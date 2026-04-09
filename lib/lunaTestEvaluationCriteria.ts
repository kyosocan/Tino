/** 与 tests/README.md 对齐：仅用于 /test 自动测试结束后的评估，不参与正常对话 */

export type LunaTestEvaluationResult = {
  summaryVerdict: "pass" | "partial" | "fail";
  score1to5: number;
  profileChecks: { criterion: string; met: boolean; evidence: string }[];
  traitChecks: { trait: string; observed: string; score: "good" | "ok" | "weak" }[];
  suggestions: string[];
};

export const LUNA_GLOBAL_TEST_TRAITS = [
  "自适应水平：根据用户英语水平调整回复难度",
  "AI 有自己的故事：能提及与 Luna 角色一致的生活经历",
  "会鼓励且夸得具体：表扬具体、少空泛模板",
  "内容丰富：话题多样、不死板",
  "单词→短句→长句：循序渐进的引导（若该轮少可减少要求）",
  "能跟进潮流或孩子话题：可对热点/游戏等自然接话（若未聊到可标 ok/weak）",
  "总结提升：适当总结或学习建议（轮数少时可弱化）",
] as const;

export type LunaProfileCriterion = {
  userBehavior: string;
  expectedOutcomes: string[];
};

export const LUNA_PROFILE_CRITERIA: Record<string, LunaProfileCriterion> = {
  一直说中文: {
    userBehavior: "全程使用中文回复，不尝试说英文",
    expectedOutcomes: [
      "开始阶段能正常中英混杂聊天",
      "后续能引导跟读或模仿简单英文单词",
      "给出孩子容易跟的短词/短句示例",
    ],
  },
  中英混杂: {
    userBehavior: "混合使用中文和英文回复",
    expectedOutcomes: [
      "能维持中英自然混合的对话",
      "顺着话题继续追问，保持互动",
      "适当给出可复用的英文表达建议",
    ],
  },
  英文简单词语回复: {
    userBehavior: "只用简单的英文单词或短语回复",
    expectedOutcomes: [
      "主要用英文接话、追问",
      "可尝试词语接龙等轻量游戏或练习",
      "鼓励孩子略多表达，但不施压",
    ],
  },
  英文完整句子交流: {
    userBehavior: "使用完整的英文句子进行交流",
    expectedOutcomes: [
      "Luna 能自然带出自己的经历（与角色一致）",
      "能进行稍深入的话题讨论",
      "适当提供更有难度的词汇或地道表达",
    ],
  },
};

export function getProfileCriteria(profileName: string): LunaProfileCriterion | null {
  return LUNA_PROFILE_CRITERIA[profileName] ?? null;
}
