import { transfersQueue, payoutCronQueue } from "../../src/queues/queues";
import type { DisbursementJobData } from "../../src/modules/scheduler/disbursement-job.types";

/**
 * Returns every job currently sitting in the transfers queue across all
 * non-terminal states. Tests never run the actual worker, so an enqueued
 * job just sits 'waiting' — this is enough to assert enqueue behavior
 * (payload shape, priority, count) without needing a live worker or Nomba.
 */
export async function getTransferQueueJobs() {
  // Every job this app enqueues has a nonzero `priority` (see
  // queues/names.ts's TransferPriority). In BullMQ v5, a prioritized job
  // sits in a distinct 'prioritized' state until a worker claims it — it
  // is NOT in 'waiting' the way an unprioritized job would be. Omitting
  // this state here silently returns zero jobs for every real enqueue
  // this app performs. Falls back to the pre-v5 state list if the
  // installed BullMQ version doesn't recognize 'prioritized'.
  let jobs;
  try {
    jobs = await transfersQueue.getJobs(["waiting", "active", "delayed", "paused", "prioritized"]);
  } catch {
    jobs = await transfersQueue.getJobs(["waiting", "active", "delayed", "paused"]);
  }
  return jobs.map((job) => ({ name: job.name, priority: job.priority, data: job.data as DisbursementJobData }));
}

/** Wipes all jobs from both queues — call in beforeEach so job counts from a previous test never bleed into the next. */
export async function drainQueues(): Promise<void> {
  await transfersQueue.obliterate({ force: true });
  await payoutCronQueue.obliterate({ force: true });
}

/** Closes both queues' Redis connections — call once per test file in an `after` hook. */
export async function closeQueues(): Promise<void> {
  await transfersQueue.close();
  await payoutCronQueue.close();
}