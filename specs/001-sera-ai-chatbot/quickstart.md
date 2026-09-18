# Quickstart: 計画を検証可能な実装へ進める

この文書は完成後の再現・受け入れ検証手順を定義する。現時点の repository は scaffold であり、Vitest/Playwright/Newman、D1 migration、deploy/destroy script はまだ未実装である。したがって、以下を現時点で「成功済み」とは扱わない。

## 1. Prerequisites

- Node.js / pnpm（root `packageManager` に従う）
- Cloudflare account と、Workers Scripts / Pages / D1 / Workflows / Workers AI または AI Gateway に必要な最小権限 token
- Privy app（embedded Ethereum wallet、許可 origin、Sepolia）
- Sera testnet account/API credential
- Sepolia RPC endpoint と test token（JPYC/USDC）
- OpenAI/provider credential または Cloudflare AI billing configuration
- 実資産を使わないこと。MVP の write test は Sepolia のみ

## 2. Configuration inventory

公開値と秘密値を分ける。実値を README、git、browser bundle、test snapshot へ commit しない。

| Value | Location | Secret |
|-------|----------|--------|
| `VITE_PRIVY_APP_ID`, API public URL, chain ID | Pages build env | no |
| Privy app secret/verification config | Worker Secret/Binding | yes |
| Sera API key/secret | Worker Secret | yes |
| provider/API Gateway token | Worker Secret | yes |
| D1 database, Workflow, AI binding | `wrangler.jsonc` stage config | resource ID は manifest と照合 |
| model ID, Sera base URL, allowed origin | Worker vars | no（stage ごと固定） |

## 3. Baseline checks

