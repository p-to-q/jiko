# Waitlist Deploy

The public site stores waitlist signups through a Vercel Function and Neon Postgres.

## Files

- Frontend: `apps/web/src/site.tsx`, `apps/web/src/site.css`
- API: `api/waitlist.ts`
- Env template: `.env.example`

## Vercel env

The `jiko` Vercel project (team `moapachas-projects`) gets its database from the
Vercel-native Neon integration: the `jiko-mailing-list` store is connected to the
project and injects `DATABASE_URL` (plus `POSTGRES_URL` and friends) into
production, preview, and development automatically — no manual env setup needed.

- `DATABASE_URL` — injected by the Neon store connection
- `WAITLIST_BASE_COUNT` — optional display offset (default `0`), set manually if wanted

## Verify after deploy

```sh
curl https://jiko.ptoq.io/api/waitlist

curl -X POST https://jiko.ptoq.io/api/waitlist \
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
