import { spawn } from "node:child_process";

export type ProcessResult = {
  stdout: string;
  stderr: string;
};

type ProcessInput = {
  stdin?: string;
};

export function runProcess(command: string, args: string[], input: ProcessInput = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const stdout: string[] = [];
    const stderr: string[] = [];

    if (input.stdin !== undefined) {
      child.stdin?.end(input.stdin);
    }

    child.stdout?.on("data", (chunk) => {
      stdout.push(String(chunk));
    });

    child.stderr?.on("data", (chunk) => {
      stderr.push(String(chunk));
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: stdout.join(""),
        stderr: stderr.join("")
      };

      if (code === 0) {
        resolve(result);
        return;
      }

      const message = result.stderr.trim() || result.stdout.trim() || `Process exited with code ${code}`;
      reject(new Error(`${command} failed: ${message}`));
    });
  });
}
