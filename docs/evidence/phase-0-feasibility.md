# Phase 0 実現可能性エビデンス

**計測日時**: 2026-09-20 (JST)
**対象 commit**: `4b113e4a46dfe7c9ab6b92447d5c34b9c4460b69` + 作業ツリー

この文書は後続実装を開始してよいかを決める blocking gate である。`T011`〜`T016` がすべて `PASS` になるまで Phase 3 以降へ進まない。

| Task | Status | 実測・判断 |
|---|---|---|
| T011 | PASS | `@strands-agents/sdk@1.18.0` default export と `OpenAIModel` を `nodejs_compat` なしで bundle。2,839,620 bytes、gzip 523,911 bytes。local workerd で direct tool call と SSE progress/result を確認。静的 bundle に `node:` import は0件。 |
| T012 | PASS | `GEMINI_API_KEY` を使い Google 公式 OpenAI-compatible endpoint から `gemini-2.5-flash` を直接呼び、Strands 経由の日本語 stream、structured `add` tool call（結果42）、abort、provider error 正規化をremote Workerで実測。4 testすべてPASS。AI Studioの対象projectでGemini 2.5 Flashのrequest/tokenと料金¥0.28の計上を確認した。 |
| T013 | NOT_RUN | Privy app と delegated user-owned Ethereum wallet の存在・所有者候補をread-only APIで確認し、access token検証、所有権照合、残高/fee preflight、EIP-712、Sepolia自己送信、idempotency replayのWorker harnessを実装した。ブラウザでの利用者ログインと送信直前の明示承認が未完了のため、署名・送信は未実測。 |
| T014 | PARTIAL | local workerdとremote WorkerからSepolia RPCのchain ID/block/ERC-20 `balanceOf` と、credentialなしのSera config/tokens/markets/quoteを取得してZod validation。Seraはchain ID `11155111`、token 117件、market 6,786件。Privy所有権と同じaddressを使うaccount balances/orders/fills/transfer build harnessも実装・bundle済み。実測には同wallet ownerの`SERA_API_KEY`と`SERA_API_SECRET`が必要で、現在は未設定。 |
| T015 | PASS | remote Workerとremote D1で65秒接続、切断後の`Last-Event-ID`再開、terminal event replay、2-user isolationを実測。2 testすべてPASS、実行時間66.47秒。run所有者が異なる再利用を拒否し、イベントは`run_id`単位でD1へ永続化する。 |
| T016 | PASS | local D1 で同一 operation に20並行 conditional `UPDATE` を行い、`meta.changes === 1` が1件、`broadcast_count = 1` を確認。 |

## Version / runtime

- `@strands-agents/sdk`: `1.18.0`
- `@cloudflare/vitest-pool-workers`: `0.22.0`
- Vitest: `4.1.11`
- Wrangler dry-run: `4.134.0`
- local workerd compatibility date: `2026-08-22`（同梱 workerd の上限。deployable 本体は `2026-09-18`）
- latest local runner: 10,464 ms、peak RSS 79,024 KiB、user CPU 8,535 µs、system CPU 2,591 µs（runner process の値であり isolate memory ではない）
- Privy/account spike追加後のlatest bundle: 3,665.26 KiB、gzip 650.13 KiB。`nodejs_compat`なしでWrangler dry-runが成功した。

## Gemini remote Worker

- Worker: `sera-strands-worker-spike`
- URL: `https://sera-strands-worker-spike.avp-104-106-107-a78.workers.dev`
- Gemini検証 version: `b76f0f50-7871-40aa-a5cf-9946270334dc`
- SSE検証 version: `013de7a1-4c8b-408f-ae6f-d5df93de7a01`
- SSE実装後 bundle: 2,778.89 KiB、gzip 513.13 KiB、reported startup 49 ms
- 認証付き remote test: 日本語stream、structured tool call、abort、provider errorの4件がPASS。
- `/__spike/model` は `SPIKE_TOKEN` bearerを必須とし、無認証POSTがHTTP 401になることをremoteで確認した。Secret値はログ・エビデンスに記録しない。
- Google AI Studioの`Gemini Project`（Tier 1）で、Gemini 2.5 FlashのAPI request、入力token、出力tokenが計上されていることを確認した。28日表示の料金は¥0.28、コスト削減¥0.28、総費用¥0.00であった（利用額情報は最大24時間遅延し得る）。