repository root で実行する。

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm frontend lint
pnpm frontend build
```

実装後に追加される gate:

```bash
pnpm test
pnpm api-spec lint
pnpm api-spec generate
pnpm api-spec diff
pnpm api-spec contract
pnpm e2e
```

期待結果:

- generated client に未反映の OpenAPI 差分がない。
- formatter/lint/type/build/unit/contract/E2E がすべて exit 0。
- test output は token、signature、wallet credential を含まない。

## 4. Blocking feasibility gate

本体機能より前に、最小 spike を local と remote Worker で実行する。

```bash
pnpm spike:workers:local
pnpm spike:workers:remote --stage dev
pnpm spike:concurrency --stage dev
```

合格条件:

1. Strands Agent が request ごとに作られ、日本語 streaming と1回以上の structured tool call を完了する。
2. bundle/runtime に `child_process`、stdio、native SQLite、persistent `fs` の依存がない。
3. `openai/gpt-5.6-terra` の stream、tool call、abort、provider error が schema 通り処理される。
4. Privy access token と wallet owner が Worker で検証され、exact request authorization の payload hash が UI 表示と一致する。
5. Sera testnet の tokens/markets/quote、read-only account route、transfer preparation が Worker fetch で zod validation を通る。
6. 同じ approval/idempotency key を20並行送信して、application と upstream の broadcast 観測回数が最大1。
7. SSE を切断・再接続して、seq の欠落/重複適用なしに terminal state へ到達する。
8. 2 user の並行 run で conversation、wallet、proposal、event が混在しない。
9. bundle size、startup、CPU、memory、subrequest、外部 latency が `docs/evidence/` に実測として記録される。

いずれかが失敗した場合は実装を進めず、[research.md](./research.md) の fallback を選んで plan/spec を更新する。

## 5. Local run

実装後の想定手順:

```bash
pnpm dev:setup --stage local
pnpm backend dev
pnpm frontend dev
```

`dev:setup` は local D1 migration と非秘密の stage config を準備する。secret は `.dev.vars` 等の gitignore 対象から読み、sample file に値を含めない。

確認:

```bash
curl -fsS http://127.0.0.1:8787/v1/health
```

期待: `status: ok`、UTC time、build version。外部 Sera/Privy/provider 障害を health 200 で隠さず、capability/readiness は別に観測する。

## 6. Read-only acceptance

1. 新規 Privy user で login し、embedded wallet を作成する。
2. 同じ user で reload/re-login し、同じ address と Sepolia が表示される。
3. balance を尋ね、token、amount、network、source、fetched time を確認する。
4. 「JPYC/USDC の板」と尋ね、結果が `synthetic depth` / quote-based estimate と表示されることを確認する。
5. 未対応情報を尋ね、捏造せず unsupported と source range を返すことを確認する。
6. 別 user の conversation/wallet/run ID を REST に渡し、内容や存在を開示しないことを確認する。

Evidence: request correlation ID、stage、commit、source endpoint、取得時刻、safe screenshot。JWT/wallet signature は保存しない。

## 7. Swap acceptance（Sepolia）

1. capability endpoint で `JPYC/USDC`、両 address/decimals/minimum を確認する。
2. chat から数量不足の swap を依頼し、追加質問前に proposal が作られないことを確認する。
3. valid amount の proposal で input/output、expected amount、fee、slippage、network、quote expiry、proposal hash を確認する。
4. 拒否時に network request の broadcast が0であることを確認する。
5. 承認後、EIP-712 payload hash と proposal hash の対応を確認して実行する。
6. 同じ execute request を並行再送し、すべて同じ operation ID を返し、broadcast は最大1回であることを確認する。
7. order/fill evidence により `SUCCEEDED` または根拠付き `FAILED` へ到達する。
8. expiry 後の古い承認が `410` となり、新 proposal/approval を必要とすることを確認する。

## 8. Transfer acceptance（Sepolia）

1. JPYC または USDC、recipient、amount を入力し、from/to/token/amount/network/fee を確認する。
2. malformed/zero-address、unsupported token、残高不足を送信前に拒否する。
3. exact Privy authorization request の digest が proposal と一致することを確認して署名する。
4. 20並行 execute で broadcast 最大1回、同一 operation ID を確認する。
5. response loss を注入し、新規送信せず tx hash/status recovery を優先することを確認する。
6. Sepolia receipt の status/block/hash を根拠に terminal state へ到達する。

## 9. Streaming/recovery acceptance

- Agent stream 中に network を切断し、`Last-Event-ID` から再開する。
- reconnect のため message POST や execute POST が自動再送されない。
- terminal event 後、REST run/operation state と表示が一致する。
- Workflow deadline を超えた operation は成功と断定せず `UNKNOWN`、recheck は broadcast なし。

## 10. Deploy convergence

```bash
pnpm deploy --stage dev
pnpm deploy --stage dev
pnpm smoke --stage dev
```

期待:

- resource は `sera-ai-api-dev`、`sera-ai-db-dev`、`sera-ai-web-dev` に収束し、2回目に duplicate を作らない。
- migration → Worker → health → Pages → authenticated smoke の順で完了する。
- `.deploy/state/dev.json` が account/stage/name/id/ownership/commit を保持し、secret を含まない。
- remote URL で read-only acceptance と、明示的に許可した Sepolia write smoke が通る。

## 11. Destroy safety

```bash
pnpm destroy --stage dev --dry-run
pnpm destroy --stage dev
pnpm inventory --stage dev
```

期待:

- dry-run は exact name/id/account、削除順、保持対象を表示する。
- manifest と live resource が不一致なら fail closed。
- dev の Pages、Worker/Workflow、D1 だけが削除され、他 stage、共有 AI Gateway、Privy app、Sera account、RPC project は残る。
- on-chain transaction/history は削除できないことが明示される。
- 途中失敗後の再実行で残存 resource の削除へ収束する。

## 12. Documentation acceptance

別の開発者が README のみで prerequisites、local read-only、remote deploy、主要 test、destroy を完了する。ブログ内の図・数値・スクリーンショットは実装 commit と `docs/evidence/` の実測に対応し、「予定」と「確認済み」を区別する。

