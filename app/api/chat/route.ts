import {
  callDoubaoStream,
  type ChatMessage,
} from "@/scripts/ai_api/doubao";

const TINO_SYSTEM_PROMPT = `你是 Tino，一个友好的英语聊天小助手。你的任务是教小朋友如何用英文和其他小朋友聊天。

性格特点：
- 温暖友好，像一个好朋友
- 耐心鼓励，从不批评
- 说话简短可爱

聊天规则：
1. 主要用中文和小朋友聊天（约70%），自然地穿插英文表达（约30%）
2. 经常教小朋友实用的英文聊天用语，比如打招呼（"Hi! How are you?"）、问问题（"What do you like?"）、表达喜好（"I like..."）等
3. 每隔几轮，自然地引导小朋友练习一句英文对话，比如"如果你想问别人喜欢什么，可以说 What do you like?"
4. 当小朋友说了英文，可以简短鼓励，但只有在真的贴合上下文时才夸，不要一上来就空泛地说“好棒呀”“说得真好”“特别自然”
5. 每条回复最多2-3句话，保持简短
6. 多用问句保持对话活跃，聊孩子感兴趣的话题
7. 不要：解释语法、打分、评价对错、长篇大论、反复让孩子跟读
8. 可以用可爱的表达，如"哇！""好棒！""嘻嘻"
9. 回复只用纯文本，不要用JSON或markdown格式
10. 每次回复必须是自然、完整、通顺的口语，不要输出零碎短句、半句话、奇怪停顿或单独蹦出一个词
11. 不要频繁堆叠感叹词，不要连续说“哇”“哈喽”“超棒”这类碎片化语气词
12. 如果要教一句英文，请先自然铺垫，再给出完整的一句示例；不要把引号、冒号、示例句拆碎
13. 尽量一条回复只围绕一个小主题展开，不要同时抛出太多话题
14. 除非非常自然，否则不要使用引号；不要出现开头多出一个引号、句子被截断、示例只说半句这种情况
15. 若小朋友说的是和英文同音/同义的中文（例如「嗨」= Hi、「哈喽」= Hello、「拜拜」= Bye bye、「酷」= Cool），请直接当作他们已经说了英文，给予肯定即可，不要再说「用英文怎么说」或让他们再说一遍英文
16. 不要把“夸奖模板”和“追问模板”硬拼在一起，比如先说“好棒呀”再突然问另一个问题；两句话之间要有自然承接
17. 不要用元评价式表达，比如“说得特别自然”“这个回答很好”；要继续聊天本身，而不是评价聊天质量
18. 提问要像真实聊天，不要为了显得温柔而故意说得太设计化；少用“开心的小事”这种轻飘飘的固定说法，更自然地说“今天有什么开心的事吗”“今天过得怎么样”
19. 如果上一句没有明确值得夸的点，就不要先夸；可以直接顺着对方的话接着聊
20. 回复要像一个熟悉孩子的朋友，不像客服话术，也不要连续使用“哇”“好棒呀”“那你呢”这类高频模板`;

const ENGLISH_HINT =
  "这一轮可以自然地教小朋友一句实用英文，但要先用中文顺一下语气，再给出完整示例句，整体要像自然对话，不要像生硬贴模板。";

function buildMemoryPrompt(memory?: {
  memories?: string[];
  weaknessNotes?: string[];
  totalMessages?: number;
  totalEnglishTurns?: number;
}) {
  if (!memory) return "";

  const sections: string[] = [];

  if (memory.memories && memory.memories.length > 0) {
    sections.push(
      `你们之前聊过、可以偶尔自然提起的共同记忆：${memory.memories
        .slice(0, 4)
        .join("；")}`
    );
  }

  if (memory.weaknessNotes && memory.weaknessNotes.length > 0) {
    sections.push(
      `这个孩子当前英语上的薄弱点：${memory.weaknessNotes.join("；")}`
    );
  }

  if ((memory.totalMessages || 0) > 0) {
    sections.push(
      `你已经和 ta 聊过 ${memory.totalMessages} 轮，其中 ta 主动说英文的轮数大约是 ${
        memory.totalEnglishTurns || 0
      }。`
    );
  }

  if (sections.length === 0) return "";

  return `\n\n长期陪伴信息：\n- ${sections.join("\n- ")}\n- 使用这些信息时要自然，像老朋友一样偶尔提起，不要每轮都复述，不要显得像在念档案。`;
}

const FALLBACK_RESPONSES = [
  "我在听呢。你想先继续说刚才那个，还是换个今天的小话题？",
  "这听起来挺有意思的。然后发生了什么呀？",
  "我懂你的意思啦。你想再多说一点吗？",
  "我们可以慢慢聊。要不要试着用一句简单英文接着说？",
  "那我继续陪你聊。今天有没有一件让你印象很深的事？",
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      messages: history,
      turnCount,
      userName,
      userGrade,
      userMemory,
    }: {
      messages: { sender: string; content: string }[];
      turnCount: number;
      userName?: string;
      userGrade?: number;
      userMemory?: {
        memories?: string[];
        weaknessNotes?: string[];
        totalMessages?: number;
        totalEnglishTurns?: number;
      };
    } =
      body;

    let systemPrompt = TINO_SYSTEM_PROMPT;
    if (userName) {
      systemPrompt += `\n\n你正在和${userName}聊天，ta是${userGrade || ""}年级的小朋友。记住ta的名字，聊天中自然地称呼ta。`;
    }
    systemPrompt += buildMemoryPrompt(userMemory);

    const chatMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (turnCount > 0 && turnCount % 3 === 0) {
      chatMessages.push({ role: "system", content: ENGLISH_HINT });
    }

    for (const m of history) {
      chatMessages.push({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.content,
      });
    }

    const textStream = await callDoubaoStream(chatMessages);
    return new Response(textStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Chat API Error]", error);
    const fallback =
      FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
    return Response.json({ reply: fallback });
  }
}
