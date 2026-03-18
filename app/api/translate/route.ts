import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";

const ZH2EN_PROMPT = `你是 Tino，一只活泼的英语小狐狸，帮助小朋友把中文翻译成简单的英文，并标注每个单词的音标。
请直接以 JSON 格式返回，不要使用 markdown 代码块，格式如下：
{"english":"翻译结果","words":[{"word":"单词","phonetic":"/音标/"}],"voiceGuide":"鼓励语"}
要求：
- english：用小学生能理解的简单英文，语气自然像小朋友间对话
- words：英文句子中每个单词及其美式 IPA 音标，标点符号附在对应单词上（如 "cream."）
- voiceGuide：用 Tino 的口吻，活泼温柔，格式为「{中文原文}，用英文可以这样说：{英文}！来按住发音键读一下吧～」`;

const EN2ZH_PROMPT = `你是一个英语翻译助手，帮助小朋友理解英文。
要求：
- 翻译成简单易懂的中文
- 只返回中文翻译，不要其他任何内容（不要解释、不要英文、不要引号）`;

export async function POST(req: Request) {
  try {
    const { text, lang } = await req.json() as { text: string; lang?: string };
    if (!text) {
      return Response.json({ error: "missing text" }, { status: 400 });
    }

    const isEn2Zh = lang === "en2zh";
    const systemPrompt = isEn2Zh ? EN2ZH_PROMPT : ZH2EN_PROMPT;
    const userContent = isEn2Zh
      ? `请把下面这句英文翻译成简单的中文：\n${text}`
      : `请把下面这句话翻译成简单的英文，并按要求返回 JSON：\n${text}`;

    const msgs: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];

    const result = await callDoubao(msgs, {
      model: process.env.ARK_TRANSLATE_MODEL || "doubao-seed-2-0-lite-260215",
      timeoutMs: Number(process.env.ARK_TRANSLATE_TIMEOUT_MS || "8000"),
      retries: 1,
    });

    if (isEn2Zh) return Response.json({ chinese: result || "" });

    try {
      const jsonStr = (result || "").replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      return Response.json({
        english: (parsed.english || "").trim(),
        words: Array.isArray(parsed.words) ? parsed.words : [],
        voiceGuide: (parsed.voiceGuide || "").trim(),
      });
    } catch {
      return Response.json({ english: (result || "").trim(), words: [], voiceGuide: "" });
    }
  } catch (error) {
    console.error("[Translate API Error]", error);
    return Response.json({ english: "", chinese: "", words: [], voiceGuide: "" });
  }
}
