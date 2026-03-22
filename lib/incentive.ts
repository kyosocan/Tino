import type { CSSProperties } from "react";

/**
 * 装扮（作用于用户角色立绘：滤镜 + 可选装饰 + 光环）
 * 与「头像框」独立：头像框为环形边框；装扮为角色整体风格与贴图。
 */
export type OutfitDef = {
  id: string;
  name: string;
  price: number;
  /** 对 Image 的 CSS filter（全屏立绘时微调色调） */
  imgFilter?: string;
  /** 小预览/头像上的描边（可与头像框叠加） */
  ringStyle?: CSSProperties;
  /** 头顶小装饰（emoji，避免额外素材） */
  badge?: string;
};

export const OUTFITS: OutfitDef[] = [
  {
    id: "default",
    name: "默认",
    price: 0,
  },
  {
    id: "sunset",
    name: "小太阳",
    price: 60,
    imgFilter: "brightness(1.06) saturate(1.18) hue-rotate(-12deg)",
    ringStyle: { border: "3px solid #fb923c", boxShadow: "0 0 10px rgba(251,146,60,0.45)" },
    badge: "☀️",
  },
  {
    id: "ocean",
    name: "海洋",
    price: 90,
    imgFilter: "brightness(1.04) saturate(1.12) hue-rotate(175deg)",
    ringStyle: { border: "3px solid #38bdf8", boxShadow: "0 0 10px rgba(56,189,248,0.5)" },
    badge: "🌊",
  },
  {
    id: "forest",
    name: "森友",
    price: 120,
    imgFilter: "brightness(1.05) saturate(1.2) hue-rotate(85deg)",
    ringStyle: { border: "3px solid #4ade80", boxShadow: "0 0 10px rgba(74,222,128,0.45)" },
    badge: "🌿",
  },
  {
    id: "star",
    name: "星光",
    price: 180,
    imgFilter: "brightness(1.08) saturate(1.15)",
    ringStyle: {
      border: "3px solid #c084fc",
      boxShadow: "0 0 14px rgba(192,132,252,0.9), 0 0 28px rgba(147,112,219,0.35)",
    },
    badge: "✨",
  },
  {
    id: "explorer",
    name: "探险家",
    price: 260,
    imgFilter: "brightness(1.06) saturate(1.1) hue-rotate(15deg)",
    ringStyle: { border: "3px solid #f59e0b", boxShadow: "0 0 12px rgba(245,158,11,0.55)" },
    badge: "🧢",
  },
] as const;

export function getOutfit(id: string): OutfitDef {
  return OUTFITS.find((o) => o.id === id) ?? OUTFITS[0]!;
}
