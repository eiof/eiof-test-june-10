// Heavily inspired by: https://github.com/softprops/turnstyle
// This script does the same as the github action above, but takes `queued`
// jobs into account in addition to in progress jobs

const delay = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms));

const getRuns = async (github, context, input) => {
  const { owner, repo } = context.repo;

  const options = {
    owner,
    repo,
    branch: input.branch,
  };

  const inProgressOptions = {
    ...options,
    status: 'in_progress',
  };

  const queuedOptions = {
    ...options,
    status: 'queued',
  };

  const inProgressRunsPromise = github.paginate(
    github.rest.actions.listWorkflowRunsForRepo,
    inProgressOptions,
  );

  const queuedRunsPromise = github.paginate(
    github.rest.actions.listWorkflowRunsForRepo,
    queuedOptions,
  );

  const fetchRuns = async () => await Promise.all([
    inProgressRunsPromise,
    queuedRunsPromise,
  ]);

  let lastError = null;

  // Retry up to 3 times on Github API Request failure
  for (let attempt = 0; attempt < 3; ++attempt) {
    if (attempt > 0) await delay(1000);
    try {
      const data = await fetchRuns();
      return data.flat(Infinity);
    } catch (error) {
      lastError = error;
    }
  }
  
  throw lastError;
};

const pollWorkflows = async (github, context, input) => {
  const workflowName = context.workflow;

  while (true) {
    const runs = await getRuns(github, context, input);

    const newerRuns = runs
      .filter((run) => run.name === workflowName && run.id > context.id);

    if (newerRuns.length) {
      const { owner, repo } = context.repo;
      const cancelOptions = {
        owner,
        repo,
        run_id: context.id,
      };

      console.log('Canceling workflow run, newer build has started.');

      await github.request(
        github.rest.actions.cancelWorkflowRun,
        cancelOptions,
      )

      // Wait up to 5 min for cancel
      // otherwise fall through the loop and try again
      await delay(300 * 1000);
      continue;
    }

    const previousRuns = runs
      .filter((run) => run.name === workflowName && run.id < context.runId)
      .sort((a, b) => b.id - a.id);

    if (!previousRuns.length) {
      // No other runs
      break;
    }

    console.log('Awaiting runs:');
    for (const run of previousRuns) {
      console.log(`  ${run.html_url}`);
    }

    // Wait 30 seconds before checking again
    await delay(input.delay * 1000);
  }
};

const wait = async (github, context, input) => {
  console.log('Checking for running builds...');

  await pollWorkflows(github, context, input);

  console.log('No other builds in progress. Continuing...');
};

export default wait;
