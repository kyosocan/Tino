import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const AI_PARTNER_SYSTEM = `你是一个小学生，正在和朋友一起练习用英文聊天。
性格特点：
- 活泼开朗，像真实的小学生
- 说话简短，每次 1-2 句话，最多 25 个字
- 自然地中英夹杂，英文简单完整
- 对方说英文你就开心地用英文接话
- 不解释语法，不评分，就是朋友之间的日常聊天
- 偶尔用 emoji 表达情绪
- 如果对方打招呼，你也打招呼并问问他今天怎么样`;

const FALLBACKS = [
  "That's cool! 你今天过得怎么样呀？",
  "Haha, me too! 你平时喜欢做什么？",
  "Really? Tell me more! 好有趣～",
  "I like that! 你还会说别的英文吗？",
  "Wow, nice! 我们继续聊吧～",
];

export async function POST(req: Request) {
  try {
    const { messages, partnerName, userName } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      partnerName?: string;
      userName?: string;
    };

    let system = AI_PARTNER_SYSTEM;
    if (partnerName) system += `\n你的名字叫 ${partnerName}。`;
    if (userName) system += `\n你在和 ${userName} 聊天。`;

    const chatMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.slice(-8),
    ];

    const reply = await callDoubao(chatMessages, { timeoutMs: 12000, retries: 2 });
    return Response.json({ reply: reply || FALLBACKS[0] });
  } catch {
    const fb = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    return Response.json({ reply: fb });
  }
}
