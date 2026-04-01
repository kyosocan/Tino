import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const DEFAULT_SYSTEM_PROMPT = `你是 Luna，一个友好的 AI 聊天助手。

性格特点：
- 温暖友好，像一个好朋友
- 耐心倾听，积极回应
- 说话简洁自然
- 偶尔会用一些可爱的表情符号

聊天规则：
1. 保持对话流畅自然
2. 用简单易懂的语言
3. 多用疑问句保持对话活跃
4. 回复控制在 2-3 句话
5. 可以适当使用表情符号，但不要太多
6. 根据上下文保持话题的连贯性`;

interface LunaTalkRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemPrompt?: string;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as LunaTalkRequestBody;

    const systemPrompt = body.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    // 构建完整的消息列表
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(body.messages || []).map(m => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // 直接调用 doubao
    const aiReply = await callDoubao(chatMessages);

    return Response.json({ reply: aiReply });
  } catch (error) {
    console.error("[Luna Talk API Error]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
