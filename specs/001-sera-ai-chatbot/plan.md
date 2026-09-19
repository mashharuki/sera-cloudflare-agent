# 実装計画: Sera AI チャットボット

**Feature ID**: `001-sera-ai-chatbot` | **Git Branch**: 未作成（現在の checkout は `main`） | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: `docs/memo.md` と `specs/001-sera-ai-chatbot/spec.md`

## Summary

Cloudflare Pages 上の React チャット UI と Cloudflare Workers 上の Hono API により、Privy のユーザー所有 embedded wallet を使う Sera Protocol 専用 AI チャットボットを構築する。会話オーケストレーションには request-scoped な Strands Agents TypeScript SDK、外部状態には Sera REST API、Privy API、Ethereum Sepolia RPC を使う。`sera-mcp` / `sera-agents` は能力・スキーマ・安全設計の参照実装として version/commit を固定するが、Node.js 固有依存を含むため Worker 内では起動せず、必要な Sera 機能だけを直接 REST adapter として実装する。

資産変更は会話生成から分離し、D1 に固定した transaction proposal、利用者の明示承認、Privy の client-side authorization または EIP-712 署名、D1 の条件付き更新、外部 idempotency key を経て最大一度だけ送信する。送信後の確認は Cloudflare Workflows が担当する。OpenAPI YAML を API の正本とし、まず Workers 実環境で Strands・署名・ストリーミング・二重送信防止を検証してから、read-only MVP、swap/transfer、運用・教材成果物の順で完成させる。

## Technical Context

**Language/Version**: TypeScript 7.0.2（root）、frontend TypeScript 6.0.2、Cloudflare Workers compatibility date `2026-09-18`

**Primary Dependencies**: Hono 4.13.8、React 19.2.8、Vite 8.3.0、`@strands-agents/sdk` 1.18.0（先行検証で固定）、OpenAI SDK 6.45.0（Google AI Studio の OpenAI-compatible endpoint 用）、Privy React SDK / `@privy-io/node`（実装時に同一 minor へ固定）、Material UI（accessible component 基盤）、React Bits（装飾的 interaction のみ）、TanStack Query（server state）/ Router（routing）、Zustand（永続化しない UI state のみ）、zod、OpenAPI Generator 7.25.0、Sera REST API

**Storage**: Cloudflare D1（ユーザー所有関係、会話、承認、冪等性、取引状態、監査イベント）、Cloudflare Workflows（確定待ち）、TanStack Query cache と Zustand/browser memory（表示専用の一時状態）。KV・ローカルファイル・Worker グローバルメモリ・browser persistence は重要状態に使わない

**Testing**: Vitest（unit/integration）、Miniflare/Wrangler（Workers runtime）、OpenAPI lint/generation/diff、Postman/Newman（有限 REST contract）、専用 fetch parser（SSE contract）、Playwright（認証・承認・切断復旧 E2E）

**Target Platform**: Cloudflare Workers（API/Agent）、Cloudflare Pages Direct Upload（SPA）、Ethereum Sepolia chain ID `11155111`（MVP 資産操作）、モダンブラウザ

**Project Type**: pnpm workspace の web application（frontend + serverless API + shared packages）

**Performance Goals**: 非 LLM REST は p95 500 ms 未満、チャットの最初の SSE event は p95 3秒未満、状態照会は p95 1秒未満、同一承認への並行実行で broadcast 回数は最大1回。外部依存時間は別計測する

**Constraints**: Worker 128 MB、startup 1秒、bundle 64 MiB uncompressed、同期 CPU は paid plan 既定30秒以内、同時 outbound connection 6以下を設計目安とする。`child_process`、stdio MCP、native SQLite、永続 `fs`、サーバー保管 private key を禁止。秘密情報は Bindings/Secrets のみ、mainnet 送信は本 feature の検証対象外

**Scale/Scope**: 教材・検証用 MVP。初期目標は同時チャット 20、登録利用者 1,000、利用者あたり会話 100・メッセージ 1,000・資産操作 100。20同時 SSE とこの最大想定データ量を負荷 fixture で検証する。MVP の資産操作は Sepolia の `JPYC/USDC` と両 token の transfer に限定し、対応 token/market/address/最小量は起動時または要求時に Sera `/tokens`・`/markets` から再検証する

