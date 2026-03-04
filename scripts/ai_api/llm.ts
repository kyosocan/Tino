import { callDoubao } from "@/scripts/ai_api/doubao";

const HOST_NAME = "Teacher Mia";

export type LlmRequestBody = {
  mode?: "ai_turn" | "coach" | "host_turn" | "room_intro";
  theme?: string;
  difficulty?: "easy" | "medium" | "hard";
  playerName?: string;
  transcript?: string;
  tasks?: string[];
  needSupport?: boolean;
  turnIndex?: number;
  roomPhase?: "warmup" | "explore" | "free_qa" | "wrapup";
  recentContext?: string;
};

function limitText(text: string, max = 120) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function parseModelJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function getRoomPhase(turnIndex: number) {
  if (turnIndex < 4) return "warmup";
  if (turnIndex < 10) return "explore";
  if (turnIndex < 15) return "free_qa";
  return "wrapup";
}

export async function generateLlmReply(body: LlmRequestBody) {
  const levelHint =
    body.difficulty === "hard"
      ? "Use slightly richer but still kid-friendly English."
      : body.difficulty === "medium"
        ? "Use simple full sentences and one short follow-up."
        : "Use very easy words, short sentences, and clear prompts for young kids.";

  const mode = body.mode || "ai_turn";
  const turnIndex = Number.isFinite(body.turnIndex) ? Number(body.turnIndex) : 0;
  const phase = body.roomPhase || getRoomPhase(turnIndex);
  const contextHint = body.recentContext ? `Recent room context:\n${body.recentContext}` : "No recent context.";

  if (mode === "room_intro") {
    const content = await callDoubao([
      {
        role: "system",
        content:
          `You are ${HOST_NAME}, a warm foreign English teacher for Chinese kids aged 4-10. Start the room with a short, friendly intro: take turns, speak simple English, and cheer each other on. Keep it natural and easy, not robotic. You may add one short Chinese support line. ${levelHint} Output JSON only: {"intro":"...","supportZh":"..."}. Keep each field under 90 characters.`
      },
      {
        role: "user",
        content: `Theme: ${body.theme || "Daily Talk"}. Start the game now.`
      }
    ]);
    const introData = parseModelJson<{ intro: string; supportZh?: string }>(content, {
      intro: "Welcome! We take turns and speak simple English about today's topic.",
      supportZh: "小提示：一人一句，慢慢说就可以。"
    });
    return {
      intro: limitText(introData.intro, 90),
      supportZh: introData.supportZh ? limitText(introData.supportZh, 60) : ""
    };
  }

  if (mode === "host_turn") {
    const content = await callDoubao([
      {
        role: "system",
        content:
          `You are ${HOST_NAME}, a warm native English teacher hosting a speaking club for children aged 4-10 in China. Keep it calm, encouraging, and conversational. Avoid robotic phrasing and awkward small talk. Never use awkward greetings like "Hi you". You can naturally mix simple English with short Chinese hints when needed. Always provide one main question plus one short follow-up question for the same child. Keep continuity with room context and move the topic forward by phase:
warmup: easy personal sharing.
explore: ask details/reasons/examples.
free_qa: include short peer free-talk invitation.
wrapup: summarize and ask one reflective question.
${levelHint}
Output JSON only:
{"hostPrompt":"...","followUpPrompt":"...","freeTalkPrompt":"..."}
freeTalkPrompt can be empty string if not needed.
Keep each prompt under 90 chars.`
      },
      {
        role: "user",
        content: `Topic: ${body.theme || "Daily Talk"}.
Child name: ${body.playerName || "friend"}.
Turn index: ${turnIndex}.
Phase: ${phase}.
${contextHint}
Generate host main question + follow-up. In free_qa phase, add a freeTalkPrompt inviting peers to ask each other.`
      }
    ]);
    const hostData = parseModelJson<{
      hostPrompt: string;
      followUpPrompt?: string;
      freeTalkPrompt?: string;
    }>(content, {
      hostPrompt: `${body.playerName || "Friend"}, tell us one thing about ${body.theme || "today"}.`
    });
    return {
      hostPrompt: limitText(hostData.hostPrompt, 90),
      followUpPrompt: hostData.followUpPrompt ? limitText(hostData.followUpPrompt, 90) : "",
      freeTalkPrompt: hostData.freeTalkPrompt ? limitText(hostData.freeTalkPrompt, 90) : "",
      phase
    };
  }

  if (mode === "coach") {
    const content = await callDoubao([
      {
        role: "system",
        content:
          `You are ${HOST_NAME}, a gentle ESL coach for kids aged 4-10 and co-host of the room. Sound like a real foreign teacher: warm, natural, and not stiff. If the child struggles or asks in Chinese, provide one short Chinese hint and one sentence frame the child can copy. You may code-switch (EN + 简短中文) naturally. Keep all English simple and short. Always include one short follow-up question to deepen the child's answer. ${levelHint}
Output JSON only:
{"hostPrompt":"...","followUpPrompt":"...","aiReply":"...","newWords":["..."],"supportZh":"...","targetSentence":"..."}.
supportZh and targetSentence can be empty strings when not needed. Keep hostPrompt/aiReply/followUpPrompt each under 90 chars.`
      },
      {
        role: "user",
        content: `Topic: ${body.theme || "Daily Talk"}\nChild name: ${body.playerName || "kid"}\nKid said: ${body.transcript || ""}\nTasks: ${(body.tasks || []).join(
          ", "
        )}\nTurn index: ${turnIndex}\nPhase: ${phase}\nNeed extra support: ${body.needSupport ? "yes" : "no"}\n${contextHint}\nIf support needed, include a short Chinese hint and one easy sentence the kid can copy.\nReturn natural coach guidance, one follow-up question, and one peer reply.`
      }
    ]);
    const coachData = parseModelJson<{
      hostPrompt: string;
      followUpPrompt?: string;
      aiReply: string;
      newWords: string[];
      supportZh?: string;
      targetSentence?: string;
    }>(content, {
      hostPrompt: "Great try! Can you add one more detail?",
      aiReply: "Wow, that is cool! I like it too.",
      newWords: ["favorite"],
      supportZh: "你可以先说一个短句。",
      targetSentence: "My favorite animal is a rabbit."
    });
    return {
      hostPrompt: limitText(coachData.hostPrompt, 90),
      followUpPrompt: coachData.followUpPrompt ? limitText(coachData.followUpPrompt, 90) : "",
      aiReply: limitText(coachData.aiReply, 90),
      newWords: Array.isArray(coachData.newWords) ? coachData.newWords.slice(0, 3) : [],
      supportZh: coachData.supportZh ? limitText(coachData.supportZh, 60) : "",
      targetSentence: coachData.targetSentence ? limitText(coachData.targetSentence, 80) : ""
    };
  }

  const aiReply = await callDoubao([
    {
      role: "system",
      content:
        `You are a child peer in an English room (age 4-10). Speak naturally, short, and friendly. Avoid stiff textbook style. Give one answer sentence and one tiny follow-up question to keep conversation going. ${levelHint}. Output plain text in 1-2 short lines.`
    },
    {
      role: "user",
      content: `Topic: ${body.theme || "Daily Talk"}.
Speaker name: ${body.playerName || "friend"}.
Turn index: ${turnIndex}.
Phase: ${phase}.
${contextHint}`
    }
  ]);

  return { aiReply: limitText(aiReply, 90) };
}
