"use client";

import React, { useState, useRef } from "react";
import type { LunaTestEvaluationResult } from "@/lib/lunaTestEvaluationCriteria";

type EvaluationState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; evaluation: LunaTestEvaluationResult }
  | { kind: "error"; message: string };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AnalysisResult {
  mode: string;
  context: string;
}

interface TestProfile {
  name: string;
  description: string;
  systemPrompt: string;
}

const TEST_PROFILES: TestProfile[] = [
  {
    name: "一直说中文",
    description: "全程使用中文回复，不尝试说英文",
    systemPrompt: `你是一个测试用户，全程只用中文回复。不要说任何英文。假装你是一个刚开始学英语的孩子，只会说中文。每次回复要自然，像真实聊天一样。`,
  },
  {
    name: "中英混杂",
    description: "混合使用中文和英文回复",
    systemPrompt: `你是一个测试用户，混合使用中文和英文回复。有时候说中文，有时候说简单的英文单词。回复要自然，像真实聊天一样。`,
  },
  {
    name: "英文简单词语回复",
    description: "只用简单的英文单词或短语回复",
    systemPrompt: `你是一个测试用户，只用简单的英文单词或短语回复。不要说完整的句子，只用1-3个单词回复。回复要自然。`,
  },
  {
    name: "英文完整句子交流",
    description: "使用完整的英文句子进行交流",
    systemPrompt: `你是一个测试用户，使用完整的英文句子进行交流。你的英语水平不错，可以进行正常的英文对话。回复要自然。`,
  },
];

export interface LunaTalkTestRunnerProps {
  /** 独立 /test 页使用：不占全屏遮罩，嵌入主布局 */
  fullPage?: boolean;
}