## Constitution Check

*GATE: Phase 2 前と Phase 3 後に確認。現在は計画時の再評価結果。*

| Gate | 設計上の証拠 | 結果 |
|------|--------------|------|
| I. 明示承認・一度だけの資産操作 | proposal hash/version、承認期限、D1 unique 制約、条件付き state transition、Privy idempotency key、Workflow は追跡のみ | PASS |
| II. 認証・鍵・ユーザー境界 | Privy JWT 検証後に wallet owner を再検証。ユーザー所有 wallet、client-side authorization、全外部入力 zod 検証 | PASS |
| III. Workers 成立性 | stdio/native 依存を排除し直接 Sera REST adapter を選択。Strands/provider/stream/signing は Phase 2 spike の必須 gate | PASS（spike 合格を実装着手条件とする） |
| IV. 事実と契約が正本 | OpenAPI 3.0.3、Sera runtime capability discovery、固定 commit/version、receipt/orders/fills を結果根拠にする | PASS |
| V. 最小構成と耐久性 | Pages + 1 Worker + D1 + Workflows。DO/KV/Queue/remote MCP は初期構成から除外 | PASS |
| VI. deploy/destroy 再現性 | stage 固有命名、resource manifest、Direct Upload、再実行可能 deploy、安全確認付き destroy | PASS |
| VII. 段階的品質 gate | feasibility → read-only → asset operations → hardening → lifecycle/docs の順。各段階の終了条件を定義 | PASS |
| VIII. 教材・監査可能性 | 日本語 README/blog、編集可能な図、実測証拠 ledger、参照 version/license を成果物に含める | PASS |

原則違反および未解決の `NEEDS CLARIFICATION` はない。Phase 2 spike が不合格の場合は後続実装を停止し、`research.md` の fallback に従って再計画する。

## Project Structure

### Documentation (this feature)

```text
specs/001-sera-ai-chatbot/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   ├── sera-adapter.md
│   └── sse-events.md
└── tasks.md                 # $speckit-tasks で生成済み
```

### Source Code (repository root)

```text
apps/
├── backend/
│   ├── src/
│   │   ├── api/             # Hono routes/middleware/problem responses
│   │   ├── agent/           # request-scoped Strands orchestration/read-only tools
│   │   ├── auth/            # Privy token verification and ownership
│   │   ├── domain/          # proposals, approvals, operation state machines
│   │   ├── infrastructure/  # D1, Sera, Privy, RPC, Gemini adapters
│   │   ├── workflows/       # confirmation polling only
│   │   └── index.ts
│   ├── migrations/
│   └── test/
└── frontend/
    ├── src/
    │   ├── app/
    │   ├── features/chat/
    │   ├── features/wallet/
    │   ├── features/transactions/
    │   ├── lib/api/         # generated typescript-fetch client wrapper
    │   └── main.tsx
    └── e2e/
packages/
├── api-spec/
│   ├── openapi.yaml         # contracts/openapi.yaml と同期する正本
│   ├── generated/           # generated; direct edit 禁止
│   └── postman/
└── shared/
    └── src/                 # pure domain types/schemas; runtime-neutral
scripts/
├── deploy.ts
├── destroy.ts
├── verify-contract.ts
└── record-evidence.ts
docs/
├── architecture/
├── evidence/
└── blog.md
spikes/
└── worker/                    # 本番 module を実装する前の捨てられる成立性検証
```

**Structure Decision**: 既存の pnpm monorepo を維持し、deployable は `apps/backend` と `apps/frontend` の2つ、再利用契約は `packages/api-spec`、runtime-neutral な型だけを `packages/shared` に置く。API Worker は1つから開始し、bundle/startup spike が上限を超えた場合だけ Service Binding 分割を再検討する。Pages Functions、常駐 Node サーバー、Worker 内 MCP server は追加しない。

## Delivery Stages

