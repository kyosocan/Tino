import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

export const runtime = "nodejs";

interface Body {
  conversationHistory?: Array<{ role: string; content: string }>;
  systemPrompt?: string;
}

function formatHistory(turns: Array<{ role: string; content: string }>): string {
  return turns
    .map((t) => `${t.role === "user" ? "用户" : "Luna"}：${t.content}`)
    .join("\n");
}

function cleanSimulatedReply(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^用户[：:]\s*/i, "").replace(/^User:\s*/i, "");
  const lines = s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return (lines[0] ?? s).slice(0, 500);
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "无效 JSON" }, { status: 400 });
  }

  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const history = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

  if (!systemPrompt || history.length === 0) {
    return Response.json({ error: "缺少 systemPrompt 或 conversationHistory" }, { status: 400 });
  }

  const recent = history.slice(-12);
  const historyText = formatHistory(recent);

  const system = `${systemPrompt}

【任务】你只扮演对话里的「用户」，根据上文接一句自然回复。
规则：只输出一句用户要说的话；不要角色标签、不要引号包裹全句、不要解释；尽量简短。`;

  const userMsg = `下文为最近对话（用户 / Luna 交替）。请接最后一条 Luna 之后，用户的下一句：\n\n${historyText}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userMsg },
  ];

  try {
    const text = await callDoubao(messages, { timeoutMs: 45_000, retries: 2 });
    const reply = cleanSimulatedReply(text);
    if (!reply) {
      return Response.json({ error: "模型未返回有效内容" }, { status: 502 });
    }
    return Response.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[simulate_user]", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
