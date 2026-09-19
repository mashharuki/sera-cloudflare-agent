type GeminiToolCall = {
  index?: number;
  [key: string]: unknown;
};

type GeminiStreamChunk = {
  choices?: Array<{
    delta?: {
      tool_calls?: GeminiToolCall[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

function normalizeChunk(chunk: GeminiStreamChunk): GeminiStreamChunk {
  return {
    ...chunk,
    choices: chunk.choices?.map((choice) => ({
      ...choice,
      delta: choice.delta
        ? {
            ...choice.delta,
            tool_calls: choice.delta.tool_calls?.map((toolCall, index) => ({
              ...toolCall,
              index: toolCall.index ?? index,
            })),
          }
        : undefined,
    })),
  };
}

export function normalizeGeminiSseLine(line: string): string {
  const carriageReturn = line.endsWith("\r") ? "\r" : "";
  const content = carriageReturn ? line.slice(0, -1) : line;
  if (!content.startsWith("data: ") || content === "data: [DONE]") {
    return line;
  }

  try {
    const chunk = JSON.parse(content.slice(6)) as GeminiStreamChunk;
    return `data: ${JSON.stringify(normalizeChunk(chunk))}${carriageReturn}`;
  } catch {
    return line;
  }
}

function createSseTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${normalizeGeminiSseLine(line)}\n`));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) {
        controller.enqueue(encoder.encode(normalizeGeminiSseLine(buffer)));
      }
    },
  });
}

export function createGeminiOpenAiFetch(
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init): Promise<Response> => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.body || !contentType.includes("text/event-stream")) {
      return response;
    }

    return new Response(response.body.pipeThrough(createSseTransform()), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
