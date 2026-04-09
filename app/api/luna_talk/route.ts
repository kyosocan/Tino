import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";
import {
  loadAllData,
  findMarkdownByName,
  type MarkdownFile,
} from "./lib/markdownLoader";
import {
  startMemoryExtraction,
  readExistingMemories,
  resolveMemoryDir,
  isValidMemorySandboxKey,
  LUNA_DEFAULT_MEMORY_DIR,
} from "./lib/memoryExtractor";

interface LunaTalkRequestBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** 自动测试专用：隔离记忆目录，不传则使用普通用户记忆 */
  memorySandbox?: string;
}

interface AnalysisResult {
  mode: string;
  context: string;
}

/**
 * 格式化模式列表供分析 LLM 使用
 */
function formatModesForAnalysis(modes: MarkdownFile[]): string {
  return modes
    .map((m, i) => `${i + 1}. ${m.name}\n   ${m.description}`)
    .join('\n\n');
}

/**
 * 格式化话题列表供分析 LLM 使用
 */
function formatTopicsForAnalysis(topics: MarkdownFile[]): string {
  if (topics.length === 0) return '（无可用话题）';
  return topics
    .map((s, i) => `${i + 1}. ${s.name}\n   ${s.description}`)
    .join('\n\n');
}

/**
 * 格式化日记列表供分析 LLM 使用
 */
function formatDiariesForAnalysis(diaries: MarkdownFile[]): string {
  if (diaries.length === 0) return '（无可用日记）';
  return diaries
    .map((s, i) => `${i + 1}. ${s.name}\n   ${s.description}`)
    .join('\n\n');
}

/**
 * 格式化技能列表供分析 LLM 使用
 */
function formatSkillsForAnalysis(skills: MarkdownFile[]): string {
  if (skills.length === 0) return '（无可用技能）';
  return skills
    .map((s, i) => `${i + 1}. ${s.name}\n   ${s.description}`)
    .join('\n\n');
}

/**
 * 格式化对话历史
 */
function formatHistoryForAnalysis(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  if (messages.length === 0) return '（无历史对话）';
  return messages
    .map((m) => `${m.role === 'user' ? '用户' : 'Luna'}: ${m.content}`)
    .join('\n');
}

/**
 * 从 LLM 响应中提取 JSON
 */
function extractJsonFromResponse(text: string): AnalysisResult | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as Partial<AnalysisResult>;
    return {
      mode: parsed.mode || '',
      context: parsed.context || '',
    };
  } catch {
    return null;
  }
}

/**
 * 调用分析 LLM
 */
async function analyzeConversation(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  data: ReturnType<typeof loadAllData>
): Promise<AnalysisResult> {
  const { modes, topics, diaries, skills, analyzerTemplate } = data;

  if (!analyzerTemplate) {
    throw new Error('找不到分析模板');
  }

  const userMessage = messages.length > 0
    ? messages[messages.length - 1].content
    : '';

  // 分析模型只参考最近3轮历史消息
  const historyMessages = messages.slice(0, -1).slice(-3);

  const analysisPrompt = analyzerTemplate.content
    .replace('{{modes}}', formatModesForAnalysis(modes))
    .replace('{{topics}}', formatTopicsForAnalysis(topics))
    .replace('{{diaries}}', formatDiariesForAnalysis(diaries))
    .replace('{{skills}}', formatSkillsForAnalysis(skills))
    .replace('{{history}}', formatHistoryForAnalysis(historyMessages))
    .replace('{{userMessage}}', userMessage);

  console.log('\n========== 分析 LLM Prompt ==========\n');
  console.log(analysisPrompt);
  console.log('\n=======================================\n');

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: analysisPrompt },
  ];

  const response = await callDoubao(chatMessages);
  const result = extractJsonFromResponse(response);

  if (!result) {
    return {
      mode: modes[0]?.name || '中英混合引导',
      context: '',
    };
  }

  // 验证模式
  const modeExists = modes.some(m => m.name === result.mode);
  if (!modeExists && modes.length > 0) {
    result.mode = modes[0].name;
  }

  // 验证 context 是否存在（在话题、日记或技能中）
  const allContent = [...topics, ...diaries, ...skills];
  const contextExists = result.context ? allContent.some(c => c.name === result.context) : false;
  if (!contextExists) {
    result.context = '';
  }

  return result;
}

