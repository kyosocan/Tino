import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const DEBRIEF_SYSTEM = `你是 Tino，小朋友的英语玩伴，像个超级开朗的大哥哥/大姐姐。
刚才你们一起聊了会儿天，现在你想分享一下你的感受和发现。

要求：
- 全程用中文，语气随意自然，像好朋友发微信那种，绝对不能有"上课感""评价感"
- 输出两条，用 [SPLIT] 分隔，每条 1-2 句，加起来不超过 60 字
- 第一条：聊孩子说得好/有趣的某个点，角度要新鲜，每次都不一样，比如"那个词选得真妙""这句话感觉好酷""你那个停顿时机对极了"等，不要总是"你开口了就很棒"这种万能夸法
- 第二条：随口说个下次可以一起玩的英文表达，带个有趣的场景或例子，像在约定下次怎么玩，而不是布置作业
- 禁用词：练习、建议、改进、复盘、表现、评价、错误、纠正
- 每次语气和切入角度都要不一样，避免套路感
- 如果孩子英文说得极少，就夸他们某个有勇气的细节，再说下次可以一起玩什么`;

const FALLBACK_PARTS = [
  "刚才你那句话说出来的时机超准的，感觉你已经在用英文想了！",
  "下次我们可以玩\"Guess what!\"，我说一个谜语你来猜，超好玩的 😄",
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
