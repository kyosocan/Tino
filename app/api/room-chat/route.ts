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

const SILENCE_NUDGE_MS = 25_000;
const SILENCE_NUDGE_COOLDOWN_MS = 45_000;

/** 对方太久没接话时，由 Tino 轻声引导该说话的一方 */
async function generateSilenceNudge(roomId: string, userId: string) {
  const room = getRoom(roomId);
  if (!room || room.tinoGenerating) return { ok: false as const };

  const me = room.users.find((u) => u.userId === userId);
  const partner = room.users.find((u) => u.userId !== userId);
  if (!me || !partner) return { ok: false as const };

  const nonTino = room.messages.filter((m) => m.senderId !== "tino");
  const lastMsg = nonTino[nonTino.length - 1];
  if (!lastMsg) return { ok: false as const };

  if (Date.now() - lastMsg.timestamp < SILENCE_NUDGE_MS) return { ok: false as const };

  if (
    room.lastSilenceNudgeAt &&
    Date.now() - room.lastSilenceNudgeAt < SILENCE_NUDGE_COOLDOWN_MS
  ) {
    return { ok: false as const };
  }

  let nudgeWho: "peer" | "self";
  if (lastMsg.senderId === userId) nudgeWho = "peer";
  else if (lastMsg.senderId === partner.userId) nudgeWho = "self";
  else return { ok: false as const };

  room.tinoGenerating = true;
  try {
    const userNames = room.users.map((u) => u.name).join(" 和 ");
    const recent = room.messages
      .slice(-10)
      .map((m) => `${m.senderName}: ${m.content}`)
      .join("\n");

    const hint =
      nudgeWho === "peer"
        ? `对方小朋友「${partner.name}」有一阵子没接话了。请直接称呼 Ta 的名字，用一句温暖简短的话请 Ta 试着用英语回应，中英混合，最多2句。`
        : `刚才「${partner.name}」已经说了。「${me.name}」有一阵子没接话。请温和地鼓励 ${me.name} 用英语接着说，中英混合，最多2句。`;

    const msgs: ChatMessage[] = [
      {
        role: "system",
        content: `${TINO_ROOM_PROMPT}\n房间里有：${userNames}。\n你是 Tino，只在冷场时轻轻提醒下一位该说话的人。`,
      },
      {
        role: "user",
        content: `最近的对话：\n${recent}\n\n${hint}`,
      },
    ];

    const reply = await callDoubao(msgs);
    if (reply) {
      addTinoMessage(roomId, reply);
      room.lastSilenceNudgeAt = Date.now();
      return { ok: true as const };
    }
  } catch (error) {
    console.error("[Tino silence nudge error]", error);
  } finally {
    room.tinoGenerating = false;
  }
  return { ok: false as const };
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

      case "silence_nudge": {
        const { roomId, userId } = body;
        if (!roomId || !userId) {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }
        const result = await generateSilenceNudge(roomId, userId);
        return Response.json(result);
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("[RoomChat API Error]", error);
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
