export type OutputTask = (signal: AbortSignal) => Promise<void>;

export type OutputTaskOutcome =
  | {
      key: string;
      status: "completed";
    }
  | {
      key: string;
      status: "cancelled";
      reason: unknown;
    }
  | {
      key: string;
      status: "failed";
      error: unknown;
    };

type ActiveOutput = {
  key: string;
  token: symbol;
  controller: AbortController;
};

/**
 * Owns one local output slot. Replacement is latest-wins, but the next task
 * does not start until the cancelled task has actually settled, so cooperative
 * cleanup cannot overlap two speakers or playback processes.
 */
export class OutputScheduler {
  private activeOutput?: ActiveOutput;
  private closedReason?: unknown;
  private tail: Promise<void> = Promise.resolve();
  private readonly idleWaiters = new Set<() => void>();

  get activeKey(): string | undefined {
    return this.activeOutput?.key;
  }

  get idle(): boolean {
    return this.activeOutput === undefined;
  }

  schedule(key: string, task: OutputTask): Promise<OutputTaskOutcome> {
    if (this.closedReason !== undefined) {
      return Promise.resolve({
        key,
        status: "cancelled",
        reason: this.closedReason
      });
    }

    const predecessor = this.tail;
    const replacedOutput = this.activeOutput;
    const output: ActiveOutput = {
      key,
      token: Symbol(key),
      controller: new AbortController()
    };

    this.activeOutput = output;
    const completion = this.run(output, predecessor, task);
    this.tail = completion.then(() => undefined);

    if (replacedOutput) {
      replacedOutput.controller.abort(
        new Error(`Output task ${replacedOutput.key} was replaced by ${key}`)
      );
    }

    return completion;
  }

  cancelActive(reason?: unknown): void {
    const activeOutput = this.activeOutput;
    if (!activeOutput || activeOutput.controller.signal.aborted) {
      return;
    }

    activeOutput.controller.abort(
      reason ?? new Error(`Output task ${activeOutput.key} was cancelled`)
    );
  }

  cancel(key: string, reason?: unknown): boolean {
    const activeOutput = this.activeOutput;
    if (
      !activeOutput ||
      activeOutput.key !== key ||
      activeOutput.controller.signal.aborted
    ) {
      return false;
    }

    activeOutput.controller.abort(
      reason ?? new Error(`Output task ${activeOutput.key} was cancelled`)
    );
    return true;
  }

  close(reason?: unknown): void {
    if (this.closedReason !== undefined) {
      return;
    }

    this.closedReason = reason ?? new Error("Output scheduler was closed");
    this.cancelActive(this.closedReason);
  }

  waitForIdle(): Promise<void> {
    if (this.idle) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  private async run(
    output: ActiveOutput,
    predecessor: Promise<void>,
    task: OutputTask
  ): Promise<OutputTaskOutcome> {
    try {
      await predecessor;

      if (output.controller.signal.aborted) {
        return cancelledOutcome(output);
      }

      await task(output.controller.signal);

      return output.controller.signal.aborted
        ? cancelledOutcome(output)
        : { key: output.key, status: "completed" };
    } catch (error) {
      return output.controller.signal.aborted
        ? cancelledOutcome(output)
        : { key: output.key, status: "failed", error };
    } finally {
      this.finish(output);
    }
  }

  private finish(output: ActiveOutput): void {
    if (this.activeOutput?.token !== output.token) {
      return;
    }

    this.activeOutput = undefined;
    const waiters = [...this.idleWaiters];
    this.idleWaiters.clear();

    for (const resolve of waiters) {
      resolve();
    }
  }
}

function cancelledOutcome(output: ActiveOutput): OutputTaskOutcome {
  return {
    key: output.key,
    status: "cancelled",
    reason: output.controller.signal.reason
  };
}
