import { loadAllData } from "../lib/markdownLoader";

export async function GET() {
  try {
    const data = loadAllData();

    return Response.json({
      memories: data.memories.map(m => ({
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