### Stage A — Setup（tasks Phase 1）

1. dependency、テスト基盤、OpenAPI 生成 command、stage 設定 template、spike runner の入口を追加する。
2. この phase では本番 domain/service を実装せず、次の成立性検証を実行できる最小基盤だけを用意する。

### Stage B — 成立性 spike（tasks Phase 2、後続作業の blocking gate）

1. `@strands-agents/sdk@1.18.0` を最小 Worker に bundle し、local Wrangler と remote Worker の双方で単一 tool call を stream する。
2. Google AI Studio の API key を使い、Google 公式 OpenAI-compatible endpoint から `gemini-2.5-flash` を直接呼ぶ。日本語、streaming、structured tool call、abort、provider error と、課金が Google 側へ帰属することを検証する。
3. Privy access token 検証、wallet ownership、client-side authorization 付き exact request、同じ idempotency key の並行送信を Sepolia で検証する。
4. Sera REST の read、quote、EIP-712 swap payload、transfer build/send、orders/fills を Worker fetch から確認する。stdio MCP と `convert_and_send` は使用しない。
5. SSE を切断・再接続し、D1 の event cursor から重複なく復旧する。2ユーザー並行実行で Agent state と wallet state が混在しないことを確認する。
6. gate 記録に bundle size、startup、CPU、memory、subrequest、外部 latency、実行日時、commit/version を保存する。1つでも不合格なら Stage C へ進まない。

### Stage C — 契約・domain・基盤（tasks Phase 3）

1. `contracts/openapi.yaml` を `packages/api-spec/openapi.yaml` の正本へ移し、lint、client generation、breaking diff を CI/manual gate にする。
2. D1 migration と repository、Problem Details、認証/認可 middleware、correlation ID、redacted logging を実装する。
3. Sera/Privy/RPC/LLM を ports/adapters で分離し、zod により upstream response も検証する。
4. proposal 作成と同一 D1 transaction で `AWAITING_APPROVAL` の Operation を作り、拒否・取消を含む stable operation ID、proposal hash、approval version、submission lease、監査イベントを共通 domain として unit test する。

### Stage D — read-only MVP（tasks Phase 4–5）

1. Privy login と embedded wallet の create/read、所有権の同期を実装し、Sepolia RPC の ERC-20 `balanceOf` をその wallet address に対して照会する。Sera `/balances` は別の Sera account 残高として扱い、user-wallet 対応を実測で証明するまで利用者残高には混在させない。
2. balance、token、market、FX、synthetic depth、orders/fills の read-only tools を追加する。「板」は Sera quote から推定した depth と明記する。
3. conversation、message、agent run、SSE stream/reconnect を実装し、LLM は read-only tool だけを直接呼べるようにする。
4. AS-001〜AS-004、AS-009〜AS-010 と AS-011 の read-only 部分、および user story P1/P2 を contract/integration/E2E で合格させる。

### Stage E — swap / transfer / status（tasks Phase 6–8）

1. deterministic service が quote/build response から proposal と stable Operation を同一 transaction で作り、UI が全条件・期限・operation ID を表示する。
2. 承認時に proposal hash/version/owner/expiry を再検証し、署名対象を生成する。LLM には署名・broadcast 権限を与えない。
3. D1 の単一 winner transaction と Privy/Sera の idempotency を組み合わせ、swap/transfer を最大一度だけ送信する。
4. Workflows が Sera orders/fills と Sepolia receipt を再照会し、7状態へ収束させる。切断後も operation ID から復旧する。
5. P3〜P5、AS-005〜AS-008、AS-011〜AS-012、AS-019〜AS-022、期限切れ・拒否・取消・response loss・並行クリックを testnet で検証する。

### Stage F — deploy / destroy lifecycle（tasks Phase 9）

1. `sera-ai-api-{stage}`、`sera-ai-db-{stage}`、`sera-ai-web-{stage}` と resource manifest を用いる再実行可能 deploy を実装する。
2. migration → Worker dry-run/secrets/deploy/health → frontend build/Pages Direct Upload → smoke の順に収束させる。
3. destroy は account/stage/name/id/ownership を検証し、prod は追加確認する。共有資源とオンチェーン履歴を対象外にし、部分失敗から再開可能にする。

