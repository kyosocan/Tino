import { generateLlmReply } from "@/scripts/ai_api/llm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await generateLlmReply(body);
    return Response.json(result);
  } catch (error) {
    console.error("[Luna Talk API Error]", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
