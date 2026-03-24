/**
 * AI 语伴成长体系：根据孩子累计英文输出（轮次、词数）划分阶段，
 * 驱动对话提示词里「难度与脚手架」随阶段略升，避免一成不变的陪聊。
 */

export type CompanionGrowthStage = {
  id: "seedling" | "sprout" | "partner" | "star";
  /** 界面短标签 */
  label: string;
  /** 注入模型的行为提示（中文） */
  shortHint: string;
  tier: 0 | 1 | 2 | 3;
};

/** 由陪伴记忆推导；目前以「主动含英文的轮次」为主信号 */
export type CompanionGrowthInput = {
  totalEnglishTurns: number;
};

/** 以「主动说英文的轮次」为主阈值；词数用于同档内微调说明（可选扩展） */
const T1 = 5;
const T2 = 20;
const T3 = 50;

export function deriveCompanionGrowthStage(
  memory: CompanionGrowthInput
): CompanionGrowthStage {
  const t = memory.totalEnglishTurns;

  if (t < T1) {
    return {
      id: "seedling",
      label: "萌芽",
      tier: 0,
      shortHint:
        "孩子还在热身阶段：英文以超短句、单词级回应为主。你多用「半句英文 + 中文接一下」的脚手架，少抛长难句；多鼓励开口，不要评对错。",
    };
  }

  if (t < T2) {
    return {
      id: "sprout",
      label: "成长",
      tier: 1,
      shortHint:
        "孩子已能零星说英文：可逐渐把英文比例略提高，仍保持一句一义；可给简单跟读或替换词，但别像课文；接话要像朋友，别像老师检查作业。",
    };
  }

  if (t < T3) {
    return {
      id: "partner",
      label: "好搭档",
      tier: 2,
      shortHint:
        "孩子英文输出较稳定：你可以用稍完整的英文句接话，偶尔延伸一个新信息或小问题；减少重复示范同一句型；仍避免语法讲解与打分。",
    };
  }

  return {
    id: "star",
    label: "英语小达人",
    tier: 3,
    shortHint:
      "孩子已能较频繁用英文互动：你可以更像同龄好友聊天，英文可略长、话题可略展开；少用模板夸，多顺着具体内容接话；仍保持轻松、不考试感。",
  };
}
