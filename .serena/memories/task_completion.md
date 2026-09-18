## Definition of done (current state of the repo)

No CI workflow or pre-commit/pre-push hook config was found yet (no `.github/workflows`,
no husky config in root `package.json`). Until such automation exists, run manually before
considering a change complete:

1. `pnpm check` (Biome format+lint, repo root) — covers backend and root-level TS/JS.
2. `pnpm frontend lint` (oxlint) if frontend files changed — Biome's `files.includes` doesn't
   exclude frontend, but frontend also has its own oxlint config; run both.
3. `pnpm frontend build` (`tsc -b && vite build`) if frontend files changed — type-checks via
   project references.
4. `pnpm backend cf-typegen` if `apps/backend/wrangler.jsonc` bindings changed, then re-check
   `apps/backend/src/index.ts` compiles against the regenerated `CloudflareBindings` type.
5. `pnpm knip` and `pnpm jscpd` are available for unused-code / duplication checks but are not
   confirmed to be wired into any enforced gate — run on request, not required by default.
6. No test suite exists yet (`vitest`/`playwright` are planned per `docs/memo.md` but not
   installed) — do not claim "tests pass" until they're actually added.
