import { neon } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";

export default async function handler(request: any, response: any) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization");
  response.setHeader("cache-control", "no-store");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    sendJson(response, 503, { error: "Admin access is not configured" });
    return;
  }

  const token = extractToken(request);
  if (!token || !safeEqual(token, adminSecret)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!databaseUrl) {
    sendJson(response, 503, { error: "Database is not configured" });
    return;
  }

  try {
    const sql = neon(databaseUrl);
    await sql`
      CREATE TABLE IF NOT EXISTS waitlist_subscribers (
        email text primary key,
        source text not null default 'site',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    const rows = await sql`
      SELECT email, source, created_at, updated_at
      FROM waitlist_subscribers
      ORDER BY created_at DESC
    `;

    sendJson(response, 200, {
      ok: true,
      total: rows.length,
      subscribers: rows,
    });
  } catch {
    sendJson(response, 500, { error: "Failed to query subscribers" });
  }
}

function safeEqual(a: string, b: string): boolean {
  const digestA = new Uint8Array(createHash("sha256").update(a).digest());
  const digestB = new Uint8Array(createHash("sha256").update(b).digest());
  return timingSafeEqual(digestA, digestB);
}

function extractToken(request: any): string | undefined {
  const authHeader = request.headers?.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const url = new URL(request.url ?? "", `http://${request.headers?.host}`);
  return url.searchParams.get("secret") ?? undefined;
}

function sendJson(response: any, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}
