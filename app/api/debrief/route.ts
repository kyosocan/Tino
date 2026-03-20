import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const DEBRIEF_SYSTEM = `你是 Tino，小朋友的英语玩伴，像一个开朗的大朋友。
刚才你们一起聊了一会儿，现在你想聊聊刚才好玩的地方。

要求：
- 用中文，语气轻松随意，像好朋友聊天一样，绝对不能有"上课感"或"评价感"
- 分两部分，中间用 [SPLIT] 分隔：
  第一部分：真心夸一个孩子说的英文词/句，说清楚哪句好玩/厉害，语气像"哇我发现你..."
  第二部分：随口说一句你下次也想一起说的表达，语气像"对了，下次我们还可以说..."，给出例句，要像在约定一起玩，而不是布置作业
- 每部分最多 2 句话，轻快简短
- 如果孩子英文说得很少，就夸他们敢开口，然后说你们下次可以一起玩什么
- 不要用 JSON，只输出文字，不要出现"练习""建议""改进""复盘"这些词
- 不要使用任何 emoji`;

const FALLBACK_PARTS = [
  "哇，你刚才开口说英文啦！光是这样就很厉害了！",
  "对了，下次我们还可以一起说 \"Hi! How are you?\" 超好玩的～",
];

export async function POST(req: Request) {
  try {
    const { messages, userName } = await req.json() as {
      messages: { sender: string; content: string }[];
      userName?: string;
    };

    const userMessages = messages.filter((m) => m.sender === "user");
    if (userMessages.length === 0) {
      return Response.json({ parts: FALLBACK_PARTS });
    }

    const transcript = messages
      .filter((m) => m.sender !== "system")
      .slice(-20)
      .map((m) => {
        const label = m.sender === "user" ? (userName || "小朋友") : m.sender === "tino" ? "Tino" : "好友";
        return `${label}: ${m.content}`;
      })
      .join("\n");

    const chatMessages: ChatMessage[] = [
      { role: "system", content: DEBRIEF_SYSTEM },
      {
        role: "user",
        content: `小朋友叫${userName || "小朋友"}，以下是刚才我们聊天的记录：\n\n${transcript}\n\n现在请你像好朋友一样聊聊刚才好玩的地方。`,
      },
    ];

    const reply = await callDoubao(chatMessages, { timeoutMs: 15000, retries: 2 });
    if (!reply) return Response.json({ parts: FALLBACK_PARTS });

    const raw = reply.split(/\[SPLIT\]/);
    const parts = raw.map((p) => p.trim()).filter(Boolean);
    return Response.json({ parts: parts.length >= 2 ? parts : FALLBACK_PARTS });
  } catch {
    return Response.json({ parts: FALLBACK_PARTS });
  }
}
