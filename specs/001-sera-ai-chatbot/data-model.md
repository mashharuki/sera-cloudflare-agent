# データモデル: Sera AI チャットボット

## モデル原則

- D1 を durable state の正本とし、LLM context、SSE connection、Worker global memory を正本にしない。
- すべての user-owned record は `user_id` を持ち、query は認証済み user scope を必須にする。別 user の ID は `404` 相当として存在も開示しない。
- 金額は human-readable decimal string と raw integer string を区別する。JavaScript `number` で token amount を保持しない。
- address、chain、token decimals、quote、fee、expiry は proposal 作成時の snapshot を保持する。runtime capability と不一致なら再承認する。
- すべての時刻は UTC ISO 8601、ID は UUIDv7 を使用する。

## Entity relationship

```text
User 1 ── 0..1 WalletLink
User 1 ── * Conversation 1 ── * Message
Conversation 1 ── * AgentRun 1 ── * AgentEvent
User 1 ── * TransactionProposal 1 ── * Approval
TransactionProposal 1 ── 1 Operation 1 ── * OperationObservation
User 1 ── * AuditEvent
```

## 1. User

認証主体。Privy user の app 内 projection であり、JWT 本体や email/phone は保存しない。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `privy_did` | string | UNIQUE、`did:privy:` prefix、log では hash/mask |
| `created_at` | timestamp | required |
| `last_seen_at` | timestamp | required |

**Validation**: access token の `sub` と `aud` を SDK で検証し、その `sub` からのみ lookup/upsert する。

## 2. WalletLink

Privy にある user-owned embedded wallet の ownership projection。鍵・seed・delegated credential は保存しない。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `user_id` | UUIDv7 | FK User、UNIQUE |
| `privy_wallet_id` | string | UNIQUE |
| `address` | EVM address | lowercase checksum comparison 用 canonical form |
| `chain_id` | integer | MVP は `11155111` |
| `wallet_type` | enum | `PRIVY_EMBEDDED_USER_OWNED` のみ |
| `verified_at` | timestamp | required |
| `created_at`, `updated_at` | timestamp | required |

**Invariant**: request ごと、少なくとも資産操作の承認・実行時には Privy user record と再照合する。1 user 1 MVP wallet。

## 3. Conversation

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `user_id` | UUIDv7 | FK User、index |
| `title` | string | 1..120、secret/token を含めない |
| `status` | enum | `ACTIVE`, `CLOSED` |
| `created_at`, `updated_at` | timestamp | required |

## 4. Message

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `conversation_id` | UUIDv7 | FK、index |
| `user_id` | UUIDv7 | ownership query 用 FK |
| `role` | enum | `USER`, `ASSISTANT`, `TOOL_SUMMARY`, `SYSTEM_NOTICE` |
| `content` | string | 1..20,000、credential redaction 後 |
| `source_refs_json` | JSON | URL/source/type/fetchedAt。任意 |
| `created_at` | timestamp | required |

**Invariant**: raw tool credential、signature、JWT、full upstream error は保存しない。asset operation の真偽は Message ではなく Operation に置く。

## 5. AgentRun

1 user message に対する request-scoped Strands 実行。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `conversation_id`, `user_id` | UUIDv7 | FK、ownership |
| `input_message_id` | UUIDv7 | FK Message |
| `status` | enum | `QUEUED`, `STREAMING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `model_provider`, `model_id` | string | evidence 用 |
| `correlation_id` | string | UNIQUE |
| `error_code` | string | safe code、任意 |
| `started_at`, `completed_at` | timestamp | 状態に応じ required |

**Transition**:

```text
QUEUED -> STREAMING -> COMPLETED
                    -> FAILED
       -> CANCELLED
