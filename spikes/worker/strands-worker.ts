import { PrivyClient } from "@privy-io/node";
import { Agent, type ToolResultBlock, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";

import { createGeminiOpenAiFetch } from "./gemini-openai-fetch";

const requestSchema = z.object({
  left: z.number(),
  right: z.number(),
});

const modelRequestSchema = z.object({
  scenario: z.enum([
    "japanese-stream",
    "structured-tool",
    "slow",
    "provider-error",
  ]),
  left: z.number().optional(),
  right: z.number().optional(),
});

const geminiOpenAiBaseUrl =
  "https://generativelanguage.googleapis.com/v1beta/openai/";

type SpikeEnv = {
  DB: D1Database;
  GEMINI_API_KEY: string;
  MODEL_ID: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  RPC_URL: string;
  SERA_API_KEY?: string;
  SERA_API_SECRET?: string;
  SERA_NETWORK: string;
  SPIKE_TOKEN?: string;
};

const privyRequestSchema = z.object({
  accessToken: z.string().min(20),
  idempotencyKey: z.string().regex(/^privy-spike-[a-zA-Z0-9-]{1,80}$/u),
  walletId: z.string().min(1).max(200),
});

type PrivyWalletContext = {
  address: string;
  client: PrivyClient;
  privyDid: string;
  walletId: string;
};

type SseRun = {
  duration_ms: number;
  started_at: number;
  user_id: string;
};

type StoredSseEvent = {
  data_json: string;
  event_id: number;
  event_type: string;
};

const sseQuerySchema = z.object({
  durationMs: z.coerce.number().int().min(100).max(70_000).default(100),
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u),
  userId: z.string().regex(/^user-[a-z0-9-]+$/u),
});

const evmAddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/iu);
const seraConfigSchema = z.object({
  chain_id: z.number().int(),
  sera_address: evmAddressSchema,
  vault_address: evmAddressSchema,
});
const seraTokensSchema = z.object({
  tokens: z.array(
    z.object({
      address: evmAddressSchema,
      symbol: z.string().min(1),
      decimals: z.number().int().nonnegative(),
    }),
  ),
});
const seraMarketsSchema = z.object({
  markets: z.array(
    z.object({
      symbol: z.string().min(1),
      base_address: evmAddressSchema,
      quote_address: evmAddressSchema,
      min_bid_quote_amount_raw: z.string().regex(/^\d+$/u),
    }),
  ),
});
const seraQuoteSchema = z.object({
  uuid: z.string().min(1),
  route_params: z.object({
    taker: evmAddressSchema,
    inputToken: evmAddressSchema,
    outputToken: evmAddressSchema,
  }),
  expires_at: z.number().int(),
});
const seraQuoteErrorSchema = z.object({
  detail: z.object({
    success: z.literal(false),
    error: z.string().min(1),
  }),
});
const seraBalancesSchema = z.object({
  owner_address: evmAddressSchema,
  balances: z.array(
    z.object({
      token: evmAddressSchema,
      symbol: z.string().min(1),
      decimals: z.number().int().nonnegative(),
      wallet_balance: z.string().regex(/^\d+$/u),
      vault_available: z.string().regex(/^\d+$/u),
      vault_frozen: z.string().regex(/^\d+$/u),
      vault_total: z.string().regex(/^\d+$/u),
      total: z.string().regex(/^\d+$/u),
    }),
  ),
  updated_at: z.string().min(1),
  wallet_balance_available: z.boolean(),
});
const seraOrdersSchema = z.object({
  trades: z.array(
    z
      .object({
        trade_id: z.string().min(1),
        owner_address: evmAddressSchema,
        status: z.string().min(1),
      })
      .passthrough(),
  ),
  total: z.number().int().nonnegative(),
});
const seraFillsSchema = z.object({
  items: z.array(
    z
      .object({
        maker_order_id: z.string().min(1),
        taker_order_id: z.string().min(1),
        settlement_status: z.string().min(1),
      })
      .passthrough(),
  ),
});
const seraTransactionSchema = z.object({
  tx: z.object({
    to: evmAddressSchema,
    data: z.string().regex(/^0x[0-9a-f]*$/iu),
    value: z.string().regex(/^0x[0-9a-f]+$/iu),
    chainId: z.string().regex(/^0x[0-9a-f]+$/iu),
    nonce: z.string().regex(/^0x[0-9a-f]+$/iu),
    gas: z.string().regex(/^0x[0-9a-f]+$/iu),
    type: z.string().regex(/^0x[0-9a-f]+$/iu),
    maxFeePerGas: z.string().regex(/^0x[0-9a-f]+$/iu),
    maxPriorityFeePerGas: z.string().regex(/^0x[0-9a-f]+$/iu),
  }),
});

