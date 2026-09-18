# Agent SSE wire contract

## Endpoint

`GET /v1/agent-runs/{runId}/events`

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- authentication と run ownership は stream 開始前に検証する。
- resume cursor は `Last-Event-ID` を優先し、なければ query `after` を使う。
- event `id` は run 内の10進 `seq`。再接続時は cursor より大きい event だけ返す。
- comment heartbeat `: heartbeat` は15秒以内を目安に送り、domain event として数えない。

## Envelope

```text
id: 12
event: message.delta
data: {"runId":"<uuid>","seq":12,"occurredAt":"2026-09-18T00:00:00Z","payload":{"text":"..."}}

```

`data` は1行 JSON。全 event に `runId`, `seq`, `occurredAt`, `payload` を含める。JWT、signature、wallet credential、raw upstream error を含めない。

## Events

| Event | Payload | Terminal |
|-------|---------|----------|
| `run.started` | `{ conversationId, messageId }` | no |
| `message.delta` | `{ text }` | no |
| `tool.started` | `{ toolCallId, toolName, classification: "READ" | "PROPOSAL" }` | no |
| `tool.completed` | `{ toolCallId, toolName, summary, sourceRefs[] }` | no |
| `proposal.ready` | `{ proposalId, kind, proposalHash, expiresAt }` | no |
| `run.completed` | `{ outputMessageId }` | yes |
| `run.failed` | `{ code, retryable, correlationId }` | yes |

`tool.completed.summary` は safe projection のみで、raw quote signing payload は含めない。詳細な承認対象は authenticated proposal endpoint から取得する。

## Reconnect behavior

1. client は受信済み最大 `seq` を run ごとに保持する。
2. disconnect 後、同じ run ID と cursor で reconnect する。message POST を再送しない。
3. server は D1 event log から再生後、run が進行中なら live stream へ接続する。
4. terminal event 後は接続を閉じる。terminal event が TTL 後に失われても `GET /v1/agent-runs/{id}` で状態を取得できる。
5. cursor が retention window より古い場合は `409 EVENT_CURSOR_EXPIRED` とし、conversation/run REST state の再取得を案内する。

## Contract tests

- seq の単調性、一意性、cursor exclusive replay
- UTF-8 日本語 delta の分割結合
- terminal event は最大1つ
- 途中切断後に message/proposal/asset execution が重複しない
- 2 user が他者 run ID を指定しても event の存在を開示しない
- slow consumer/abort で Worker resource を解放し、run durable state は継続または明示 cancellation へ遷移する

