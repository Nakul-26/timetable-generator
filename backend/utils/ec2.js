import AWS from "aws-sdk";

const ec2 = new AWS.EC2({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

export const startEC2 = async () => {
  const instanceId = process.env.EC2_INSTANCE_ID;
  if (!instanceId) throw new Error("EC2_INSTANCE_ID is not set in environment");

  const res = await ec2
    .describeInstances({ InstanceIds: [instanceId] })
    .promise();

  const state = res?.Reservations?.[0]?.Instances?.[0]?.State?.Name;

  console.log("EC2 state:", state);

  if (state === "running") {
    console.log("EC2 already running");
    return;
  }

  console.log("Starting EC2...");

  await ec2
    .startInstances({
      InstanceIds: [instanceId],
    })
    .promise();
};

export const waitForSolver = async (opts = {}) => {
  const solverUrl = process.env.SOLVER_URL;
  if (!solverUrl) throw new Error("SOLVER_URL is not set in environment");

  const healthUrl = `${solverUrl.replace(/\/+$/, '')}/health`;
  const intervalMs = opts.intervalMs || 3000;
  const timeoutMs = opts.timeoutMs || 120000; // default 2 minutes
  const start = Date.now();

  while (true) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        console.log("Solver is ready");
        return;
      }
    } catch (err) {
      console.log("Waiting for solver...");
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error("Timeout waiting for solver to become ready");
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
};
