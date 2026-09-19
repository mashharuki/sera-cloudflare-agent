# Phase 0 調査: Sera AI チャットボット

**調査日**: 2026-09-18
**対象**: `docs/memo.md`、Sera、Strands Agents、Cloudflare、Privy、OpenAPI/deploy lifecycle

## 1. Sera の参照実装と能力境界

**Decision**: `sera-mcp` は commit [`d6f50c1`](https://github.com/sera-cx/sera-mcp/commit/d6f50c1aa6098354d796b777a5474989e9acc1f7)（package 0.8.3）、`sera-agents` は commit [`49192ce`](https://github.com/sera-cx/sera-agents/commit/49192cebf90b2572a5335c3299dbfe4efefc4d91)（package 0.7.3）を設計調査の基準とする。実装時には lockfile だけでなく参照 commit、license、引用/改変箇所を evidence に残す。

**Rationale**: `sera-mcp` の [`registry.ts`](https://github.com/sera-cx/sera-mcp/blob/d6f50c1aa6098354d796b777a5474989e9acc1f7/src/tools/registry.ts) は現在56 tools（external signer では `convert_and_send` を隠して55）を登録しており、過去の README にある32 tools より信頼できる。残高、market、quote、swap、transfer、orders/fills の実際の route と schema を追跡できる。一方、`sera-agents` は template、public gateway、x402、OpenAI Agents の例が中心で、Strands adapter や wallet 作成機能ではない。

**Alternatives considered**: README の件数を固定値として採用する案は source と不一致のため却下。package 全体を Worker に import する案は後述の互換性理由で却下。

## 2. Worker からの Sera 接続方式

**Decision**: Sera REST API の direct adapter を Worker に実装する。MVP は `/tokens`、`/markets`、`/config`、`/fx/rate`、`/swap/quote`、`/swap`、`/balances`、`/orders`、`/fills`、`/transfer`、`/transfer/send`、`/system/time` の必要部分だけを zod で検証する。ただし `/balances` は Sera account 残高であり、Privy wallet の利用者残高とは分離する。`sera-mcp` の [`client.ts`](https://github.com/sera-cx/sera-mcp/blob/d6f50c1aa6098354d796b777a5474989e9acc1f7/src/client.ts) と tool schema を仕様根拠として参照する。

**Rationale**: `sera-mcp` は Node >=18.17、stdio/Express、`child_process`、`fs`、`better-sqlite3` 等の Node/native 前提を含む。Workers の `nodejs_compat` は native SQLite や子プロセスを提供しない。public remote MCP は keyless read/analytics と unsigned settle の一部17 tools に絞られ、balance、orders、transfer、execution を満たさず、gateway 自体も Node subprocess 構成である。direct adapter が最小で監査しやすい。

**Alternatives considered**:

- Worker 内で MCP server を port: 実質的な大規模 fork になり MVP の範囲外。
- `https://agents.sera.cx/mcp` のみ: read-only comparison には使えるが製品要件を満たさない。
- 外部 Node server で `sera-mcp`: full serverless/最小運用の要件に反する。

## 3. Sera capability matrix と MVP 対象

**Decision**: MVP の資産操作は Ethereum Sepolia (`11155111`) の `JPYC/USDC` に固定する。2026-09-18 の公開 testnet `/tokens` と `/markets` で、JPYC `0x0b2d...2150`、USDC `0x965d...2d0e`、市場 `JPYC/USDC`、両 token 6 decimals、amount/price step `0.000001` を確認した。ただし address・最小量・market availability は mutable な外部データなので、実行時に再取得して proposal へ snapshot する。

| 製品能力 | Sera の根拠 | MVP 方針 |
|----------|-------------|----------|
| wallet 作成 | Sera にはない | Privy が担当 |
| Privy wallet balance | Sepolia RPC `eth_call` / ERC-20 `balanceOf` | wallet owner を検証し、token address・block・source とともに取得 |
| Sera account balance | `GET /balances` / `sera.get_balances` | 別情報として扱い、Privy user/wallet 対応を実測で証明するまで US1 には表示しない |
| market/price | `/markets`、`/fx/rate`、quote | source と取得時刻を表示 |
| order book | `infer_book` / `probe_depth` / `scan_markets` | quote を反復した**推定 depth** と明記。取引所の authoritative book と呼ばない |
| trade history | `/orders`、`/fills` | wallet owner のみ |
| swap | quote → EIP-712 sign → `/swap` | server private key 不使用、`convert_and_send` 不使用 |
| transfer | `/transfer` build → exact tx authorization → `/transfer/send` | Privy authorization と idempotency を spike |
| swap status | orders/fills/settlement status | Workflow が追跡 |
| transfer status | Sera MCP に receipt tool なし | Sepolia RPC receipt を正本にする |

**Rationale**: 仕様の「少なくとも1ペア」を、現時点で実在する日本円系 stablecoin と USDC の pair で具体化できる。runtime discovery により upstream 変更を安全に unsupported として扱える。

**Alternatives considered**: 全 token/pair の write 操作を初回から公開する案は組合せテストと表示安全性が不足。mainnet は実資産リスクがあるため本 feature の受け入れ対象外。

## 4. Strands Agents の Workers 互換性

**Decision**: [`@strands-agents/sdk@1.18.0`](https://www.npmjs.com/package/@strands-agents/sdk) を候補として固定し、browser/default export だけを request-scoped Agent として tasks Phase 2 で実測する。Node-only loader、stdio/SSE config loader、global mutable Agent は使わない。

**Rationale**: 現行 source は [`strands-agents/harness-sdk`](https://github.com/strands-agents/harness-sdk) へ移り、旧 `sdk-typescript` は archive 済み。package は Node >=22 を宣言する一方、browser bundle/test と Node export の分離があるため Workers で動く可能性はあるが、公式保証とは扱えない。Worker local/remote の bundle・runtime・stream/tool call を blocking spike にする。

**Alternatives considered**: compatibility を仮定して全面実装する案は憲章違反。remote MCP を Strands から使う場合は `McpClient({url})` の Streamable HTTP のみを optional spike とし、stdio transport は除外。

## 5. LLM provider と model routing

**Decision**: Strands `OpenAIModel` を使い、Google 公式 OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/` を `baseURL` に設定する。Google AI Studio の `GEMINI_API_KEY` で推論し、初期 model ID は configurable な `gemini-2.5-flash` とする。日本語、streaming、function/tool call、structured output、abort/error の contract test を通す。

**Rationale**: ユーザー保有の Gemini credit を確実に使い、構成・秘密値・障害点を最小化するため、Cloudflare AI Gateway/Unified Billing を経由しない。Strands の既存 OpenAI adapter と導入済み OpenAI SDK だけで Workers 互換性を維持でき、未承認の第三者 build script を持つ追加 SDK も不要になる。provider latency/error はアプリ側の structured log で観測する。

**Alternatives considered**: Cloudflare AI Gateway/Unified Billing は追加 token・gateway 設定・障害点が増え、Google credit の消費経路も複雑になるため却下。Google native endpoint と `@google/genai` は将来候補だが、依存追加時に第三者 build script の承認が必要になったため現段階では採用しない。Workers AI は Google credit を消費しないため本要件の fallback にはしない。

## 6. Privy 認証・wallet・署名

**Decision**: React の Privy login + `createOnLogin` による user-owned embedded Ethereum wallet、Worker の `@privy-io/node` による access token 検証、Privy DID と wallet ID/address/chain の server-side ownership 照合を採用する。server delegated signer と private key は MVP で使わない。

swap は Sera が返す EIP-712 `route_params` を client wallet で署名する。transfer は Worker が exact Privy wallet RPC request と安定 idempotency key を組み立て、client の authorization signature を得て、Worker が同じ serialized request を Privy API へ送る経路を tasks Phase 2 で検証する。

**Rationale**: 秘密鍵を browser/Worker/LLM へ露出せず、人間が意図した exact payload と server execution を結び付けられる。Privy idempotency key は同一 request を24時間同一処理として扱えるが、アプリ側 D1 の排他を置き換えるものではない。

**Alternatives considered**:

- server delegated wallet: 自動化には有用だが MVP の明示承認境界を広げるため却下。
- client が直接 send して hash を報告: 単純だが response loss と二重送信の制御が弱い。authorization spike 不合格時の再計画候補。
- Privy Intents/OneBalance: cross-chain abstraction が必要になった将来 scope。

## 7. 永続状態と同時実行制御

**Decision**: D1 をユーザー、wallet link、会話、agent event、proposal、approval、operation、audit の正本とする。proposal と `AWAITING_APPROVAL` の Operation は同じ D1 transaction で作り、拒否・取消・承認・送信・終端まで stable operation ID を維持する。`operations(user_id, submission_idempotency_key)` と proposal/version の unique 制約、条件付き更新の単一 winner で broadcast 権を取得する。

**Rationale**: 再接続・retry・Worker restart を越える状態が必要。D1 は relational ownership と transaction/conditional update を一つの resource で満たす。KV は強い一貫性が必要な idempotency に不適、メモリ/ファイルは永続しない。

**Alternatives considered**: Durable Objects は最初から追加せず、concurrency spike で broadcast >1 になった場合のみ operation coordinator として導入。Queue は multi-step 状態追跡には不十分。

## 8. 取引追跡

**Decision**: Cloudflare Workflows は broadcast 成功後だけ起動し、Sera order/fill または Sepolia transaction receipt を bounded backoff で追跡する。Workflow は取引を送信しない。deadline 到達時は `UNKNOWN` とし、manual recheck を可能にする。

**Rationale**: `waitUntil` は長時間・再試行可能な確定待ちではない。Workflows は durable step と retry を提供し、D1 の operation を正本に保てる。

**Alternatives considered**: synchronous polling は request lifetime/connection 制約に弱い。cron は全取引 scan が必要で遅延も大きい。

## 9. Streaming と復旧

**Decision**: REST で run を作成し、別 endpoint の SSE (`text/event-stream`) で `run.started`、`message.delta`、`tool.*`、`proposal.ready`、`run.completed|failed` を配信する。event は run ごとの単調 `seq` を持ち、D1 に期限付き保存し、`Last-Event-ID` または `after` で再開する。

**Rationale**: SSE disconnect を asset operation retry と結び付けず、状態再取得を可能にする。単方向 chat stream には WebSocket より単純で Pages/Workers と整合する。

**Alternatives considered**: 1 request 内で生成完了まで保持する案は再接続と evidence が弱い。WebSocket/DO は双方向常時接続が必要になった場合のみ。

## 10. API contract と生成

**Decision**: OpenAPI 3.0.3 YAML を正本とし、OpenAPI Generator 7.25.0 の `typescript-fetch` client を生成する。Hono server は handwritten route + zod validation とし、contract test で response を照合する。有限 REST は Newman、SSE は専用 parser + Playwright を使う。

**Rationale**: server stub generator を強制すると Hono/Workers への余計な adapter が増える。client generation と contract diff は型の二重管理を減らし、SSE は OpenAPI の静的 schema だけでは wire semantics を十分検証できない。

**Alternatives considered**: REST と MCP tool schema の共用は責任境界が異なるため却下。generated code の直接編集は禁止。

## 11. Cloudflare 構成と制限

**Decision**: 1 API Worker + D1 + 1 confirmation Workflow + Pages Direct Upload から開始する。Pages Functions、KV、Queue、DO、Service Binding は初期構成に入れない。Worker の 128 MB、1秒 startup、64 MiB uncompressed bundle、6 outbound connections、CPU/subrequest limit を spike で計測する。

**Rationale**: 最小資源で責任分離を保ち、実測なしの分散を避ける。2026-08-04 以降の compatibility date は Node behavior を自動有効化するが、非対応 API の stub まで動作する意味ではない。

**Alternatives considered**: agent Worker と API Worker の分割は bundle/startup 超過時のみ Service Binding で再検討。

## 12. deploy / destroy

**Decision**: `sera-ai-api-{stage}`、`sera-ai-db-{stage}`、`sera-ai-web-{stage}` の deterministic name と、account/stage/name/id/createdBy を含む local resource manifest を使う。deploy は preflight → inventory → D1/migration → Worker dry-run/secrets/deploy/health → frontend build → Pages Direct Upload → smoke。destroy は manifest と live resource を照合して Pages → Worker/Workflow → D1 の順に削除し、prod だけ追加確認する。

**Rationale**: deploy 再実行と部分失敗復旧を可能にし、共有資源や別 stage の誤削除を防ぐ。オンチェーン履歴と外部アカウント共通設定は削除対象外。

**Alternatives considered**: Pages preview branch は完全削除と stage ownership が曖昧になるため、独立 stage project を採用。名前 glob による一括削除は禁止。

## 13. 検証順序

**Decision**: feasibility spike → contract/domain → read-only MVP → asset operations → hardening/E2E → lifecycle/docs の順に進める。mock、dry-run、local Worker、remote Worker、Sepolia の evidence を区別し、mainnet evidence は作らない。

**Rationale**: 最も高い不確実性は UI ではなく Worker runtime、Strands、署名、外部 API、idempotency にある。先に失敗を安く発見できる。

**Alternatives considered**: UI から縦に作る案は runtime 非互換発覚時の手戻りが大きい。

## 調査完了判定

- `NEEDS CLARIFICATION`: 0
- 憲章違反: 0
- 実装前に実測が必要な事項: tasks Phase 2 の6 spike として blocking gate 化済み
- mutable な外部事実: Sera token/market、model availability、Cloudflare limit は deploy/実行時に再検証する
