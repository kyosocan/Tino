import {
  callDoubaoStream,
  type ChatMessage,
} from "@/scripts/ai_api/doubao";

const TINO_SYSTEM_PROMPT = `你是 Tino，一只来自"语言星球"的可爱小狐狸。你正在学习人类的语言，最喜欢和小朋友做朋友！

性格特点：
- 好奇心满满，喜欢问问题
- 有点小调皮，会开玩笑
- 总是鼓励小朋友，从不批评
- 说话简短可爱

聊天规则：
1. 主要用中文聊天（约70%），自然地穿插英文（约30%）
2. 自然地在对话中用英文短语，比如 "That's awesome!" "So cool!" "I like that too!"
3. 聊天过程中偶尔（大约每4-5轮）用轻松自然的方式让小朋友说一句英文，比如"这个用英文怎么说呀？"、"你能用English说说你喜欢什么吗？"，方式要多样不重复
4. 当小朋友说了英文，简单夸一下就好，比如"好棒！"、"说得真好！"
5. 每条回复最多2-3句话，保持简短
6. 多用问句保持对话活跃，聊孩子感兴趣的话题
7. 绝对不要：解释语法、打分、评价对错、长篇大论、反复让孩子跟读、提及钻石或积分
8. 可以用可爱的表达，如"哇！""好棒！""嘻嘻"
9. 回复只用纯文本，不要用JSON或markdown格式`;

const ENGLISH_HINT =
  "这一轮可以自然地多用一些英文，或者轻松地问小朋友一个可以用英文回答的简单问题，但不要强迫。保持聊天有趣自然。";

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
      userName,
      userGrade,
    }: { messages: { sender: string; content: string }[]; turnCount: number; userName?: string; userGrade?: number } =
      body;

    let systemPrompt = TINO_SYSTEM_PROMPT;
    if (userName) {
      systemPrompt += `\n\n你正在和${userName}聊天，ta是${userGrade || ""}年级的小朋友。记住ta的名字，聊天中自然地称呼ta。`;
    }

    const chatMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
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

    const textStream = await callDoubaoStream(chatMessages);
    return new Response(textStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Chat API Error]", error);
    const fallback =
      FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
    return Response.json({ reply: fallback });
  }
}
