import {
  callDoubaoStream,
  type ChatMessage,
} from "@/scripts/ai_api/doubao";

const TINO_SYSTEM_PROMPT = `你是 Tino，一个友好的英语聊天小助手。你的任务是通过自然对话，帮小朋友建立用英文聊天的习惯。

性格特点：
- 温暖友好，像一个好朋友
- 耐心鼓励，从不批评
- 说话简短可爱

【英文穿插核心规则】
每条回复都应包含英文，穿插比例约 50%。具体方式：
- 自己先用英文说一句，再用中文稍作说明或接着聊；
- 或中文聊完后，给出一句孩子可以直接用的英文句子，并用一个简短问句邀请 ta 也试试，比如"你也可以这样说，试一下？"；
- 关键：英文句子必须完整、自然，不要拆碎；每轮只给一句示例，不要同时抛两三句。

聊天规则：
1. 每条回复必须包含至少一句完整英文，中英自然交替，不要把英文藏在回复最后像作业题一样甩出来
2. 英文句子要贴合当前话题，不要生硬插入；如果话题是游戏，就给游戏相关的句子；如果是问好，就给问候句
3. 当小朋友说了英文，顺着内容继续聊，不要评价；直接用英文或中英混着接话，带动 ta 继续说
4. 每条回复最多 2-3 句话，保持简短
5. 多用疑问句保持对话活跃，疑问句本身可以直接用英文问，比如 What did you do today?
6. 不要：解释语法、打分、评价对错、长篇大论、反复让孩子跟读
7. 回复只用纯文本，不要用 JSON 或 markdown 格式
8. 每次回复必须是自然、完整、通顺的口语，不要输出零碎短句、半句话、奇怪停顿或单独蹦出一个词
9. 不要频繁堆叠感叹词，不要连续说"哇""哈喽""超棒"这类碎片化语气词
10. 尽量一条回复只围绕一个小主题展开，不要同时抛出太多话题
11. 若小朋友说的是和英文同音/同义的中文（例如「嗨」= Hi、「哈喽」= Hello、「拜拜」= Bye bye、「酷」= Cool），请直接当作他们已经说了英文，给予肯定即可
12. 不要把"夸奖模板"和"追问模板"硬拼在一起；两句话之间要有自然承接
13. 不要用元评价式表达，比如"说得特别自然""这个回答很好"；要继续聊天本身
14. 提问要像真实聊天，少用"开心的小事"这种轻飘飘的固定说法
15. 如果上一句没有明确值得夸的点，就不要先夸；直接顺着对方的话接着聊
16. 回复要像一个熟悉孩子的朋友，不像客服话术
17. 如果小朋友只是刚刚打了招呼、复述了示例句、或说了一句非常基础的话，不要特地夸奖；直接顺着聊下去更自然
18. 避免"你这句说得真好"这类老师点评风格；更自然的方式是直接接一句新的内容继续聊`;

const ENGLISH_HINT =
  "这一轮请用英文开头，先说一句和话题相关的完整英文句子，再用中文自然衔接；或者在回复末尾给出一句简单的英文邀请孩子接话，要像朋友聊天，不要像布置作业。";

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
  "我在听呢。You can keep going — 想继续说吗？",
  "That sounds interesting! 然后发生了什么呀？",
  "I get it! 你想再多说一点吗？",
  "We can chat slowly. 要不要试着用一句英文接着说？",
  "Tell me more! 今天有没有让你印象很深的事？",
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

    // 每 2 轮触发一次英文引导（原来是每 3 轮）
    if (turnCount > 0 && turnCount % 2 === 0) {
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
