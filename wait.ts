// Heavily inspired by: https://github.com/softprops/turnstyle
// This script does the same as the github action above, but takes `queued`
// jobs into account in addition to in progress jobs

const delay = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms));

const getWorkflows = async (github, context) => {
  const { owner, repo } = context.repo;

  const options = {
    owner,
    repo,
  };

  return github.paginate(github.rest.actions.listRepoWorkflows, options);
};

const getRuns = async (github, context, input, workflow_id) => {
  const { owner, repo } = context.repo;

  const options = {
    owner,
    repo,
    workflow_id,
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
    github.rest.actions.listWorkflowRuns,
    inProgressOptions,
  );

  const queuedRunsPromise = github.paginate(
    github.rest.actions.listWorkflowRuns,
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

const pollWorkflows = async (github, context, input, workflow_id) => {
  while (true) {
    const runs = await getRuns(github, context, input, workflow_id);

    const newerRuns = runs
      .filter((run) => run.id > context.id);

    if (newerRuns.length) {
      const { owner, repo } = context.repo;
      const cancelOptions = {
        owner,
        repo,
        run_id: context.id,
      };

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
      .filter((run) => run.id < context.runId)
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

  const workflows = await getWorkflows(github, context);
  const current_workflow = workflows.find(
    (workflow) => workflow.name === context.workflow,
  );

  if (current_workflow && current_workflow.id) {
    await pollWorkflows(github, context, input, current_workflow.id);
  }

  console.log('No other builds in progress. Continuing...');
};

export default wait;
