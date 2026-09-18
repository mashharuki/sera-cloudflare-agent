## Commands (run from repo root unless noted)

- `pnpm format` — Biome format --write .
- `pnpm check` — Biome check --write . (lint+format, applies fixes)
- `pnpm knip` — unused files/deps/exports report
- `pnpm jscpd` — copy-paste detection over apps/ and packages/
- `pnpm backend <script>` / `pnpm frontend <script>` / `pnpm api-spec <script>` /
  `pnpm shared <script>` — shorthand for `pnpm --filter <workspace> <script>`
- Backend (`apps/backend`): `pnpm backend dev` (wrangler dev), `pnpm backend deploy` (wrangler
  deploy --minify), `pnpm backend cf-typegen` (regenerate `CloudflareBindings` types from
  wrangler.jsonc bindings — run after editing bindings).
- Frontend (`apps/frontend`): `pnpm frontend dev` (vite), `pnpm frontend build` (tsc -b && vite
  build), `pnpm frontend lint` (oxlint — separate from root Biome check), `pnpm frontend preview`.
- No test runner is configured yet anywhere in the repo (`shared` and `api-spec` package.json
  `test` scripts are npm-init placeholders that just exit 1).
- Darwin-specific: no notable deviations found yet for standard unix commands (git/ls/grep behave
  normally); update this note if that changes.
