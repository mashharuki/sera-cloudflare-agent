# Phase 0 実現可能性エビデンス

**計測日時**: 2026-09-19 (JST)  
**対象 commit**: `3a8b17c6b6b51cb9379fe8974d5eb3a733c8f179` + 作業ツリー

この文書は後続実装を開始してよいかを決める blocking gate である。`T011`〜`T016` がすべて `PASS` になるまで Phase 3 以降へ進まない。

| Task | Status | 実測・判断 |
|---|---|---|
| T011 | PASS | `@strands-agents/sdk@1.18.0` default export と `OpenAIModel` を `nodejs_compat` なしで bundle。2,837,960 bytes、gzip 523,389 bytes。local workerd で direct tool call と SSE progress/result を確認。静的 bundle に `node:` import は0件。 |
| T012 | NOT_RUN | Cloudflare AI REST 用の最小権限 token または provider credential が未設定。日本語、stream、tool call、abort、provider error は未実測。 |
| T013 | NOT_RUN | Privy app、テスト user-owned wallet、access token、client authorization signature が未設定。Sepolia 送信は未実測。 |
| T014 | PARTIAL | local workerd からSepolia RPCのchain ID/block/ERC-20 `balanceOf` と、credentialなしのSera config/tokens/markets/quoteを取得してZod validation。Seraはchain ID `11155111`、token 117件、market 6,786件。Quoteは認証エラーではなく `no_liquidity` のbusiness rejectionまで到達。Sera account balances、orders/fills、transfer build、Privy wallet/account mappingは未実測で、これらauthenticated account endpointには `SERA_API_KEY` と `SERA_API_SECRET` が必要。 |
| T015 | NOT_RUN | remote Worker URL と remote D1 が未作成。60秒超 SSE、再開、terminal replay、2-user isolation は未実測。 |
| T016 | PASS | local D1 で同一 operation に20並行 conditional `UPDATE` を行い、`meta.changes === 1` が1件、`broadcast_count = 1` を確認。 |

## Version / runtime

- `@strands-agents/sdk`: `1.18.0`
- `@cloudflare/vitest-pool-workers`: `0.22.0`
- Vitest: `4.1.11`
- Wrangler dry-run: `4.134.0`
- local workerd compatibility date: `2026-08-22`（同梱 workerd の上限。deployable 本体は `2026-09-18`）
- local runner: 12,296 ms、peak RSS 63,584 KiB（runner process の値であり isolate memory ではない）

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

- T012 不合格時: Cloudflare REST + Strands OpenAI adapter を停止し、同一 contract test を通した Workers AI custom adapter または provider-native endpoint を再評価する。
- T013 不合格時: server broadcast を禁止し、client wallet direct send + transaction hash reporting へ再計画する。
- T014 不合格時: 該当 capability を未対応として資産変更を開始しない。
- T015 不合格時: SSE/D1 event model を再設計し、再開保証を満たすまでチャット実装を開始しない。
- T016 不合格時: Durable Object coordinator を導入して再検証する。

## Gate

現状は `NOT_RUN` があるため **CLOSED**。`pnpm exec tsx scripts/check-feasibility-gate.ts` は非0で終了しなければならない。