STREAMING -> CANCELLED
```

## 6. AgentEvent

SSE 再接続用の期限付き event log。

| Field | Type | Constraint |
|-------|------|------------|
| `run_id` | UUIDv7 | FK AgentRun、composite PK |
| `seq` | integer | run 内で単調増加、composite PK |
| `event_type` | enum | `run.started`, `message.delta`, `tool.started`, `tool.completed`, `proposal.ready`, `run.completed`, `run.failed`, `heartbeat` |
| `payload_json` | JSON | event schema に合致、secret-free |
| `created_at`, `expires_at` | timestamp | TTL cleanup 対象 |

**Invariant**: `(run_id, seq)` は一意。client は最後に処理した seq 以下を無視する。

## 7. CapabilitySnapshot

Sera runtime discovery の取得結果。正本は upstream で、これは短期 snapshot と evidence。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `network` | enum | `SEPOLIA`, `MAINNET` |
| `kind` | enum | `CONFIG`, `TOKENS`, `MARKETS` |
| `etag_or_hash` | string | response canonical hash |
| `payload_json` | JSON | zod 検証済み |
| `fetched_at`, `expires_at` | timestamp | required |

## 8. TransactionProposal

利用者が承認する immutable snapshot。LLM の文章ではなく deterministic service が作る。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `user_id`, `wallet_link_id` | UUIDv7 | FK、ownership |
| `conversation_id` | UUIDv7 | FK、任意 |
| `kind` | enum | `SWAP`, `TRANSFER` |
| `creation_idempotency_key` | string | `(user_id, creation_idempotency_key)` UNIQUE |
| `version` | integer | 1以上。変更時は新 version/new proposal |
| `network`, `chain_id` | string/integer | `SEPOLIA`, `11155111` |
| `from_address` | EVM address | WalletLink と一致 |
| `to_address` | EVM address | transfer では required |
| `input_token`, `output_token` | JSON | address/symbol/decimals |
| `input_amount_raw`, `expected_output_raw` | decimal integer string | kind に応じ required |
| `max_slippage_bps` | integer | swap required、0..10,000、MVP policy 上限以下 |
| `fee_snapshot_json` | JSON | gas/protocol fee と単位 |
| `quote_id` | string | swap required |
| `upstream_payload_hash` | hex string | route/build response canonical hash |
| `proposal_hash` | hex string | user-visible fields + upstream hash + owner + expiry の canonical hash、UNIQUE |
| `expires_at` | timestamp | required、現在時刻より後 |
| `created_at` | timestamp | required |

**Invariant**:

- 承認後に field を更新しない。quote/fee/recipient/amount の変更は新 proposal を作る。
- `from_address` は承認時と実行時に WalletLink/Privy ownership と再一致させる。
- `expires_at <= now`、capability change、hash mismatch のいずれかで実行禁止。
- Proposal と `AWAITING_APPROVAL` の Operation は同一 D1 transaction で1件ずつ作成し、API は両方の ID を返す。

## 9. Approval

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `proposal_id`, `user_id` | UUIDv7 | FK |
| `proposal_version`, `proposal_hash` | integer/string | proposal と一致 |
| `status` | enum | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `EXPIRED`, `CONSUMED` |
| `authorization_kind` | enum | `EIP712_SIGNATURE`, `PRIVY_REQUEST_SIGNATURE` |
| `authorization_digest` | string | signature bytes 自体ではなく digest/参照 |
| `approved_at`, `expires_at`, `consumed_at` | timestamp | 状態に応じ required |
| `created_at` | timestamp | required |

**Constraint**: `(proposal_id, proposal_version, user_id)` UNIQUE。署名の raw value は execution request の短命入力として検証し、不要になれば保存しない。

**Transition**:

```text
PENDING -> APPROVED -> CONSUMED
        -> REJECTED
        -> CANCELLED
        -> EXPIRED