export default function LunaTalkTestRunner({ fullPage = false }: LunaTalkTestRunnerProps) {
  const [currentProfile, setCurrentProfile] = useState<TestProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [maxTurns, setMaxTurns] = useState(10);
  const [logs, setLogs] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationState>({ kind: "idle" });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const pickSimulatedFallback = (profile: TestProfile): string => {
    const fallbacks = {
      一直说中文: ["好的", "知道了", "哈哈", "是的", "对呀"],
      中英混杂: ["ok", "好的", "yes", "哈哈", "cool"],
      英文简单词语回复: ["ok", "yes", "no", "hi", "hello", "thanks"],
      英文完整句子交流: ["That's interesting!", "I see.", "Really?", "Cool!"],
    };
    const options = fallbacks[profile.name as keyof typeof fallbacks] || ["ok"];
    return options[Math.floor(Math.random() * options.length)];
  };

  const simulateUserResponse = async (
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
    profile: TestProfile
  ): Promise<string> => {
    try {
      const res = await fetch("/api/luna_talk/simulate_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationHistory,
          systemPrompt: profile.systemPrompt,
        }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };

      if (!res.ok) {
        console.warn("[simulate_user] 使用备用回复:", data.error ?? res.status);
        return pickSimulatedFallback(profile);
      }

      const reply = typeof data.reply === "string" ? data.reply.trim() : "";
      if (reply) return reply;
      return pickSimulatedFallback(profile);
    } catch (error) {
      console.warn("[simulate_user] 网络异常，使用备用回复:", error);
      return pickSimulatedFallback(profile);
    }
  };

  const sendToLuna = async (
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
    memorySandbox: string
  ): Promise<{ reply: string; analysis: AnalysisResult }> => {
    const res = await fetch("/api/luna_talk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory, memorySandbox }),
    });

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status}`);
    }

    const data = await res.json();
    return {
      reply: data.reply,
      analysis: data.analysis ?? { mode: "—", context: "" },
    };
  };

  const runOutcomeEvaluation = async (
    profile: TestProfile,
    transcript: Array<{ role: "user" | "assistant"; content: string }>
  ) => {
    setEvaluation({ kind: "loading" });
    try {
      const res = await fetch("/api/luna_talk/evaluate_test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileName: profile.name, transcript }),
      });
      const data = (await res.json()) as { evaluation?: LunaTestEvaluationResult; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `评估请求失败 ${res.status}`);
      }
      if (!data.evaluation) {
        throw new Error("响应缺少 evaluation");
      }
      setEvaluation({ kind: "ok", evaluation: data.evaluation });
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 📋 对话效果评估已完成`]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEvaluation({ kind: "error", message: msg });
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] 📋 评估失败: ${msg}`]);
    }
  };

  const startTest = async (profile: TestProfile) => {
    setCurrentProfile(profile);
    setMessages([]);
    setIsRunning(true);
    setCurrentTurn(0);
    setLogs([]);
    setEvaluation({ kind: "idle" });
    const profileIdx = TEST_PROFILES.findIndex((p) => p.name === profile.name);
    const memorySandbox = `p${Math.max(0, profileIdx)}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    addLog(`开始测试: ${profile.name}`);
    addLog(`描述: ${profile.description}`);
    addLog(`记忆沙箱: ${memorySandbox}（空记忆起跑，不影响普通对话）`);

    const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

    const firstUserMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: "你好！",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, firstUserMsg]);
    conversationHistory.push({ role: "user", content: "你好！" });
    addLog(`👤 用户: 你好！`);

    let abortedByError = false;

    for (let i = 0; i < maxTurns; i++) {
      setCurrentTurn(i + 1);
      addLog(`--- 第 ${i + 1} 轮 ---`);

      try {
        const lunaResult = await sendToLuna(conversationHistory, memorySandbox);

        const lunaMsg: ChatMessage = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: lunaResult.reply,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, lunaMsg]);
        conversationHistory.push({ role: "assistant", content: lunaResult.reply });
        addLog(`🌙 Luna: ${lunaResult.reply}`);
        addLog(
          `   [模式: ${lunaResult.analysis.mode}, 内容: ${lunaResult.analysis.context || "无"}]`
        );

        if (i < maxTurns - 1) {
          await new Promise((r) => setTimeout(r, 1000));

          const userReply = await simulateUserResponse(conversationHistory, profile);
          const userMsg: ChatMessage = {
            id: `user-${Date.now()}`,
            role: "user",
            content: userReply,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, userMsg]);
          conversationHistory.push({ role: "user", content: userReply });
          addLog(`👤 用户: ${userReply}`);
        }
      } catch (error) {
        abortedByError = true;
        addLog(`❌ 错误: ${error instanceof Error ? error.message : "Unknown error"}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    addLog(`✅ 测试完成: ${profile.name}`);
    setIsRunning(false);

    if (!abortedByError && conversationHistory.length >= 2) {
      addLog(`⏳ 正在生成对话效果评估（对照测试目标）…`);
      void runOutcomeEvaluation(profile, [...conversationHistory]);
    }
  };

  const stopTest = () => {
    setIsRunning(false);
    addLog(`⏹️ 测试已停止`);
  };

  const clearAll = () => {
    setMessages([]);
    setLogs([]);
    setCurrentProfile(null);
    setCurrentTurn(0);
    setEvaluation({ kind: "idle" });
  };

  return (
    <div
      className={
        fullPage
          ? "flex-1 w-full min-h-0 flex items-center justify-center p-2 sm:p-4"
          : "fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      }
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full flex flex-col ${
          fullPage
            ? "max-w-7xl h-[min(90dvh,calc(100dvh-4.5rem))]"
            : "max-w-5xl h-[90vh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 flex items-center justify-between shrink-0 rounded-t-2xl">
          <h2 className="text-lg font-bold flex items-center gap-2">🧪 Luna Talk 自动测试</h2>
          <button
            onClick={clearAll}
            className="px-3 py-1 bg-red-500 hover:bg-red-400 rounded-md text-sm"
          >
            清空
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0 rounded-b-2xl">
          <div className="w-64 bg-gray-50 border-r border-gray-200 p-4 flex flex-col shrink-0 overflow-y-auto">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">测试画像</h3>
              <div className="space-y-2">
                {TEST_PROFILES.map((profile) => (
                  <button
                    key={profile.name}
                    onClick={() => !isRunning && startTest(profile)}
                    disabled={isRunning}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      currentProfile?.name === profile.name
                        ? "bg-purple-100 text-purple-800 border border-purple-300"
                        : "bg-white hover:bg-gray-100 text-gray-700 border border-gray-200"
                    } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className="font-medium">{profile.name}</div>
                    <div className="text-gray-500 mt-1">{profile.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                对话轮数: {maxTurns}
              </label>
              <input
                type="range"
                min={3}
                max={15}
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                disabled={isRunning}
                className="w-full"
              />
            </div>

            {isRunning && (
              <div className="mb-4">
                <div className="text-sm font-semibold text-gray-700 mb-2">
                  进度: {currentTurn}/{maxTurns}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all"
                    style={{ width: `${(currentTurn / maxTurns) * 100}%` }}
                  />
                </div>
                <button
                  onClick={stopTest}
                  className="mt-2 w-full px-3 py-2 bg-red-500 hover:bg-red-400 text-white rounded-md text-sm"
                >
                  停止测试
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col bg-white min-w-0 min-h-0">
            <div className="p-3 border-b border-gray-200 bg-gray-50 shrink-0">
              <h3 className="text-sm font-semibold text-gray-700">
                {currentProfile ? `测试: ${currentProfile.name}` : "选择测试画像开始"}
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 min-h-0">
              {messages.length === 0 ? (
                <div className="text-center text-gray-400 mt-20">
                  <div className="text-4xl mb-4">🧪</div>
                  <p className="text-sm">选择左侧的测试画像开始</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === "user";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                          isUser
                            ? "bg-green-500 text-white rounded-tr-none"
                            : "bg-white text-gray-800 rounded-tl-none border border-gray-200"
                        }`}
                      >
                        <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                        <div
                          className={`text-xs mt-1 ${isUser ? "text-green-100" : "text-gray-400"} text-right`}
                        >
                          {msg.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {isRunning && (
                <div className="flex justify-start">
                  <div className="bg-white text-gray-800 rounded-2xl rounded-tl-none border border-gray-200 px-4 py-3 shadow-sm">
                    <div className="flex gap-1.5 items-center">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: `${i * 150}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="w-80 bg-gray-900 text-gray-100 flex flex-col shrink-0 min-h-0 h-full border-l border-gray-700">
            <div className="p-3 border-b border-gray-700 shrink-0">
              <h3 className="text-sm font-semibold">执行日志</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 text-xs font-mono space-y-1 border-b border-gray-700">
              {logs.map((log, i) => (
                <div key={i} className="text-gray-300 break-words">
                  {log}
                </div>
              ))}
              {logs.length === 0 && <div className="text-gray-500">等待测试开始...</div>}
            </div>
            <div className="shrink-0 px-2 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              对话效果评估（仅自动测试）
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 text-xs leading-relaxed">
              {evaluation.kind === "idle" && (
                <p className="text-gray-500">
                  一轮完整测试结束后，将对照「测试画像」预期与产品特性自动生成评估；正常聊天不受影响。
                </p>
              )}
              {evaluation.kind === "loading" && (
                <p className="text-amber-200/90 animate-pulse">正在分析对话是否符合测试目标…</p>
              )}
              {evaluation.kind === "error" && (
                <p className="text-red-300">评估失败：{evaluation.message}</p>
              )}
              {evaluation.kind === "ok" && (
                <div className="space-y-3 text-gray-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        evaluation.evaluation.summaryVerdict === "pass"
                          ? "px-2 py-0.5 rounded bg-green-800 text-green-100"
                          : evaluation.evaluation.summaryVerdict === "partial"
                            ? "px-2 py-0.5 rounded bg-amber-800 text-amber-100"
                            : "px-2 py-0.5 rounded bg-red-900/80 text-red-100"
                      }
                    >
                      {evaluation.evaluation.summaryVerdict === "pass"
                        ? "总体：通过"
                        : evaluation.evaluation.summaryVerdict === "partial"
                          ? "总体：部分符合"
                          : "总体：未达预期"}
                    </span>
                    <span className="text-gray-400">
                      综合分 {evaluation.evaluation.score1to5}/5
                    </span>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-1">画像预期</div>
                    <ul className="space-y-1 pl-1">
                      {evaluation.evaluation.profileChecks.map((c, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className={c.met ? "text-green-400" : "text-red-400"}>
                            {c.met ? "✓" : "✗"}
                          </span>
                          <span>
                            {c.criterion}
                            {c.evidence ? (
                              <span className="text-gray-500 block text-[11px] mt-0.5">
                                依据：{c.evidence}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-gray-400 mb-1">全局特性</div>
                    <ul className="space-y-1 pl-1">
                      {evaluation.evaluation.traitChecks.map((t, i) => (
                        <li key={i}>
                          <span className="text-gray-300">{t.trait}</span>{" "}
                          <span
                            className={
                              t.score === "good"
                                ? "text-green-400"
                                : t.score === "ok"
                                  ? "text-gray-400"
                                  : "text-orange-300"
                            }
                          >
                            [{t.score}]
                          </span>
                          {t.observed ? (
                            <div className="text-gray-500 text-[11px] mt-0.5">{t.observed}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {evaluation.evaluation.suggestions.length > 0 && (
                    <div>
                      <div className="text-gray-400 mb-1">建议</div>
                      <ul className="list-disc list-inside text-gray-300 space-y-0.5">
                        {evaluation.evaluation.suggestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