const seraNetworkUrls = {
  sepolia: "https://api-testnet.sera.cx/api/v1",
} as const;
const rpcResultSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number().int(),
  result: z.string().regex(/^0x[0-9a-f]+$/iu),
});

const addTool = tool({
  name: "add",
  description: "Add two numbers while reporting progress.",
  inputSchema: requestSchema,
  callback: async function* ({ left, right }) {
    yield { step: "adding" };
    return { sum: left + right };
  },
});

function encodeServerEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function encodeStoredServerEvent(event: StoredSseEvent): Uint8Array {
  return new TextEncoder().encode(
    `id: ${event.event_id}\nevent: ${event.event_type}\ndata: ${event.data_json}\n\n`,
  );
}

async function initializeSseTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS spike_sse_runs (run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS spike_sse_events (run_id TEXT NOT NULL, event_id INTEGER NOT NULL, event_type TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY (run_id, event_id))",
    ),
  ]);
}

async function getOrCreateSseRun(
  db: D1Database,
  runId: string,
  userId: string,
  durationMs: number,
): Promise<SseRun | null> {
  await initializeSseTables(db);
  await db
    .prepare(
      "INSERT OR IGNORE INTO spike_sse_runs (run_id, user_id, started_at, duration_ms) VALUES (?, ?, ?, ?)",
    )
    .bind(runId, userId, Date.now(), durationMs)
    .run();
  const run = await db
    .prepare(
      "SELECT user_id, started_at, duration_ms FROM spike_sse_runs WHERE run_id = ?",
    )
    .bind(runId)
    .first<SseRun>();
  return run?.user_id === userId ? run : null;
}

async function storeSseEvent(
  db: D1Database,
  runId: string,
  eventId: number,
  eventType: string,
  userId: string,
  isTerminal = false,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO spike_sse_events (run_id, event_id, event_type, data_json) VALUES (?, ?, ?, ?)",
    )
    .bind(
      runId,
      eventId,
      eventType,
      JSON.stringify({ userId, ...(isTerminal ? { terminal: true } : {}) }),
    )
    .run();
}

async function listSseEvents(
  db: D1Database,
  runId: string,
  afterEventId: number,
): Promise<StoredSseEvent[]> {
  const result = await db
    .prepare(
      "SELECT event_id, event_type, data_json FROM spike_sse_events WHERE run_id = ? AND event_id > ? ORDER BY event_id",
    )
    .bind(runId, afterEventId)
    .all<StoredSseEvent>();
  return result.results;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createPrivyClient(env: SpikeEnv): PrivyClient | null {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    return null;
  }
  return new PrivyClient({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });
}

async function getPrivyWalletContext(
  env: SpikeEnv,
  accessToken: string,
  walletId: string,
): Promise<PrivyWalletContext | null> {
  const client = createPrivyClient(env);
  if (!client) return null;
  const token = await client.utils().auth().verifyAccessToken(accessToken);
  for await (const wallet of client
    .wallets()
    .list({ user_id: token.user_id })) {
    if (wallet.id !== walletId || wallet.chain_type !== "ethereum") continue;
    return {
      address: wallet.address,
      client,
      privyDid: token.user_id,
      walletId,
    };
  }
  return null;
}

