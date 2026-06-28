declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string): Promise<Buffer>;
  export function rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string | Uint8Array, encoding?: string): Promise<void>;
}

declare module "node:child_process" {
  export function spawn(command: string, args?: string[], options?: { stdio?: string[] }): {
    stdin?: {
      end(value?: string): void;
    };
    on(event: "error", listener: (error: Error) => void): void;
    on(event: "close", listener: (code: number | null) => void): void;
    stderr?: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
    stdout?: {
      on(event: "data", listener: (chunk: unknown) => void): void;
    };
  };
}

declare module "node:http" {
  const http: {
    createServer(handler: (request: any, response: any) => void): {
      listen(port: number, host: string, callback?: () => void): void;
      close(callback?: () => void): void;
    };
  };
  export default http;
}

declare module "node:path" {
  const path: {
    basename(value: string): string;
    dirname(value: string): string;
    extname(value: string): string;
    join(...values: string[]): string;
  };
  export default path;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:url" {
  export function fileURLToPath(value: string): string;
}

declare const console: {
  error(...values: unknown[]): void;
  log(...values: unknown[]): void;
};

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  on(event: string, listener: () => void): void;
  uptime(): number;
};

declare class Blob {
  constructor(parts: unknown[], options?: { type?: string });
}

declare class FormData {
  append(name: string, value: unknown, fileName?: string): void;
}

declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  }
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

declare function setInterval(handler: () => void, timeoutMs: number): unknown;
declare function clearInterval(handle: unknown): void;
