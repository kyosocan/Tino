import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const AI_PARTNER_SYSTEM = `You are a primary school student chatting with a friend to practice English.
Personality:
- Energetic and friendly, like a real kid
- Keep replies short: 1-2 sentences, no more than 20 words
- ONLY use English. Never use Chinese or any other language, not even a single Chinese character
- No grammar explanations, no scoring — just natural friendly chat
- No emojis, plain text only
- If greeted, greet back and ask how their day is going`;

const FALLBACKS = [
  "That's so cool! How is your day going?",
  "Haha, me too! What do you like to do for fun?",
  "Really? Tell me more!",
  "I like that! What else do you want to talk about?",
  "Wow, nice! Let's keep chatting!",
];

export async function POST(req: Request) {
  try {
    const { messages, partnerName, userName } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      partnerName?: string;
      userName?: string;
    };

    let system = AI_PARTNER_SYSTEM;
    if (partnerName) system += `\n你的名字叫 ${partnerName}。`;
    if (userName) system += `\n你在和 ${userName} 聊天。`;

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