## SSE / D1 remote durability

- `spikes/worker/sse-isolation.spike.test.ts` の2 testをremote Workerへ実行し、66.47秒でPASSした。
- 最初の接続でevent 1〜2を受信後に切断し、`Last-Event-ID: 2`で再接続してevent 3のterminal eventを受信した。全体の経過時間が60秒以上であることをassertした。
- runとeventはremote D1 `sera-ai-db-dev` に保存し、同じrun IDは作成時のuser IDに固定する。別userによる再利用はHTTP 403とする。
- 別run IDで同時接続した`user-a`と`user-b`について、各streamに他方のuser IDが混在しないことを確認した。
- `/__spike/sse`も`SPIKE_TOKEN` bearer必須とし、検証用endpointから第三者が長時間処理を開始できないようにした。

## Remote resource measurements

- 計測 version: `37000993-c94e-4b6b-835f-91a3679edc05`、reported startup 46 ms。
- runner probe: Sera public 3,416 ms / HTTP 200 / 4 subrequests、Sepolia RPC 248 ms / HTTP 200 / 3 subrequests。
- Cloudflare observabilityの単発実測: Sera public wall 4,776 ms / CPU 64 ms、Sepolia RPC wall 24 ms / CPU 3 ms。ネットワーク状態によりrunner latencyとは一致しない。
- subrequest数はendpoint実装がレスポンスヘッダーへ明示するinstrumentation値であり、probe変更時には実装と同時に更新する。

## Sepolia RPC

- Phase 0 のcredential不要probeでは `https://ethereum-sepolia-rpc.publicnode.com` を使用した。本番設定の `RPC_URL` をこの共有endpointへ固定する判断ではない。
- local workerd から `eth_chainId`、`eth_blockNumber`、Sepolia USDC contractへの`eth_call balanceOf(address)`を並行実行し、chain ID `11155111` とhex形式のblock/balanceをschema検証した。

## Sera public API

- `SERA_NETWORK=sepolia` から canonical URL `https://api-testnet.sera.cx/api/v1` を選択し、custom base URL は使用していない。
- local workerd の `fetch` で `GET /config`、`GET /tokens`、`GET /markets` がすべて HTTP 200。レスポンスは endpoint ごとの Zod schema で検証した。
- `POST /swap/quote` は credential なしで認証境界を通過し、JPYC/USDCの現在の流動性に対するHTTP 400 `no_liquidity` をschema検証した。成功quoteとbusiness rejectionの両方を受理するprobeであり、401/403や未知のshapeは失敗扱いにする。
- `/config`: chain ID `11155111`、Sera contract `0x83475A1bD98a8DC2DCd507A747e4DC85da241D6e`。
- `/tokens`: 117件。`/markets`: 6,786件。
- Workers runtime は `redirect: "error"` を受理しないため、`redirect: "manual"` と非2xx拒否でリダイレクト非追従を実装した。

## Balance source

利用者残高の正本は Sepolia RPC の ERC-20 `balanceOf` とする。Sera `/balances` は Sera account 残高であり、Privy user-owned wallet との対応を T014 で証明できるまで混在させない。

## Fallback 判断

- T012 不合格時: Google 公式 OpenAI-compatible endpoint を停止し、同じ contract test を通す provider-native custom adapter を実装して再検証する。
- T013 不合格時: server broadcast を禁止し、client wallet direct send + transaction hash reporting へ再計画する。
- T014 不合格時: 該当 capability を未対応として資産変更を開始しない。
- T015 不合格時: SSE/D1 event model を再設計し、再開保証を満たすまでチャット実装を開始しない。
- T016 不合格時: Durable Object coordinator を導入して再検証する。

## Gate

現状は `NOT_RUN` があるため **CLOSED**。`pnpm exec tsx scripts/check-feasibility-gate.ts` は非0で終了しなければならない。
