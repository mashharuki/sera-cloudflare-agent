---

description: "Sera AI チャットボットの依存順・ユーザーストーリー別実装タスク"
---

# Tasks: Sera AI チャットボット

**Input**: `specs/001-sera-ai-chatbot/` の `plan.md`、`spec.md`、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**Tests**: 仕様の「ユーザーシナリオとテスト」、AS-001〜AS-023、SC-001〜SC-011 が必須のため、各ストーリーで test-first とする。各 test task は対象実装前に作成し、期待理由で失敗することを確認する。

**Organization**: Phase 1 は setup、Phase 2 は本番実装より先に完了する blocking feasibility gate、Phase 3 は全ストーリー共通基盤、Phase 4–9 は P1〜P6 のユーザーストーリー、最終 Phase は横断品質である。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 先行依存の完了後、別ファイルを変更する他の `[P]` task と並行可能
- **[Story]**: `spec.md` の User Story（`US1`〜`US6`）
- すべての task に変更または検証対象の正確な file path を含める

## Phase 1: Setup（共有開発基盤）

**Purpose**: scaffold を維持したまま、契約生成、テスト、local/remote 検証を実行できる基盤を追加する。

- [X] T001 root/backend/frontend の runtime・dev dependency を計画の固定 version で追加し `package.json`、`apps/backend/package.json`、`apps/frontend/package.json`、`pnpm-lock.yaml` を更新する
- [X] T002 [P] OpenAPI Generator 7.25.0、lint、breaking-diff、typescript-fetch 生成 command を `packages/api-spec/package.json` と `packages/api-spec/openapi-generator.json` に設定する
- [X] T003 [P] Workers pool を含む Vitest 設定と共通 test factory を `vitest.workspace.ts`、`apps/backend/vitest.config.ts`、`apps/backend/src/test/factories.ts` に追加する
- [X] T004 [P] frontend の Chromium E2E 設定、test project、artifact redaction を `apps/frontend/playwright.config.ts` と `apps/frontend/e2e/fixtures.ts` に追加する
- [X] T005 [P] REST contract collection と Newman environment template を `packages/api-spec/postman/sera-ai-chatbot.postman_collection.json` と `packages/api-spec/postman/local.postman_environment.json` に作成する
- [X] T006 [P] 計画どおりの backend/frontend/shared/scripts/docs ディレクトリ境界を `apps/backend/src/`、`apps/frontend/src/features/`、`packages/shared/src/`、`scripts/`、`docs/evidence/` に作成する
- [X] T007 [P] 公開値と秘密値を分離した local/stage template を `.dev.vars.example`、`apps/frontend/.env.example`、`config/stages/dev.example.json` に定義する
- [X] T008 root から test、contract、codegen、spike、deploy、destroy を起動する script entry を `package.json` に追加する
- [X] T009 D1、Workflow、Gemini model、Sera URL、RPC、allowed origin の stage bindings を `apps/backend/wrangler.jsonc` に宣言し `apps/backend/worker-configuration.d.ts` を再生成する
- [X] T010 generated client、Playwright artifact、secret、resource manifest を追跡対象外にする規則を `.gitignore` と `packages/api-spec/generated/.gitkeep` に追加する

**Checkpoint**: 全開発 command が root から起動でき、秘密値を commit せず次の blocking phase を開始できる。

---

## Phase 2: Feasibility Spike（本番実装前の blocking gate）

**Purpose**: 捨てられる最小 Worker と専用 fixture だけで、主要 dependency・署名・Sera・SSE・D1 排他が Workers local/remote で成立するかを先に実測する。

**⚠️ CRITICAL**: この phase がすべて PASS するまで `apps/backend/src/` の本番 service/domain 実装と User Story phase を開始しない。

- [X] T011 `@strands-agents/sdk` browser/default export の local Worker bundle、tool call、stream test を `spikes/worker/strands-worker.ts` と `spikes/worker/strands-worker.spike.test.ts` に作成して Node-only import がないことを確認する
- [X] T012 [P] Google AI Studio API key と Google 公式 OpenAI-compatible endpoint を使う `gemini-2.5-flash` の日本語、stream、structured tool call、abort、provider error、Google 側の利用量計上の remote test を `spikes/worker/model-provider.spike.test.ts` に作成する
- [ ] T013 [P] Privy token/ownership、EIP-712、exact request authorization、同一 idempotency key の挙動を Sepolia で検証する test を `spikes/worker/privy-signing.spike.test.ts` に作成する
- [ ] T014 [P] Sepolia RPC ERC-20 `balanceOf` と Sera testnet の config/tokens/markets/account balances/quote/orders/fills/transfer build を Worker fetch から検証し、Privy wallet と Sera account の対応可否を `spikes/worker/external-apis.spike.test.ts` に記録する
- [X] T015 [P] SSE 60秒超、切断再開、terminal replay、2-user state isolation を remote Worker で検証する test を `spikes/worker/sse-isolation.spike.test.ts` に作成する
- [X] T016 D1 conditional update と20並行 execute で winner が1件になることを検証する test harness を `spikes/worker/idempotency-concurrency.spike.test.ts` に作成する
- [X] T017 local/remote spike を実行し bundle size、startup、CPU、memory、subrequest、latency を収集する runner を `scripts/run-feasibility-spikes.ts` に実装する
- [X] T018 spike の実測、version/commit、PASS/FAIL、balance source、fallback 判断を `docs/evidence/phase-0-feasibility.md` に記録し、FAIL が1件でも後続 task を停止する gate を `scripts/check-feasibility-gate.ts` に実装する

**Checkpoint**: Workers local/remote の成立性 gate が PASS し、採用 dependency と balance source が実測で確定している。

---

## Phase 3: Foundational（全ストーリー共通基盤）

**Purpose**: 成立性 gate で確定した構成だけを用いて、API 契約、D1、認証・認可、Agent/SSE、外部 adapter、取引・監査の共通境界を実装する。

