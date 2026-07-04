# Site Domains

Canonical public origin:

- `https://jiko.ptoq.io`

Fallback / Vercel frontend origin:

- `https://jiko-showcase.vercel.app`

Configuration notes:

- Vercel project: `jiko-showcase`
- Production should serve `jiko.ptoq.io` as the public URL shown from `p-to-q/site`.
- Keep `jiko-showcase.vercel.app` available as the deployment fallback and troubleshooting URL.
- HTML canonical and social metadata should point at `https://jiko.ptoq.io/`.
