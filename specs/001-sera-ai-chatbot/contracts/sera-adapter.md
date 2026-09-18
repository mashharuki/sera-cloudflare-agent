# Sera REST adapter contract

## 目的

Worker は `sera-mcp` を runtime import/起動せず、必要な Sera REST API を typed port として呼ぶ。この文書は内部 port と upstream の責任境界を固定し、OpenAPI の公開 API と MCP tool contract を混同しないための契約である。

## 共通規則

- base URL と network は binding から取得し、mainnet/testnet を暗黙に切り替えない。
- account credential は Worker Secret のみ。browser、LLM message、D1、log に含めない。
- request/response は zod で実行時検証し、未知 field は必要に応じ保持しても実行判断には使わない。
- timeout、retry、rate limit を operation ごとに設定する。write request は upstream idempotency が確認できる場合以外、自動 retry しない。
- upstream raw error は log にも redaction し、公開 API は safe `Problem.code` に変換する。
- `/tokens`、`/markets`、`/config` は mutable capability。proposal 作成と実行前に有効期限を確認する。

## Port operations

| Port method | Sera route / reference | Auth | Classification | Output used as truth |
|-------------|------------------------|------|----------------|----------------------|
| `getConfig` | `GET /config` | public | read | network/service capability |
| `listTokens` | `GET /tokens` | public | read | token address/decimals/minimum |
| `listMarkets` | `GET /markets` | public | read | market/step/precision |
| `getFxRate` | `GET /fx/rate` | public | read | reference price only |
| `getQuote` | `POST /swap/quote` | per upstream | read/preparation | quote ID, route params, fee, expiry |
| `getSeraAccountBalances` | `GET /balances` | account | read | Sera account balance。Privy wallet 残高とは混在させない |
| `listOrders` | `GET /orders` | account | read | swap state evidence |
| `listFills` | `GET /fills` | account | read | execution/fill evidence |
| `prepareTransfer` | `POST /transfer` | account | prepare | unsigned EIP-1559 transaction |
| `executeSwap` | `POST /swap` | account + user signature | write | accepted order/tx reference |
| `sendTransfer` | `POST /transfer/send` | account + authorized tx | write | accepted tx reference |
| `getSystemTime` | `GET /system/time` | public | read | quote/clock skew check |

## Public Agent tools

Strands に公開してよい tool は次だけとする。

- `get_wallet_summary`: authenticated user の wallet address/network の safe projection
- `get_balances`: ownership 検証済み Privy wallet address に対する Sepolia RPC の ERC-20 balance。token address、block、source を返す
- `list_markets`, `get_fx_rate`, `estimate_synthetic_depth`: read-only market data
- `list_my_orders`, `list_my_fills`: authenticated user scope の read-only history
- `draft_swap_proposal`, `draft_transfer_proposal`: proposal API を呼び、`proposal.ready` を返すまで。承認・署名・送信はしない
- `get_operation_status`: D1 の operation と最新 evidence を読む

Agent tool に公開しない operation:

- access token verification、wallet ownership mutation
- approval creation、signature verification
- `executeSwap`、`sendTransfer`、Privy wallet RPC submission
- secret/API credential access

`getSeraAccountBalances` は Privy user/wallet と Sera account の一対一対応を成立性 spike で証明するまで Agent tool に公開しない。利用者 wallet の ERC-20 残高は Sera adapter ではなく Ethereum RPC adapter が `balanceOf` で取得する。

## Synthetic depth semantics

`infer_book`、`probe_depth`、`scan_markets` 相当の結果は複数サイズの executable quote から推定した depth である。応答は常に `informationKind: SYNTHETIC_DEPTH`、source `SERA_QUOTE`、各 quote の fetched/expiry を含める。authoritative order book、注文総量、約定保証とは表示しない。

## Write invariants

1. adapter は `Operation` の winner lease、valid Approval、unexpired Proposal を入力として要求する。
2. payload は proposal の `upstream_payload_hash` と再計算 hash が一致しなければ拒否する。
3. external idempotency key は stable `operation.id` から導出する。
4. timeout/response loss は `UNKNOWN` であり、成功/失敗を推測しない。
5. write response は operation evidence として hash/reference のみ保存し、署名や credential は保存しない。