- [ ] T019 `specs/001-sera-ai-chatbot/contracts/openapi.yaml` を正本候補として `packages/api-spec/openapi.yaml` に反映し、以後は package 側だけを編集する規則を `packages/api-spec/README.md` に明記する
- [ ] T020 `packages/api-spec/openapi.yaml` から typescript-fetch client を `packages/api-spec/generated/typescript-fetch/` へ再現可能に生成する script を `packages/api-spec/scripts/generate.mjs` に実装し、契約変更直後に必ず実行する
- [ ] T021 [P] OpenAPI 構文、全 `$ref`、operationId 一意性、生成差分、breaking diff を検査する test を `packages/api-spec/src/openapi-contract.test.ts` に作成する
- [ ] T022 User、WalletLink、Conversation、Message、AgentRun、AgentEvent、CapabilitySnapshot、Proposal、Approval、Operation、Observation、AuditEvent の制約と index を `apps/backend/migrations/0001_initial.sql` に実装する
- [ ] T023 [P] UUIDv7、EVM address、raw amount、UTC timestamp、Result、operation/approval state の zod schema と pure type を `packages/shared/src/domain.ts` と `packages/shared/src/domain.test.ts` に実装する
- [ ] T024 [P] Worker bindings と公開設定を fail-closed で検証する schema を `apps/backend/src/config/env.ts` と `apps/backend/src/config/env.test.ts` に実装する
- [ ] T025 D1 transaction、conditional update、row mapping、migration test helper を `apps/backend/src/infrastructure/d1/client.ts` と `apps/backend/src/infrastructure/d1/client.test.ts` に実装する
- [ ] T026 [P] RFC 9457 Problem、safe error code、retryable 判定を `apps/backend/src/api/problem.ts` と `apps/backend/src/api/problem.test.ts` に実装する
- [ ] T027 [P] correlation ID と JWT/signature/credential/PII redaction を備えた structured logger を `apps/backend/src/observability/logger.ts` と `apps/backend/src/observability/logger.test.ts` に実装する
- [ ] T028 Privy access token の `sub`/`aud` 検証と User projection upsert middleware を `apps/backend/src/auth/privy-auth.ts` と `apps/backend/src/auth/privy-auth.test.ts` に実装する
- [ ] T029 user-scoped query と WalletLink/Conversation/Run/Proposal/Operation の存在非開示 ownership guard を `apps/backend/src/auth/authorize-owner.ts` と `apps/backend/src/auth/authorize-owner.test.ts` に実装する
- [ ] T030 [P] allowlist CORS、security headers、body limit、user/IP rate limit の middleware を `apps/backend/src/api/security-middleware.ts` と `apps/backend/src/api/security-middleware.test.ts` に実装する
- [ ] T031 timeout、bounded read retry、no automatic write retry、zod response validation を備えた Sera HTTP client core を `apps/backend/src/infrastructure/sera/client.ts` と `apps/backend/src/infrastructure/sera/client.test.ts` に実装する
- [ ] T032 `/config`、`/tokens`、`/markets` の runtime discovery と期限付き CapabilitySnapshot を `apps/backend/src/infrastructure/sera/capabilities.ts` と `apps/backend/src/infrastructure/sera/capabilities.test.ts` に実装する
- [ ] T033 [P] Privy user/wallet lookup と exact request authorization submission の port を `apps/backend/src/infrastructure/privy/client.ts` と `apps/backend/src/infrastructure/privy/client.test.ts` に実装する
- [ ] T034 [P] Sepolia chain ID 固定、ERC-20 `balanceOf`、receipt schema、block/source、timeout を持つ JSON-RPC port を `apps/backend/src/infrastructure/ethereum/rpc-client.ts` と `apps/backend/src/infrastructure/ethereum/rpc-client.test.ts` に実装する
- [ ] T035 Conversation、Message、AgentRun、AgentEvent の user-scoped repository と event seq 排他を `apps/backend/src/infrastructure/d1/conversation-repository.ts` と `apps/backend/src/infrastructure/d1/conversation-repository.test.ts` に実装する
- [ ] T036 request ごとに Agent を生成し global mutable state を持たない Strands runtime factory を `apps/backend/src/agent/runtime.ts` と `apps/backend/src/agent/runtime.test.ts` に実装する
- [ ] T037 Strands `OpenAIModel`、Google 公式 OpenAI-compatible base URL、Google API key、configurable model ID、abort/error mapping を `apps/backend/src/agent/model-provider.ts` と `apps/backend/src/agent/model-provider.test.ts` に実装する
- [ ] T038 seq replay、`Last-Event-ID`、UTF-8 delta、heartbeat、terminal event を扱う SSE writer を `apps/backend/src/api/sse.ts` と `apps/backend/src/api/sse.test.ts` に実装する
- [ ] T039 health、capabilities、conversation/message/run/event の contract routes と zod boundary を `apps/backend/src/api/system-routes.ts`、`apps/backend/src/api/chat-routes.ts`、`apps/backend/src/index.ts` に実装する
- [ ] T040 generated client に Privy bearer、Idempotency-Key、Problem mapping を付ける wrapper を `apps/frontend/src/lib/api/client.ts` と `apps/frontend/src/lib/api/client.test.ts` に実装する
- [ ] T041 Material UI/React Bits/TanStack Query・Router/Zustand の採用境界を `apps/frontend/src/app/architecture.md` に記録し、Privy provider、error boundary、ephemeral UI store を `apps/frontend/src/app/providers.tsx`、`apps/frontend/src/app/router.tsx`、`apps/frontend/src/app/ui-store.ts`、`apps/frontend/src/main.tsx` に実装する
- [ ] T042 [P] proposal canonicalization、approval/operation state、proposal 作成と `AWAITING_APPROVAL` Operation の同一 transaction、submission lease を `apps/backend/src/domain/transaction-proposal.ts` と `apps/backend/src/domain/transaction-proposal.test.ts` に実装する
- [ ] T043 TransactionProposal、Approval、Operation の user-scoped repository と proposal-operation 1:1 unique/conditional transition を `apps/backend/src/infrastructure/d1/transaction-repository.ts` と `apps/backend/src/infrastructure/d1/transaction-repository.test.ts` に実装する
- [ ] T044 owner/hash/version/expiry を検証する approval、REJECT/CANCEL decision、stable operation ID、single-winner submission を `apps/backend/src/features/transactions/transaction-lifecycle-service.ts` と `apps/backend/src/features/transactions/transaction-lifecycle-service.test.ts` に実装する
- [ ] T045 [P] wallet/proposal/decision/approval/sign/submit/status event を secret-free で記録し operation ID で検索する AuditService を `apps/backend/src/audit/audit-service.ts` と `apps/backend/src/audit/audit-service.test.ts` に実装する

