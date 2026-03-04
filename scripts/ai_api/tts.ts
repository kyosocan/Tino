import { randomUUID } from "crypto";

export type TtsInput = {
  text?: string;
  voiceType?: string;
};

export async function synthesizeTts(input: TtsInput) {
  const { text, voiceType } = input;
  if (!text) {
    throw new Error("text 不能为空");
  }

  const apiUrl = process.env.TTS_API_URL || "https://openspeech.bytedance.com/api/v1/tts";
  const appId = process.env.TTS_APP_ID || "";
  const token = process.env.TTS_TOKEN || "";
  const cluster = process.env.TTS_CLUSTER || "volcano_tts";
  const uid = process.env.TTS_UID || "speakparty_user";
  const finalVoiceType =
    (voiceType && voiceType.trim()) ||
    process.env.TTS_VOICE_TYPE ||
    "en_male_tim_uranus_bigtts";
  const encoding = process.env.TTS_ENCODING || "mp3";
  const speedRatio = Number(process.env.TTS_SPEED_RATIO || "1");
  const rate = Number(process.env.TTS_RATE || "24000");

  if (!appId || !token) {
    throw new Error("缺少 TTS_APP_ID / TTS_TOKEN");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer;${token}`
    },
    body: JSON.stringify({
      app: { appid: appId, token, cluster },
      user: { uid },
      audio: {
        voice_type: finalVoiceType,
        encoding,
        speed_ratio: speedRatio,
        rate
      },
      request: {
        reqid: randomUUID(),
        text,
        operation: "query"
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS 请求失败 ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    code: number;
    data?: string;
    message?: string;
  };
  if (data.code !== 3000 || !data.data) {
    throw new Error(`TTS 业务错误: ${data.code} ${data.message || ""}`);
  }

  return {
    audioBase64: data.data,
    mimeType: encoding === "wav" ? "audio/wav" : "audio/mpeg"
  };
}