/**
 * 调用回复 LLM
 */
async function generateReply(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  analysis: AnalysisResult,
  data: ReturnType<typeof loadAllData>,
  memoryDir: string
): Promise<{ reply: string; finalPrompt: string }> {
  const { modes, topics, diaries, skills, persona, replierTemplate } = data;

  if (!replierTemplate) {
    throw new Error('找不到回复模板');
  }

  const selectedMode = findMarkdownByName(modes, analysis.mode);
  if (!selectedMode) {
    throw new Error(`找不到模式: ${analysis.mode}`);
  }

  // 查找 context 内容（在话题、日记、技能中查找）
  let selectedContent: MarkdownFile | null = null;
  if (analysis.context) {
    selectedContent = findMarkdownByName(topics, analysis.context)
      || findMarkdownByName(diaries, analysis.context)
      || findMarkdownByName(skills, analysis.context)
      || null;
  }

  let contextContent = '（无相关内容）';
  if (selectedContent) {
    contextContent = `## ${selectedContent.name}\n${selectedContent.content}`;
  }

  // 获取历史对话摘要
  const existingMemories = readExistingMemories(memoryDir);
  const historySummary = existingMemories.summary || "（无历史对话摘要）";

  // 构建 system prompt
  const systemPrompt = replierTemplate.content
    .replace('{{persona}}', persona ? persona.content : '你是 Luna，一个友好的英语学习伙伴。')
    .replace('{{modeContent}}', selectedMode.content)
    .replace('{{context}}', contextContent)
    .replace('{{historySummary}}', historySummary);

  console.log('\n========== 回复 LLM System Prompt ==========\n');
  console.log(systemPrompt);
  console.log('\n==========================================\n');

  // 只取最近3轮消息
  const recentMessages = messages.slice(-3);

  // 构建完整消息列表：system + 最近3轮对话
  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const reply = await callDoubao(chatMessages);
  return { reply, finalPrompt: systemPrompt };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LunaTalkRequestBody;
    const messages = body.messages || [];

    if (messages.length === 0) {
      return Response.json({ error: "消息列表不能为空" }, { status: 400 });
    }

    if (body.memorySandbox !== undefined && body.memorySandbox !== null) {
      const sk = String(body.memorySandbox).trim();
      if (sk.length > 0 && !isValidMemorySandboxKey(sk)) {
        return Response.json({ error: "memorySandbox 格式无效" }, { status: 400 });
      }
    }

    const memoryDir = resolveMemoryDir(
      typeof body.memorySandbox === "string" ? body.memorySandbox.trim() || null : null
    );
    const isSandbox = memoryDir !== LUNA_DEFAULT_MEMORY_DIR;

    const data = loadAllData();

    console.log("\n==========================================");
    console.log("🚀 开始两阶段对话处理");
    if (isSandbox) console.log("📦 使用记忆沙箱（自动测试）:", memoryDir);
    console.log("==========================================\n");

    const analysis = await analyzeConversation(messages, data);
    console.log("[Luna Talk] 分析结果:", analysis);

    const [replyResult] = await Promise.all([
      generateReply(messages, analysis, data, memoryDir),
      (async () => {
        startMemoryExtraction(messages, memoryDir);
      })(),
    ]);

    const { reply, finalPrompt } = replyResult;

    return Response.json({
      reply,
      analysis,
      finalPrompt,
    });
  } catch (error) {
    console.error("[Luna Talk API Error]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