**Checkpoint**: API/認証/永続化/Agent/SSE/取引/監査の共通基盤があり、各 User Story を実装できる。

---

## Phase 4: User Story 1 — ウォレットを用意して資産を確認する（Priority: P1）🎯 MVP

**Goal**: 認証利用者が自分専用 Privy wallet を重複なく作成・再取得し、Sepolia の資産残高と取得時刻を確認できる。

**Independent Test**: 新規 user が wallet を作成し、reload/re-login 後も同じ address を取得し、その address の Sepolia ERC-20 balance を token address・block・source とともに確認できる。他 user の wallet ID/address を渡しても内容を開示せず、Sera account balance を wallet balance として混在させない。

### Tests for User Story 1

- [ ] T046 [P] [US1] `GET/POST /v1/wallets/me` と `GET /v1/wallets/me/balances` の認証・schema・Problem contract test を `apps/backend/src/api/wallet-routes.test.ts` に先行作成する
- [ ] T047 [P] [US1] WalletLink の1 user 1 wallet、再試行、所有権不一致、存在非開示の repository test を `apps/backend/src/infrastructure/d1/wallet-repository.test.ts` に先行作成する
- [ ] T048 [P] [US1] Privy wallet 作成応答消失後の再取得、RPC balance failure、Sera account balance 非混在の integration test を `apps/backend/src/features/wallet/wallet-service.integration.test.ts` に先行作成する
- [ ] T049 [P] [US1] login → wallet 作成 → balance → reload/re-login → 同一 wallet と2-user 分離の E2E を `apps/frontend/e2e/us1-wallet-balance.spec.ts` に先行作成する

### Implementation for User Story 1

- [ ] T050 [P] [US1] User/WalletLink の user-scoped read/upsert と idempotent sync を `apps/backend/src/infrastructure/d1/wallet-repository.ts` に実装する
- [ ] T051 [US1] Privy user record と wallet ID/address/chain を毎回照合して projection を同期する WalletService を `apps/backend/src/features/wallet/wallet-service.ts` に実装する
- [ ] T052 [P] [US1] ownership 検証済み Privy wallet address に対する Sepolia ERC-20 `balanceOf` と raw/human amount、token address、block/source mapping を `apps/backend/src/infrastructure/ethereum/token-balances.ts` と `apps/backend/src/infrastructure/ethereum/token-balances.test.ts` に実装する
- [ ] T053 [US1] ownership guard、Idempotency-Key、取得時刻を含む wallet/balance endpoint を `apps/backend/src/api/wallet-routes.ts` と `apps/backend/src/index.ts` に実装する
- [ ] T054 [P] [US1] `get_wallet_summary` と `get_balances` の read-only Agent tools を `apps/backend/src/agent/tools/wallet-tools.ts` と `apps/backend/src/agent/tools/wallet-tools.test.ts` に実装する
- [ ] T055 [P] [US1] user-owned embedded wallet の `createOnLogin` と Sepolia 固定設定を `apps/frontend/src/features/wallet/PrivyWalletProvider.tsx` に実装する
- [ ] T056 [US1] wallet sync/balance query と認証失効時の再認証処理を `apps/frontend/src/features/wallet/useWalletSummary.ts` と `apps/frontend/src/features/wallet/useWalletSummary.test.tsx` に実装する
- [ ] T057 [P] [US1] address、network、token、balance、source、fetchedAt を表示する UI を `apps/frontend/src/features/wallet/WalletSummaryCard.tsx` と `apps/frontend/src/features/wallet/WalletSummaryCard.test.tsx` に実装する
- [ ] T058 [US1] wallet 作成/残高 intent を read-only と明示して tool へ routing する日本語 instruction を `apps/backend/src/agent/instructions.ts` と `apps/backend/src/agent/instructions.test.ts` に実装する
- [ ] T059 [US1] T046〜T058 と SC-001/SC-002 の初回測定手順・safe screenshot を `docs/evidence/us1-wallet-balance.md` に記録する

**Checkpoint**: User Story 1 が単独で動作し、MVP として login、同一 wallet 再取得、残高、所有者分離を demo できる。

---

## Phase 5: User Story 2 — 市場・取引情報を会話で調べる（Priority: P2）

**Goal**: 利用者が市場 metadata、価格、quote、synthetic depth、orders/fills を自然言語で区別して照会し、source と鮮度、未対応範囲を確認できる。

**Independent Test**: asset write 権限なしで `JPYC/USDC` を質問し、種類・対象・値・source・取得時刻が表示される。曖昧な「板」は追加質問となり、未対応情報は捏造しない。

### Tests for User Story 2

- [ ] T060 [P] [US2] capabilities/markets endpoint の metadata、synthetic depth label、source/fetchedAt schema の contract test を `apps/backend/src/api/market-routes.test.ts` に先行作成する
- [ ] T061 [P] [US2] config/tokens/markets/fx/quote/orders/fills の zod validation、timeout、rate limit、unsupported mapping test を `apps/backend/src/infrastructure/sera/market-data.test.ts` に先行作成する
- [ ] T062 [P] [US2] 曖昧入力の追加質問、情報種別の分離、未対応情報の非捏造を検証する Agent tool test を `apps/backend/src/agent/tools/market-tools.test.ts` に先行作成する
- [ ] T063 [P] [US2] SSE 切断再開で同じ message/tool を重複実行せず seq が連続する integration test を `apps/backend/src/features/chat/chat-stream.integration.test.ts` に先行作成する
- [ ] T064 [P] [US2] JPYC/USDC 照会、曖昧な板、unsupported、source badge、reconnect の E2E を `apps/frontend/e2e/us2-market-chat.spec.ts` に先行作成する

