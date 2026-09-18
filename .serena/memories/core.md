## sera-cloudflare-agent — top-level map

pnpm workspace monorepo (`apps/*`, `packages/*`). Very early-stage skeleton: `apps/backend`
and `apps/frontend` are still near-default templates (Hono "hello world", Vite+React default
app). `packages/shared` and `packages/api-spec` are empty stubs (`packages/api-spec/openapi.yaml`
is a 0-byte placeholder).

Project goal / requirements are captured in `docs/memo.md` (Japanese): build a fully serverless
Sera Protocol AI chatbot on Cloudflare Workers + Pages (wallet creation, balance check, order
book/trade info, stablecoin swap, transfer, tx status — via Strands Agents TS SDK, sera-mcp,
sera-agents, Privy). That file is the authoritative requirements doc — read it directly rather
than relying on a memory summary, since it's long and likely to evolve as the project is scoped.

Modules:
- `mem:backend/core` — Hono + Wrangler Worker (`apps/backend`)
- `mem:frontend/core` — Vite + React app (`apps/frontend`)

See `mem:tech_stack`, `mem:suggested_commands`, `mem:conventions`, `mem:task_completion` for
cross-cutting project info.

## Rules duplication

`.claude/rules/*` and `.agents/rules/*` are byte-identical duplicate rule sets (code-style,
git-workflow, testing, security, development, speckit-language, proactive-subagents-and-skills,
skill-authoring), and `.claude/skills/*` mirrors `.agents/skills/*` the same way — plain
directories, not symlinks. When editing a rule or vendored skill, update both copies or they
will silently drift.
