import {
  sendRoomMessage,
  getMessages,
  getRoom,
  shouldTinoComment,
  addTinoMessage,
} from "@/lib/matchStore";
import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const TINO_ROOM_PROMPT = `你是 Tino，一个友好的英语聊天小助手。你在一个英语聊天房间里，两个小朋友正在用英文聊天。
你的任务是帮助他们更好地用英文交流：鼓励他们、纠正明显的错误（用温和的方式）、给出简单的表达建议。
规则：
- 说话简短，最多2句
- 语气温暖有趣
- 主要用英文，可以穿插少量中文帮助理解
- 鼓励为主，不要批评
- 纯文本回复`;

async function generateTinoComment(roomId: string) {
  const room = getRoom(roomId);
  if (!room) return;

  room.tinoGenerating = true;

  try {
    const userNames = room.users.map((u) => u.name).join(" and ");
    const recent = room.messages
      .slice(-8)
      .map((m) => `${m.senderName}: ${m.content}`)
      .join("\n");

    const msgs: ChatMessage[] = [
      {
        role: "system",
        content: `${TINO_ROOM_PROMPT}\n房间里有：${userNames}。`,
      },
      {
        role: "user",
        content: `最近的对话：\n${recent}\n\n请作为 Tino 给一个简短的评论、鼓励或引导。`,
      },
    ];

    const reply = await callDoubao(msgs);
    if (reply) {
      addTinoMessage(roomId, reply);
    }
  } catch (error) {
    console.error("[Tino comment error]", error);
  } finally {
    room.tinoGenerating = false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "send": {
        const { roomId, userId, userName, content, audioBase64, mimeType } = body;
        if (!roomId || !userId || !content) {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }

        const msg = sendRoomMessage(
          roomId,
          userId,
          userName,
          content,
          audioBase64,
          mimeType
        );
        if (!msg) {
          return Response.json({ error: "room not found" }, { status: 404 });
        }

        if (shouldTinoComment(roomId)) {
          generateTinoComment(roomId).catch(console.error);
        }

        return Response.json({ success: true, messageId: msg.id });
      }

      case "poll": {
        const { roomId, since } = body;
        if (!roomId) {
          return Response.json({ error: "missing roomId" }, { status: 400 });
        }

        const messages = getMessages(roomId, since || 0);
        const room = getRoom(roomId);

        return Response.json({
          messages,
          createdAt: room?.createdAt || 0,
          users: room?.users || [],
        });
      }

      case "info": {
        const { roomId } = body;
        const room = getRoom(roomId);
        if (!room) {
          return Response.json({ error: "room not found" }, { status: 404 });
        }
        return Response.json({
          users: room.users,
          createdAt: room.createdAt,
          messageCount: room.messages.length,
        });
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[RoomChat API Error]", error);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
