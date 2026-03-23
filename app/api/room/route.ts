import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

type RoomBody = {
  action: string;
  recentContext?: string;
  userNames?: string;
  englishCount?: number;
  /** silence_nudge: 引导对方 / 引导自己接话 */
  nudgeTarget?: "peer" | "self";
  partnerName?: string;
  selfName?: string;
};

const TINO_ROOM_BASE = `你是 Tino，一个友好的英语聊天小助手。你在一个英语聊天房间里，帮助两个小朋友用英文聊天。
你的任务是鼓励他们用英文交流，给**具体、能照着说**的引导，而不是泛泛的「加油」。
规则：
- 说话简短（最多2句），语气温暖有趣；
- **必须点名**：用对话里孩子的名字（或「Hi + 名字」）直接称呼要说话的那一位，让小朋友知道在对谁说；
- 尽量给出**半句到一句英文例句**，或「你可以试着说：…」，帮助开口；
- 主要用英文，可穿插少量中文帮助理解；
- 纯文本回复。`;

export async function POST(req: Request) {
  try {
    const body: RoomBody = await req.json();
    const { action } = body;

    let reply: string;

    switch (action) {
      case "tino_comment": {
        const msgs: ChatMessage[] = [
          {
            role: "system",
            content: `${TINO_ROOM_BASE}\n房间里有：${body.userNames || "两个小朋友"}。`,
          },
          {
            role: "user",
            content: `最近的对话：\n${body.recentContext || "（刚开始）"}\n\n请作为 Tino 发言：先**点名**其中一位小朋友（用名字），结合上文给**一句与话题相关的英文说法或问句**（可跟读），鼓励 ta 用英语接着说；中英混合，最多2句。`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "summary": {
        const count = body.englishCount || 0;
        const msgs: ChatMessage[] = [
          { role: "system", content: TINO_ROOM_BASE },
          {
            role: "user",
            content: `聊天即将结束。这两个小朋友在聊天中说了大约${count}句英文。请做一个温暖的总结，鼓励他们做得很棒，并期待下次再见。用英文为主。`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "silence_nudge": {
        const recent = body.recentContext || "（刚开始）";
        const partnerName = body.partnerName || "小伙伴";
        const selfName = body.selfName || "小朋友";
        const target = body.nudgeTarget || "self";
        const hint =
          target === "peer"
            ? `现在轮到「${partnerName}」接话，但 Ta 有一阵子没开口了。你必须在话里**直接称呼 ${partnerName}**（例如「${partnerName}, can you tell us…?」），温柔地请 Ta 用英语说一两句，并**给 Ta 一句可以模仿的英文短句或简单问题**；中英混合，最多2句。`
            : `刚才「${partnerName}」已经说了；现在该「${selfName}」接话，但 Ta 有一阵子没开口。你必须**直接称呼 ${selfName}**（例如「${selfName}, how about…?」），请 Ta 用英语回应，并**给一句很简单的英文例句**让 Ta 能跟着说；中英混合，最多2句。`;
        const msgs: ChatMessage[] = [
          {
            role: "system",
            content: `${TINO_ROOM_BASE}\n你是 Tino，只在冷场时提醒**下一位该说话的人**，务必点名并给可跟读的英文。`,
          },
          {
            role: "user",
            content: `最近的对话：\n${recent}\n\n${hint}`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      default:
        reply = "Great job chatting in English! Keep it up!";
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("[Room API Error]", error);
    return Response.json({ reply: "Great job! Keep chatting in English!" });
  }
}
