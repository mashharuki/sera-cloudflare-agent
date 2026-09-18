# Phase 0 実現可能性エビデンス

**計測日時**: 2026-09-19 (JST)  
**対象 commit**: `4bdf80ea992486176a7440a5726531103c0c3569` + 作業ツリー

この文書は後続実装を開始してよいかを決める blocking gate である。`T011`〜`T016` がすべて `PASS` になるまで Phase 3 以降へ進まない。

| Task | Status | 実測・判断 |
|---|---|---|
| T011 | PASS | `@strands-agents/sdk@1.18.0` default export と `OpenAIModel` を `nodejs_compat` なしで bundle。2,831,323 bytes、gzip 521,763 bytes。local workerd で direct tool call と SSE progress/result を確認。静的 bundle に `node:` import は0件。 |
| T012 | NOT_RUN | Cloudflare AI REST 用の最小権限 token または provider credential が未設定。日本語、stream、tool call、abort、provider error は未実測。 |
| T013 | NOT_RUN | Privy app、テスト user-owned wallet、access token、client authorization signature が未設定。Sepolia 送信は未実測。 |
| T014 | NOT_RUN | Sepolia RPC URL と Privy wallet/account fixture が未設定。Sera public API は `SERA_NETWORK=sepolia` の canonical URL で credential 不要。T014 に含む Sera account `/balances` を検証する場合のみ `SERA_API_KEY` と `SERA_API_SECRET` の両方が必要。 |
| T015 | NOT_RUN | remote Worker URL と remote D1 が未作成。60秒超 SSE、再開、terminal replay、2-user isolation は未実測。 |
| T016 | PASS | local D1 で同一 operation に20並行 conditional `UPDATE` を行い、`meta.changes === 1` が1件、`broadcast_count = 1` を確認。 |

## Version / runtime

- `@strands-agents/sdk`: `1.18.0`
- `@cloudflare/vitest-pool-workers`: `0.22.0`
- Vitest: `4.1.11`
- Wrangler dry-run: `4.134.0`
- local workerd compatibility date: `2026-08-22`（同梱 workerd の上限。deployable 本体は `2026-09-18`）
- local runner: 6,799 ms、peak RSS 63,360 KiB（runner process の値であり isolate memory ではない）

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