### Implementation for User Story 2

- [ ] T065 [P] [US2] markets、FX、quote、synthetic depth、owner-scoped orders/fills の Sera adapter を `apps/backend/src/infrastructure/sera/market-data.ts` に実装する
- [ ] T066 [US2] capability expiry、情報種別、source refs、partial unavailable を統合する MarketQueryService を `apps/backend/src/features/market/market-query-service.ts` と `apps/backend/src/features/market/market-query-service.test.ts` に実装する
- [ ] T067 [US2] `list_markets`、`get_fx_rate`、`estimate_synthetic_depth`、`list_my_orders`、`list_my_fills` tools を `apps/backend/src/agent/tools/market-tools.ts` に実装する
- [ ] T068 [US2] 不足 slot を質問し synthetic depth を authoritative book と呼ばない日本語 policy を `apps/backend/src/agent/market-instructions.ts` と `apps/backend/src/agent/market-instructions.test.ts` に実装する
- [ ] T069 [US2] `GET /v1/markets` の query validation と safe response を `apps/backend/src/api/market-routes.ts` と `apps/backend/src/index.ts` に実装する
- [ ] T070 [P] [US2] 情報種別、source、fetchedAt、expiry、partial availability を表示する card を `apps/frontend/src/features/chat/MarketResultCard.tsx` と `apps/frontend/src/features/chat/MarketResultCard.test.tsx` に実装する
- [ ] T071 [P] [US2] 読み取り/資産変更 badge と clarification prompt UI を `apps/frontend/src/features/chat/MessageAnnotations.tsx` と `apps/frontend/src/features/chat/MessageAnnotations.test.tsx` に実装する
- [ ] T072 [US2] cursor resume と terminal REST fallback を持つ SSE client hook を `apps/frontend/src/features/chat/useAgentRunStream.ts` と `apps/frontend/src/features/chat/useAgentRunStream.test.ts` に実装する
- [ ] T073 [US2] 各 read query 20回の latency、source correctness、unsupported 結果を `docs/evidence/us2-market-information.md` に記録する

**Checkpoint**: User Story 2 が US1 の資産を変更せず独立検証でき、read-only conversational MVP が完成する。

---

## Phase 6: User Story 3 — ステーブルコイン交換を確認して実行する（Priority: P3）

**Goal**: Sepolia の JPYC/USDC swap を immutable proposal、明示承認、EIP-712 署名、最大1回の送信として実行する。

**Independent Test**: quote → 全条件表示 → 承認 → 1回送信 → operation ID 取得を完了し、未承認・拒否・期限切れ・1項目変更・二重クリック・並行要求では不正送信が0件となる。

### Tests for User Story 3

- [ ] T074 [P] [US3] swap proposal の quote fields、canonical hash、expiry、proposal と同時に作る stable operation ID の unit test を `apps/backend/src/features/transactions/swap-proposal-service.test.ts` に先行作成する
- [ ] T075 [P] [US3] proposal/decision/approval-request/execute の auth、409/410、Problem、same-operation contract test を `apps/backend/src/api/swap-routes.test.ts` に先行作成する
- [ ] T076 [P] [US3] Sera quote/EIP-712/execute response schema と write no-retry の adapter test を `apps/backend/src/infrastructure/sera/swap.test.ts` に先行作成する
- [ ] T077 [P] [US3] 未承認、8項目の改変、expiry、拒否、response loss、20並行 execute の integration test を `apps/backend/src/features/transactions/swap-execution.integration.test.ts` に先行作成する
- [ ] T078 [P] [US3] 不足項目の追加質問、review、拒否、署名、同一 operation 表示の Sepolia E2E を `apps/frontend/e2e/us3-swap.spec.ts` に先行作成する

### Implementation for User Story 3

- [ ] T079 [US3] runtime capability と quote を検証し immutable swap proposal を作る service を `apps/backend/src/features/transactions/swap-proposal-service.ts` と `apps/backend/src/features/transactions/swap-proposal-service.test.ts` に実装する
- [ ] T080 [P] [US3] Sera `/swap/quote` と署名済み `/swap` adapter を `apps/backend/src/infrastructure/sera/swap.ts` に実装する
- [ ] T081 [US3] 共通 lifecycle service を使い、owner/hash/version/expiry を再検証して EIP-712 exact payload を返す SwapApprovalService を `apps/backend/src/features/transactions/swap-approval-service.ts` と `apps/backend/src/features/transactions/swap-approval-service.test.ts` に実装する
- [ ] T082 [P] [US3] EIP-712 domain/types/message と signer address を検証する verifier を `apps/backend/src/infrastructure/ethereum/eip712-verifier.ts` と `apps/backend/src/infrastructure/ethereum/eip712-verifier.test.ts` に実装する
- [ ] T083 [US3] quote hash と署名を再照合し Sera swap を1回だけ送る SwapExecutionService を `apps/backend/src/features/transactions/swap-execution-service.ts` に実装する
- [ ] T084 [US3] proposal、REJECT/CANCEL decision、approval request、swap execute routes を `apps/backend/src/api/swap-routes.ts` と `apps/backend/src/index.ts` に実装する
- [ ] T085 [US3] transaction contract 変更直後に OpenAPI lint と client generation を実行し、生成差分を `packages/api-spec/generated/typescript-fetch/` に反映する
- [ ] T086 [US3] 不足 slot 補完後だけ proposal を作る `draft_swap_proposal` tool を `apps/backend/src/agent/tools/swap-tools.ts` と `apps/backend/src/agent/tools/swap-tools.test.ts` に実装する
- [ ] T087 [P] [US3] chat の swap intent と proposal query state を `apps/frontend/src/features/transactions/useSwapProposal.ts` と `apps/frontend/src/features/transactions/useSwapProposal.test.ts` に実装する
- [ ] T088 [P] [US3] network/input/output/amount/expected/fee/slippage/expiry/hash を省略なく表示する review UI を `apps/frontend/src/features/transactions/SwapReviewDialog.tsx` と `apps/frontend/src/features/transactions/SwapReviewDialog.test.tsx` に実装する
- [ ] T089 [US3] client wallet の EIP-712 sign、明示承認、拒否/取消、session expiry を扱う hook を `apps/frontend/src/features/transactions/useSwapExecution.ts` と `apps/frontend/src/features/transactions/useSwapExecution.test.ts` に実装する
- [ ] T090 [US3] operation ID と送信状態を chat/review へ統合する UI を `apps/frontend/src/features/transactions/OperationReceipt.tsx` と `apps/frontend/src/features/chat/ChatPage.tsx` に実装する
- [ ] T091 [US3] AS-020/AS-021 と SC-003〜SC-005 の Sepolia 実測、broadcast count、safe tx/order reference を `docs/evidence/us3-swap.md` に記録する

