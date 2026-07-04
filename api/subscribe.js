import { neon } from "@neondatabase/serverless";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_EMAIL_LENGTH = 254;

let schemaReady;

function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS mailing_list_subscribers (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        source text
      )
    `.catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  const email = normalizeEmail(body.email);
  if (!email) {
    return res.status(400).json({
      ok: false,
      error: "invalid_email",
      message: "Please enter a valid email address.",
    });
  }

  const sql = neon(process.env.DATABASE_URL);
  await ensureSchema(sql);

  const source = typeof body.source === "string" ? body.source.slice(0, 64) : "site";
  const inserted = await sql`
    INSERT INTO mailing_list_subscribers (email, source)
    VALUES (${email}, ${source})
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;

  if (inserted.length > 0) {
    return res.status(200).json({
      ok: true,
      status: "subscribed",
      message: "You're on the list. We'll be in touch.",
    });
  }

  return res.status(200).json({
    ok: true,
    status: "already_subscribed",
    message: "You're already on the list.",
  });
}
