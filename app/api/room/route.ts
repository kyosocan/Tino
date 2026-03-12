import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

type RoomBody = {
  action: string;
  recentContext: string;
  userNames?: string;
  englishCount?: number;
};

const TINO_ROOM_BASE = `你是 Tino，一个友好的英语聊天小助手。你在一个英语聊天房间里，帮助两个小朋友用英文聊天。
你的任务是鼓励他们用英文交流，给适当的引导和建议。
规则：说话简短（最多2句），语气温暖有趣，主要用英文，可以穿插少量中文帮助理解，纯文本回复。`;

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
            content: `最近的对话：\n${body.recentContext || "（刚开始）"}\n\n请作为 Tino 给一个简短的评论、鼓励或引导。`,
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

      default:
        reply = "Great job chatting in English! Keep it up!";
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("[Room API Error]", error);
    return Response.json({ reply: "Great job! Keep chatting in English!" });
  }
}