**Checkpoint**: User Story 3 は US4/US5 の完成を待たず、swap の提案・承認・一度だけの受付を独立検証できる。

---

## Phase 7: User Story 4 — 送金内容を確認して実行する（Priority: P4）

**Goal**: Sepolia の JPYC/USDC transfer を exact Privy authorization と同じ transaction 内容で最大1回送信する。

**Independent Test**: valid transfer を全条件確認後に1回送信でき、無効宛先、利用不能資産、残高/fee不足、未承認、署名拒否、並行要求では資産が移動しない。

### Tests for User Story 4

- [ ] T092 [P] [US4] transfer input、zero/malformed address、token、balance/fee error の domain test を `apps/backend/src/domain/transfer-proposal.test.ts` に先行作成する
- [ ] T093 [P] [US4] Privy exact serialized request、authorization digest、idempotency key、payload mismatch の test を `apps/backend/src/infrastructure/privy/transfer-authorization.test.ts` に先行作成する
- [ ] T094 [P] [US4] 未承認、署名拒否、response loss、20並行 execute で broadcast 最大1回の integration test を `apps/backend/src/features/transactions/transfer-execution.integration.test.ts` に先行作成する
- [ ] T095 [P] [US4] 不足項目、invalid recipient、insufficient funds、review、sign、same-operation の Sepolia E2E を `apps/frontend/e2e/us4-transfer.spec.ts` に先行作成する

### Implementation for User Story 4

- [ ] T096 [US4] capability、recipient、raw amount、balance/fee を検証し immutable transfer proposal を作る service を `apps/backend/src/features/transactions/transfer-proposal-service.ts` と `apps/backend/src/features/transactions/transfer-proposal-service.test.ts` に実装する
- [ ] T097 [P] [US4] Sera `/transfer` build と `/transfer/send` の schema-validated adapter を `apps/backend/src/infrastructure/sera/transfer.ts` と `apps/backend/src/infrastructure/sera/transfer.test.ts` に実装する
- [ ] T098 [US4] exact wallet RPC request、proposal hash、stable Privy idempotency key を結ぶ builder を `apps/backend/src/infrastructure/privy/transfer-authorization.ts` に実装する
- [ ] T099 [P] [US4] Privy `useAuthorizationSignature` を exact payload に限定する client hook を `apps/frontend/src/features/transactions/useTransferAuthorization.ts` と `apps/frontend/src/features/transactions/useTransferAuthorization.test.ts` に実装する
- [ ] T100 [US4] authorization signature と proposal を再照合して1回だけ submit する TransferExecutionService を `apps/backend/src/features/transactions/transfer-execution-service.ts` と `apps/backend/src/features/transactions/transfer-execution-service.test.ts` に実装する
- [ ] T101 [P] [US4] invalid recipient、unsupported token、balance/fee不足、signature rejection、upstream failure を分類する mapper を `apps/backend/src/features/transactions/transaction-errors.ts` と `apps/backend/src/features/transactions/transaction-errors.test.ts` に実装する
- [ ] T102 [US4] transfer proposal、REJECT/CANCEL decision、approval request、execute routes を `apps/backend/src/api/transfer-routes.ts` と `apps/backend/src/index.ts` に実装する
- [ ] T103 [US4] network/token/amount/recipient の不足を補完後だけ proposal にする `draft_transfer_proposal` tool を `apps/backend/src/agent/tools/transfer-tools.ts` と `apps/backend/src/agent/tools/transfer-tools.test.ts` に実装する
- [ ] T104 [P] [US4] from/to/token/amount/network/fee/hash を表示する transfer review UI を `apps/frontend/src/features/transactions/TransferReviewDialog.tsx` と `apps/frontend/src/features/transactions/TransferReviewDialog.test.tsx` に実装する
- [ ] T105 [US4] review、explicit approve、authorization、execute、cancel を統合する hook を `apps/frontend/src/features/transactions/useTransferExecution.ts` と `apps/frontend/src/features/transactions/useTransferExecution.test.ts` に実装する
- [ ] T106 [P] [US4] failure category と安全な次の行動を表示する UI を `apps/frontend/src/features/transactions/TransactionFailureAlert.tsx` と `apps/frontend/src/features/transactions/TransactionFailureAlert.test.tsx` に実装する
- [ ] T107 [US4] response loss 時に再送せず operation lookup へ切り替える recovery を `apps/frontend/src/features/transactions/useOperationRecovery.ts` と `apps/frontend/src/features/transactions/useOperationRecovery.test.ts` に実装する
- [ ] T108 [US4] AS-008/AS-019〜AS-022 と SC-003〜SC-005 の Sepolia 実測、broadcast count、safe tx reference を `docs/evidence/us4-transfer.md` に記録する

