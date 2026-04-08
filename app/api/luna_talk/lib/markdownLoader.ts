import fs from 'fs';
import path from 'path';

export interface MarkdownFile {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

/**
 * 解析 Markdown 文件的 frontmatter 和内容
 */
export function parseMarkdownFile(filePath: string): MarkdownFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 解析 frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    // 提取 name 和 description
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) {
      return null;
    }

    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : '',
      content: body.trim(),
      filePath,
    };
  } catch (error) {
    console.error(`Error parsing markdown file ${filePath}:`, error);
    return null;
  }
}

/**
 * 加载指定目录下的所有 Markdown 文件
 */
export function loadMarkdownDirectory(dirPath: string): MarkdownFile[] {
  const results: MarkdownFile[] = [];

  try {
    if (!fs.existsSync(dirPath)) {
      return results;
    }

    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      if (file.endsWith('.md')) {
        const fullPath = path.join(dirPath, file);
        const parsed = parseMarkdownFile(fullPath);
        if (parsed) {
          results.push(parsed);
        }
      }
    }
  } catch (error) {
    console.error(`Error loading directory ${dirPath}:`, error);
  }

  return results;
}

/**
 * 按名称查找 Markdown 文件
 */
export function findMarkdownByName(files: MarkdownFile[], name: string): MarkdownFile | undefined {
  return files.find(f => f.name === name);
}

// 预定义的数据目录路径
const DATA_DIR = path.join(process.cwd(), 'app', 'api', 'luna_talk', 'data');

export const PATHS = {
  modes: path.join(DATA_DIR, '模式'),
  topics: path.join(DATA_DIR, '话题'),
  diaries: path.join(DATA_DIR, '日记'),
  skills: path.join(DATA_DIR, '技能'),
  persona: path.join(DATA_DIR, '人设'),
  system: path.join(DATA_DIR, '系统'),
  memories: path.join(DATA_DIR, '记忆'),
};

// 缓存已加载的文件
let cachedData: {
  modes: MarkdownFile[];
  topics: MarkdownFile[];
  diaries: MarkdownFile[];
  skills: MarkdownFile[];
  persona: MarkdownFile | null;
  analyzerTemplate: MarkdownFile | null;
  replierTemplate: MarkdownFile | null;
  memoryExtractorTemplate: MarkdownFile | null;
  system: MarkdownFile[];
  memories: MarkdownFile[];
} | null = null;

/**
 * 清除缓存（用于刷新记忆后）
 */
export function clearCache() {
  cachedData = null;
}

/**
 * 加载所有数据文件（带缓存）
 */
export function loadAllData() {
  if (cachedData) {
    return cachedData;
  }

  const modes = loadMarkdownDirectory(PATHS.modes);
  const topics = loadMarkdownDirectory(PATHS.topics);
  const diaries = loadMarkdownDirectory(PATHS.diaries);
  const skills = loadMarkdownDirectory(PATHS.skills);
  const personaFiles = loadMarkdownDirectory(PATHS.persona);
  const systemFiles = loadMarkdownDirectory(PATHS.system);
  const memories = loadMarkdownDirectory(PATHS.memories);

  cachedData = {
    modes,
    topics,
    diaries,
    skills,
    persona: personaFiles[0] || null,
    analyzerTemplate: findMarkdownByName(systemFiles, '分析模板') || null,
    replierTemplate: findMarkdownByName(systemFiles, '回复模板') || null,
    memoryExtractorTemplate: findMarkdownByName(systemFiles, '记忆提取模板') || null,
    system: systemFiles,
    memories,
  };

  return cachedData;
}

/**
 * 获取所有话题和日记合并（用于分析阶段）
 */
export function getAllTopicsAndDiaries(data: NonNullable<ReturnType<typeof loadAllData>>): MarkdownFile[] {
  return [...data.topics, ...data.diaries];
}