function encodeHex(bytes: ArrayBuffer): string {
  return `0x${[...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return encodeHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function runPrivyPreflightSpike(
  request: Request,
  env: SpikeEnv,
): Promise<Response> {
  const parsed = privyRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const wallet = await getPrivyWalletContext(
      env,
      parsed.data.accessToken,
      parsed.data.walletId,
    );
    if (!wallet) {
      return Response.json({ error: "wallet_not_owned" }, { status: 403 });
    }
    const [balanceHex, gasPriceHex] = await Promise.all([
      callRpc(env.RPC_URL, 10, "eth_getBalance", [wallet.address, "latest"]),
      callRpc(env.RPC_URL, 11, "eth_gasPrice", []),
    ]);
    const gasLimit = 21_000n;
    const estimatedFeeWei = BigInt(gasPriceHex) * gasLimit;
    return Response.json({
      amountWei: "0",
      balanceWei: BigInt(balanceHex).toString(),
      chainId: 11_155_111,
      estimatedFeeWei: estimatedFeeWei.toString(),
      from: wallet.address,
      gasLimit: gasLimit.toString(),
      gasPriceWei: BigInt(gasPriceHex).toString(),
      ownerVerified: true,
      to: wallet.address,
    });
  } catch {
    return Response.json({ error: "privy_preflight_failed" }, { status: 502 });
  }
}

const privySpikeCorsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-origin": "http://127.0.0.1:5173",
  "access-control-max-age": "600",
} as const;

function withPrivySpikeCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(privySpikeCorsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function runPrivySigningSpike(
  request: Request,
  env: SpikeEnv,
): Promise<Response> {
  const parsed = privyRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const wallet = await getPrivyWalletContext(
      env,
      parsed.data.accessToken,
      parsed.data.walletId,
    );
    if (!wallet) {
      return Response.json({ error: "wallet_not_owned" }, { status: 403 });
    }
    const transaction = {
      chain_id: 11_155_111,
      from: wallet.address,
      to: wallet.address,
      value: 0,
    } as const;
    const requestHash = await hashJson(transaction);
    const authorizationContext = { user_jwts: [parsed.data.accessToken] };
    const typedData = await wallet.client
      .wallets()
      .ethereum()
      .signTypedData(wallet.walletId, {
        authorization_context: authorizationContext,
        idempotency_key: `${parsed.data.idempotencyKey}-typed`,
        typed_data: {
          domain: {
            chainId: 11_155_111,
            name: "Sera Feasibility",
            version: "1",
          },
          message: {
            idempotencyKey: parsed.data.idempotencyKey,
            requestHash,
          },
          primary_type: "AuthorizedRequest",
          types: {
            AuthorizedRequest: [
              { name: "requestHash", type: "bytes32" },
              { name: "idempotencyKey", type: "string" },
            ],
          },
        },
      });
    const sent = await wallet.client
      .wallets()
      .ethereum()
      .sendTransaction(wallet.walletId, {
        authorization_context: authorizationContext,
        caip2: "eip155:11155111",
        idempotency_key: `${parsed.data.idempotencyKey}-send`,
        transaction,
      });
    return Response.json({
      ownerVerified: true,
      privyDid: wallet.privyDid,
      requestHash,
      transactionHash: sent.hash,
      typedDataSignature: typedData.signature,
      walletAddress: wallet.address,
      walletId: wallet.walletId,
    });
  } catch {
    return Response.json({ error: "privy_signing_failed" }, { status: 502 });
  }
}

function createDurableSseStream(
  db: D1Database,
  runId: string,
  run: SseRun,
  afterEventId: number,
): ReadableStream<Uint8Array> {
  let isCancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const replay = await listSseEvents(db, runId, afterEventId);
        for (const event of replay)
          controller.enqueue(encodeStoredServerEvent(event));
        if (replay.some(({ event_type }) => event_type === "terminal")) {
          controller.close();
          return;
        }
        await wait(Math.max(0, run.started_at + run.duration_ms - Date.now()));
        if (isCancelled) return;
        await storeSseEvent(db, runId, 3, "terminal", run.user_id, true);
        const terminal = await listSseEvents(
          db,
          runId,
          Math.max(afterEventId, 2),
        );
        for (const event of terminal)
          controller.enqueue(encodeStoredServerEvent(event));
        controller.close();
      } catch (error) {
        if (!isCancelled) controller.error(error);
      }
    },
    cancel() {
      isCancelled = true;
    },
  });
}

async function runSseSpike(request: Request, env: SpikeEnv): Promise<Response> {
  const url = new URL(request.url);
  const parsed = sseQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const { durationMs, runId, userId } = parsed.data;
  const run = await getOrCreateSseRun(env.DB, runId, userId, durationMs);
  if (!run) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  await Promise.all([
    storeSseEvent(env.DB, runId, 1, "started", userId),
    storeSseEvent(env.DB, runId, 2, "heartbeat", userId),
  ]);
  const lastEventId = Number.parseInt(
    request.headers.get("last-event-id") ?? "0",
    10,
  );
  return new Response(
    createDurableSseStream(
      env.DB,
      runId,
      run,
      Number.isFinite(lastEventId) ? lastEventId : 0,
    ),
    {
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
      },
    },
  );
}

function readToolResult(result: ToolResultBlock): unknown {
  const [content] = result.toJSON().toolResult.content;
  if (content && "json" in content) {
    return content.json;
  }
  return content;
}

async function importHmacKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

async function isAuthorizedSpikeRequest(
  request: Request,
  expectedToken: string | undefined,
): Promise<boolean> {
  if (!expectedToken) {
    return false;
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  const providedToken = authorization.slice("Bearer ".length);
  if (!providedToken) {
    return false;
  }
  const challenge = new TextEncoder().encode("sera-feasibility-spike");
  const [providedKey, expectedKey] = await Promise.all([
    importHmacKey(providedToken),
    importHmacKey(expectedToken),
  ]);
  const providedSignature = await crypto.subtle.sign(
    "HMAC",
    providedKey,
    challenge,
  );
  return crypto.subtle.verify(
    "HMAC",
    expectedKey,
    providedSignature,
    challenge,
  );
}

function createToolStream(
  input: z.infer<typeof requestSchema>,
): ReadableStream<Uint8Array> {
  const agent = new Agent({ tools: [addTool] });
  const iterator = agent.tool.add.stream(input, {
    recordDirectToolCall: false,
  });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.enqueue(
          encodeServerEvent("result", readToolResult(next.value)),
        );
        controller.close();
        return;
      }
      controller.enqueue(encodeServerEvent("progress", next.value.data));
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

async function runModelSpike(
  request: Request,
  env: SpikeEnv,
): Promise<Response> {
  const parsed = modelRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const model = new OpenAIModel({
    api: "chat",
    apiKey: env.GEMINI_API_KEY,
    clientConfig: {
      baseURL: geminiOpenAiBaseUrl,
      fetch: createGeminiOpenAiFetch(),
    },
    maxTokens: 256,
    modelId:
      parsed.data.scenario === "provider-error"
        ? "invalid-spike-model"
        : env.MODEL_ID,
  });
  const agent = new Agent({
    model,
    printer: false,
    systemPrompt:
      "Respond in Japanese. When arithmetic is requested, you must call the add tool.",
    tools: [addTool],
  });
  const prompt =
    parsed.data.scenario === "structured-tool"
      ? `add ツールで ${parsed.data.left} と ${parsed.data.right} を加算してください。`
      : parsed.data.scenario === "slow"
        ? "詳細な日本語の説明を非常に長く生成してください。"
        : "Sera Protocolについて日本語で短く説明してください。";
  const events: string[] = [];
  let text = "";
  let toolResult: unknown;

  try {
    for await (const event of agent.stream(prompt, {
      cancelSignal: request.signal,
    })) {
      if (
        event.type === "modelStreamUpdateEvent" &&
        event.event.type === "modelContentBlockDeltaEvent" &&
        event.event.delta.type === "textDelta"
      ) {
        events.push("delta");
        text += event.event.delta.text;
      }
      if (event.type === "toolResultEvent") {
        toolResult = readToolResult(event.result);
      }
    }
    return Response.json({
      events,
      text,
      ...(toolResult ? { toolResult } : {}),
    });
  } catch (error) {
    return Response.json(
      {
        code: "MODEL_PROVIDER_ERROR",
        retryable:
          error instanceof Error &&
          /timeout|rate|temporar/iu.test(error.message),
      },
      { status: 502 },
    );
  }
}

async function fetchSeraJson<T>(
  url: URL,
  schema: z.ZodType<T>,
): Promise<{ data: T; status: number }> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`Sera API returned HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Sera API response failed schema validation");
  }
  return { data: parsed.data, status: response.status };
}