APPROVED -> EXPIRED
```

## 10. Operation

資産操作の実行・追跡の正本。仕様に定義した7状態だけを持つ。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK。外部 idempotency key の基礎 |
| `user_id`, `proposal_id` | UUIDv7 | FK、`proposal_id` UNIQUE |
| `approval_id` | UUIDv7 | FK、承認完了まで NULL |
| `kind` | enum | `SWAP`, `TRANSFER` |
| `status` | enum | 下表 |
| `submission_idempotency_key` | string | 実行要求まで NULL、設定後は `(user_id, submission_idempotency_key)` UNIQUE |
| `submission_lease` | string | winner token、任意 |
| `tx_hash` | hex string | network accepted 後、任意、UNIQUE when present |
| `sera_order_id` | string | swap accepted 後、任意、UNIQUE when present |
| `failure_code`, `failure_detail_safe` | string | 任意 |
| `last_evidence_type` | enum | `SERA_RESPONSE`, `SERA_ORDER`, `SERA_FILL`, `RPC_RECEIPT`, `TIMEOUT` |
| `last_checked_at` | timestamp | required after submission attempt |
| `created_at`, `updated_at`, `terminal_at` | timestamp | 状態に応じ required |

| Status | 日本語 | 許可される次状態 |
|--------|--------|------------------|
| `AWAITING_APPROVAL` | 承認待ち | `SUBMITTING`, `FAILED` |
| `SUBMITTING` | 送信処理中 | `SUBMITTED`, `FAILED`, `UNKNOWN` |
| `SUBMITTED` | 送信済み | `CONFIRMING`, `SUCCEEDED`, `FAILED`, `UNKNOWN` |
| `CONFIRMING` | 確認中 | `SUCCEEDED`, `FAILED`, `UNKNOWN` |
| `UNKNOWN` | 結果不明 | `SUBMITTED`, `CONFIRMING`, `SUCCEEDED`, `FAILED` |
| `SUCCEEDED` | 成功 | 終端 |
| `FAILED` | 失敗 | 終端 |

**At-most-once algorithm**:

1. Proposal 作成 transaction が `(user_id, creation_idempotency_key)` を検証し、Proposal と `AWAITING_APPROVAL` Operation を同時に insert する。再試行時は既存の2 IDを返す。
2. `execute` transaction が auth/owner/hash/expiry/approval を再検証し、`submission_idempotency_key` を初回だけ設定する。既存 key なら同じ Operation を返す。
3. `AWAITING_APPROVAL -> SUBMITTING` の conditional update に成功した request だけが `submission_lease` を得る。
4. stable operation ID から Privy/Sera idempotency key を生成して1回送る。
5. response loss 時は再 broadcast せず、同じ external key と upstream status/RPC を照会する。
6. 拒否または取消は Operation を `FAILED` へ遷移させ、`USER_REJECTED` または `USER_CANCELLED` を記録する。

## 11. OperationObservation

取引状態を変えた根拠の append-only 記録。

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `operation_id` | UUIDv7 | FK、index |
| `source` | enum | `SERA`, `ETHEREUM_RPC`, `PRIVY`, `APPLICATION` |
| `observed_status` | string | upstream 値 |
| `evidence_ref` | string | order/tx/block/request ID。secret-free |
| `payload_hash` | string | raw response の canonical hash |
| `observed_at` | timestamp | required |

## 12. AuditEvent

| Field | Type | Constraint |
|-------|------|------------|
| `id` | UUIDv7 | PK |
| `user_id` | UUIDv7 | FK、任意（system event 可） |
| `actor_type` | enum | `USER`, `SYSTEM`, `WORKFLOW` |
| `action` | enum | `PROPOSAL_CREATED`, `REJECTED`, `CANCELLED`, `APPROVAL_REQUESTED`, `SIGNATURE_ACCEPTED`, `SIGNATURE_REJECTED`, `SUBMIT_STARTED`, `SUBMIT_ACCEPTED`, `STATUS_CHANGED`, `RECHECK_REQUESTED` |
| `resource_type`, `resource_id` | string | required |
| `outcome` | enum | `SUCCEEDED`, `REJECTED`, `FAILED`, `UNKNOWN` |
| `correlation_id` | string | index |
| `metadata_json` | JSON | token/signature/PII 禁止 |
| `created_at` | timestamp | append-only |

**Indexes**: `(user_id, resource_type, resource_id, created_at)` と `(resource_type, resource_id, action)` を持ち、operation ID から proposal、approval、署名要求、送信、状態変更を検索できるようにする。

## 13. ManagedResourceManifest（local artifact）

D1 table ではなく `.deploy/state/{stage}.json`（gitignore、secret-free）として保持する。

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | integer | required |
| `accountId` | string | exact match |
| `stage` | string | `dev`, `staging`, `prod` 等 allowlist |
| `createdBy` | string | repository identifier |
| `resources[]` | object | kind/name/id/managed/createdAt |
| `lastDeployCommit` | git SHA | required after deploy |

**Invariant**: destroy は `managed: true` かつ live name/id/account が一致する resource のみ削除する。共有 AI Gateway、Privy app、Sera account、RPC project、オンチェーン履歴は manifest の削除対象にしない。

## Retention と cleanup

- AgentEvent: 24時間または run 完了後の設定期間で削除。ただし proposal/operation 参照 event は safe summary を残す。
- Conversation/Message: user deletion policy と教材環境の retention を設定可能にする。
- Proposal/Approval/Operation/Observation/Audit: 財務監査・デバッグに必要な期間を stage policy で定め、勝手に TTL 削除しない。
- CapabilitySnapshot: expiry 後に置換可能。proposal 内 snapshot は immutable。
