import { Agent, type ToolResultBlock, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { z } from "zod";

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

type SpikeEnv = {
  AI_GATEWAY_BASE_URL: string;
  MODEL_ID: string;
};

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
  const token = request.headers.get("x-ai-gateway-token");
  if (!parsed.success || !token) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const model = new OpenAIModel({
    api: "chat",
    apiKey: token,
    clientConfig: { baseURL: env.AI_GATEWAY_BASE_URL },
    maxTokens: 256,
    modelId:
      parsed.data.scenario === "provider-error"
        ? "openai/invalid-spike-model"
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

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
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
