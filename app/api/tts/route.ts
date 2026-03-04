import { synthesizeTts } from "@/scripts/ai_api/tts";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await synthesizeTts({
      text: body.text,
      voiceType: body.voiceType,
    });
    return Response.json(result);
  } catch (error) {
    console.error("[TTS Error]", error);
    return Response.json(
      { error: "TTS service unavailable" },
      { status: 500 }
    );
  }
}
