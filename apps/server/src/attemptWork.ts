export type AttemptWorkLease = {
  signal: AbortSignal;
  finish(): void;
};

type ActiveAttemptWork = {
  controller: AbortController;
  token: object;
};

/**
 * Owns cancellable runtime work for one immutable session attempt. Replacing
 * or finishing an old lease cannot remove a newer lease for the same key.
 */
export class AttemptWorkRegistry {
  private readonly active = new Map<string, ActiveAttemptWork>();
  private closedReason?: Error;

  get activeCount(): number {
    return this.active.size;
  }

  begin(sessionId: string, attemptId: string): AttemptWorkLease {
    const key = attemptKey(sessionId, attemptId);
    const token = {};
    const controller = new AbortController();
    if (this.closedReason) {
      controller.abort(this.closedReason);
      return {
        signal: controller.signal,
        finish() {}
      };
    }
    const previous = this.active.get(key);

    this.active.set(key, { controller, token });
    previous?.controller.abort(new Error("Attempt work was superseded"));

    let finished = false;
    return {
      signal: controller.signal,
      finish: () => {
        if (finished) {
          return;
        }
        finished = true;

        if (this.active.get(key)?.token === token) {
          this.active.delete(key);
        }
      }
    };
  }

  cancel(sessionId: string, attemptId: string, reason: Error): boolean {
    const key = attemptKey(sessionId, attemptId);
    const current = this.active.get(key);
    if (!current) {
      return false;
    }

    current.controller.abort(reason);
    return true;
  }

  close(reason = new Error("Attempt work registry was closed")): void {
    if (this.closedReason) {
      return;
    }

    this.closedReason = reason;
    for (const current of this.active.values()) {
      current.controller.abort(reason);
    }
  }

  has(sessionId: string, attemptId: string): boolean {
    return this.active.has(attemptKey(sessionId, attemptId));
  }
}

function attemptKey(sessionId: string, attemptId: string): string {
  return JSON.stringify([sessionId, attemptId]);
}
