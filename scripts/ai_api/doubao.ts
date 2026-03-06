export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ArkInputItem = {
  type: "input_text";
  text: string;
};

type ArkInputMessage = {
  role: "system" | "user" | "assistant";
  content: ArkInputItem[];
};

type ArkOutputText = { type: "output_text"; text: string };
type ArkOutputMessage = {
  type: "message";
  content?: ArkOutputText[];
};
type ArkResponse = {
  output?: ArkOutputMessage[];
  error?: { message?: string; code?: string };
};

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function getArkConfig() {
  const apiKey = process.env.ARK_API_KEY || "";
  const model = process.env.ARK_MODEL || "doubao-seed-2-0-lite-260215";
  if (!apiKey) throw new Error("缺少 ARK_API_KEY");
  return { apiKey, model };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(attempt: number) {
  const base = 300 * 2 ** Math.min(attempt - 1, 5);
  return Math.min(base + Math.floor(Math.random() * base * 0.2), 10000);
}

function toArkInput(messages: ChatMessage[]): ArkInputMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "input_text" as const, text: m.content }],
  }));
}

function extractText(data: ArkResponse): string {
  const msg = data.output?.find((o) => o.type === "message");
  return msg?.content?.find((c) => c.type === "output_text")?.text?.trim() || "";
}

export async function callDoubaoStream(
  messages: ChatMessage[]
): Promise<ReadableStream<Uint8Array>> {
  const cfg = getArkConfig();
  const input = toArkInput(messages);
  const encoder = new TextEncoder();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  const response = await fetch(ARK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, input, stream: true }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    const detail = await response.text().catch(() => "");
    throw new Error(`Ark stream 失败 ${response.status}: ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = "";

  return new ReadableStream({
    async pull(ctrl) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timeout);
          if (lineBuf.startsWith("data:")) {
            const jsonStr = lineBuf.slice(5).trim();
            if (jsonStr && jsonStr !== "[DONE]") {
              try {
                const evt = JSON.parse(jsonStr);
                if (evt.type === "response.output_text.delta" && evt.delta) {
                  ctrl.enqueue(encoder.encode(evt.delta));
                }
              } catch { /* skip */ }
            }
          }
          ctrl.close();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = (lineBuf + chunk).split("\n");
        lineBuf = lines.pop() || "";

        let enqueued = false;
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const evt = JSON.parse(jsonStr);
            if (evt.type === "response.output_text.delta" && evt.delta) {
              ctrl.enqueue(encoder.encode(evt.delta));
              enqueued = true;
            }
          } catch { /* skip */ }
        }

        if (enqueued) return;
      }
    },
    cancel() {
      clearTimeout(timeout);
      reader.cancel().catch(() => {});
    },
  });
}

export async function callDoubao(messages: ChatMessage[]) {
  const cfg = getArkConfig();
  const input = toArkInput(messages);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(ARK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({ model: cfg.model, input }),
      });

      if (!response.ok) {
        const detail = await response.text();
        const err = new Error(`Ark 调用失败 ${response.status}: ${detail}`);
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= 3) throw err;
        lastError = err;
        console.warn(`[Ark] 第 ${attempt} 次请求失败(${response.status})，重试中...`);
        await sleep(computeDelayMs(attempt));
        continue;
      }

      const data = (await response.json()) as ArkResponse;
      if (data.error) throw new Error(`Ark 业务错误: ${data.error.message || data.error.code}`);
      return extractText(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 3) throw err;
      lastError = err;
      console.warn(`[Ark] 第 ${attempt} 次异常，重试中...`, err.message);
      await sleep(computeDelayMs(attempt));
    }
  }

  throw lastError || new Error("Ark 调用失败：未知错误");
}