### Stage G — hardening と UI（tasks Phase 10）

1. allowlist CORS、security headers、rate limit、timeouts、bounded retry、PII/secret redaction を追加する。
2. Material UI を accessibility と form/dialog/focus 管理の基盤にし、React Bits は reduced-motion と keyboard 操作を壊さない装飾に限定する。TanStack Query は server state、Router は routing、Zustand は永続化しない UI state だけに使う。
3. Vitest、Newman、SSE parser、Playwright、Wrangler remote smoke を統合し、実測 evidence を生成する。

### Stage H — README・ブログ・最終受け入れ（tasks Phase 9–10）

1. 日本語 README に前提、設定、local、testnet、deploy、復旧、destroy、費用、制約を記載する。
2. 日本語技術ブログに architecture、採用/却下理由、Workers 適応、Sera/Privy の署名境界、失敗例、実測値を記載する。
3. 新規環境で文書のみを使う再現試験、deploy 再実行、destroy 後 inventory、全受け入れシナリオを完了する。

## Architecture Decisions

- **Sera integration**: Worker 内 MCP server ではなく direct REST adapter。`sera-mcp` の tool semantics/Zod schema/policy を MIT license 条件下で参照し、引用・改変箇所を記録する。remote MCP は read-only の比較 spike に限定する。
- **Agent boundary**: Strands Agent は request/run ごとに生成し、global mutable state を持たない。agent tool は read-only query と proposal draft までで、approval/sign/broadcast は通常 API service が担当する。
- **Wallet/signing**: Privy user-owned embedded wallet。delegated server signer と server private key は MVP で使わない。exact serialized request への client authorization と EIP-712 署名を用途別に使う。
- **Balance source**: 利用者 wallet の残高は Sepolia RPC の ERC-20 `balanceOf`（token address/block/source を返す）を正本にする。Sera `/balances` は account credential に紐づく別残高であり、Privy user/wallet との一対一対応を spike で証明できない限り US1 の残高へ使用しない。
- **Frontend state/UI**: Material UI を semantic/accessibility 基盤、React Bits を装飾、TanStack Query/Router を server state/routing、Zustand を ephemeral UI state に限定し、同一状態を複数 store へ複製しない。
- **Durability**: D1 が正本、Workflows は broadcast 後の追跡のみ。Durable Objects は D1 の条件付き更新で同時実行要件を満たせないという実測が出た場合のみ追加する。
- **Model routing**: Strands `OpenAIModel` と Google AI Studio API key を使い、Google 公式 OpenAI-compatible endpoint へ直接接続する。初期値は configurable な `gemini-2.5-flash`。推論課金は `GEMINI_API_KEY` の Google project に帰属させる。AI Gateway/Unified Billing は導入しない。

## Risk Register

| Risk | Early signal | Mitigation / fallback |
|------|--------------|-----------------------|
| Strands が Worker runtime で非互換 | bundle/runtime で Node API error | Phase 2 で停止。browser export の範囲縮小、custom provider、最後に最小 orchestrator への置換を再計画 |
| Privy exact-request authorization が intended tx と結び付かない | server-side payload と client 表示の hash が一致しない | broadcast を禁止し、client wallet direct send + tx hash reporting を安全性低下として明示して再計画 |
| Sera upstream が仕様変更 | runtime schema validation failure | circuit breaker、capability endpoint、unsupported 表示。固定 copy を信頼せず `/config` `/tokens` `/markets` を再取得 |
| D1 だけで同時送信を抑止できない | concurrency test で broadcast >1 | operation lease + DO coordinator を追加し、Complexity Tracking を更新 |
| Workflow の確認が終端へ収束しない | polling deadline 超過 | `UNKNOWN` に遷移し、manual recheck endpoint と evidence を提供 |
| Pages/Worker stage を誤削除 | manifest mismatch | fail closed、resource ID/name/account の三重照合、prod explicit confirmation |
