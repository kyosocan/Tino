import { randomUUID } from "crypto";

export type AsrInput = {
  audioBase64?: string;
  mimeType?: string;
};

export async function recognizeAsr(input: AsrInput) {
  const { audioBase64, mimeType } = input;
  if (!audioBase64) {
    throw new Error("audioBase64 不能为空");
  }

  const apiUrl =
    process.env.VOLCENGINE_ASR_API_URL ||
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
  const appId = process.env.VOLCENGINE_APP_ID || "";
  const accessToken = process.env.VOLCENGINE_ACCESS_TOKEN || "";
  const resourceId = process.env.VOLCENGINE_RESOURCE_ID || "volc.bigasr.auc_turbo";

  if (!appId || !accessToken) {
    throw new Error("缺少 VOLCENGINE_APP_ID / VOLCENGINE_ACCESS_TOKEN");
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-App-Key": appId,
      "X-Api-Access-Key": accessToken,
      "X-Api-Resource-Id": resourceId,
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1"
    },
    body: JSON.stringify({
      user: { uid: appId },
      audio: {
        data: audioBase64,
        format: mimeType?.replace("audio/", "") || "webm"
      },
      request: { model_name: "bigmodel" }
    })
  });

  const statusCode = response.headers.get("X-Api-Status-Code");
  const message = response.headers.get("X-Api-Message");
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ASR 请求失败 ${response.status}: ${detail}`);
  }
  if (statusCode !== "20000000") {
    throw new Error(`ASR 业务错误: ${statusCode || "unknown"} ${message || ""}`);
  }

  const data = (await response.json()) as { result?: { text?: string } };
  return { text: data.result?.text || "" };
}
