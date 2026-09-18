# AGENTS.md

This file provides guidance to AI Codeing Agent when working with code in this repository.

## ETH Skills

Read https://ethskills.com/SKILL.md and follow it before writing Solidity or shipping anything onchain.

## Project state

This is a very early-stage skeleton. `apps/backend` and `apps/frontend` are still close to
their default scaffolds (Hono "hello world" Worker; default Vite+React template).
`packages/shared` and `packages/api-spec` are empty stubs — `packages/api-spec/openapi.yaml`
is a 0-byte placeholder. There is no CI workflow and no test runner installed yet.

The actual product requirements live in `docs/memo.md` (Japanese): a fully serverless Sera
Protocol AI chatbot on Cloudflare Workers + Pages — wallet creation, balance check, order
book/trade info, stablecoin swap, transfer, and tx-status confirmation, built on the Strands
Agents TypeScript SDK, `sera-mcp`, `sera-agents`, and Privy for wallet auth/signing. Read that
file directly for the full spec (goals, required tech, Workers-compatibility investigation
scope, architecture decisions to make, wallet/tx design constraints, monorepo/API layout,
deploy/destroy requirements, README/blog deliverables, and completion criteria) rather than
relying on a paraphrase here, since it is long and will keep evolving as the project is scoped.

## Commands

Run from the repo root unless noted. Package manager is pnpm (`pnpm@11.24.0` pinned in
`package.json`), workspaces are `apps/*` and `packages/*`.

- `pnpm check` — Biome format+lint with autofix (repo root scope; excludes `.agents`, `.wrangler`, generated worker-configuration.d.ts files)
- `pnpm format` — Biome format --write only
- `pnpm knip` — unused files/deps/exports report
- `pnpm jscpd` — copy-paste detection over `apps/` and `packages/`
- `pnpm backend <script>` / `pnpm frontend <script>` / `pnpm api-spec <script>` / `pnpm shared <script>` — shorthand for `pnpm --filter <workspace> <script>`

Backend (`apps/backend`, Hono on Cloudflare Workers via Wrangler):
- `pnpm backend dev` — `wrangler dev`
- `pnpm backend deploy` — `wrangler deploy --minify`
- `pnpm backend cf-typegen` — regenerate the `CloudflareBindings` type from `wrangler.jsonc` bindings; run this after editing bindings, then re-check `src/index.ts` still compiles against the regenerated type

Frontend (`apps/frontend`, Vite + React 19):
- `pnpm frontend dev` — vite dev server
- `pnpm frontend build` — `tsc -b && vite build` (type-checks via TS project references, then builds)
- `pnpm frontend lint` — `oxlint` (separate linter from root Biome — run both when touching frontend code)
- `pnpm frontend preview` — preview a production build

No test suite exists yet anywhere in the repo (`vitest`/`playwright` are planned per
`docs/memo.md` but not installed — don't claim "tests pass"). There is no CI workflow or git
hook config, so the commands above must be run manually before considering work done.

## Architecture

- pnpm workspace monorepo: `apps/*` for deployables, `packages/*` for shared code/specs.
- `apps/backend/wrangler.jsonc`: `compatibility_date` tracks current date, `nodejs_compat` is
  present but commented out — don't assume Node.js compatibility APIs are available until this
  is explicitly enabled and verified against the actual dependency's Workers-compatibility
  requirements (this is a central open question per `docs/memo.md`).
- `apps/frontend` uses TypeScript project references (`tsconfig.json` → `tsconfig.app.json` /
  `tsconfig.node.json`); build with `tsc -b`, not a single-project `tsc`.
- `packages/api-spec/openapi.yaml` is intended to be the source-of-truth API contract (OpenAPI +
  a generator), per `docs/memo.md` — not yet populated.
- Linting/formatting is split: root **Biome** (`biome.json`) covers backend + root-level
  TS/JS/JSON and does *not* apply to the frontend's own linter; frontend uses **oxlint**
  (`apps/frontend/.oxlintrc.json`) independently. Run both when frontend files change.

## Repo-local rule files (duplicated, keep both in sync)

`.claude/rules/*.md` and `.agents/rules/*.md` are byte-identical duplicate rule sets, and
`.claude/skills/*` mirrors `.agents/skills/*` the same way — these are plain directories, not
symlinks, so editing one copy without the other causes silent drift. The rules cover:

- **code-style.md** — `const` over `let`/never `var`; early returns; functions under 50 lines;
  `is`/`has`/`should`-prefixed booleans; verb-noun function names; explicit return types on
  exported TS functions; `type` for object shapes vs `interface` for extendable contracts;
  `unknown` over `any`; discriminated unions over optional fields; `satisfies` over `as`;
  Result-pattern (`{ ok: true, data } | { ok: false, error }`) for expected failures, throw only
  for programmer errors; import grouping (external → internal → relative) with `@/` path aliases.
- **git-workflow.md** — Conventional Commits; `feat/<ticket-id>-<desc>` / `fix/<ticket-id>-<desc>`
  branches; never push directly to `main`; squash merge to main; PRs under ~400 lines of diff.
- **testing.md** — colocated `foo.ts` → `foo.test.ts`; `describe`/`it('should X when Y')` naming;
  factory functions (not raw objects) for test data; mock at module boundaries, not internals.
- **security.md** — zod validation at all external boundaries; never hardcode secrets/log
  tokens; parameterized queries only; check auth then authz on every protected route.
- **speckit-language.md** — all Spec Kit (`/speckit-*`, `.specify/`) generated documents must be
  written in **Japanese**; code identifiers, error codes, standard/protocol names, and git commit
  messages stay in English.
- **development.md** (Japanese) — prefer Chrome DevTools MCP over Claude-in-Chrome MCP for
  browser automation in this repo; use subagents for investigation/debugging to conserve
  context; never assert "no change needed" / make codebase-wide claims without first running a
  `grep -rn` sweep across all files as evidence; route large outputs (>500 lines or hundreds of
  KB — raw diffs, big grep dumps, long logs) through a subagent that returns only a summary/JSON,
  never straight into the main conversation context; parallel subagent launches are discouraged
  here (heavy MCP tool definitions + context growth reliably hit "Prompt is too long") — prefer
  sequential subagents, cap at 2-3 if parallel is unavoidable; start Docker with `startdocker`
  yourself when a task needs it rather than asking the user.
- **proactive-subagents-and-skills.md** (Japanese) — proactively use Skills for tasks needing
  specialized knowledge (actually read and apply SKILL.md, don't just name it) and Subagents for
  independent/parallelizable work (refactoring, review, broad exploration); state which one
  you're using and why in one line before proceeding.

## Foreign-agent configs detected

A Codex config (`~/.codex/config.toml`) and a Gemini CLI config (`~/.gemini/settings.json`)
exist on this machine but were not read or imported. Run `/import` to scan what's importable
(MCP servers, slash commands, subagents, skills, instructions), then `/import --yes=<digest>`
to apply the user-level items.
