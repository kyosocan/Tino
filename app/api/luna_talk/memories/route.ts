import { loadAllData, clearCache } from "../lib/markdownLoader";
import fs from 'fs';
import path from 'path';

const memoriesDir = path.join(process.cwd(), 'app', 'api', 'luna_talk', 'data', '记忆');

export async function GET() {
  try {
    const data = loadAllData();

    // 过滤掉习得词汇
    const filteredMemories = data.memories.filter(m => m.name !== '习得词汇');

    return Response.json({
      memories: filteredMemories.map(m => ({
        name: m.name,
        description: m.description,
        content: m.content,
      })),
    });
  } catch (error) {
    console.error("[Memories API Error]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const filesToClear = ['用户画像.md', '摘要.md', '习得词汇.md'];

    for (const file of filesToClear) {
      const filePath = path.join(memoriesDir, file);
      if (fs.existsSync(filePath)) {
        // 清空文件内容，保留 frontmatter
        const content = fs.readFileSync(filePath, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
        if (frontmatterMatch) {
          const newContent = `${frontmatterMatch[0]}\n`;
          fs.writeFileSync(filePath, newContent, 'utf-8');
        }
      }
    }

    // 清除缓存
    clearCache();

    return Response.json({ success: true });
  } catch (error) {
    console.error("[Clear Memories API Error]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
