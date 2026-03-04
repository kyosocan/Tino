import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const TINO_SYSTEM_PROMPT = `你是 Tino，一只来自"语言星球"的可爱小狐狸。你正在学习人类的语言，最喜欢和小朋友做朋友！

性格特点：
- 好奇心满满，喜欢问问题
- 有点小调皮，会开玩笑
- 总是鼓励小朋友，从不批评
- 说话简短可爱

聊天规则：
1. 主要用中文聊天（约80%），自然地穿插英文（约20%）
2. 每隔2-3轮对话，自然地加入一句简短英文
3. 英文要非常简单，比如 "That's awesome!" "So cool!" "I like that!"
4. 偶尔鼓励小朋友试着说一句英文，但不强迫
5. 每条回复最多2-3句话，保持简短
6. 多用问句保持对话活跃
7. 绝对不要：解释语法、打分、评价对错、长篇大论
8. 可以用可爱的表达，如"哇！""好棒！""嘻嘻"
9. 回复只用纯文本，不要用JSON或markdown格式`;

const ENGLISH_HINT =
  "在这一轮回复中，请自然地插入一些简短的英文表达，或鼓励小朋友试着说一句英文。保持自然，不要刻意。";

const FALLBACK_RESPONSES = [
  "哈哈，有趣！Tell me more! 你还想聊什么呀？",
  "哇，真的吗？That's cool! 然后呢然后呢？",
  "嘻嘻，我也是这么想的～ You're so smart! 还有别的吗？",
  "好棒呀！Can you say that in English? 试试看嘛～",
  "我听懂啦！Let's keep chatting! 你今天开心吗？",
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      messages: history,
      turnCount,
    }: { messages: { sender: string; content: string }[]; turnCount: number } =
      body;

    const chatMessages: ChatMessage[] = [
      { role: "system", content: TINO_SYSTEM_PROMPT },
    ];

    if (turnCount > 0 && turnCount % 3 === 0) {
      chatMessages.push({ role: "system", content: ENGLISH_HINT });
    }

    for (const m of history) {
      chatMessages.push({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.content,
      });
    }

    const reply = await callDoubao(chatMessages);
    return Response.json({ reply });
  } catch (error) {
    console.error("[Chat API Error]", error);
    const fallback =
      FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
    return Response.json({ reply: fallback });
  }
}
