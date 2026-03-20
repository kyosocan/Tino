import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const SUGGEST_PROMPT = `You are Tino, a friendly English-learning fox helping kids aged 6-12 practice English conversation.

Given the last sentence said by someone in an English chat room, return exactly 2 short, natural English responses that a child could realistically say next. The responses must:
- Be very short (2-6 words each)
- Sound natural for a child to say
- Be easy to pronounce
- Fit as a direct reply to the given sentence
- Be different from each other (one reaction + one question, or two different reactions)

Return ONLY valid JSON, no markdown, no explanation:
{"suggestions":[{"en":"...","zh":"..."},{"en":"...","zh":"..."}]}

Where "zh" is a simple Chinese translation of the English suggestion.`;

export async function POST(req: Request) {
  try {
    const { lastMessage } = await req.json() as { lastMessage: string };
    if (!lastMessage) {
      return Response.json({ suggestions: [] }, { status: 400 });
    }

    const msgs: ChatMessage[] = [
      { role: "system", content: SUGGEST_PROMPT },
      { role: "user", content: lastMessage },
    ];

    const result = await callDoubao(msgs, {
      model: process.env.ARK_TRANSLATE_MODEL,
      timeoutMs: 8000,
      retries: 1,
    });

    const stripped = (result || "").replace(/```json\n?|```\n?/g, "").trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : stripped);
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 2) : [];
    return Response.json({ suggestions });
  } catch (error) {
    console.error("[Suggest API Error]", error);
    return Response.json({ suggestions: [] });
  }
}
