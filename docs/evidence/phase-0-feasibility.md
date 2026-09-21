# Phase 0 実現可能性エビデンス

**計測日時**: 2026-09-21 (JST)
**対象 commit**: `4b113e4a46dfe7c9ab6b92447d5c34b9c4460b69` + 作業ツリー

この文書は後続実装を開始してよいかを決める blocking gate である。`T011`〜`T016` がすべて `PASS` になるまで Phase 3 以降へ進まない。

| Task | Status | 実測・判断 |
|---|---|---|
| T011 | PASS | `@strands-agents/sdk@1.18.0` default export と `OpenAIModel` を `nodejs_compat` なしで bundle。2,839,620 bytes、gzip 523,911 bytes。local workerd で direct tool call と SSE progress/result を確認。静的 bundle に `node:` import は0件。 |
| T012 | PASS | `GEMINI_API_KEY` を使い Google 公式 OpenAI-compatible endpoint から `gemini-2.5-flash` を直接呼び、Strands 経由の日本語 stream、structured `add` tool call（結果42）、abort、provider error 正規化をremote Workerで実測。4 testすべてPASS。AI Studioの対象projectでGemini 2.5 Flashのrequest/tokenと料金¥0.28の計上を確認した。 |
| T013 | PASS | Privy access tokenとserver-side user/wallet ownershipを照合し、利用者の明示承認後にEIP-712署名と0 ETH Sepolia自己送信を実測。2件目のtx `0x1a1c7256f655dd2bef21181222e5bd302fd0ea38eb6b2ddd9984c3c314ffd9ff` を同一idempotency keyで再要求すると同じhash/request hashが返り、latest/pending nonceはいずれも`2`のまま（重複broadcastなし）。 |
| T014 | PARTIAL | public config/tokens/markets/quoteとSepolia RPCを検証済み。Privy walletでSera `ManageApiKey`を署名し、一時read-only keyの作成・owner照合、`/balances`・`/orders`・`/fills`のHTTP 200/Zod validation、毎回のself-revokeを実測した。`POST /transfer` buildのみUSDC/JPYC指定と429/503限定3回retry後もHTTP 503のため未成立。秘密値は保存・出力せず、各試行のcleanupは成功。 |
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

## Privy signing / Sepolia broadcast

- Privy email loginのaccess tokenをWorkerで検証し、Privy user recordのwallet address/ID/`user_can_sign`と照合した。
- 送信前にchain ID `11155111`、from/to、0 ETH、残高、推定最大feeを表示し、利用者の明示承認後だけ実行した。
- EIP-712 `AuthorizedRequest`をPrivy user JWT authorization contextで署名し、同じwalletから同じwalletへの0 ETH transactionを送信した。
- tx `0x2d87646bcb0f0a69eb920622dbbe7bfef2fc2221c7f1603b76f706a2d70c08ee` はblock `11748063`でstatus `1`。実使用gasは`21000`、effective gas priceは`1138184464 wei`、feeは`23901873744000 wei`。送信後nonceは`1`、残高は`9976098126256000 wei`。
- idempotency検証用tx `0x1a1c7256f655dd2bef21181222e5bd302fd0ea38eb6b2ddd9984c3c314ffd9ff` はblock `11748126`でstatus `1`。実使用gasは`21000`、effective gas priceは`3748007453 wei`、feeは`78708156513000 wei`。同一idempotency keyの再要求は同じtransaction hash/request hashを返し、latest/pending nonceはともに`2`で追加broadcastされなかった。
- `@privy-io/node@0.34.0`のwallet RPCはEIP-712とtransactionを`params.typed_data` / `params.transaction`で渡す必要がある。旧shapeの`typed_data`直下指定はHTTP 400となり、チェーンnonceが増えていないことを確認してから修正した。

## Sera public API

- `SERA_NETWORK=sepolia` から canonical URL `https://api-testnet.sera.cx/api/v1` を選択し、custom base URL は使用していない。
- local workerd の `fetch` で `GET /config`、`GET /tokens`、`GET /markets` がすべて HTTP 200。レスポンスは endpoint ごとの Zod schema で検証した。
- `POST /swap/quote` は credential なしで認証境界を通過し、JPYC/USDCの現在の流動性に対するHTTP 400 `no_liquidity` をschema検証した。成功quoteとbusiness rejectionの両方を受理するprobeであり、401/403や未知のshapeは失敗扱いにする。
- `/config`: chain ID `11155111`、Sera contract `0x83475A1bD98a8DC2DCd507A747e4DC85da241D6e`。
- `/tokens`: 117件。`/markets`: 6,786件。
- Workers runtime は `redirect: "error"` を受理しないため、`redirect: "manual"` と非2xx拒否でリダイレクト非追従を実装した。

## Sera account API

- 公式testnet仕様に従い、Privy walletでEIP-712 `ManageApiKey(owner, action=create, timestamp)`を署名して一時read-only API keyを作成した。`/api-keys/verify`のownerはPrivy所有者と一致した。
- 一時credentialでlowercase owner addressを指定し、`GET /balances`、`GET /orders`、`GET /fills`がHTTP 200かつZod schema validationを通過した。
- `POST /transfer`はUSDC/JPYC、amount `1`、自己宛てのunsigned buildだけを要求し、送信endpointは呼んでいない。429/503に限定した3回の短い指数backoff後もHTTP 503で、T014のtransfer build条件は未達。
- 各試行の一時keyは`POST /api-keys/self-revoke`で即時失効した。key/secretはレスポンス、ログ、ファイルへ保存・表示していない。

## Balance source

利用者残高の正本は Sepolia RPC の ERC-20 `balanceOf` とする。Sera `/balances` は Sera account 残高であり、Privy user-owned wallet との対応を T014 で証明できるまで混在させない。

## Fallback 判断

- T012 不合格時: Google 公式 OpenAI-compatible endpoint を停止し、同じ contract test を通す provider-native custom adapter を実装して再検証する。
- T013 不合格時: server broadcast を禁止し、client wallet direct send + transaction hash reporting へ再計画する。
- T014 不合格時: 該当 capability を未対応として資産変更を開始しない。
- T015 不合格時: SSE/D1 event model を再設計し、再開保証を満たすまでチャット実装を開始しない。
- T016 不合格時: Durable Object coordinator を導入して再検証する。

## Gate

現状は T014 が `PARTIAL` のため **CLOSED**。`pnpm exec tsx scripts/check-feasibility-gate.ts` は非0で終了しなければならない。
