import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";
import { loadAllData, parseMarkdownFile } from "./markdownLoader";
import fs from "fs";
import path from "path";

/** 普通对话记忆目录（data/记忆） */
export const LUNA_DEFAULT_MEMORY_DIR = path.join(
  process.cwd(),
  "app",
  "api",
  "luna_talk",
  "data",
  "记忆"
);

/** 自动测试隔离记忆的 key：仅允许安全字符，防止路径穿越 */
export function isValidMemorySandboxKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]{1,96}$/.test(key);
}

/**
 * 解析记忆目录：无 key 或非法 key → 默认生产目录；合法 key → .sandbox/<key>/（按需创建）
 */
export function resolveMemoryDir(sandboxKey?: string | null): string {
  if (typeof sandboxKey !== "string") return LUNA_DEFAULT_MEMORY_DIR;
  const key = sandboxKey.trim();
  if (!key || !isValidMemorySandboxKey(key)) return LUNA_DEFAULT_MEMORY_DIR;
  const dir = path.join(LUNA_DEFAULT_MEMORY_DIR, ".sandbox", key);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface ExtractedMemory {
  persona: string;
  summary: string;
}

/**
 * 读取现有的记忆文件
 */
export function readExistingMemories(memoryDir: string = LUNA_DEFAULT_MEMORY_DIR): {
  persona: string;
  summary: string;
} {
  let persona = "";
  let summary = "";

  const personaFile = path.join(memoryDir, "用户画像.md");
  if (fs.existsSync(personaFile)) {
    const parsed = parseMarkdownFile(personaFile);
    if (parsed) persona = parsed.content;
  }

  const summaryFile = path.join(memoryDir, "摘要.md");
  if (fs.existsSync(summaryFile)) {
    const parsed = parseMarkdownFile(summaryFile);
    if (parsed) summary = parsed.content;
  }

  return { persona, summary };
}

/**
 * 格式化对话历史供记忆提取使用
 */
function formatHistoryForMemoryExtraction(
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
function extractMemoryJsonFromResponse(text: string): ExtractedMemory | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as Partial<ExtractedMemory>;
    return {
      persona: parsed.persona || '',
      summary: parsed.summary || '',
    };
  } catch {
    return null;
  }
}

/**
 * 调用 LLM 提取记忆
 */
async function extractMemoriesWithLLM(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  existingMemories: { persona: string; summary: string }
): Promise<ExtractedMemory | null> {
  const data = loadAllData();
  const extractionTemplate = data.system.find(f => f.name === '记忆提取模板');

  if (!extractionTemplate) {
    console.error('[Memory Extractor] 找不到记忆提取模板');
    return null;
  }

  const extractionPrompt = extractionTemplate.content
    .replace('{{history}}', formatHistoryForMemoryExtraction(messages))
    .replace('{{existingPersona}}', existingMemories.persona || '（无现有画像）')
    .replace('{{existingSummary}}', existingMemories.summary || '（无现有摘要）');

  console.log('\n========== 记忆提取 Prompt ==========\n');
  console.log(extractionPrompt);
  console.log('\n=====================================\n');

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: extractionPrompt },
  ];

  const response = await callDoubao(chatMessages);
  return extractMemoryJsonFromResponse(response);
}

/**
 * 写入记忆文件
 */
function writeMemoryFile(name: string, content: string, memoryDir: string) {
  const filePath = path.join(memoryDir, `${name}.md`);

  const frontmatter = `---
name: ${name}
description: ${name === '用户画像' ? '用户的基本信息和喜好' :
              '对话历史摘要'}
---

${content}
`;

  try {
    fs.writeFileSync(filePath, frontmatter, 'utf-8');
    console.log(`[Memory Extractor] 已更新 ${name}.md`);
  } catch (error) {
    console.error(`[Memory Extractor] 写入 ${name}.md 失败:`, error);
  }
}

/**
 * 异步提取并保存记忆（不阻塞回复）
 */
export async function extractAndSaveMemoriesAsync(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  memoryDir: string = LUNA_DEFAULT_MEMORY_DIR
): Promise<void> {
  try {
    console.log("\n=========================================");
    console.log("🧠 开始异步记忆提取");
    if (memoryDir !== LUNA_DEFAULT_MEMORY_DIR) {
      console.log("[Memory Extractor] 沙箱目录:", memoryDir);
    }
    console.log("=========================================\n");

    const existingMemories = readExistingMemories(memoryDir);
    const extracted = await extractMemoriesWithLLM(messages, existingMemories);

    if (!extracted) {
      console.log("[Memory Extractor] 记忆提取失败，使用现有内容");
      return;
    }

    if (extracted.persona) {
      writeMemoryFile("用户画像", extracted.persona, memoryDir);
    }
    if (extracted.summary) {
      writeMemoryFile("摘要", extracted.summary, memoryDir);
    }

    console.log("[Memory Extractor] 记忆提取完成");
  } catch (error) {
    console.error("[Memory Extractor] 记忆提取出错:", error);
  }
}

/**
 * 启动异步记忆提取（不等待结果）
 */
export function startMemoryExtraction(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  memoryDir: string = LUNA_DEFAULT_MEMORY_DIR
): void {
  extractAndSaveMemoriesAsync(messages, memoryDir).catch((error) => {
    console.error("[Memory Extractor] 后台任务出错:", error);
  });
}
