#!/usr/bin/env node

import { callDoubao, type ChatMessage } from "../scripts/ai_api/doubao";

interface TestProfile {
  name: string;
  description: string;
  systemPrompt: string;
  expectedResults: string[];
}

interface ChatTurn {
  user: string;
  assistant: string;
  analysis?: {
    mode: string;
    context: string;
  };
}

interface TestResult {
  profile: string;
  turns: ChatTurn[];
  passed: boolean;
  notes: string[];
}

const TEST_PROFILES: TestProfile[] = [
  {
    name: "一直说中文",
    description: "全程使用中文回复，不尝试说英文",
    systemPrompt: `你是一个测试用户，全程只用中文回复。不要说任何英文。假装你是一个刚开始学英语的孩子，只会说中文。`,
    expectedResults: [
      "开始正常聊天（中英混杂）",
      "之后引导跟读单词"
    ]
  },
  {
    name: "中英混杂",
    description: "混合使用中文和英文回复",
    systemPrompt: `你是一个测试用户，混合使用中文和英文回复。有时候说中文，有时候说简单的英文单词。`,
    expectedResults: [
      "正常聊天（中英混杂）",
      "继续追问话题"
    ]
  },
  {
    name: "英文简单词语回复",
    description: "只用简单的英文单词或短语回复",
    systemPrompt: `你是一个测试用户，只用简单的英文单词或短语回复。不要说完整的句子，只用1-2个单词回复。`,
    expectedResults: [
      "纯英文应答追问",
      "可以开启一些类似词语接龙的游戏"
    ]
  },
  {
    name: "英文完整句子交流",
    description: "使用完整的英文句子进行交流",
    systemPrompt: `你是一个测试用户，使用完整的英文句子进行交流。你的英语水平不错，可以进行正常的英文对话。`,
    expectedResults: [
      "AI 会自然提及自己合适的经历"
    ]
  }
];

async function simulateUserResponse(
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  profile: TestProfile
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: profile.systemPrompt },
    ...conversationHistory.map((m) => ({
      role: (m.role === "user" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    }))
  ];

  return await callDoubao(messages);
}

async function runTest(profile: TestProfile, maxTurns: number = 6): Promise<TestResult> {
  console.log(`\n========================================`);
  console.log(`🧪 测试画像: ${profile.name}`);
  console.log(`========================================\n`);

  const turns: ChatTurn[] = [];
  const notes: string[] = [];

  // 初始问候
  const initialMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: '你好！' }
  ];

  let conversationHistory = [...initialMessages];

  console.log(`👤 用户: 你好！`);

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n--- 第 ${i + 1} 轮 ---\n`);

    // 调用 Luna Talk API
    const lunaRes = await fetch('http://localhost:3000/api/luna_talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    if (!lunaRes.ok) {
      throw new Error(`API request failed: ${lunaRes.status}`);
    }

    const lunaData = await lunaRes.json();
    const lunaReply = lunaData.reply;
    const lunaAnalysis = lunaData.analysis;

    console.log(`🌙 Luna: ${lunaReply}`);
    if (lunaAnalysis) {
      console.log(`   [模式: ${lunaAnalysis.mode}, 内容: ${lunaAnalysis.context || '无'}]`);
    }

    // 记录这一轮
    turns.push({
      user: conversationHistory[conversationHistory.length - 1].content,
      assistant: lunaReply,
      analysis: lunaAnalysis
    });

    conversationHistory.push({ role: 'assistant', content: lunaReply });

    // 模拟用户回复（最后一轮不需要）
    if (i < maxTurns - 1) {
      const userReply = await simulateUserResponse(conversationHistory, profile);
      console.log(`\n👤 用户: ${userReply}`);
      conversationHistory.push({ role: 'user', content: userReply });
    }
  }

  // 简单评估
  const passed = turns.length >= 3;
  if (!passed) {
    notes.push("对话轮数不足");
  }

  return {
    profile: profile.name,
    turns,
    passed,
    notes
  };
}

async function main() {
  console.log('🌙 Luna Talk 自动测试');
  console.log('========================================\n');

  const results: TestResult[] = [];

  for (const profile of TEST_PROFILES) {
    try {
      const result = await runTest(profile);
      results.push(result);

      console.log(`\n✅ 测试完成: ${profile.name}`);
      console.log(`   结果: ${result.passed ? '通过' : '未通过'}`);
    } catch (error) {
      console.error(`\n❌ 测试失败: ${profile.name}`, error);
      results.push({
        profile: profile.name,
        turns: [],
        passed: false,
        notes: [`测试出错: ${error instanceof Error ? error.message : 'Unknown error'}`]
      });
    }

    // 测试之间暂停
    await new Promise(r => setTimeout(r, 1000));
  }

  // 输出总结
  console.log('\n\n========================================');
  console.log('📊 测试总结');
  console.log('========================================\n');

  for (const result of results) {
    console.log(`\n📋 ${result.profile}`);
    console.log(`   状态: ${result.passed ? '✅ 通过' : '❌ 未通过'}`);
    console.log(`   对话轮数: ${result.turns.length}`);
    if (result.notes.length > 0) {
      console.log(`   备注: ${result.notes.join(', ')}`);
    }
  }

  console.log('\n🎉 测试完成！');
}

// 检查是否直接运行
if (require.main === module) {
  main().catch(console.error);
}

export { runTest, TEST_PROFILES, type TestResult };
