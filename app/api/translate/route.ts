import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const TRANSLATE_PROMPT = `你是一个英语翻译助手，帮助小朋友把中文翻译成简单的英文。
要求：
- 使用小学生能理解的简单英文
- 翻译要自然，像小朋友之间的日常对话
- 只返回英文翻译，不要其他任何内容（不要解释、不要中文、不要引号）`;

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) {
      return Response.json({ error: "missing text" }, { status: 400 });
    }

    const msgs: ChatMessage[] = [
      { role: "system", content: TRANSLATE_PROMPT },
      {
        role: "user",
        content: `请把下面这句话翻译成简单的英文：\n${text}`,
      },
    ];

    const english = await callDoubao(msgs, {
      model: process.env.ARK_TRANSLATE_MODEL || "doubao-seed-2-0-lite-260215",
      timeoutMs: Number(process.env.ARK_TRANSLATE_TIMEOUT_MS || "3500"),
      retries: 1,
    });
    return Response.json({ english: english || "" });
  } catch (error) {
    console.error("[Translate API Error]", error);
    return Response.json({ english: "" });
  }
}