**Checkpoint**: User Story 4 が swap とは独立に transfer の提案・承認・一度だけの受付を検証できる。

---

## Phase 8: User Story 5 — 取引結果を根拠とともに追跡する（Priority: P5）

**Goal**: swap/transfer の同じ operation ID を受付から終端まで追跡し、Sera order/fill または Sepolia receipt を根拠に状態を表示する。

**Independent Test**: 既知 operation で全7状態、許可遷移、成功/失敗の evidence、外部障害時 UNKNOWN、broadcast しない recheck、切断復旧を確認する。

### Tests for User Story 5

- [ ] T109 [P] [US5] 7状態の許可/禁止遷移、終端不変、UNKNOWN recovery の table-driven test を `apps/backend/src/domain/operation-state.test.ts` に先行作成する
- [ ] T110 [P] [US5] Workflow retry/backoff/deadline/restart と「追跡のみ・送信なし」を検証する test を `apps/backend/src/workflows/transaction-tracker.test.ts` に先行作成する
- [ ] T111 [P] [US5] Sepolia receipt と Sera order/fill の success/failure/pending schema test を `apps/backend/src/features/transactions/operation-tracker.test.ts` に先行作成する
- [ ] T112 [P] [US5] operation/recheck の owner isolation、evidence、UNKNOWN、no-broadcast contract test を `apps/backend/src/api/operation-routes.test.ts` に先行作成する
- [ ] T113 [P] [US5] pending → confirming → terminal、RPC/Sera 障害 → UNKNOWN → recheck の E2E を `apps/frontend/e2e/us5-operation-status.spec.ts` に先行作成する

### Implementation for User Story 5

- [ ] T114 [US5] transition guard、conditional update、append-only OperationObservation query を `apps/backend/src/infrastructure/d1/operation-repository.ts` と `apps/backend/src/infrastructure/d1/operation-repository.test.ts` に実装する
- [ ] T115 [P] [US5] Sepolia `eth_getTransactionReceipt` と block/confirmations の safe evidence mapping を `apps/backend/src/infrastructure/ethereum/receipt-tracker.ts` と `apps/backend/src/infrastructure/ethereum/receipt-tracker.test.ts` に実装する
- [ ] T116 [P] [US5] Sera order/fill/settlement response を operation evidence に写像する tracker を `apps/backend/src/infrastructure/sera/order-tracker.ts` と `apps/backend/src/infrastructure/sera/order-tracker.test.ts` に実装する
- [ ] T117 [US5] bounded backoff、durable step、deadline UNKNOWN を持つ confirmation Workflow を `apps/backend/src/workflows/transaction-tracker.ts` と `apps/backend/src/index.ts` に実装する
- [ ] T118 [US5] broadcast せず既存 reference を再照会する OperationTrackingService を `apps/backend/src/features/transactions/operation-tracker.ts` に実装する
- [ ] T119 [US5] evidence timeline を含む `GET /v1/operations/{id}`、audit events、idempotent recheck route を `apps/backend/src/api/operation-routes.ts` と `packages/api-spec/openapi.yaml` に実装し、直後に client を再生成する
- [ ] T120 [P] [US5] 7状態、tx/order reference、last checked、evidence、recheck action を表示する timeline を `apps/frontend/src/features/transactions/OperationTimeline.tsx` と `apps/frontend/src/features/transactions/OperationTimeline.test.tsx` に実装する
- [ ] T121 [P] [US5] `get_operation_status` read-only Agent tool を `apps/backend/src/agent/tools/operation-tools.ts` と `apps/backend/src/agent/tools/operation-tools.test.ts` に実装する
- [ ] T122 [US5] AS-007/AS-011/AS-012、SC-006/SC-007 の障害注入、recovery、network evidence を `docs/evidence/us5-transaction-tracking.md` に記録する

**Checkpoint**: User Story 5 が会話出力ではなく外部 evidence により全 operation を追跡し、結果不明から安全に回復できる。

---

## Phase 9: User Story 6 — 開発者が環境を再現して安全に削除する（Priority: P6）

**Goal**: 新規環境の開発者が日本語文書だけで local run、検証、stage deploy、再実行、managed resource destroy、残存確認を完了できる。

**Independent Test**: 未使用環境で README を順に実行し、2回以上の deploy が重複0へ収束し、dry-run と destroy が指定 stage の managed resource だけを削除し、文書の全主張が evidence へリンクする。

### Tests for User Story 6

- [ ] T123 [P] [US6] manifest account/stage/name/id/managed 照合、shared resource 除外、prod confirmation の unit test を `scripts/lib/resource-manifest.test.ts` に先行作成する
- [ ] T124 [P] [US6] deploy の3回再実行と各中断点からの収束を fake Cloudflare API で検証する test を `scripts/deploy.test.ts` に先行作成する
- [ ] T125 [P] [US6] destroy dry-run、部分失敗再開、別 stage/共有 resource 非変更を検証する test を `scripts/destroy.test.ts` に先行作成する
- [ ] T126 [P] [US6] README 必須節、内部 link、evidence link、7図の原本/表示形式を検査する test を `scripts/docs-contract.test.ts` に先行作成する

### Implementation for User Story 6

