declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>;
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
    dirname(value: string): string;
    join(...values: string[]): string;
  };
  export default path;
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

declare function setInterval(handler: () => void, timeoutMs: number): unknown;
declare function clearInterval(handle: unknown): void;
