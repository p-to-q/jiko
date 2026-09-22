# Repository Setup

## Status

This repository is public source under the terms in [`LICENSE`](../LICENSE).
Public visibility applies to code, documentation, synthetic fixtures, and
deliberately published design assets. It does not authorize publishing user
recordings, real-person transcripts, credentials, private endpoints, or local
runtime receipts.

The repository profile is public-source `micro+`: small enough for a prototype,
but disciplined enough that future code has a clear place to land.

## Suggested GitHub Settings

Create the GitHub repository as:

- Visibility: public.
- Default branch: `main`.
- Issues: enabled.
- Projects: optional.
- Wiki: disabled unless needed.
- Discussions: disabled for now.
- Allow squash merge: enabled.
- Allow merge commits: disabled unless the team prefers them.
- Allow rebase merge: optional.
- Automatically delete head branches: enabled.

Branch protection can be added after the first working prototype:

- Require pull request before merging.
- Require at least one approval.
- Require status checks once CI exists.

## Files Present

- `README.md`: project entrypoint and current direction.
- `docs/product-brief.md`: product definition and interaction principles.
- `docs/engineering-discipline.md`: lightweight engineering contract for humans and agents.
- `docs/engineering-architecture.md`: shared system architecture.
- `docs/runtime-paths.md`: laptop path and Raspberry Pi hardware path.
- `docs/audio-prototype.md`: STT/TTS/audio feature extraction route.
- `docs/data-handling.md`: privacy and retention rules for recordings and transcripts.
- `docs/hardware-notes.md`: hardware shell, button, screen, Pi notes.
- `docs/repository-map.md`: short map of active and planned paths.
- `docs/open-questions.md`: unresolved product/engineering decisions.
- `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`: TypeScript workspace root.
- `apps/web`: Vite/React device UI.
- `apps/server`: local HTTP/SSE backend and mock/audio-upload loop.
- `packages/protocol`: shared event and receipt schemas.
- `packages/core`: session reducer and result composition.
- `packages/readings`: transparent first-pass reading heuristics.
- `.gitignore`: default ignored files for Node, Python, build output, secrets, logs, and local recordings.
- `.env.example`: placeholder environment variables.
- `.editorconfig`, `.gitattributes`, `.prettierrc`: small formatting defaults.
- `.github/workflows/ci.yml`: Linux host build, contracts, tests, benchmark, and
  Chromium product journeys on pull requests and `main`.
- `AGENTS.md`: local agent instructions.

## Still Missing

Add these when the relevant workflow exists:

- Production-enclosure CAD after the internal stack and dimensions are measured.
- `docs/demo-script.md` after the interaction copy is settled.

Do not add governance files or ADR trees until there is a real workflow to
support. Host CI validates the runnable workspace on pull requests and `main`;
it does not protect merges until branch protection requires the check.
Target-HIL and signed release automation remain separate future gates. The
current license is already part of the public repo.

## Secret Handling

Never commit:

- `.env`.
- API keys.
- Raw judge/user recordings unless explicitly approved.
- Private model credentials.
- Generated audio logs containing user speech.

Use `.env.example` to document required variables without including values.

## First Git Commands

```bash
git init
git add README.md docs AGENTS.md .gitignore .env.example .editorconfig .gitattributes .prettierrc
git commit -m "Add project brief and prototype architecture"
git branch -M main
git remote add origin git@github.com:ORG_OR_USER/REPO_NAME.git
git push -u origin main
```

Only run the remote commands after the intended GitHub repository exists and its
visibility and license have been checked.
