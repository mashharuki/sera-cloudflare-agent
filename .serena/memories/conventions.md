## Conventions

Full rules live in `.claude/rules/*.md` (mirrored in `.agents/rules/*.md` — see `mem:core` for
the duplication caveat). Read them directly for specifics; summary of what's there:
- `code-style.md` — const-over-let, early returns, <50-line functions, verb-noun function names,
  is/has/should booleans, TS explicit return types on exported fns, `type` vs `interface` split,
  `unknown` over `any`, discriminated unions, `satisfies` over `as`, Result-pattern error
  handling, import grouping with `@/` path aliases.
- `git-workflow.md` — Conventional Commits, `feat/<ticket>-<desc>` / `fix/<ticket>-<desc>`
  branches, squash merge to main, never push directly to main.
- `testing.md` — colocated `*.test.ts`, describe/it with `it('should X when Y')` naming,
  factory functions for test data, mock at module boundaries.
- `security.md` — zod validation at boundaries, no hardcoded secrets, parameterized queries,
  auth-then-authz on every protected route.
- `speckit-language.md` — all Spec Kit (`/speckit-*`, `.specify/`) generated docs must be written
  in Japanese; code identifiers/error codes/standard names/commit messages stay in English.
- `development.md` (Japanese) — prefer Chrome DevTools MCP over Claude-in-Chrome MCP for browser
  automation; use subagents for investigation to save context; cite evidence before asserting
  "no changes needed" or making codebase-wide claims (must grep -rn first); large outputs
  (>500 lines / hundreds of KB) go through a subagent summary, never straight into the main
  context; parallel subagent launches are discouraged in this environment (heavy MCP defs +
  context growth → "Prompt is too long") — prefer sequential, cap at 2-3 if parallel is required.
- `proactive-subagents-and-skills.md` (Japanese) — proactively use Skills for tasks needing
  specialized knowledge (read SKILL.md and apply it, don't just namecheck it) and Subagents for
  independent/parallelizable work; state which one you're using and why in one line.