- [ ] T127 [P] [US6] ManagedResourceManifest の zod schema と atomic read/write を `scripts/lib/resource-manifest.ts` に実装する
- [ ] T128 [P] [US6] Worker/Workflow/D1/Pages の live resource inventory と exact identifier 比較を `scripts/lib/cloudflare-inventory.ts` と `scripts/lib/cloudflare-inventory.test.ts` に実装する
- [ ] T129 [US6] preflight → inventory → D1/migration → Worker dry-run/secrets/deploy/health → Pages build/upload → smoke の収束処理を `scripts/deploy.ts` に実装する
- [ ] T130 [US6] manifest/live 三重照合、prod追加確認、Pages → Worker/Workflow → D1、部分再開を `scripts/destroy.ts` に実装する
- [ ] T131 [P] [US6] local D1 migration と secret-free config を準備する idempotent setup を `scripts/setup-local.ts` に実装する
- [ ] T132 [P] [US6] health、authenticated US1/US2、optional Sepolia write を区別する smoke runner を `scripts/smoke.ts` に実装する
- [ ] T133 [US6] `dev:setup`、`deploy`、`destroy`、`inventory`、`smoke` command と stage argument validation を `package.json` に接続する
- [ ] T134 [P] [US6] 目的、US1〜US5、architecture、前提、権限、設定、local、test、deploy、recovery、destroy、費用、制約、参照元を日本語で `README.md` に記述する
- [ ] T135 [P] [US6] 採用理由、Sera再利用境界、Agent/asset責任分離、Privy署名、Workers適応、deploy/destroy、課題、実測を `docs/blog.md` に記述する
- [ ] T136 [P] [US6] browser/Pages/Worker/D1/Workflow/Gemini/Privy/Sera/RPC の信頼境界を `docs/architecture/system.drawio` に作図する
- [ ] T137 [P] [US6] 認証・wallet ownership・署名境界を `docs/architecture/auth-wallet.drawio` に作図する
- [ ] T138 [P] [US6] 残高と市場照会の read-only flow を `docs/architecture/balance.drawio` と `docs/architecture/market-query.drawio` に作図する
- [ ] T139 [P] [US6] proposal/approval/sign/idempotent submit を含む swap/transfer flow を `docs/architecture/swap.drawio` と `docs/architecture/transfer.drawio` に作図する
- [ ] T140 [P] [US6] Operation 7状態、Workflow、Sera/RPC evidence の追跡 flow を `docs/architecture/transaction-tracking.drawio` に作図する
- [ ] T141 [US6] 7個の `.drawio` 原本を文書表示用 SVG に export して `docs/architecture/rendered/` に配置し component/trust boundary の一致を検証する
- [ ] T142 [US6] 未使用環境で README の local/deploy/US1/US2 を第三者3名が実行した時間・結果を `docs/evidence/us6-reproduction.md` に記録する
- [ ] T143 [US6] dev と公開 stage の deploy 3回、failure recovery、destroy、残存0/非対象変更0を `docs/evidence/us6-lifecycle.md` に記録する

**Checkpoint**: User Story 6 が新規環境で再現され、managed resource だけを安全に削除でき、README/blog/図の主張が evidence と一致する。

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: 全ストーリーを横断する security、performance、accessibility、retention、契約・文書整合をリリース品質へ収束させる。

- [ ] T144 [P] AS-001/AS-002/AS-005/AS-009 の未認証・越権・session expiry・2-user isolation regression を `apps/backend/src/security/security-boundaries.integration.test.ts` に追加する
- [ ] T145 [P] fixture secret が browser bundle、response、log、error、evidence に現れないことを検査する scanner を `scripts/scan-secrets.ts` と `scripts/scan-secrets.test.ts` に実装する
- [ ] T146 [P] keyboard、focus、screen reader name、contrast、responsive viewport の accessibility E2E を `apps/frontend/e2e/accessibility.spec.ts` に追加する
- [ ] T147 [P] read API p95、20同時 SSE、first event、status query、登録1,000人×会話100×message 1,000×資産操作100相当 fixture の D1 query、Worker CPU/subrequest を測定する load script を `scripts/measure-performance.ts` に実装する
- [ ] T148 [P] AgentEvent TTL と capability expiry を削除し transaction/audit record を保持する cleanup を `apps/backend/src/maintenance/retention.ts` と `apps/backend/src/maintenance/retention.test.ts` に実装する
- [ ] T149 [P] Privy/Sera/RPC/model の timeout、429、5xx、malformed response を retryable Problem と安全な UI action に写像する resilience test を `apps/backend/src/resilience/external-failures.integration.test.ts` に追加する
- [ ] T150 OpenAPI lint、generation、generated diff、Newman、SSE parser contract を一括検証する gate を `scripts/verify-contract.ts` と `package.json` に実装する
- [ ] T151 dependency license/version、Sera参照commit、引用/改変、bundle dependency に禁止 Node API がないことを `docs/evidence/dependency-audit.md` に記録する
- [ ] T152 SC-001〜SC-011 の測定 protocol、対象人数、条件、raw evidence link、未実測表記を `docs/evidence/success-criteria.md` に実装する
- [ ] T153 `pnpm check`、frontend lint/build、Vitest、contract、Newman、Playwright、remote smoke を実行し結果を `docs/evidence/release-gates.md` に記録する
- [ ] T154 spec FR/AS/SC → task → test → implementation → evidence の traceability matrix を `docs/evidence/traceability.md` に作成する
- [ ] T155 `specs/001-sera-ai-chatbot/quickstart.md` を新規環境で逐次実行し、差異と最終 PASS/FAIL を `docs/evidence/quickstart-validation.md` に記録する
- [ ] T156 [P] SC-001 を対象利用者5名以上で測定し wallet 作成から balance 表示までの時間・成功率・raw evidence を `docs/evidence/sc-001-wallet-usability.md` に記録する
- [ ] T157 [P] SC-003 を対象利用者5名以上で swap/transfer review の重要項目認識率として測定し、質問票・結果・raw evidence を `docs/evidence/sc-003-transaction-comprehension.md` に記録する

**Checkpoint**: 憲章の最低 release gate、全受け入れ基準、実測と文書の対応が PASS している。

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 Setup
  └─> Phase 2 Feasibility Spike
        └─> Phase 3 Foundational
              ├─> Phase 4 US1 wallet/balance
              ├─> Phase 5 US2 market/chat
              ├─> Phase 6 US3 swap
              ├─> Phase 7 US4 transfer
              └─> Phase 8 US5 tracking

US1 + US2 + US3 + US4 + US5
  └─> Phase 9 US6 reproducibility/lifecycle/docs
        └─> Phase 10 cross-cutting release gates