async function probeSeraQuote(
  baseUrl: string,
  fromToken: string,
  toToken: string,
  fromAmount: string,
): Promise<{ outcome: "quoted" | "business_rejection"; status: number }> {
  const probeAddress = "0x000000000000000000000000000000000000dEaD";
  const response = await fetch(new URL(`${baseUrl}/swap/quote`), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      from_token: fromToken,
      to_token: toToken,
      from_amount: fromAmount,
      owner_address: probeAddress,
      recipient: probeAddress,
      expiration: Math.floor(Date.now() / 1000) + 120,
      gas_mode: "receive_less",
    }),
    redirect: "manual",
  });
  const body: unknown = await response.json();
  if (response.ok && seraQuoteSchema.safeParse(body).success) {
    return { outcome: "quoted", status: response.status };
  }
  if (response.status === 400 && seraQuoteErrorSchema.safeParse(body).success) {
    return { outcome: "business_rejection", status: response.status };
  }
  throw new Error(`Sera quote returned unexpected HTTP ${response.status}`);
}

async function runSeraPublicSpike(env: SpikeEnv): Promise<Response> {
  if (env.SERA_NETWORK !== "sepolia") {
    return Response.json({ error: "unsupported_network" }, { status: 500 });
  }

  try {
    const baseUrl = seraNetworkUrls.sepolia;
    const [config, tokens, markets] = await Promise.all([
      fetchSeraJson(new URL(`${baseUrl}/config`), seraConfigSchema),
      fetchSeraJson(new URL(`${baseUrl}/tokens`), seraTokensSchema),
      fetchSeraJson(new URL(`${baseUrl}/markets`), seraMarketsSchema),
    ]);
    const usdc = tokens.data.tokens.find(({ symbol }) => symbol === "USDC");
    const jpyc = tokens.data.tokens.find(({ symbol }) => symbol === "JPYC");
    const market = markets.data.markets.find(
      ({ symbol }) => symbol === "JPYC/USDC",
    );
    if (!usdc || !jpyc || !market) {
      throw new Error("Sera testnet does not expose the JPYC/USDC capability");
    }
    const quote = await probeSeraQuote(
      baseUrl,
      usdc.address,
      jpyc.address,
      market.min_bid_quote_amount_raw,
    );
    return Response.json(
      {
        network: env.SERA_NETWORK,
        baseUrl,
        config: {
          status: config.status,
          chainId: config.data.chain_id,
          seraAddress: config.data.sera_address,
        },
        tokens: { status: tokens.status, count: tokens.data.tokens.length },
        markets: { status: markets.status, count: markets.data.markets.length },
        quote,
      },
      { headers: { "x-spike-subrequests": "4" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: "sera_public_api_unavailable",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }
}

async function fetchSeraAccountJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  env: SpikeEnv,
  init?: RequestInit,
): Promise<{ data: T; status: number }> {
  if (!env.SERA_API_KEY || !env.SERA_API_SECRET) {
    throw new Error("Sera account credentials are not configured");
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${env.SERA_API_KEY}:${env.SERA_API_SECRET}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`Sera account API returned HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Sera account API response failed schema validation");
  }
  return { data: parsed.data, status: response.status };
}

async function runSeraAccountSpike(
  request: Request,
  env: SpikeEnv,
): Promise<Response> {
  const parsed = privyRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!env.SERA_API_KEY || !env.SERA_API_SECRET) {
    return Response.json(
      { error: "sera_account_credentials_missing" },
      { status: 412 },
    );
  }
  try {
    const wallet = await getPrivyWalletContext(
      env,
      parsed.data.accessToken,
      parsed.data.walletId,
    );
    if (!wallet) {
      return Response.json({ error: "wallet_not_owned" }, { status: 403 });
    }
    const baseUrl = seraNetworkUrls.sepolia;
    const owner = wallet.address.toLowerCase();
    const balances = await fetchSeraAccountJson(
      new URL(`${baseUrl}/balances?owner_address=${owner}&include_zero=true`),
      seraBalancesSchema,
      env,
    );
    const [orders, fills] = await Promise.all([
      fetchSeraAccountJson(
        new URL(`${baseUrl}/orders?owner_address=${owner}&limit=1`),
        seraOrdersSchema,
        env,
      ),
      fetchSeraAccountJson(
        new URL(`${baseUrl}/fills?owner_address=${owner}&limit=1`),
        seraFillsSchema,
        env,
      ),
    ]);
    const token =
      balances.data.balances.find(
        ({ wallet_balance }) => BigInt(wallet_balance) > 0n,
      ) ?? balances.data.balances[0];
    if (!token) throw new Error("Sera account returned no whitelisted tokens");
    const transfer = await fetchSeraAccountJson(
      new URL(`${baseUrl}/transfer`),
      seraTransactionSchema,
      env,
      {
        method: "POST",
        body: JSON.stringify({
          amount: "1",
          from_address: owner,
          to: owner,
          token: token.token,
        }),
      },
    );
    return Response.json({
      accountMapping: {
        privyAddress: wallet.address,
        seraOwnerAddress: balances.data.owner_address,
        verified:
          balances.data.owner_address.toLowerCase() ===
          wallet.address.toLowerCase(),
      },
      accountBalances: {
        count: balances.data.balances.length,
        status: balances.status,
      },
      fills: { count: fills.data.items.length, status: fills.status },
      orders: { count: orders.data.trades.length, status: orders.status },
      transferBuild: {
        chainId: Number.parseInt(transfer.data.tx.chainId, 16),
        status: transfer.status,
        token: token.token,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "sera_account_api_unavailable",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }
}

async function callRpc(
  rpcUrl: string,
  id: number,
  method: string,
  params: unknown[],
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    redirect: "manual",
  });
  if (!response.ok) {
    throw new Error(`Sepolia RPC returned HTTP ${response.status}`);
  }
  const parsed = rpcResultSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Sepolia RPC response failed schema validation");
  }
  return parsed.data.result;
}

async function runSepoliaRpcSpike(env: SpikeEnv): Promise<Response> {
  const tokenAddress = "0x965d4b4546716e416e950bc30467d128455d2d0e";
  const walletAddress = "000000000000000000000000000000000000dead";
  const balanceOfData = `0x70a08231${walletAddress.padStart(64, "0")}`;
  try {
    const [chainIdHex, blockNumber, balance] = await Promise.all([
      callRpc(env.RPC_URL, 1, "eth_chainId", []),
      callRpc(env.RPC_URL, 2, "eth_blockNumber", []),
      callRpc(env.RPC_URL, 3, "eth_call", [
        { to: tokenAddress, data: balanceOfData },
        "latest",
      ]),
    ]);
    return Response.json(
      {
        chainId: Number.parseInt(chainIdHex, 16),
        blockNumber,
        balance,
        tokenAddress,
      },
      { headers: { "x-spike-subrequests": "3" } },
    );
  } catch (error) {
    return Response.json(
      {
        error: "sepolia_rpc_unavailable",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 502 },
    );
  }
}

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
    const isPrivySpike = [
      "/__spike/privy-preflight",
      "/__spike/privy-signing",
      "/__spike/sera-account",
    ].includes(url.pathname);
    if (request.method === "OPTIONS" && isPrivySpike) {
      return new Response(null, {
        headers: privySpikeCorsHeaders,
        status: 204,
      });
    }
    const isProtectedSpike = ["/__spike/model", "/__spike/sse"].includes(
      url.pathname,
    );
    if (
      isProtectedSpike &&
      !(await isAuthorizedSpikeRequest(request, env.SPIKE_TOKEN))
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (request.method === "GET" && url.pathname === "/__spike/sse") {
      return runSseSpike(request, env);
    }
    if (request.method === "GET" && url.pathname === "/__spike/sera-public") {
      return runSeraPublicSpike(env);
    }
    if (request.method === "GET" && url.pathname === "/__spike/sepolia-rpc") {
      return runSepoliaRpcSpike(env);
    }
    if (request.method === "POST" && url.pathname === "/__spike/model") {
      return runModelSpike(request, env);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/__spike/privy-preflight"
    ) {
      return withPrivySpikeCors(await runPrivyPreflightSpike(request, env));
    }
    if (
      request.method === "POST" &&
      url.pathname === "/__spike/privy-signing"
    ) {
      return withPrivySpikeCors(await runPrivySigningSpike(request, env));
    }
    if (request.method === "POST" && url.pathname === "/__spike/sera-account") {
      return withPrivySpikeCors(await runSeraAccountSpike(request, env));
    }
    if (request.method !== "POST" || url.pathname !== "/tool-stream") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    return new Response(createToolStream(parsed.data), {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
      },
    });
  },
};
