import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const AI_PARTNER_SYSTEM = `You are a primary school kid chatting with a new friend at an English corner. Your goal is to keep the conversation fun and mostly in English.

Rules:
- Speak mostly English. Use short, simple sentences a primary schooler would say.
- Each reply is 1-2 sentences max, under 20 words total.
- Only add a tiny bit of Chinese (3-5 words max) when it helps the other kid understand — e.g. "That's so fun! 你也喜欢吗？"
- If the other kid speaks Chinese, gently respond in English first, then echo their meaning in English to encourage them — never reply fully in Chinese.
- Never explain grammar, never give scores, never act like a teacher.
- Be warm, playful, use emoji occasionally 😄
- Ask a follow-up question to keep the chat going.`;

const FALLBACKS = [
  "That's so cool! What do you like to do after school? 😄",
  "Haha, me too! Do you have a favorite game?",
  "Really? Tell me more! I want to know!",
  "Wow, nice! What else do you like?",
  "That sounds fun! Can we talk more about it?",
];

export async function POST(req: Request) {
  try {
    const { messages, partnerName, userName } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      partnerName?: string;
      userName?: string;
    };

    let system = AI_PARTNER_SYSTEM;
    if (partnerName) system += `\nYour name is ${partnerName}.`;
    if (userName) system += `\nYou are chatting with ${userName}.`;

    const chatMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.slice(-8),
    ];

    const reply = await callDoubao(chatMessages, { timeoutMs: 12000, retries: 2 });
    return Response.json({ reply: reply || FALLBACKS[0] });
  } catch {
    const fb = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
    return Response.json({ reply: fb });
  }
}
