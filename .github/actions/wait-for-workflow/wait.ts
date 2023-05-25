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

  const inProgressRunsPromise = github.paginate(
    github.rest.actions.listWorkflowRunsForRepo,
    { ...options, status: 'in_progress' }
  );

  const queuedRunsPromise = github.paginate(
    github.rest.actions.listWorkflowRunsForRepo,
    { ...options, status: 'queued' }
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

const cancelSelf = async (github, context) => {
  console.log('Canceling this workflow, a newer workflow has started.');
  
  const { owner, repo } = context.repo;
  await github.rest.actions.cancelWorkflowRun({
    owner,
    repo,
    run_id: context.runId,
  });

  // Wait up to five minutes for cancelation
  await delay(300 * 100)

  // Fail the workflow if cancelation is taking too long
  throw new Error("Unexpectedly failed to cancel this workflow.");
}

const pollRuns = async (github, context, input) => {
  console.log('Checking for other workflows...');

  const workflowName = context.workflow;
  const runId = context.runId;

  while (true) {
    const runs = await getRuns(github, context, input);

    const newerRun = runs.find((run) => run.name === workflowName && run.id > runId);

    if (newerRun) {
      await cancelSelf(github, context);
    }

    const previousRuns = runs
      .filter((run) => run.name === workflowName && run.id < context.runId)
      .sort((a, b) => b.id - a.id);

    if (!previousRuns.length) {
      console.log('No other workflows in progress. Continuing...');
      break;
    }

    console.log('Awaiting runs:');
    previousRuns.forEach((run) => console.log(`  ${run.html_url}`));

    // Wait before checking again
    await delay(input.delay * 1000);
  }
};

const wait = async (core, github, context) => {
  const branch =  core.getInput('branch');
  const delay =  Number(core.getInput('delay'));
  const rawCancelOnNewerWorkflow = core.getInput('cancelOnNewerWorkflow');
  const cancelOnNewerWorkflow = rawCancelOnNewerWorkflow === true || rawCancelOnNewerWorkflow === 'true';
  
  const input = {
    branch,
    delay,
    cancelOnNewerWorkflow,
  };

  return await pollRuns(github, context, input);
}

module.exports = wait;