```

- **Phase 1**: 依存なし。
- **Phase 2**: Phase 1 完了後。T011〜T018 の全 PASS が本番基盤をブロックする。
- **Phase 3**: Phase 2 の gate PASS 後。全 User Story の共通前提であり、部分実装中に User Story へ進まない。
- **US1 / US2**: Phase 3 後に並行可能。US2 の owner-scoped history E2E は US1 wallet があると完全になるが、fixture wallet で独立 test 可能。
- **US3 / US4**: Phase 3 後に proposal fixture で並行着手可能。製品 UI 統合は US1 wallet と US2 chat shell の完了後。
- **US5**: Phase 3 後に operation fixture で独立着手可能。実 Sera/RPC の E2E は US3 または US4 が operation を作成した後。
- **US6**: release 対象とする US1〜US5 が完了した後。deploy/destroy library の test-first 実装は先行可能。
- **Phase 10**: release 対象の全 User Story と US6 完了後。

### User Story Dependencies

| Story | Starts after | Product integration dependency | Independent fixture |
|-------|--------------|--------------------------------|---------------------|
| US1 | Phase 3 | なし | Privy/RPC test doubles |
| US2 | Phase 3 | chat shell は Phase 3、wallet history は US1 | authenticated fixture user/wallet |
| US3 | Phase 3 | final UI は US1 wallet + US2 chat | fixed quote/proposal/wallet |
| US4 | Phase 3 | final UI は US1 wallet + US2 chat、shared transaction domain は Phase 3 | unsigned tx/proposal/wallet |
| US5 | Phase 3 | live evidence は US3/US4 operation | seeded Operation/Observation |
| US6 | US1–US5 | 文書・smoke・図は完成機能を参照 | fake Cloudflare inventory |

### Within Each User Story

1. Contract/unit/integration/E2E test を先に作成し、未実装理由で fail することを確認する。
2. Repository/domain model を service より前に実装する。
3. 外部 adapter と deterministic service を endpoint/Agent tool より前に実装する。
4. Asset write は proposal → approval → signature validation → submission lease → broadcast の順を崩さない。
5. UI を API/状態遷移に接続し、最後に story evidence と independent test を完了する。

### Parallel Opportunities

- Phase 1 の T002〜T007 は担当 file が分かれており並行可能。
- Phase 2 の T012〜T015 は独立 spike として並行可能。Phase 3 は T023/T024/T026/T027/T030/T033/T034 を先行依存完了後に並行可能。
- 各 Story の `[P]` test は同じ phase の実装前に並行して作成できる。
- US1 と US2、US3 と US4、fixture を使う US5 は Phase 3 checkpoint 後に別担当で並行可能。
- US6 の README、ブログ、7図は実測値を placeholder として明示する限り並行執筆でき、最終値は T142/T143 後に確定する。

---

## Parallel Examples

### User Story 1

```text
T046 wallet API contract test
T047 WalletLink repository test
T048 wallet recovery integration test
T049 wallet/balance E2E
```

### User Story 2

```text
T060 market API contract test
T061 Sera market adapter test
T062 Agent ambiguity/unsupported test
T063 SSE reconnect integration test
T064 market chat E2E
```

### User Story 3

```text
T074 proposal/state unit test
T075 swap API contract test
T076 Sera swap adapter test
T077 swap concurrency integration test
T078 swap E2E
```

### User Story 4

```text
T092 transfer domain test
T093 Privy authorization test
T094 transfer concurrency integration test
T095 transfer E2E
```

### User Story 5

```text
T109 operation state test
T110 Workflow test
T111 external evidence test
T112 operation API contract test
T113 tracking E2E
```

### User Story 6

```text
T123 manifest safety test
T124 deploy convergence test
T125 destroy scope test
T126 documentation contract test
```

---

## Implementation Strategy

### MVP First

1. Phase 1 を完了する。
2. Phase 2 の local/remote feasibility gate をすべて PASS させる。
3. Phase 3 の共通基盤を完成させる。
4. Phase 4（US1）の wallet/balance を完成させる。
5. T046〜T059 を実行して独立検証し、ここで一度停止して MVP を demo する。
6. read-only conversational MVP が必要なら Phase 5（US2）までを次の公開単位とする。

### Incremental Delivery

1. **Feasibility**: Setup + 捨てられる Workers/Strands/Privy/Sera/SSE/D1 spike。
2. **Foundation**: gate PASS 後の契約・認証・永続化・Agent/SSE・取引・監査共通基盤。
3. **MVP**: US1 wallet/balance。
4. **Read-only product**: US2 market/chat。
5. **Asset operations**: US3 swap、次に US4 transfer。各 story ごとに Sepolia safety evidence を残す。
6. **Durable status**: US5 tracking/recovery。
7. **Reproducible sample**: US6 deploy/destroy/README/blog/diagrams。
8. **Release**: Phase 10 の横断 gate。

### Stop Conditions

- T018 が FAIL の場合、User Story 実装を開始せず `research.md` と `plan.md` の fallback を再評価する。
- 未承認・改変・期限切れ・重複のいずれかで broadcast が1件以上観測された場合、US3/US4 を公開しない。
- secret scan、owner isolation、contract diff、destroy scope のいずれかが FAIL の場合、deploy/destroy を release 手順として公開しない。
- mainnet write はこの task list の対象外であり、別 feature/spec/明示承認なしに追加しない。

## Notes

- `[P]` は「依存なし」ではなく、前段 checkpoint 完了後に同 phase の別 file task と並行可能という意味である。
- generated code は `packages/api-spec/generated/` に限定し、直接編集しない。
- `.claude/rules/` と `.agents/rules/` を変更する task が生じた場合は双方を同じ変更にする。
- 実測前の README/blog/evidence は「未検証」と明示し、想定値を確認済みとして記載しない。
- testnet write は明示的な operator action でのみ実行し、mainnet write は実行しない。
