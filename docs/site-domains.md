# Site Domains

Canonical public origin:

- `https://jiko.ptoq.io`

Fallback / Vercel deployment origin:

- `https://jiko-eosin.vercel.app`

Configuration notes:

- Vercel project: `jiko` in the moapacha account (team `moapachas-projects`), git-connected to `p-to-q/jiko` `main`.
- The former `jiko-showcase` project (`jiko-showcase.vercel.app`) lives in a different, old Vercel account and is no longer canonical.
- Production should serve `jiko.ptoq.io` as the public URL.
- Keep `jiko-eosin.vercel.app` available as the deployment fallback and troubleshooting URL.
- HTML canonical and social metadata should point at `https://jiko.ptoq.io/`.
