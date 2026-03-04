import { recognizeAsr } from "@/scripts/ai_api/asr";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await recognizeAsr({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });
    return Response.json(result);
  } catch (error) {
    console.error("[ASR Error]", error);
    return Response.json({ text: "" }, { status: 500 });
  }
}
