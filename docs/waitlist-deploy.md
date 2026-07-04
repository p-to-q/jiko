# Waitlist Deploy

The public site stores waitlist signups through a Vercel Function and Neon Postgres.

## Files

- Frontend: `apps/web/src/site.tsx`, `apps/web/src/site.css`
- API: `api/waitlist.ts`
- Env template: `.env.example`

## Vercel env

Set these on the `jiko-showcase` project:

- `DATABASE_URL` — Neon connection string
- `WAITLIST_BASE_COUNT` — optional display offset (default `0`)

## Verify after deploy

```sh
curl https://jiko-showcase.vercel.app/api/waitlist

curl -X POST https://jiko-showcase.vercel.app/api/waitlist \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","source":"site"}'
```

Then submit once on `https://jiko.ptoq.io/` and confirm the counter updates.

## Local preview

Vite does not serve `/api/waitlist`. On `localhost`, valid emails use a visual preview fallback (green + local count) when the API is missing or returns an error. Invalid non-empty submissions still show red, but the app still attempts to post them so the backend can record and count them. Production shows green only for valid email format after a real API response; invalid format keeps the red feedback even if the API records it.

To test the real API locally, run:

```sh
vercel dev
```
