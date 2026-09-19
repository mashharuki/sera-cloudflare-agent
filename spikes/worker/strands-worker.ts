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
  GEMINI_API_KEY: string;
  MODEL_ID: string;
  RPC_URL: string;
  SERA_NETWORK: string;
};

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

function readToolResult(result: ToolResultBlock): unknown {
  const [content] = result.toJSON().toolResult.content;
  if (content && "json" in content) {
    return content.json;
  }
  return content;
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
    return Response.json({
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
    });
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
    return Response.json({
      chainId: Number.parseInt(chainIdHex, 16),
      blockNumber,
      balance,
      tokenAddress,
    });
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
    if (request.method === "GET" && url.pathname === "/__spike/sera-public") {
      return runSeraPublicSpike(env);
    }
    if (request.method === "GET" && url.pathname === "/__spike/sepolia-rpc") {
      return runSepoliaRpcSpike(env);
    }
    if (request.method === "POST" && url.pathname === "/__spike/model") {
      return runModelSpike(request, env);
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
