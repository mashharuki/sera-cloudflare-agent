import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

type TransactionTrackerParams = {
  operationId: string;
};

export class TransactionTracker extends WorkflowEntrypoint<
  CloudflareBindings,
  TransactionTrackerParams
> {
  async run(
    event: Readonly<WorkflowEvent<TransactionTrackerParams>>,
    step: WorkflowStep,
  ): Promise<never> {
    return await step.do(
      "reject-unimplemented-transaction-tracker",
      {
        retries: {
          limit: 0,
          delay: "1 second",
        },
        timeout: "10 seconds",
      },
      async () => {
        throw new Error(
          `Transaction tracking is not implemented for operation ${event.payload.operationId}.`,
        );
      },
    );
  }
}
