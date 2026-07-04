import { neon } from "@neondatabase/serverless";

const maxBodyBytes = 4096;
const waitlistBaseCount = readBaseCount(process.env.WAITLIST_BASE_COUNT);

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export default async function handler(request: any, response: any) {
  setHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    sendJson(response, 503, { error: "Waitlist storage is not configured" });
    return;
  }

  try {
    const sql = neon(databaseUrl);
    await ensureWaitlistTable(sql);

    if (request.method === "GET") {
      const storedCount = await readStoredCount(sql);
      sendJson(response, 200, {
        ok: true,
        waitlistCount: waitlistBaseCount + storedCount,
      });
      return;
    }

    const body = await readJsonBody(request);
    const email = normalizeWaitlistInput(stringValue(body.email));
    if (!email) {
      sendJson(response, 400, { error: "Expected a non-empty waitlist value" });
      return;
    }

    const source = sanitizeSource(stringValue(body.source));

    await sql`
      insert into waitlist_subscribers (email, source)
      values (${email}, ${source})
      on conflict (email) do update set
        source = excluded.source,
        updated_at = now()
    `;

    const storedCount = await readStoredCount(sql);

    sendJson(response, 201, {
      ok: true,
      looksLikeEmail: isValidEmail(email),
      waitlistCount: waitlistBaseCount + storedCount,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    sendJson(response, 500, { error: "Waitlist request failed" });
  }
}

async function ensureWaitlistTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql`
    create table if not exists waitlist_subscribers (
      email text primary key,
      source text not null default 'site',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
}

async function readStoredCount(sql: ReturnType<typeof neon>): Promise<number> {
  const rows = await sql`
    select count(*)::int as count
    from waitlist_subscribers
  `;

  return numberValue(rows[0]?.count) ?? 0;
}

async function readJsonBody(request: any): Promise<Record<string, unknown>> {
  const parsedBody = readParsedBody(request.body);
  if (parsedBody) {
    return parsedBody;
  }

  const chunks: string[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    totalBytes += text.length;
    if (totalBytes > maxBodyBytes) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(text);
  }

  const raw = chunks.join("").trim();
  if (!raw) {
    throw new HttpError(400, "Expected a JSON body");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Expected valid JSON");
  }

  const objectBody = readParsedBody(value);
  if (!objectBody) {
    throw new HttpError(400, "Expected a JSON object body");
  }

  return objectBody;
}

function readParsedBody(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      return readParsedBody(JSON.parse(trimmed));
    } catch {
      throw new HttpError(400, "Expected valid JSON");
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function setHeaders(response: any): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");
}

function sendJson(response: any, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function sanitizeSource(value: string | undefined): string {
  if (!value) {
    return "site";
  }

  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9:_-]{1,40}$/.test(trimmed)) {
    return "site";
  }

  return trimmed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeWaitlistInput(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalizedValue || normalizedValue.length > 254 || /[\u0000-\u001f\u007f]/.test(normalizedValue)) {
    return undefined;
  }

  return normalizedValue;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBaseCount(value: string | undefined): number {
  const parsed = Number(value ?? "0");
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    return 0;
  }

  return parsed;
}
