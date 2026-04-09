/**
 * 批量调用项目内火山 TTS（scripts/ai_api/tts），将文案合成 WAV（PCM）写入 data/。
 * 参数：16kHz 采样率（与常见设备端 PCM 一致）；接口侧语音合成一般为单声道。
 *
 * 需配置 .env 中的 TTS_APP_ID、TTS_TOKEN（与线上一致）。
 *
 * 用法:
 *   npm run generate-tts
 */

import { config } from "dotenv";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

import { synthesizeTts } from "./ai_api/tts";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

const VOICE = "zh_female_vv_uranus_bigtts";

/** 火山 OpenSpeech：wav 为带头的 PCM；rate 16000 即 16k */
const TTS_ENCODING = "wav" as const;
const TTS_SAMPLE_RATE_HZ = 16000;

/** 文件名取文案前若干字符（去非法路径字符）；重复时自动加序号 */
const STEM_MAX_CHARS = 12;

const SEGMENTS: string[] = [
  "小朋友你好，我来自 语行星 ，正要前往地球，请问这里是地球吗",
  "请按住设备右上方按钮告诉我吧",
  "吼吼，我顺利到达地球了，感谢你的帮助呢",
  "我看了下导航仪，这里就是地球呢，你真是有趣呢",
  '哈哈！你是我在地球遇到第一个小朋友，我们成为朋友吧，大声回答"yes"吧',
  "Nice to meet you ，I'm Tino",
  "Interesting，nice to meet you ，I'm Tino",
  "地球上还有许多小朋友在不断进步哦，我们要成为Best Partner，摇一摇向其他小朋友发起对战吧",
  "小朋友，快摇一摇设备发起对战吧",
  "小朋友，请你观察图片，说出它的英文单词吧，题目出现就能抢答哦",
  "First victory",
  "Second victory",
  "Third victory",
  "oops",
  "看图猜单词",
  "按住输入语音按钮，打断题干语音",
  "超级回合",
  "小朋友，在超级回合里你可以多次答题，每答对一个都会获得积分哦，请说出任意水果的英文单词",
  "five、four、three、two、one",
  "3，2，1",
];

function fileStemFromText(text: string): string {
  const trimmed = text.trim();
  const slice = [...trimmed].slice(0, STEM_MAX_CHARS).join("");
  let stem = slice
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  if (!stem) stem = "segment";
  return stem;
}

async function main() {
  const dataDir = resolve(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });

  const stemCounts = new Map<string, number>();

  for (const text of SEGMENTS) {
    let base = fileStemFromText(text);
    const n = (stemCounts.get(base) ?? 0) + 1;
    stemCounts.set(base, n);
    const filename = n === 1 ? `${base}.wav` : `${base}_${n}.wav`;
    const outPath = join(dataDir, filename);

    const { audioBase64 } = await synthesizeTts({
      text,
      voiceType: VOICE,
      encoding: TTS_ENCODING,
      rate: TTS_SAMPLE_RATE_HZ,
    });
    await writeFile(outPath, Buffer.from(audioBase64, "base64"));
    console.log(filename, "←", text.slice(0, 48) + (text.length > 48 ? "…" : ""));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
