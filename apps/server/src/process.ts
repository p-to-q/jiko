import { spawn } from "node:child_process";

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

type ProcessInput = {
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maximum bytes retained from each of stdout and stderr. */
  maxOutputBytes?: number;
};

export class ProcessTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`${command} timed out after ${timeoutMs} ms`);
    this.name = "ProcessTimeoutError";
  }
}

export class ProcessAbortError extends Error {
  constructor(command: string) {
    super(`${command} was cancelled`);
    this.name = "ProcessAbortError";
  }
}

export class ProcessOutputLimitError extends Error {
  constructor(command: string, stream: "stdout" | "stderr", maxOutputBytes: number) {
    super(`${command} ${stream} exceeded ${maxOutputBytes} bytes`);
    this.name = "ProcessOutputLimitError";
  }
}

export function runProcess(command: string, args: string[], input: ProcessInput = {}): Promise<ProcessResult> {
  const maxOutputBytes = resolveMaxOutputBytes(input.maxOutputBytes);
  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(new ProcessAbortError(command));
      return;
    }

    const child = spawn(command, args, { stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let terminationError: Error | undefined;
    let terminating = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const terminate = (error: Error) => {
      terminationError ??= error;
      if (terminating) {
        return;
      }
      terminating = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 250);
      forceKill.unref?.();
    };
    const timeout = input.timeoutMs
      ? setTimeout(() => {
          terminate(new ProcessTimeoutError(command, input.timeoutMs ?? 0));
        }, input.timeoutMs)
      : undefined;
    timeout?.unref();
    const handleAbort = () => {
      terminate(new ProcessAbortError(command));
    };
    input.signal?.addEventListener("abort", handleAbort, { once: true });

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
      input.signal?.removeEventListener("abort", handleAbort);
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const resolveOnce = (result: ProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    child.stdout?.on("data", (chunk: unknown) => {
      if (terminationError) {
        return;
      }
      const bytes = processOutputChunk(chunk);
      if (maxOutputBytes !== undefined && stdoutBytes + bytes.byteLength > maxOutputBytes) {
        terminate(new ProcessOutputLimitError(command, "stdout", maxOutputBytes));
        return;
      }
      stdoutBytes += bytes.byteLength;
      stdout.push(bytes);
    });

    child.stderr?.on("data", (chunk: unknown) => {
      if (terminationError) {
        return;
      }
      const bytes = processOutputChunk(chunk);
      if (maxOutputBytes !== undefined && stderrBytes + bytes.byteLength > maxOutputBytes) {
        terminate(new ProcessOutputLimitError(command, "stderr", maxOutputBytes));
        return;
      }
      stderrBytes += bytes.byteLength;
      stderr.push(bytes);
    });

    child.on("error", (error) => {
      rejectOnce(terminationError ?? error);
    });
    child.stdin?.on("error", (error) => {
      child.kill("SIGKILL");
      rejectOnce(terminationError ?? error);
    });
    child.on("close", (code) => {
      if (terminationError) {
        rejectOnce(terminationError);
        return;
      }

      const result = {
        stdout: Buffer.concat(stdout, stdoutBytes).toString(),
        stderr: Buffer.concat(stderr, stderrBytes).toString()
      };

      if (code === 0) {
        resolveOnce(result);
        return;
      }

      const message = result.stderr.trim() || result.stdout.trim() || `Process exited with code ${code}`;
      rejectOnce(new Error(`${command} failed: ${message}`));
    });

    if (input.stdin !== undefined) {
      child.stdin?.end(input.stdin);
    }
  });
}

function resolveMaxOutputBytes(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("maxOutputBytes must be a positive safe integer");
  }
  return value;
}

function processOutputChunk(chunk: unknown): Buffer {
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
}
