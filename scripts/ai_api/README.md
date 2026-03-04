# AI API 代码整理说明

本目录用于集中存放项目中与 AI 模型 API 直接交互的代码，覆盖 LLM、ASR、TTS 三类能力。

## 目录结构

- `doubao.ts`
  - Doubao/OpenAI-Compatible Chat Completions 调用封装
  - 包含鉴权、重试、退避与 jitter 逻辑
- `llm.ts`
  - LLM 场景编排逻辑（`room_intro` / `host_turn` / `coach` / `ai_turn`）
  - 统一 prompt 组织、返回解析与兜底处理
- `asr.ts`
  - 火山引擎 ASR HTTP API 封装
  - 输入 `audioBase64 + mimeType`，返回识别文本
- `tts.ts`
  - 火山引擎 TTS HTTP API 封装
  - 输入文本和音色，返回 base64 音频与 MIME 类型

## 与 Next.js 路由的关系

以下路由保留在 `app/api`（作为 HTTP 入口），但核心模型调用逻辑已迁移到本目录：

- `app/api/llm/route.ts` -> `scripts/ai_api/llm.ts`
- `app/api/asr/route.ts` -> `scripts/ai_api/asr.ts`
- `app/api/tts/route.ts` -> `scripts/ai_api/tts.ts`

## 兼容性说明

- `lib/server/doubao.ts` 已调整为转发导出：
  - `export { callDoubao, type ChatMessage } from "@/scripts/ai_api/doubao";`
  - 这样旧引用可继续工作，后续可逐步迁移至新路径。

## 主要环境变量

### Doubao / LLM

- `DOUBAO_API_BASE_URL`
- `TAL_MLOPS_APP_ID`
- `TAL_MLOPS_APP_KEY`
- `DOUBAO_MODEL`
- `DOUBAO_MAX_ATTEMPTS`
- `DOUBAO_RETRY_BASE_DELAY_MS`

### ASR

- `VOLCENGINE_ASR_API_URL`
- `VOLCENGINE_APP_ID`
- `VOLCENGINE_ACCESS_TOKEN`
- `VOLCENGINE_RESOURCE_ID`

### TTS

- `TTS_API_URL`
- `TTS_APP_ID`
- `TTS_TOKEN`
- `TTS_CLUSTER`
- `TTS_UID`
- `TTS_VOICE_TYPE`
- `TTS_ENCODING`
- `TTS_SPEED_RATIO`
- `TTS_RATE`

## 后续建议

- 若要进一步彻底集中，可将 `scripts` 下历史测试脚本逐步迁移到本目录（例如 `scripts/ai_api/tests`），并统一公共参数解析与日志格式。
