## Tech stack

- Package manager: pnpm workspaces (`pnpm-workspace.yaml`: `apps/*`, `packages/*`), pinned
  `packageManager: pnpm@11.24.0` in root `package.json`.
- Language: TypeScript throughout (`"type": "module"` everywhere).
- Backend (`apps/backend`): Hono (`hono@^4`) on Cloudflare Workers via Wrangler
  (`wrangler@^4`). Entry point `src/index.ts`. `wrangler.jsonc` compatibility_date is
  auto-bumped to current date (no `nodejs_compat` flag enabled yet — commented out).
- Frontend (`apps/frontend`): Vite 8 + React 19, TypeScript project-references build
  (`tsc -b && vite build`), linted with `oxlint` (not Biome) via `.oxlintrc.json`.
- Root-level tooling: Biome 2.5.11 (format+lint, double-quote JS strings, organize-imports on
  save) — `biome.json` excludes `.agents`, `.wrangler`, generated worker-configuration.d.ts
  files. `knip` for unused-code detection. `jscpd` for copy-paste detection
  (`pnpm jscpd` scans `./apps ./packages`).
- Planned but not yet present in code (per `docs/memo.md` requirements): Strands Agents TS SDK,
  sera-mcp / sera-agents, Privy, zod, zustand, Tanstack, Material UI, React Bits, vitest,
  Playwright, OpenAPI Generator, Postman/Newman. Do not assume these are wired up — check
  actual `package.json` files before relying on them.
