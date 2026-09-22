export type AttemptDeadline = {
  signal: AbortSignal;
  /** Server-monotonic timestamp; never compare with a client monotonic clock. */
  startedAtMs: number;
  /** Server-monotonic timestamp; never compare with Date.now(). */
  expiresAtMs: number;
  timeoutMs: number;
};

type DeadlineExpiredHandler = (
  error: SessionDeadlineExceededError
) => void | Promise<void>;

type ActiveDeadline = AttemptDeadline & {
  controller: AbortController;
  onExpired: DeadlineExpiredHandler;
  timeout: ReturnType<typeof setTimeout>;
  token: object;
};

export class SessionDeadlineExceededError extends Error {
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly timeoutMs: number;

  constructor(startedAtMs: number, expiresAtMs: number, timeoutMs: number) {
    super(`Session processing exceeded its ${timeoutMs} ms deadline`);
    this.name = "SessionDeadlineExceededError";
    this.startedAtMs = startedAtMs;
    this.expiresAtMs = expiresAtMs;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Owns one monotonic processing deadline per immutable session attempt.
 * Repeated callers observe the original deadline and cannot extend it.
 */
export class AttemptDeadlineRegistry {
  private readonly active = new Map<string, ActiveDeadline>();
  private closedReason?: Error;

  constructor(readonly timeoutMs = configuredSessionDeadlineMs()) {
    this.timeoutMs = Math.max(1, Math.round(timeoutMs));
  }

  get activeCount(): number {
    return this.active.size;
  }

  ensure(
    sessionId: string,
    attemptId: string,
    startedAtMs: number,
    onExpired: DeadlineExpiredHandler
  ): AttemptDeadline {
    const key = attemptKey(sessionId, attemptId);
    const existing = this.active.get(key);
    if (existing) {
      return publicDeadline(existing);
    }

    const controller = new AbortController();
    const normalizedStartedAtMs = Number.isFinite(startedAtMs)
      ? startedAtMs
      : performance.now();
    const expiresAtMs = normalizedStartedAtMs + this.timeoutMs;
    if (this.closedReason) {
      controller.abort(this.closedReason);
      return {
        signal: controller.signal,
        startedAtMs: normalizedStartedAtMs,
        expiresAtMs,
        timeoutMs: this.timeoutMs
      };
    }

    const token = {};
    const timeout = setTimeout(() => {
      this.expireActive(key, token, sessionId, attemptId);
    }, Math.max(0, expiresAtMs - performance.now()));
    timeout.unref?.();

    const deadline: ActiveDeadline = {
      controller,
      expiresAtMs,
      onExpired,
      signal: controller.signal,
      startedAtMs: normalizedStartedAtMs,
      timeout,
      timeoutMs: this.timeoutMs,
      token
    };
    this.active.set(key, deadline);
    return publicDeadline(deadline);
  }

  get(sessionId: string, attemptId: string): AttemptDeadline | undefined {
    const deadline = this.active.get(attemptKey(sessionId, attemptId));
    return deadline ? publicDeadline(deadline) : undefined;
  }

  /**
   * Timers cannot fire while synchronous DSP blocks the event loop. Call this
   * at commit boundaries so an overdue result cannot win merely because the
   * timer callback was delayed.
   */
  expireIfDue(
    sessionId: string,
    attemptId: string,
    nowMs = performance.now()
  ): SessionDeadlineExceededError | undefined {
    const key = attemptKey(sessionId, attemptId);
    const current = this.active.get(key);
    if (!current || nowMs < current.expiresAtMs) {
      return undefined;
    }

    return this.expireActive(key, current.token, sessionId, attemptId);
  }

  cancel(
    sessionId: string,
    attemptId: string,
    reason = new Error("Session processing deadline was cancelled")
  ): boolean {
    const key = attemptKey(sessionId, attemptId);
    const current = this.active.get(key);
    if (!current) {
      return false;
    }

    this.active.delete(key);
    clearTimeout(current.timeout);
    current.controller.abort(reason);
    return true;
  }

  close(reason = new Error("Session deadline registry was closed")): void {
    if (this.closedReason) {
      return;
    }

    this.closedReason = reason;
    for (const current of this.active.values()) {
      clearTimeout(current.timeout);
      current.controller.abort(reason);
    }
    this.active.clear();
  }

  private expireActive(
    key: string,
    token: object,
    sessionId: string,
    attemptId: string
  ): SessionDeadlineExceededError | undefined {
    const current = this.active.get(key);
    if (!current || current.token !== token) {
      return undefined;
    }

    this.active.delete(key);
    clearTimeout(current.timeout);
    const error = new SessionDeadlineExceededError(
      current.startedAtMs,
      current.expiresAtMs,
      current.timeoutMs
    );
    let expiration: void | Promise<void> = undefined;
    try {
      // Async handlers execute synchronously until their first await. Route
      // handlers use that window to seal the attempt before this signal is
      // observed by provider work.
      expiration = current.onExpired(error);
    } catch (handlerError) {
      reportDeadlineHandlerFailure(sessionId, attemptId, handlerError);
    }
    current.controller.abort(error);
    if (expiration) {
      void expiration.catch((handlerError) => {
        reportDeadlineHandlerFailure(sessionId, attemptId, handlerError);
      });
    }
    return error;
  }
}

export function configuredSessionDeadlineMs(): number {
  const configured = Number(process.env.SESSION_DEADLINE_MS);
  if (!Number.isFinite(configured)) {
    return 4_000;
  }

  return Math.max(250, Math.min(60_000, Math.round(configured)));
}

export function configuredResultCommitReserveMs(totalTimeoutMs: number): number {
  const configured = Number(process.env.SESSION_RESULT_COMMIT_RESERVE_MS);
  const requested = Number.isFinite(configured) ? Math.round(configured) : 750;
  return Math.max(1, Math.min(Math.max(1, totalTimeoutMs - 1), requested));
}

function publicDeadline(deadline: ActiveDeadline): AttemptDeadline {
  return {
    signal: deadline.signal,
    startedAtMs: deadline.startedAtMs,
    expiresAtMs: deadline.expiresAtMs,
    timeoutMs: deadline.timeoutMs
  };
}

function attemptKey(sessionId: string, attemptId: string): string {
  return JSON.stringify([sessionId, attemptId]);
}

function reportDeadlineHandlerFailure(
  sessionId: string,
  attemptId: string,
  error: unknown
): void {
  console.error(
    `Session deadline handler failed for ${sessionId}/${attemptId}`,
    error
  );
}
