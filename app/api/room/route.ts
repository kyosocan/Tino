import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

type RoomBody = {
  action: string;
  phase: string;
  turnIndex: number;
  friendName: string;
  friendEnglishName: string;
  friendGrade: number;
  friendLikes: string[];
  recentContext: string;
  userMessage?: string;
  englishCount?: number;
  userName?: string;
};

const TINO_HOST_BASE = `你是 Tino，一只来自"语言星球"的可爱小狐狸，现在你是聊天房间的主持人。
房间里有两个小朋友在聊天，你的任务是让他们玩得开心，同时自然地练习英文。
规则：说话简短（最多2句），语气温暖有趣，不要长篇大论，回复纯文本。`;

function buildHostPrompt(body: RoomBody, extra: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${TINO_HOST_BASE}\n房间里有：用户（小朋友）和 ${body.friendName}（${body.friendEnglishName}），${body.friendGrade}年级，喜欢${body.friendLikes.join("、")}。\n当前阶段：${body.phase}\n${extra}`,
    },
    {
      role: "user",
      content: body.recentContext || "（房间刚开始）",
    },
  ];
}

const FRIEND_PROMPT_BASE = (body: RoomBody) =>
  `你是${body.friendName}，一个${body.friendGrade}年级的中国小朋友，在一个英文练习聊天室里。
你喜欢${body.friendLikes.join("和")}。
你的特点：说话像小朋友，简短且自然，会尝试说一些简单的英文，但偶尔也用中文。
规则：每条回复1-2句话，自然回应上一条消息，回复纯文本。`;

const AI2_NAME = "嘟嘟";

const AI2_HOST_BASE = `你是${AI2_NAME}，一只可爱的小兔子，和 Tino 一起主持聊天房间。
你活泼热情，说话简短有趣，喜欢用一些简单英文。回复纯文本，最多2句。`;

const FALLBACKS: Record<string, string> = {
  intro: "Welcome! 大家好呀！Let's have fun together!",
  tino_intro: "嘿嘿！我给大家介绍一下，this is my best friend！我们经常一起聊天哦～ Say hi!",
  ai2_intro: "我也带了一个小伙伴来！Come and say hello!",
  friend_self_intro: "大家好！Nice to meet you!",
  warmup: "太棒了！Now let's chat! 你们喜欢什么呀？Tell us!",
  friend: "嗯嗯！I think so too! 你觉得呢？",
  host: "You two are doing great! 继续聊吧！",
  game: "Game time! 谁能用英文说出三种动物？🐱🐶🐰\nWho can name three animals in English?",
  summary: "Great job! 你们太棒了！",
};

export async function POST(req: Request) {
  let parsedBody: RoomBody | null = null;

  try {
    parsedBody = await req.json();
  } catch {
    return Response.json({ reply: FALLBACKS.host });
  }

  const body = parsedBody!;
  const { action } = body;

  try {
    let reply: string;

    switch (action) {
      case "intro": {
        const msgs = buildHostPrompt(
          body,
          `请用温暖有趣的方式欢迎大家来到聊天房间，营造轻松愉快的氛围。不要让小朋友自我介绍名字和年级（主持人已经认识大家了），直接引导他们聊天互动。`
        );
        reply = await callDoubao(msgs);
        break;
      }

      case "tino_intro": {
        const userName = body.userName || "小朋友";
        const msgs: ChatMessage[] = [
          {
            role: "system",
            content: `${TINO_HOST_BASE}\n你正在给大家介绍你的好朋友${userName}。像一个热情的小伙伴一样把${userName}介绍给房间里的其他人。\n语气活泼可爱，穿插简单英文，1-2句话，回复纯文本。`,
          },
          {
            role: "user",
            content: `请用"嘿嘿，我来给大家介绍..."这样的开头，把你的好朋友${userName}介绍给大家。要像朋友间互相带新朋友认识那样自然热情。`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "ai2_intro": {
        const msgs: ChatMessage[] = [
          {
            role: "system",
            content: `${AI2_HOST_BASE}\n你正在把你的好朋友${body.friendName}（英文名${body.friendEnglishName}）介绍给大家。\n${body.friendName}是${body.friendGrade}年级的小朋友，喜欢${body.friendLikes.join("和")}。\n像一个热情的小伙伴一样介绍你的朋友，自然穿插英文，1-2句话，回复纯文本。`,
          },
          {
            role: "user",
            content: `请把你的好朋友${body.friendName}介绍给大家，提到ta喜欢什么。要有热情和自豪感，像在说"看！这是我的好朋友！"`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "friend_self_intro": {
        const msgs: ChatMessage[] = [
          { role: "system", content: FRIEND_PROMPT_BASE(body) },
          {
            role: "user",
            content: `${AI2_NAME}刚刚把你介绍给了大家。现在请简短地跟大家打招呼，介绍自己的名字和爱好，自然使用一些英文。1-2句话。`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "warmup": {
        const userName = body.userName || "小朋友";
        const msgs = buildHostPrompt(
          body,
          `大家已经互相认识了。请直接用${userName}的名字称呼ta，热情地鼓励大家开始聊天。给一个有趣的话题引子让他们聊起来，比如问一个轻松好玩的问题。不要再让小朋友介绍名字或年级。1-2句话，穿插英文。`
        );
        reply = await callDoubao(msgs);
        break;
      }

      case "friend_reply": {
        const msgs: ChatMessage[] = [
          { role: "system", content: FRIEND_PROMPT_BASE(body) },
          {
            role: "user",
            content: `对方说：${body.userMessage || "你好"}\n\n最近对话：\n${body.recentContext || "无"}\n\n请自然地回应。`,
          },
        ];
        reply = await callDoubao(msgs);
        break;
      }

      case "host_comment": {
        const msgs = buildHostPrompt(
          body,
          body.phase === "icebreaking"
            ? "两个小朋友在自我介绍，给予鼓励，如果他们用了英文就夸奖。"
            : "评论一下小朋友的对话，给予鼓励。如果全是中文，自然地建议他们说一句英文。如果聊得好就鼓励。"
        );
        reply = await callDoubao(msgs);
        break;
      }

      case "game": {
        const games = [
          "谁能用英文说出三种水果？🍎🍌🍊 Let's go!",
          "用英文描述今天的天气吧！☀️🌧️ How's the weather?",
          "谁能用英文说三种颜色？🎨 What colors do you know?",
          "用英文数到十！Ready? One, two, three...",
          "谁能用英文说三种动物？🐱🐶🐰 Name three animals!",
        ];
        const randomGame = games[Math.floor(Math.random() * games.length)];
        const msgs = buildHostPrompt(
          body,
          `现在是小游戏时间！请提出一个简单有趣的英文小游戏，类似这种风格："${randomGame}"\n小游戏持续约30秒，保持简单有趣。`
        );
        reply = await callDoubao(msgs);
        break;
      }

      case "summary": {
        const count = body.englishCount || 0;
        const msgs = buildHostPrompt(
          body,
          `聊天即将结束。请做一个温暖的总结，提到他们说了大约${count}句英文，鼓励他们做得很棒。用"Great job!"或类似的表达结尾。`
        );
        reply = await callDoubao(msgs);
        break;
      }

      default:
        reply = "Let's keep chatting! 继续聊吧！";
    }

    return Response.json({ reply });
  } catch (error) {
    console.error("[Room API Error]", error);
    const fallback =
      FALLBACKS[action as keyof typeof FALLBACKS] || FALLBACKS.host;
    return Response.json({ reply: fallback });
  }
}
