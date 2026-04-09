import { jsonrepair } from "jsonrepair";
import { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";
import {
  getProfileCriteria,
  LUNA_GLOBAL_TEST_TRAITS,
  type LunaTestEvaluationResult,
} from "@/lib/lunaTestEvaluationCriteria";
export const runtime = "nodejs";

type TranscriptTurn = { role: "user" | "assistant"; content: string };

interface Body {
  profileName?: string;
  transcript?: TranscriptTurn[];
}

const EVALUATOR_SYSTEM = `你是「Luna Talk」自动测试的对话效果评估器。只根据下方提供的对话记录与测试标准做客观评估，不要编造对话里未出现的内容。

输出要求：仅输出一个 JSON 对象，不要用 markdown 代码块，不要输出任何其它文字。
字段要求：
- evidence、observed、criterion、trait、suggestions 的每条内容必须是「单行」短句；禁止换行；禁止在字符串内使用英文双引号 "；引用原文用中文「」或省略引号。
- 布尔值 met 只能是 true 或 false（小写，不加引号）。
- summaryVerdict 只能是 "pass"、"partial"、"fail" 三者之一。
- score1to5 为 1～5 的整数。

JSON 结构示例：
{
  "summaryVerdict": "partial",
  "score1to5": 3,
  "profileChecks": [ { "criterion": "…", "met": true, "evidence": "无" } ],
  "traitChecks": [ { "trait": "…", "observed": "…", "score": "ok" } ],
  "suggestions": [ "…" ]
}

原则：轮次少或未触达某类行为时，用 partial/weak 合理标注，不要苛求。`;
function formatTranscript(transcript: TranscriptTurn[]): string {
  return transcript
    .map((t, i) => `${i + 1}. ${t.role === "user" ? "用户" : "Luna"}：${t.content}`)
    .join("\n");
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const s = trimmed.indexOf("{");
  const e = trimmed.lastIndexOf("}");
  if (s >= 0 && e > s) return trimmed.slice(s, e + 1);
  return trimmed;
}

function parseEvaluationJson(text: string): LunaTestEvaluationResult {
  const tryParse = (s: string) => {
    const x = JSON.parse(s) as unknown;
    if (!x || typeof x !== "object") throw new Error("invalid");
    return x as LunaTestEvaluationResult;
  };

  const candidate = extractJsonCandidate(text);

  try {
    return tryParse(candidate);
  } catch {
    /* LLM 常输出尾逗号、未转义引号等，用 jsonrepair 再试 */
  }

  try {
    return tryParse(jsonrepair(candidate));
  } catch {
    /* fall through */
  }

  throw new Error("无法解析评估 JSON");
}

function normalizeResult(raw: LunaTestEvaluationResult): LunaTestEvaluationResult {
  const verdict = raw.summaryVerdict;
  const okVerdict =
    verdict === "pass" || verdict === "partial" || verdict === "fail" ? verdict : "partial";
  let score = Number(raw.score1to5);
  if (!Number.isFinite(score)) score = 3;
  score = Math.min(5, Math.max(1, Math.round(score)));

  const profileChecks = Array.isArray(raw.profileChecks)
    ? raw.profileChecks.map((p) => ({
        criterion: String(p.criterion ?? ""),
        met: Boolean(p.met),
        evidence: String(p.evidence ?? ""),
      }))
    : [];

  const traitChecks = Array.isArray(raw.traitChecks)
    ? raw.traitChecks.map((t) => {
        const sc = t.score;
        const scoreNorm =
          sc === "good" || sc === "ok" || sc === "weak" ? sc : "ok";
        return {
          trait: String(t.trait ?? ""),
          observed: String(t.observed ?? ""),
          score: scoreNorm,
        };
      })
    : [];

  const suggestions = Array.isArray(raw.suggestions)
    ? raw.suggestions.map((s) => String(s))
    : [];

  return {
    summaryVerdict: okVerdict,
    score1to5: score,
    profileChecks,
    traitChecks,
    suggestions,
  };
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "无效 JSON" }, { status: 400 });
  }

  const profileName = body.profileName?.trim();
  const transcript = body.transcript;
  if (!profileName || !Array.isArray(transcript) || transcript.length === 0) {
    return Response.json({ error: "缺少 profileName 或 transcript" }, { status: 400 });
  }

  const profile = getProfileCriteria(profileName);
  if (!profile) {
    return Response.json({ error: `未知测试画像: ${profileName}` }, { status: 400 });
  }

  const userPayload = [
    `【测试画像】${profileName}`,
    `【用户行为设定】${profile.userBehavior}`,
    `【预期结果（请逐条检查）】\n${profile.expectedOutcomes.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
    `【产品全局特性（请逐项简要评估）】\n${LUNA_GLOBAL_TEST_TRAITS.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    `【对话记录】\n${formatTranscript(transcript)}`,
  ].join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: EVALUATOR_SYSTEM },
    { role: "user", content: userPayload },
  ];

  try {
    const text = await callDoubao(messages, { timeoutMs: 90_000, retries: 2 });
    const parsed = normalizeResult(parseEvaluationJson(text));
    return Response.json({ evaluation: parsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
