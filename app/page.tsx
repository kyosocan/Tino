"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import DeviceFrame from "@/components/DeviceFrame";
import TinoAvatar from "@/components/TinoAvatar";
import TestChatPanel from "@/components/TestChatPanel";
import tinoPortrait from "@/scripts/ai_api/人物像.png";
import portraitUser from "@/scripts/ai_api/User1.png";
import portraitPartner from "@/scripts/ai_api/partner2.png";
import portraitBuddy from "@/scripts/ai_api/partner1.png";
import type {
  Message,
  AppMode,
  RoomPartner,
  MessageSender,
} from "@/lib/types";
import { OUTFITS, getOutfit, type OutfitDef } from "@/lib/incentive";
import { isEnglishOnlyBottleContent } from "@/lib/bottleValidation";
import {
  deriveCompanionGrowthStage,
  type CompanionGrowthStage,
} from "@/lib/companionGrowth";

/* ───────── constants ───────── */

/** Split a complete text into individual sentences for sentence-by-sentence TTS.
 *
 * Rules:
 *  1. Always split on \n (newline = natural pause boundary).
 *  2. Line contains Chinese  → split only on Chinese punctuation 。！？
 *     (avoids splitting "How are you?" inside a Chinese sentence)
 *  3. Pure-English line      → split on .!? only when followed by
 *     space + uppercase letter, or at end of string.
 */
function splitIntoSentences(text: string): string[] {
  const results: string[] = [];

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hasChinese = /[\u4e00-\u9fff]/.test(line);

    if (hasChinese) {
      /* Chinese / mixed: split only on Chinese sentence-ending punctuation */
      const chunks = line.split(/([。！？]+)/);
      for (let i = 0; i < chunks.length; i += 2) {
        const combined = ((chunks[i] ?? "") + (chunks[i + 1] ?? "")).trim();
        if (combined) results.push(combined);
      }
    } else {
      /* Pure English: split on .!? when followed by space+uppercase or end */
      let current = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        current += ch;
        if (/[.!?]/.test(ch)) {
          const next = line[i + 1] ?? "";
          const afterNext = line[i + 2] ?? "";
          const atEnd = !next;
          const beforeNewSentence = next === " " && /[A-Z]/.test(afterNext);
          if (atEnd || beforeNewSentence) {
            if (current.trim()) results.push(current.trim());
            current = "";
            if (next === " ") i++; // skip the separating space
          }
        }
      }
      if (current.trim()) results.push(current.trim());
    }
  }

  return results.length > 0 ? results : text.trim() ? [text.trim()] : [];
}

/* First-visit onboarding messages delivered in sequence.
 * Only the first two steps are timer-driven.
 * After step 2: 跟读卡片出现；跟读完成或关闭卡片后，再播「摇一摇匹配其他小朋友」引导。 */
const ONBOARDING_STEPS = [
  { delay: 1500, text: "我是 Tino，你的英语聊天小伙伴！\n我们可以一起聊天、玩游戏，还能认识新朋友～" },
  { delay: 6500, text: "遇到新朋友就可以说这句话：Nice to meet you！" },
];

const ROOM_DURATION = 300;
/** 聊天室：一方久未接话后，Tino 冷场引导 */
const ROOM_SILENCE_MS = 10_000;
const ROOM_SILENCE_POLL_MS = 3000;

/** 英语角：对方 AI 伙伴（ai_buddy）TTS 音色 */
const TTS_VOICE_AI_BUDDY = "zh_female_xiaoxue_uranus_bigtts";
/** 英语角：AI 替补小朋友（friend，仅 isAiRoom）TTS 音色 */
const TTS_VOICE_AI_CHILD = "zh_female_peiqi_uranus_bigtts";

function ttsCacheKey(text: string, voiceType: string | undefined): string {
  return `${voiceType ?? "default"}|${text}`;
}

function formatFriendLastChatTime(timestamp: number): string {
  if (!timestamp) return "最近";
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < 10 * minute) return "刚刚";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} 小时前`;
  if (diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))} 天前`;

  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd} 聊过`;
}

const GLOW: Record<string, string> = {
  tino: "rgba(255,140,66,0.7)",
  user: "rgba(126,200,227,0.7)",
  friend: "rgba(168,213,186,0.7)",
};

type CompanionMemory = {
  memories: string[];
  totalMessages: number;
  totalEnglishTurns: number;
  totalChineseTurns: number;
  totalQuestionTurns: number;
  totalEnglishWords: number;
  lastUpdatedAt: number;
};

/* ───────── helpers ───────── */

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/** 聊天室用户发言：道别/不想聊了，或主动要加好友 → 弹出加好友确认（与结束时同一套逻辑） */
function detectRoomFriendInviteTrigger(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (
    /再见|拜拜|回见|不聊了|不想聊|先下了|先这样|下次(再)?聊|不玩了|我走啦|溜了|先撤|有缘再会|下次见|有空再聊|先走|下线|886|拜拜啦|再见啦|先不聊|先告辞|告辞了|不打扰了|不聊啦|先撤了|撤了|晚安啦|晚安|see\s*you|talk\s*later|bye\b|goodbye|gotta\s*go|\bgtg\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/加好友|加你好友|加个好友|加一下好友|想加你|我们加好友|做个朋友|交个朋友|加个联系人|add\s*(me\s*)?as\s*(a\s*)?friend|be\s*friends|let'?s\s*be\s*friends|friend\s*me|add\s*friend/i.test(t)) {
    return true;
  }
  return false;
}

/** 中文与英文发音相同/极相近的常用词，直接采用英文，不弹翻译框、不要求用户再说英文 */
const SAME_PRONUNCIATION_MAP: Record<string, string> = {
  "嗨": "Hi",
  "嗨。": "Hi",
  "哈喽": "Hello",
  "哈啰": "Hello",
  "拜拜": "Bye bye",
  "拜拜。": "Bye bye",
  "酷": "Cool",
};

function normalizeForPronunciationLookup(text: string): string {
  return text.replace(/[。！？\s]+$/g, "").trim();
}

/** 若整句是「中英同音」词，返回对应英文；否则返回 null */
function getEnglishIfSamePronunciation(text: string): string | null {
  const normalized = normalizeForPronunciationLookup(text);
  return SAME_PRONUNCIATION_MAP[normalized] ?? null;
}

/** 极常见词：仍按长度计基础分，但不计「生词」额外分 */
const ENGLISH_POINTS_STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "am", "be", "been", "was", "were",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "her", "its", "our", "their",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as",
  "do", "does", "did", "have", "has", "had",
  "no", "yes", "ok", "okay", "oh", "so", "and", "or", "but", "not",
  "hi", "hey", "hello", "bye", "byebye", "thanks", "thank",
]);

function scoreEnglishTurn(
  text: string,
  seenWords: Set<string>
): { points: number; novelCount: number } {
  const words = text.match(/[a-zA-Z]{2,}/g) || [];
  if (words.length === 0) return { points: 0, novelCount: 0 };

  let points = 0;
  let novelCount = 0;

  for (const raw of words) {
    const w = raw.toLowerCase();
    const base = raw.length <= 3 ? 1 : raw.length <= 6 ? 2 : 3;
    points += base;

    if (!seenWords.has(w)) {
      seenWords.add(w);
      if (!ENGLISH_POINTS_STOPWORDS.has(w)) {
        novelCount += 1;
        points += 4;
      }
    }
  }

  if (/[A-Z][a-z].*\s[a-z]/.test(text) && words.length >= 3) points += 2;

  return { points, novelCount };
}

function generateUserId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyCompanionMemory(): CompanionMemory {
  return {
    memories: [],
    totalMessages: 0,
    totalEnglishTurns: 0,
    totalChineseTurns: 0,
    totalQuestionTurns: 0,
    totalEnglishWords: 0,
    lastUpdatedAt: 0,
  };
}

function getCompanionMemoryKey(name: string, grade: number): string {
  return `tino_companion_memory_${name.trim()}_${grade}`;
}

/** 每次刷新都从零开始：清空所有已保存的同伴记忆键 */
function clearAllCompanionMemoryStorage(): void {
  try {
    if (typeof localStorage === "undefined") return;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("tino_companion_memory_")) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

function persistCompanionMemory(
  name: string,
  grade: number,
  memory: CompanionMemory
) {
  try {
    localStorage.setItem(
      getCompanionMemoryKey(name, grade),
      JSON.stringify(memory)
    );
  } catch {
    /* storage unavailable */
  }
}

function normalizeMemoryText(text: string): string {
  return text
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[。！？!?，,；;：:]+$/g, "")
    .trim();
}

const INVALID_ENGLISH_MEMORY_TOPICS = new Set([
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "this",
  "that",
  "these",
  "those",
  "someone",
  "somebody",
  "anyone",
  "anybody",
  "everyone",
  "everybody",
  "something",
  "anything",
  "nothing",
  "everything",
]);

function isQuestionLikeMemory(text: string): boolean {
  if (!text) return true;
  if ((text.match(/[?？]/g) || []).length > 0) return true;
  return /(什么|怎么|为什么|吗|呢|是不是|可不可以|能不能|刚才|听懂|意思|问的是什么|在干嘛)/.test(
    text
  );
}

function isValidPreferenceTopic(topic: string): boolean {
  if (!topic) return false;

  const lower = topic.toLowerCase();
  if (INVALID_ENGLISH_MEMORY_TOPICS.has(lower)) return false;
  if (/^(这个|那个|这些|那些|这个东西|那个东西|事情|东西|问题|内容)$/.test(topic)) {
    return false;
  }

  const englishWords = lower.match(/[a-z]+/g) || [];
  if (englishWords.length > 0) {
    if (englishWords.length > 3) return false;
    if (englishWords.some((word) => INVALID_ENGLISH_MEMORY_TOPICS.has(word))) {
      return false;
    }
  }

  return true;
}

function normalizePreferenceTopic(rawTopic: string): string | null {
  const topic = normalizeMemoryText(rawTopic)
    .replace(/^(是|就是|都?是|特别是|最喜欢|喜欢|爱|最爱)/, "")
    .replace(/^(一个|一些|那个|这个)/, "")
    .replace(/^(a|an|the|my|your|his|her|our|their)\s+/i, "")
    .replace(/\s+(very much|a lot|so much|too)$/i, "")
    .replace(/(呀|啊|啦|呢|哦)+$/g, "")
    .trim();

  if (!topic || topic.length < 2 || topic.length > 20) return null;
  if (isQuestionLikeMemory(topic)) return null;
  if (!isValidPreferenceTopic(topic)) return null;
  return topic;
}

function toPreferenceMemory(text: string): string | null {
  const cleaned = normalizeMemoryText(text);
  if (!cleaned || isQuestionLikeMemory(cleaned)) return null;

  const zhLikeMatch = cleaned.match(
    /(我最喜欢|我喜欢|我最爱|我爱|我的爱好是|我平时喜欢|我特别喜欢)([^，。！？!?]{1,20})/
  );
  if (zhLikeMatch) {
    const topic = normalizePreferenceTopic(zhLikeMatch[2]);
    if (topic) return `你喜欢${topic}`;
  }

  const enLikeMatch = cleaned.match(
    /\b(?:i like|i love|my favorite(?:\s+\w+)? is)\s+([a-z][a-z\s]{0,24})/i
  );
  if (enLikeMatch) {
    const topic = normalizePreferenceTopic(enLikeMatch[1]);
    if (topic) return `你喜欢${topic}`;
  }

  if (/^你喜欢/.test(cleaned) && !isQuestionLikeMemory(cleaned)) {
    const topic = normalizePreferenceTopic(cleaned.replace(/^你喜欢/, ""));
    if (topic) return `你喜欢${topic}`;
  }

  return null;
}

function pickMemorySnippet(text: string): string | null {
  return toPreferenceMemory(text);
}

function updateCompanionMemory(
  prev: CompanionMemory,
  text: string
): CompanionMemory {
  const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
  const hasEnglish = englishWords.length > 0;
  const hasChinese = containsChinese(text);
  const hasQuestion = /[?？]/.test(text);
  const snippet = pickMemorySnippet(text);
  const nextMemories = snippet
    ? [snippet, ...prev.memories.filter((item) => item !== snippet)].slice(0, 6)
    : prev.memories;

  return {
    memories: nextMemories,
    totalMessages: prev.totalMessages + 1,
    totalEnglishTurns: prev.totalEnglishTurns + (hasEnglish ? 1 : 0),
    totalChineseTurns: prev.totalChineseTurns + (hasChinese ? 1 : 0),
    totalQuestionTurns: prev.totalQuestionTurns + (hasQuestion ? 1 : 0),
    totalEnglishWords: prev.totalEnglishWords + englishWords.length,
    lastUpdatedAt: Date.now(),
  };
}

function deriveWeaknessNotes(memory: CompanionMemory): string[] {
  if (memory.totalMessages === 0) return [];

  const notes: string[] = [];
  const englishRatio =
    memory.totalMessages > 0
      ? memory.totalEnglishTurns / memory.totalMessages
      : 0;
  const avgEnglishWords =
    memory.totalEnglishTurns > 0
      ? memory.totalEnglishWords / memory.totalEnglishTurns
      : 0;
  const questionRatio =
    memory.totalMessages > 0
      ? memory.totalQuestionTurns / memory.totalMessages
      : 0;

  if (memory.totalEnglishTurns === 0 || englishRatio < 0.35) {
    notes.push("还不太敢主动连续说英文，可以多给打招呼和自我介绍的句型支架。");
  }
  if (memory.totalEnglishTurns > 0 && avgEnglishWords < 4) {
    notes.push("英文表达偏短，可以多引导 ta 用完整句子表达想法。");
  }
  if (questionRatio < 0.18) {
    notes.push("不太主动提问，可以多示范 How/What/Do you like... 这类问句。");
  }

  return notes.slice(0, 2);
}

function buildCompanionGreeting(
  name: string,
  memory: CompanionMemory
): string {
  const isFirstVisit = memory.totalMessages === 0;

  if (isFirstVisit) {
    return `嗨，${name}！`;
  }

  const remembered = memory.memories[0];
  if (remembered && remembered.startsWith("你喜欢")) {
    const topic = remembered.replace(/^你喜欢/, "").trim();
    if (topic) {
      return `嗨，${name}！\n上次聊到你喜欢${topic}，今天继续？`;
    }
  }

  return `嗨，${name}！\n今天过得怎么样？`;
}

function extractPromptHeadline(line: string): string {
  return line
    .replace(/^(先试试这句|试着这样开场|先说这一句|今天可以这样开头|开头可以说|想不到说什么时，就先说)[：:]\s*/u, "")
    .trim();
}

/* ───────── component ───────── */

export default function Home() {
  /* device */
  const [isPowered, setIsPowered] = useState(true);
  const [volume, setVolume] = useState(5);
  const [showVolume, setShowVolume] = useState(false);

  /* user profile */
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [userGrade, setUserGrade] = useState(0);

  /* mode */
  const [mode, setMode] = useState<AppMode>("companion");
  const modeRef = useRef<AppMode>("companion");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  /* partner (real person) */
  const [partner, setPartner] = useState<RoomPartner | null>(null);
  const partnerRef = useRef<RoomPartner | null>(null);
  useEffect(() => { partnerRef.current = partner; }, [partner]);
  const [roomId, setRoomId] = useState("");

  /* chat context */
  /* NOTE: displayText and companionMsgs start empty to avoid SSR/client hydration
     mismatch from Math.random() in pickInitialGreeting. The init useEffect fills them. */
  const [companionMsgs, setCompanionMsgs] = useState<Message[]>([]);
  const [roomMsgs, setRoomMsgs] = useState<Message[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);
  const companionMemoryRef = useRef<CompanionMemory>(createEmptyCompanionMemory());
  const [companionGrowth, setCompanionGrowth] = useState<CompanionGrowthStage>(
    () => deriveCompanionGrowthStage(createEmptyCompanionMemory())
  );

  /* splash / app ready */
  const [isAppReady, setIsAppReady] = useState(false);

  /* companion display */
  const [displayText, setDisplayText] = useState("");
  const [showOnboardingReadingCard, setShowOnboardingReadingCard] = useState(false);
  const onboardingReadingCardRef = useRef(false);

  /* recording */
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  useEffect(() => {
    if (!recordingError) return;
    const t = setTimeout(() => setRecordingError(""), 3500);
    return () => clearTimeout(t);
  }, [recordingError]);



  /* AI room */
  const [isAiRoom, setIsAiRoom] = useState(false);
  const isAiRoomRef = useRef(false);
  useEffect(() => { isAiRoomRef.current = isAiRoom; }, [isAiRoom]);

  /* room chat UI */
  const [roomTopic] = useState("");
  const [icebreakerDone, setIcebreakerDone] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const [aiBuddyName, setAiBuddyName] = useState("");
  const roomBottomRef = useRef<HTMLDivElement>(null);

  /* room message card navigation (0 = show latest) */
  const [roomViewOffset, setRoomViewOffset] = useState(0);
  const [roomTranslations, setRoomTranslations] = useState<Record<string, string>>({});

  /* post-room debrief */
  const pendingDebriefRef = useRef<string[] | null>(null);
  /** fetchDebrief 异步写入 pending 后递增，驱动复盘 effect 在数据就绪时再跑 */
  const [debriefVersion, setDebriefVersion] = useState(0);

  /* room */
  const [timeLeft, setTimeLeft] = useState(ROOM_DURATION);
  const [englishCount, setEnglishCount] = useState(0);
  const [roomDisplay, setRoomDisplay] = useState<{ sender: string; content: string } | null>(null);
  const [sessionDiamonds, setSessionDiamonds] = useState(0);
  const endedRef = useRef(false);

  /* room polling */
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const lastPollTimeRef = useRef(0);
  const seenMsgIds = useRef(new Set<string>());

  /* match polling */
  const matchPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /* matching UI phase: "waiting" | "ai_found" */
  const [matchingPhase, setMatchingPhase] = useState<"waiting" | "ai_found">("waiting");

  /* room messages ref (for AI room callbacks) */
  const roomMsgsRef = useRef<Message[]>([]);
  useEffect(() => { roomMsgsRef.current = roomMsgs; }, [roomMsgs]);

  const roomSilenceTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  /** 已对某条「最后非 Tino 的用户/同伴消息」做过冷场引导 */
  const roomSilenceBasisMsgIdRef = useRef<string | null>(null);
  const roomSilenceInFlightRef = useRef(false);

  /* translation popup */

  /* exit confirmation */
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    if (!showExitConfirm) return;
    const t = setTimeout(() => setShowExitConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [showExitConfirm]);

  /* friends list */
  type FriendRecord = { name: string; grade: number; lastChatAt: number };
  const [friendsList, setFriendsList] = useState<FriendRecord[]>([]);
  const [showFriendsList, setShowFriendsList] = useState(false);
  /** 聊天结束或用户说「再见/加好友」等时询问是否加好友（含 AI 替补房） */
  const [friendInvitePartner, setFriendInvitePartner] = useState<RoomPartner | null>(
    null
  );
  /** 本局是否已弹出过加好友（避免道别 + 退出房间连弹两次） */
  const friendInvitePromptShownRef = useRef(false);
  /** 好友语音留言：独立轻量流程（录音→识别→本地展示），不进语音房 */
  type FriendVoiceMemo = { name: string; grade: number; emoji: string; avatarColor: string };
  const [friendVoiceMemo, setFriendVoiceMemo] = useState<FriendVoiceMemo | null>(null);
  const [friendVoiceMemoResult, setFriendVoiceMemoResult] = useState<string | null>(null);
  const friendVoiceMemoRef = useRef<{ name: string; grade: number } | null>(null);
  useEffect(() => {
    friendVoiceMemoRef.current = friendVoiceMemo
      ? { name: friendVoiceMemo.name, grade: friendVoiceMemo.grade }
      : null;
  }, [friendVoiceMemo]);

  /* drift bottle */
  type BottleSubState =
    | "menu"
    | "throw_input"
    | "throwing"
    | "throw_done"
    | "picking"
    | "picked"
    | "replying"
    | "reply_done"
    | "inbox";
  type PickedBottleData = {
    id: string;
    senderName: string;
    senderGrade: number;
    content: string;
    audioBase64?: string;
    mimeType?: string;
  };
  type InboxBottleData = {
    id: string;
    content: string;
    reply: { content: string; repliedByName: string; repliedAt: number };
  };
  const [bottleSubState, setBottleSubState] =
    useState<BottleSubState>("menu");
  const bottleSubStateRef = useRef<BottleSubState>("menu");
  useEffect(() => { bottleSubStateRef.current = bottleSubState; }, [bottleSubState]);
  const [bottleInput, setBottleInput] = useState("");
  const [bottleAudioBase64, setBottleAudioBase64] = useState("");
  const [bottleAudioMime, setBottleAudioMime] = useState("");
  const [bottleReplyInput, setBottleReplyInput] = useState("");
  const [pickedBottle, setPickedBottle] = useState<PickedBottleData | null>(
    null
  );
  const [bottleInbox, setBottleInbox] = useState<InboxBottleData[]>([]);
  const [bottleLoading, setBottleLoading] = useState(false);
  const [bottleInboxUnread, setBottleInboxUnread] = useState(0);
  const [bottleThrowError, setBottleThrowError] = useState<string | null>(null);

  /* 积分 + 装扮 */
  const [diamonds, setDiamonds] = useState(0);
  const [diamondDelta, setDiamondDelta] = useState<number | null>(null);
  /** 每次加积分 +1，用于重播轻提示动画 */
  const [pointsHintKey, setPointsHintKey] = useState(0);
  /** 本会话内已出现过的英文词，用于「生词」额外加分（仅计一次） */
  const englishWordSeenForPointsRef = useRef<Set<string>>(new Set());
  const [ownedOutfits, setOwnedOutfits] = useState<string[]>(["default"]);
  const [activeOutfit, setActiveOutfit] = useState("default");

  useEffect(() => {
    try {
      const d = localStorage.getItem("tino_diamonds");
      if (d) setDiamonds(Number(d));
      const oo = localStorage.getItem("tino_owned_outfits");
      if (oo) {
        try {
          const parsed = JSON.parse(oo) as string[];
          if (Array.isArray(parsed) && parsed.length > 0) setOwnedOutfits(parsed);
        } catch { /* ignore */ }
      }
      const ao = localStorage.getItem("tino_active_outfit");
      if (ao) setActiveOutfit(ao);
      const fl = localStorage.getItem("tino_friends_list");
      if (fl) setFriendsList(JSON.parse(fl));

      localStorage.removeItem("tino_user_id");
      clearAllCompanionMemoryStorage();
      try {
        sessionStorage.removeItem("tino_user_id");
      } catch {
        /* ignore */
      }
      const name = "小明";
      const grade = 1;
      const memory = createEmptyCompanionMemory();
      const sessionUserId = generateUserId();
      const greeting = buildCompanionGreeting(name, memory);
      sessionStorage.setItem("tino_user_id", sessionUserId);
      localStorage.setItem("tino_user_name", name);
      localStorage.setItem("tino_user_grade", String(grade));
      setUserId(sessionUserId);
      setUserName(name);
      setUserGrade(grade);
      companionMemoryRef.current = memory;
      setCompanionGrowth(deriveCompanionGrowthStage(memory));
      setDisplayText(greeting);
      setCompanionMsgs([
        { id: "g", sender: "tino", content: greeting, timestamp: Date.now() },
      ]);
      setMode("companion");
    } catch { /* SSR or unavailable */ }
  }, []);

  const notifyMatchLeave = useCallback(
    (uid: string, preferBeacon = false) => {
      if (!uid) return;

      const payload = JSON.stringify({ action: "leave", userId: uid });

      if (
        preferBeacon &&
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
      ) {
        try {
          const ok = navigator.sendBeacon(
            "/api/match",
            new Blob([payload], { type: "application/json" })
          );
          if (ok) return;
        } catch {
          /* beacon unavailable */
        }
      }

      fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: preferBeacon,
      }).catch(() => {});
    },
    []
  );

  useEffect(() => {
    if (!userId) return;
    notifyMatchLeave(userId);
  }, [userId, notifyMatchLeave]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!userId) return;
      if (modeRef.current !== "matching" && modeRef.current !== "room") return;
      notifyMatchLeave(userId, true);
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [userId, notifyMatchLeave]);

  useEffect(() => {
    try { localStorage.setItem("tino_diamonds", String(diamonds)); } catch {}
  }, [diamonds]);
  useEffect(() => {
    try { localStorage.setItem("tino_owned_outfits", JSON.stringify(ownedOutfits)); } catch {}
  }, [ownedOutfits]);
  useEffect(() => {
    try { localStorage.setItem("tino_active_outfit", activeOutfit); } catch {}
  }, [activeOutfit]);

  useEffect(() => {
    if (diamondDelta === null) return;
    const t = setTimeout(() => setDiamondDelta(null), 1320);
    return () => clearTimeout(t);
  }, [diamondDelta]);

  const buyOutfit = useCallback(
    (o: OutfitDef) => {
      if (diamonds < o.price || ownedOutfits.includes(o.id)) return;
      setDiamonds((d) => d - o.price);
      setOwnedOutfits((prev) => [...prev, o.id]);
      setActiveOutfit(o.id);
    },
    [diamonds, ownedOutfits]
  );

  const activeOutfitDef = getOutfit(activeOutfit);

  /* active speaker highlight */
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const speakerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const highlightSpeaker = useCallback((id: string) => {
    setActiveSpeaker(id);
    if (speakerTimer.current) clearTimeout(speakerTimer.current);
    speakerTimer.current = setTimeout(() => setActiveSpeaker(null), 4000);
  }, []);

  /* TTS playback via AudioContext */
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsChain = useRef<Promise<void>>(Promise.resolve());
  const ttsPending = useRef(0);
  const volumeRef = useRef(volume);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const currentSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsCache = useRef<Map<string, AudioBuffer>>(new Map());

  const motionGrantedRef = useRef(false);
  /** iOS Safari：需在用户手势内 resume，并播一帧静音，后续异步 TTS 才能出声 */
  const silentPrimedRef = useRef(false);

  /**
   * 同步解锁音频（必须在点击/触摸等用户手势的同步栈内调用）。
   * iOS/WebKit：对 `resume()` 使用 `await` 会脱离手势链，导致上下文一直保持 suspended、后续无声音。
   */
  const unlockAudioSync = useCallback(() => {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;

    if (!audioCtxRef.current) {
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
    }
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    gain.gain.value = volumeRef.current / 10;
    /* 禁止 await：必须在手势同步路径上调用 */
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        /* ignore */
      });
    }

    if (!silentPrimedRef.current) {
      silentPrimedRef.current = true;
      try {
        const frames = Math.max(2, Math.floor(ctx.sampleRate * 0.05));
        const silent = ctx.createBuffer(1, frames, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = silent;
        src.connect(gain);
        src.start(0);
      } catch {
        /* ignore */
      }
    }

    if (!motionGrantedRef.current) {
      motionGrantedRef.current = true;
      const DM = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      if (typeof DM.requestPermission === "function") {
        DM.requestPermission()
          .then((result) => {
            if (result !== "granted") motionGrantedRef.current = false;
          })
          .catch(() => {
            motionGrantedRef.current = false;
          });
      }
    }
  }, []);

  /** 加积分时短促提示音；有生词额外分时多一声更高音 */
  const playPointsDing = useCallback((novelCount: number) => {
    unlockAudioSync();
    const ctx = audioCtxRef.current;
    const master = gainNodeRef.current;
    if (!ctx || !master) return;

    const ding = (freq: number, startOffset: number) => {
      const t0 = ctx.currentTime + startOffset;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.11, t0 + 0.006);
      g.gain.linearRampToValueAtTime(0.001, t0 + 0.13);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + 0.14);
    };

    ding(880, 0);
    if (novelCount > 0) {
      ding(1046, 0.14);
    }
  }, [unlockAudioSync]);

  const awardDiamonds = useCallback(
    (text: string) => {
      const { points, novelCount } = scoreEnglishTurn(
        text,
        englishWordSeenForPointsRef.current
      );
      if (points <= 0) return;

      if (modeRef.current === "room") {
        setSessionDiamonds((d) => d + points);
      } else {
        setDiamonds((d) => d + points);
      }
      setPointsHintKey((k) => k + 1);
      setDiamondDelta(points);
      playPointsDing(novelCount);
    },
    [playPointsDing]
  );

  useEffect(() => {
    volumeRef.current = volume;
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume / 10;
  }, [volume]);

  const playAudioBase64 = useCallback(
    (
      audioBase64: string,
      speaker?: string,
      onPlayStart?: () => void
    ) => {
      if (!audioBase64) return;

      ttsPending.current++;
      setIsSpeaking(true);

      ttsChain.current = ttsChain.current.then(async () => {
        try {
          unlockAudioSync();
          const ctx = audioCtxRef.current;
          const gain = gainNodeRef.current;
          if (!ctx || !gain) {
            onPlayStart?.();
            return;
          }

          let audioBuffer: AudioBuffer | null = null;
          try {
            const binary = atob(audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
          } catch {
            audioBuffer = null;
          }

          if (!audioBuffer) {
            onPlayStart?.();
            return;
          }

          if (ctx.state === "suspended") await ctx.resume();
          if (speaker) highlightSpeaker(speaker);
          onPlayStart?.();
          gain.gain.value = volumeRef.current / 10;

          await new Promise<void>((resolve) => {
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gain);
            currentSrcRef.current = source;
            source.onended = () => {
              currentSrcRef.current = null;
              resolve();
            };
            source.start(0);
          });
        } catch {
          /* audio playback unavailable */
        } finally {
          ttsPending.current--;
          if (ttsPending.current <= 0) {
            ttsPending.current = 0;
            setIsSpeaking(false);
          }
        }
      });
    },
    [highlightSpeaker, unlockAudioSync]
  );

  const playTTS = useCallback(
    (text: string, speaker?: string, onPlayStart?: () => void) => {
      ttsPending.current++;
      setIsSpeaking(true);

      ttsChain.current = ttsChain.current.then(async () => {
        try {
          unlockAudioSync();

          const voiceType =
            speaker === "ai_buddy"
              ? TTS_VOICE_AI_BUDDY
              : speaker === "friend" && isAiRoomRef.current
                ? TTS_VOICE_AI_CHILD
                : undefined;
          const cacheKey = ttsCacheKey(text, voiceType);

          let audioBuffer: AudioBuffer | null = null;
          if (ttsCache.current.has(cacheKey)) {
            audioBuffer = ttsCache.current.get(cacheKey)!;
          } else {
            try {
              const res = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  text,
                  ...(voiceType ? { voiceType } : {}),
                }),
              });
              const data = await res.json();
              if (!data.audioBase64 || data.error) {
                onPlayStart?.();
                return;
              }
              const ctx = audioCtxRef.current;
              if (!ctx) {
                onPlayStart?.();
                return;
              }
              audioBuffer = await ctx.decodeAudioData(
                Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)).buffer.slice(0)
              );
              ttsCache.current.set(cacheKey, audioBuffer);
            } catch {
              audioBuffer = null;
            }
          }

          if (!audioBuffer) {
            onPlayStart?.();
            return;
          }

          const ctx = audioCtxRef.current;
          const gain = gainNodeRef.current;
          if (!ctx || !gain) {
            onPlayStart?.();
            return;
          }

          if (ctx.state === "suspended") await ctx.resume();
          if (speaker) highlightSpeaker(speaker);
          onPlayStart?.();
          gain.gain.value = volumeRef.current / 10;

          await new Promise<void>((resolve) => {
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gain);
            currentSrcRef.current = source;
            source.onended = () => {
              currentSrcRef.current = null;
              resolve();
            };
            source.start(0);
          });
        } catch {
          /* TTS unavailable */
        } finally {
          ttsPending.current--;
          if (ttsPending.current <= 0) {
            ttsPending.current = 0;
            setIsSpeaking(false);
          }
        }
      });
    },
    [highlightSpeaker, unlockAudioSync]
  );

  /* Pre-fetch a TTS clip and store in cache so the room view can play it immediately. */
  const prefetchTTS = useCallback(
    async (text: string, voiceType?: string) => {
      const cacheKey = ttsCacheKey(text, voiceType);
      if (ttsCache.current.has(cacheKey)) return;
      try {
        unlockAudioSync();
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            ...(voiceType ? { voiceType } : {}),
          }),
        });
        const data = await res.json();
        if (!data.audioBase64 || data.error) return;
        const ctx = audioCtxRef.current;
        if (!ctx) return;
        const buffer = await ctx.decodeAudioData(
          Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)).buffer.slice(0)
        );
        ttsCache.current.set(cacheKey, buffer);
      } catch {
        /* ignore */
      }
    },
    [unlockAudioSync]
  );

  /* companion display auto-scroll */
  const companionBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = companionBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayText]);

  /* scroll (room messages) */
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMsgs, isLoading]);

  /* ─── helpers ─── */

  const addMsg = useCallback(
    (sender: MessageSender, content: string) => {
      const msg: Message = {
        id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender,
        content,
        timestamp: Date.now(),
      };
      const set =
        modeRef.current === "room" ? setRoomMsgs : setCompanionMsgs;
      set((prev) => [...prev, msg]);
      if ((content.match(/[a-zA-Z]{2,}/g) || []).length >= 2)
        setEnglishCount((c) => c + 1);
      if (modeRef.current === "room") {
        if (sender === "user") {
          highlightSpeaker(sender);
          setRoomDisplay({ sender, content });
        }
      } else {
        if (sender !== "system") highlightSpeaker(sender);
      }
    },
    [highlightSpeaker]
  );

  const speak = useCallback(
    (sender: MessageSender, content: string) => {
      addMsg(sender, content);
      if (sender !== "system" && sender !== "user") {
        playTTS(content, sender, () => {
          if (modeRef.current === "room") {
            setRoomDisplay({ sender, content });
          }
        });
      }
    },
    [addMsg, playTTS]
  );

  /**
   * Room mode: split fullText into sentences and queue each one individually.
   * Text for each sentence appears in the card exactly when its audio starts.
   * onAllDone fires (via ttsChain) after all sentences finish playing.
   */
  const speakRoomSentences = useCallback(
    (sender: MessageSender, fullText: string, onAllDone?: () => void) => {
      const sentences = splitIntoSentences(fullText);
      for (const sentence of sentences) {
        playTTS(sentence, sender as string, () => {
          if (modeRef.current !== "room") return;
          addMsg(sender, sentence);
          setRoomDisplay({ sender, content: sentence });
        });
      }
      if (onAllDone) {
        ttsChain.current = ttsChain.current.then(() => {
          if (modeRef.current === "room") onAllDone();
        });
      }
    },
    [addMsg, playTTS]
  );

  /* ─── sentence splitter for streaming TTS ─── */

  const splitSentences = useCallback(
    (buffer: string): { completed: string[]; remaining: string } => {
      const completed: string[] = [];
      let remaining = buffer;
      const sentenceEnd = /[。！？!?]/;

      while (true) {
        const m = remaining.match(sentenceEnd);
        if (m && m.index !== undefined) {
          const s = remaining.slice(0, m.index + 1).trim();
          remaining = remaining.slice(m.index + 1);
          if (s) completed.push(s);
          continue;
        }
        break;
      }
      return { completed, remaining };
    },
    []
  );

  /* ─── companion chat (streaming) ─── */

  const sendCompanion = useCallback(
    async (text: string) => {
      if (isLoading) return;
      addMsg("user", text);
      awardDiamonds(text);
      setIsLoading(true);
      highlightSpeaker("tino");

      try {
        const nextMemory = updateCompanionMemory(
          companionMemoryRef.current,
          text
        );
        companionMemoryRef.current = nextMemory;
        persistCompanionMemory(userName, userGrade, nextMemory);
        const growth = deriveCompanionGrowthStage(nextMemory);
        setCompanionGrowth(growth);

        const history = [
          ...companionMsgs.slice(-16),
          { id: "", sender: "user" as const, content: text, timestamp: 0 },
        ];
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({
              sender: m.sender,
              content: m.content,
            })),
            turnCount: turnCount + 1,
            userName,
            userGrade,
            userMemory: {
              memories: nextMemory.memories.slice(0, 4),
              weaknessNotes: deriveWeaknessNotes(nextMemory),
              totalMessages: nextMemory.totalMessages,
              totalEnglishTurns: nextMemory.totalEnglishTurns,
              growthStage: {
                label: growth.label,
                shortHint: growth.shortHint,
              },
            },
          }),
        });

        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("text/plain") && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let fullReply = "";
          let sentenceBuf = "";
          let shownText = "";

          setDisplayText("");

          const showSentence = (s: string) => {
            playTTS(s, "tino", () => {
              shownText = s;
              setDisplayText(s);
            });
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullReply += chunk;
            sentenceBuf += chunk;

            const { completed, remaining } = splitSentences(sentenceBuf);
            for (const s of completed) showSentence(s);
            sentenceBuf = remaining;
          }

          if (sentenceBuf.trim()) showSentence(sentenceBuf.trim());

          const reply = fullReply || "嘻嘻，再说一次吧～";
          addMsg("tino", reply);
        } else {
          const data = await res.json();
          const reply = data.reply || "嘻嘻，再说一次吧～";
          addMsg("tino", reply);
          setDisplayText("");
          const sentences = splitIntoSentences(reply);
          for (const s of sentences) {
            playTTS(s, "tino", () => setDisplayText(s));
          }
        }

        setTurnCount((c) => c + 1);
      } catch {
        const fb = "哎呀，我走神了～再说一次吧！";
        addMsg("tino", fb);
        playTTS(fb, "tino", () => {
          if (modeRef.current === "companion") setDisplayText(fb);
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      isLoading,
      companionMsgs,
      turnCount,
      userName,
      userGrade,
      addMsg,
      awardDiamonds,
      speak,
      playTTS,
      highlightSpeaker,
      splitSentences,
    ]
  );

  const maybePromptFriendInviteFromUserText = useCallback((text: string) => {
    if (endedRef.current) return;
    if (friendInvitePromptShownRef.current) return;
    const p = partnerRef.current;
    if (!p) return;
    if (!detectRoomFriendInviteTrigger(text)) return;
    friendInvitePromptShownRef.current = true;
    setFriendInvitePartner({ ...p });
  }, []);

  /* ─── room: send message to server (or AI partner) ─── */

  const sendRoom = useCallback(
    async ({
      text,
      audioBase64,
      mimeType,
    }: {
      text: string;
      audioBase64?: string;
      mimeType?: string;
    }) => {
      if (isLoading || endedRef.current || !roomId) return;
      setIsLoading(true);

      /* ── AI room: handle locally, no server call ── */
      if (isAiRoomRef.current) {
        addMsg("user", text);
        awardDiamonds(text);
        try {
          const history = roomMsgsRef.current
            .filter((m) => m.sender === "user" || m.sender === "friend")
            .slice(-8)
            .map((m) => ({
              role: (m.sender === "user" ? "user" : "assistant") as "user" | "assistant",
              content: m.content,
            }));
          history.push({ role: "user", content: text });
          const res = await fetch("/api/ai-partner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: history,
              partnerName: partnerRef.current?.name,
              userName,
            }),
          });
          const data = await res.json();
          const reply: string = data.reply || "Haha, cool!";
          speakRoomSentences("friend", reply);
        } catch {
          /* silent */
        } finally {
          setIsLoading(false);
        }
        return;
      }

      /* ── real server room ── */
      try {
        const res = await fetch("/api/room-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            roomId,
            userId,
            userName,
            content: text,
            audioBase64,
            mimeType,
          }),
        });
        if (!res.ok) {
          throw new Error(`room send failed: ${res.status}`);
        }
        const data = await res.json();
        if (!data.messageId) {
          throw new Error("missing messageId");
        }
        seenMsgIds.current.add(data.messageId);
        addMsg("user", text);
        awardDiamonds(text);
      } catch {
        addMsg("system", "消息发送失败，请重试");
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, roomId, userId, userName, addMsg, awardDiamonds, playTTS, speakRoomSentences]
  );

  /* ─── room: Chinese detection wrapper ─── */

  const handleRoomMessage = useCallback(
    async (
      text: string,
      audioPayload?: { audioBase64?: string; mimeType?: string }
    ) => {
      maybePromptFriendInviteFromUserText(text);
      if (containsChinese(text)) {
        const englishSame = getEnglishIfSamePronunciation(text);
        if (englishSame != null) {
          /* 中英同音（如 嗨=Hi）：直接当英文发送，不弹翻译、不要求再说英文 */
          sendRoom({
            text: englishSame,
            audioBase64: audioPayload?.audioBase64,
            mimeType: audioPayload?.mimeType,
          });
          return;
        }
        /* Show buddy immediately while fetching */
        setRoomDisplay({ sender: "tino", content: "..." });
        try {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          const english = (data.english || "").trim();
          const voiceGuide = (data.voiceGuide || english).trim();
          if (voiceGuide) speakRoomSentences("tino", voiceGuide);
        } catch {
          setRoomDisplay(null);
        }
        return;
      }
      sendRoom({
        text,
        audioBase64: audioPayload?.audioBase64,
        mimeType: audioPayload?.mimeType,
      });
    },
    [sendRoom, maybePromptFriendInviteFromUserText]
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      /* 中英同音（如 嗨=Hi）统一用英文，不要求用户再说英文 */
      const toSend = getEnglishIfSamePronunciation(trimmed) ?? trimmed;
      if (modeRef.current === "room") handleRoomMessage(toSend);
      else sendCompanion(toSend);
    },
    [sendCompanion, handleRoomMessage]
  );

  /* ─── room: polling for partner messages (skip for AI room) ─── */

  useEffect(() => {
    if (mode !== "room" || !roomId || isAiRoom) return;

    const poll = async () => {
      try {
        const res = await fetch("/api/room-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "poll",
            roomId,
            since: lastPollTimeRef.current,
          }),
        });
        const data = await res.json();
        const msgs = data.messages || [];

        for (const m of msgs) {
          if (seenMsgIds.current.has(m.id)) continue;
          seenMsgIds.current.add(m.id);

          if (m.senderId === userId) continue;

          const sender: MessageSender =
            m.senderId === "tino" ? "tino" : "friend";
          if (sender === "friend" && m.audioBase64) {
            // pre-recorded audio: show full text when audio starts (can't split)
            playAudioBase64(m.audioBase64, sender, () => {
              if (modeRef.current !== "room") return;
              addMsg(sender, m.content);
              setRoomDisplay({ sender, content: m.content });
            });
          } else {
            speakRoomSentences(sender, m.content);
          }
        }

        if (msgs.length > 0) {
          lastPollTimeRef.current = Math.max(
            ...msgs.map((m: { timestamp: number }) => m.timestamp)
          );
        }
      } catch {
        /* poll failed */
      }
    };

    pollTimerRef.current = setInterval(poll, 1500);
    poll();

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [mode, roomId, userId, isAiRoom, addMsg, playAudioBase64, playTTS, speakRoomSentences]);

  /* ─── room: 冷场时 Tino 引导下一方发言（真人房由「该接话的一方」客户端请求，避免重复） ─── */

  useEffect(() => {
    roomSilenceBasisMsgIdRef.current = null;
  }, [roomId]);

  useEffect(() => {
    if (mode !== "room") {
      if (roomSilenceTimerRef.current) {
        clearInterval(roomSilenceTimerRef.current);
        roomSilenceTimerRef.current = undefined;
      }
      return;
    }

    const tick = () => {
      if (
        endedRef.current ||
        modeRef.current !== "room" ||
        roomSilenceInFlightRef.current
      ) {
        return;
      }
      const msgs = roomMsgsRef.current.filter((m) => m.sender !== "system");
      if (msgs.length === 0) return;

      const lastNonTino = [...msgs].reverse().find((m) => m.sender !== "tino");
      if (!lastNonTino) return;
      if (Date.now() - lastNonTino.timestamp < ROOM_SILENCE_MS) return;
      if (roomSilenceBasisMsgIdRef.current === lastNonTino.id) return;

      const ai = isAiRoomRef.current;
      if (!ai) {
        if (lastNonTino.sender !== "friend") return;
      } else if (lastNonTino.sender === "user" && isLoadingRef.current) {
        return;
      }

      void (async () => {
        roomSilenceInFlightRef.current = true;
        try {
          if (isAiRoomRef.current) {
            const nudgeTarget =
              lastNonTino.sender === "user" ? "peer" : "self";
            const partnerName = partnerRef.current?.name || "小伙伴";
            const myName = userName || "小朋友";
            const recentContext = roomMsgsRef.current
              .filter((m) => m.sender !== "system")
              .slice(-10)
              .map((m) =>
                `${m.sender === "user" ? myName : partnerName}: ${m.content}`
              )
              .join("\n");
            const res = await fetch("/api/room", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "silence_nudge",
                recentContext,
                nudgeTarget,
                partnerName,
                selfName: myName,
              }),
            });
            const data = await res.json();
            const reply: string = data.reply || "";
            if (!reply.trim()) return;
            roomSilenceBasisMsgIdRef.current = lastNonTino.id;
            speakRoomSentences("tino", reply);
          } else {
            const rid = roomId;
            const uid = userId;
            if (!rid || !uid) return;
            const res = await fetch("/api/room-chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "silence_nudge",
                roomId: rid,
                userId: uid,
              }),
            });
            const data = await res.json();
            if (data.ok) roomSilenceBasisMsgIdRef.current = lastNonTino.id;
          }
        } catch {
          /* ignore */
        } finally {
          roomSilenceInFlightRef.current = false;
        }
      })();
    };

    roomSilenceTimerRef.current = setInterval(tick, ROOM_SILENCE_POLL_MS);
    tick();
    return () => {
      if (roomSilenceTimerRef.current) {
        clearInterval(roomSilenceTimerRef.current);
        roomSilenceTimerRef.current = undefined;
      }
    };
  }, [mode, roomId, userId, userName, isAiRoom, speakRoomSentences]);

  /* ─── companion: first-visit onboarding sequence ─── */

  /* ─── companion: play greeting TTS when device is powered on ─── */

  const greetingPlayedRef = useRef(false);
  useEffect(() => {
    if (!isPowered || mode !== "companion" || !isAppReady || greetingPlayedRef.current) return;
    const fromState = displayText.trim();
    const fromMsgs =
      companionMsgs.find((m) => m.sender === "tino")?.content?.trim() ?? "";
    const saved = fromState || fromMsgs;
    if (!saved) return;
    greetingPlayedRef.current = true;
    setDisplayText("");
    for (const s of splitIntoSentences(saved)) {
      playTTS(s, "tino", () => {
        if (modeRef.current === "companion") setDisplayText(s);
      });
    }
  }, [isPowered, mode, displayText, isAppReady, companionMsgs]); // eslint-disable-line react-hooks/exhaustive-deps

  const onboardingDoneRef = useRef(false);

  /* fires when child taps "我会读啦！" on the onboarding reading card */
  const dismissOnboardingReadingCard = useCallback(() => {
    setShowOnboardingReadingCard(false);
    const shakeIntro =
      "太棒了！英文说得真好！🎉\n想认识别的小朋友吗？\n摇一摇设备，就能随机匹配到另一个小朋友，一起用英语聊天哦！";
    setCompanionMsgs((prev) => [
      ...prev,
      { id: "ob_shake", sender: "tino", content: shakeIntro, timestamp: Date.now() },
    ]);
    for (const s of splitIntoSentences(shakeIntro)) {
      playTTS(s, "tino", () => {
        if (modeRef.current === "companion") setDisplayText(s);
      });
    }
  }, [playTTS]); // eslint-disable-line react-hooks/exhaustive-deps

  /* keep ref in sync with state so async recording handler can read it */
  useEffect(() => {
    onboardingReadingCardRef.current = showOnboardingReadingCard;
  }, [showOnboardingReadingCard]);

  /* auto-dismiss onboarding reading card after one read-along */
  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (showOnboardingReadingCard && wasRecordingRef.current && !isRecording) {
      dismissOnboardingReadingCard();
    }
    wasRecordingRef.current = isRecording;
  }, [isRecording, showOnboardingReadingCard, dismissOnboardingReadingCard]);

  useEffect(() => {
    if (mode !== "companion" || !isAppReady || onboardingDoneRef.current) return;
    if (companionMemoryRef.current.totalMessages > 0) {
      onboardingDoneRef.current = true;
      return;
    }
    onboardingDoneRef.current = true;

    const timers: ReturnType<typeof setTimeout>[] = [];
    ONBOARDING_STEPS.forEach(({ delay, text }, i) => {
      timers.push(setTimeout(() => {
        if (modeRef.current !== "companion") return;
        setCompanionMsgs((prev) => [
          ...prev,
          { id: `ob_${delay}`, sender: "tino", content: text, timestamp: Date.now() },
        ]);
        for (const s of splitIntoSentences(text)) {
          playTTS(s, "tino", () => {
            if (modeRef.current === "companion") setDisplayText(s);
          });
        }
        /* After step 2: 弹出跟读卡片；完成后 dismiss 里接「摇一摇匹配」引导 */
        if (i === 1) {
          playTTS("Nice to meet you!", "tino", () => {
            if (modeRef.current === "companion") {
              setDisplayText("Nice to meet you! 🎤\n按住右侧按键跟读一遍");
              setShowOnboardingReadingCard(true);
            }
          });
        }
      }, delay));
    });

    return () => timers.forEach(clearTimeout);
  }, [mode, isAppReady]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── post-room debrief: show Tino feedback after returning to companion ─── */

  const debriefDeliveredRef = useRef(false);
  useEffect(() => {
    if (mode !== "companion") {
      debriefDeliveredRef.current = false;
      return;
    }
    if (debriefDeliveredRef.current) return;
    if (!pendingDebriefRef.current) return;

    debriefDeliveredRef.current = true;
    const parts = pendingDebriefRef.current;
    pendingDebriefRef.current = null;

    const BASE_DELAY = 1200;
    const timers: ReturnType<typeof setTimeout>[] = [];

    /* header notice */
    timers.push(setTimeout(() => {
      if (modeRef.current !== "companion") return;
      const INTROS = [
        "哇刚才聊得好开心！我发现了个很厉害的事想告诉你～",
        "刚才好好玩哦！我悄悄记了点东西，跟你说一下 😄",
        "刚才那局我印象好深！跟你聊聊我发现的～",
        "嘿你知道吗，刚才你有一个地方特别厉害！",
        "我刚才一直在观察你哈哈，发现了一个秘密想跟你分享～",
        "刚才玩得真不错！我有个小发现要告诉你 🎉",
        "聊完啦！我偷偷给你做了个小笔记，你要看吗？",
      ];
      const intro = INTROS[Math.floor(Math.random() * INTROS.length)];
      setCompanionMsgs((prev) => [
        ...prev,
        { id: `db_intro`, sender: "tino", content: intro, timestamp: Date.now() },
      ]);
      for (const s of splitIntoSentences(intro)) {
        playTTS(s, "tino", () => {
          if (modeRef.current === "companion") setDisplayText(s);
        });
      }
    }, BASE_DELAY));

    parts.forEach((text, i) => {
      timers.push(setTimeout(() => {
        if (modeRef.current !== "companion") return;
        setCompanionMsgs((prev) => [
          ...prev,
          { id: `db_${i}`, sender: "tino", content: text, timestamp: Date.now() },
        ]);
        for (const s of splitIntoSentences(text)) {
          playTTS(s, "tino", () => {
            if (modeRef.current === "companion") setDisplayText(s);
          });
        }
      }, BASE_DELAY + (i + 1) * 2800));
    });

    return () => timers.forEach(clearTimeout);
  }, [mode, debriefVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── room: icebreaker warmup ─── */

  useEffect(() => {
    if (mode !== "room" || icebreakerDone) return;

    const AI_BUDDY_NAMES = ["Mia", "Leo", "Sunny", "Max", "Luna", "Coco", "Kai", "Ivy"];
    const buddyName = AI_BUDDY_NAMES[Math.floor(Math.random() * AI_BUDDY_NAMES.length)];
    setAiBuddyName(buddyName);

    let cancelled = false;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    (async () => {
      await delay(600);
      if (cancelled) return;

      const myName = userName || "小朋友";
      const friendName = partnerRef.current?.name || "小伙伴";

      if (!cancelled) setRoomReady(true);

      /* 双方各用自家 AI 只向对方孩子介绍另一位小朋友；两句结构、语气区分，避免听起来像复读 */
      const tinoIntro =
        `Hi ${myName}, ${friendName} is your partner for today's English corner — say something in English to say hi.\n用英语打个招呼就行，越简单越好～`;

      const buddyIntro =
        `${friendName}, ${myName} is here with you — try one short English line to answer back.\n轮到你开口啦，随便说句英语吧～`;

      speakRoomSentences("tino", tinoIntro, () => {
        if (cancelled || modeRef.current !== "room") return;
        speakRoomSentences("ai_buddy", buddyIntro, () => {
          if (!cancelled) setIcebreakerDone(true);
        });
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── room: auto-translate new messages (English → Chinese) ─── */

  useEffect(() => {
    if (mode !== "room") return;
    const last = roomMsgs[roomMsgs.length - 1];
    if (!last || last.sender === "system" || last.sender === "user") return;
    if (roomTranslations[last.id]) return;
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: last.content, lang: "en2zh" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.chinese) {
          setRoomTranslations((prev) => ({ ...prev, [last.id]: d.chinese }));
        }
      })
      .catch(() => {});
  }, [roomMsgs, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── room: keep card showing latest when new messages arrive ─── */

  useEffect(() => {
    if (mode !== "room") return;
    setRoomViewOffset(0);
  }, [roomMsgs.length, mode]);

  /* ─── room: reset navigation offset when leaving room ─── */

  useEffect(() => {
    if (mode !== "room") {
      setRoomViewOffset(0);
      setRoomTranslations({});
    }
  }, [mode]);

  /* ─── voice recording ─── */

  const startRecording = useCallback(async () => {
    if (!isPowered || isRecording) return;
    unlockAudioSync();
    highlightSpeaker("user");
    try {
      setRecordingError("");
      if (!window.isSecureContext) {
        throw new Error("请使用 HTTPS 或本机 localhost 打开，手机网页在非安全连接下不能录音");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("当前浏览器不支持麦克风录音");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("当前浏览器不支持语音录制");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/aac",
      ];
      const mime = supportedTypes.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      const actualMime = recorder.mimeType || mime || "audio/mp4";
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: actualMime });
        if (blob.size < 100) return;
        setIsTranscribing(true);
        const reader = new FileReader();
        const b64 = await new Promise<string>((resolve) => {
          reader.onloadend = () =>
            resolve((reader.result as string).split(",")[1]);
          reader.readAsDataURL(blob);
        });
        try {
          const res = await fetch("/api/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: b64, mimeType: actualMime }),
          });
          const data = await res.json();
          const text = (data.text || "").trim();
          /* bottle mode: fill input with ASR result + keep audio for throw */
          if (modeRef.current === "bottle") {
            const bs = bottleSubStateRef.current;
            if (bs === "throw_input") {
              const t = (text || "").trim();
              if (t && !isEnglishOnlyBottleContent(t)) {
                setBottleThrowError("漂流瓶请用英文哦～");
                setBottleInput("");
                setBottleAudioBase64("");
                setBottleAudioMime("");
              } else {
                setBottleThrowError(null);
                setBottleInput(t);
                setBottleAudioBase64(b64);
                setBottleAudioMime(actualMime);
              }
            } else if (bs === "replying") {
              setBottleReplyInput(text || "");
            }
            return;
          }
          if (modeRef.current === "room") {
            await handleRoomMessage(text || "Voice message", {
              audioBase64: b64,
              mimeType: actualMime,
            });
            return;
          }
          if (modeRef.current === "companion" && friendVoiceMemoRef.current) {
            const target = friendVoiceMemoRef.current;
            setFriendVoiceMemoResult(text.trim() || "…");
            setFriendsList((prev) => {
              const next = prev.map((f) =>
                f.name === target.name ? { ...f, lastChatAt: Date.now() } : f
              );
              try {
                localStorage.setItem("tino_friends_list", JSON.stringify(next));
              } catch {
                /* ignore */
              }
              return next;
            });
            return;
          }
          if (!text) return;
          /* onboarding reading card: skip AI reply, just let the card auto-dismiss */
          if (onboardingReadingCardRef.current) return;
          sendMessage(text);
        } catch {
          if (modeRef.current === "companion" && friendVoiceMemoRef.current) {
            setFriendVoiceMemoResult("没听清，再试一次");
            return;
          }
          if (modeRef.current === "room") {
            await sendRoom({
              text: "Voice message",
              audioBase64: b64,
              mimeType: actualMime,
            });
          }
        } finally {
          setIsTranscribing(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法使用麦克风，请检查权限设置";
      setRecordingError(message);
    }
  }, [isPowered, isRecording, sendMessage, sendRoom, handleRoomMessage, highlightSpeaker, unlockAudioSync]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setRecordingError("");
    setIsRecording(false);
  }, []);

  /* ─── device buttons ─── */

  const handlePower = useCallback(() => {
    unlockAudioSync();
    setIsPowered((p) => !p);
  }, [unlockAudioSync]);
  const handleVolumeUp = useCallback(() => {
    unlockAudioSync();
    setVolume((v) => Math.min(v + 1, 10));
    setShowVolume(true);
  }, [unlockAudioSync]);
  const handleVolumeDown = useCallback(() => {
    unlockAudioSync();
    setVolume((v) => Math.max(v - 1, 0));
    setShowVolume(true);
  }, [unlockAudioSync]);

  useEffect(() => {
    if (!showVolume) return;
    const t = setTimeout(() => setShowVolume(false), 1200);
    return () => clearTimeout(t);
  }, [showVolume, volume]);


  /* ─── matching ─── */

  /* ─── fetch debrief in background before leaving room ─── */
  const fetchDebrief = useCallback(async (msgs: typeof roomMsgs) => {
    try {
      const res = await fetch("/api/debrief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, userName }),
      });
      const data = await res.json();
      if (Array.isArray(data.parts) && data.parts.length > 0) {
        pendingDebriefRef.current = data.parts as string[];
        setDebriefVersion((v) => v + 1);
      }
    } catch { /* silent */ }
  }, [userName]);

  const leaveRoom = useCallback(() => {
    const invite =
      partnerRef.current && !friendInvitePromptShownRef.current
        ? { ...partnerRef.current }
        : null;

    endedRef.current = true;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setDiamonds((d) => d + sessionDiamonds);
    setSessionDiamonds(0);

    /* kick off debrief in background */
    fetchDebrief(roomMsgsRef.current);

    setMode("companion");
    setPartner(null);
    setRoomId("");
    setActiveSpeaker(null);
    setShowExitConfirm(false);
    setRoomDisplay(null);
    seenMsgIds.current.clear();
    lastPollTimeRef.current = 0;
    setIsAiRoom(false);
    isAiRoomRef.current = false;
    setIcebreakerDone(false);
    setRoomReady(false);
    setAiBuddyName("");
    setMatchingPhase("waiting");

    notifyMatchLeave(userId);
    if (invite) {
      friendInvitePromptShownRef.current = true;
      setFriendInvitePartner(invite);
    }
  }, [notifyMatchLeave, sessionDiamonds, userId, fetchDebrief]);

  const enterRoom = useCallback(
    async (rid: string, p: RoomPartner) => {
      setMatchingPhase("ai_found");
      setRoomId(rid);
      setPartner(p);
      setRoomMsgs([]);
      setTimeLeft(ROOM_DURATION);
      setEnglishCount(0);
      endedRef.current = false;
      setActiveSpeaker(null);
      setRoomDisplay(null);
      setSessionDiamonds(0);
      seenMsgIds.current.clear();
      lastPollTimeRef.current = 0;
      friendInvitePromptShownRef.current = false;

      /* Pre-fetch 破冰首句 TTS，减轻进房后首段延迟 */
      const myName = userName || "小朋友";
      const fn = p.name || "小伙伴";
      await prefetchTTS(
        `Hi ${myName}, ${fn} is your partner for today's English corner — say something in English to say hi.`
      );

      setMode("room");
    },
    [userName, prefetchTTS]
  );

  /* ─── enter AI room after 5s timeout (no real match) ─── */
  const AI_PARTNER_NAMES = ["Mochi", "小A", "Kiki", "小星", "晴晴"];

  const enterAiRoom = useCallback(() => {
    const name = AI_PARTNER_NAMES[Math.floor(Math.random() * AI_PARTNER_NAMES.length)];
    const aiPartner: RoomPartner = { userId: "ai_partner", name, grade: 0 };
    setMatchingPhase("ai_found");
    setPartner(aiPartner);
    setTimeout(async () => {
      setIsAiRoom(true);
      isAiRoomRef.current = true;
      setRoomId("ai_room");
      setRoomMsgs([]);
      setTimeLeft(ROOM_DURATION);
      setEnglishCount(0);
      endedRef.current = false;
      setActiveSpeaker(null);
      setRoomDisplay(null);
      setSessionDiamonds(0);
      seenMsgIds.current.clear();
      lastPollTimeRef.current = 0;
      friendInvitePromptShownRef.current = false;

      const myName = userName || "小朋友";
      const fn = aiPartner.name;
      await prefetchTTS(
        `Hi ${myName}, ${fn} is your partner for today's English corner — say something in English to say hi.`
      );

      setMode("room");
    }, 1800);
  }, [userName, prefetchTTS]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMatch = useCallback(async () => {
    if (friendVoiceMemoRef.current) return;
    unlockAudioSync();
    setMatchingPhase("waiting");
    setMode("matching");

    /* after 5s with no real match → arrange an AI partner */
    matchTimeoutRef.current = setTimeout(() => {
      if (matchPollRef.current) clearInterval(matchPollRef.current);
      notifyMatchLeave(userId);
      enterAiRoom();
    }, 5000);

    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          userId,
          name: userName,
          grade: userGrade,
        }),
      });
      const data = await res.json();

      if (data.matched && data.roomId && data.partner) {
        clearTimeout(matchTimeoutRef.current);
        setMatchingPhase("ai_found");
        setPartner(data.partner);
        setTimeout(() => enterRoom(data.roomId, data.partner), 1500);
        return;
      }

      matchPollRef.current = setInterval(async () => {
        try {
          const r = await fetch("/api/match", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "status", userId }),
          });
          const d = await r.json();
          if (d.matched && d.roomId && d.partner) {
            clearTimeout(matchTimeoutRef.current);
            if (matchPollRef.current) clearInterval(matchPollRef.current);
            setMatchingPhase("ai_found");
            enterRoom(d.roomId, d.partner);
          }
        } catch { /* retry */ }
      }, 1500);
    } catch {
      clearTimeout(matchTimeoutRef.current);
      setMatchingPhase("waiting");
      setMode("companion");
    }
  }, [unlockAudioSync, userId, userName, userGrade, enterRoom, enterAiRoom, notifyMatchLeave]);

  const cancelMatch = useCallback(() => {
    if (matchPollRef.current) clearInterval(matchPollRef.current);
    if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    notifyMatchLeave(userId);
    setMatchingPhase("waiting");
    setMode("companion");
  }, [notifyMatchLeave, userId]);


  /* cleanup match polling on unmount */
  useEffect(() => {
    return () => {
      if (matchPollRef.current) clearInterval(matchPollRef.current);
      if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    };
  }, []);

  /* ─── shake-to-match ─── */

  const shakeRef = useRef({ count: 0, lastTime: 0, lastX: 0, lastY: 0, lastZ: 0 });
  const shakeCooldownRef = useRef(false);

  useEffect(() => {
    if (!isPowered) return;

    const THRESHOLD = 12;   // 更灵敏（原 25）
    const SHAKE_COUNT = 2;  // 只需 2 次（原 3 次）
    const SHAKE_WINDOW = 1200; // 时间窗口拉宽（原 800ms）

    const onMotion = (e: DeviceMotionEvent) => {
      if (modeRef.current !== "companion" || shakeCooldownRef.current) return;
      if (friendVoiceMemoRef.current) return;

      /* 优先使用去重力的 acceleration，回退到 accelerationIncludingGravity */
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (!acc) return;

      const x = acc.x ?? 0, y = acc.y ?? 0, z = acc.z ?? 0;
      const s = shakeRef.current;
      const now = Date.now();

      const dx = Math.abs(x - s.lastX);
      const dy = Math.abs(y - s.lastY);
      const dz = Math.abs(z - s.lastZ);

      s.lastX = x;
      s.lastY = y;
      s.lastZ = z;

      if (dx + dy + dz > THRESHOLD) {
        if (now - s.lastTime > SHAKE_WINDOW) s.count = 0;
        s.count += 1;
        s.lastTime = now;

        if (s.count >= SHAKE_COUNT) {
          s.count = 0;
          shakeCooldownRef.current = true;
          setTimeout(() => { shakeCooldownRef.current = false; }, 5000);
          startMatch();
        }
      }
    };

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [isPowered, startMatch]);

  /* ─── room lifecycle ─── */

  useEffect(() => {
    if (mode !== "room") return;
    const iv = setInterval(() => {
      setTimeLeft((p) => {
        if (p <= 1) {
          clearInterval(iv);
          return 0;
        }
        return p - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [mode]);

  useEffect(() => {
    if (mode !== "room" || timeLeft > 0 || endedRef.current) return;
    endedRef.current = true;
    setDiamonds((d) => d + sessionDiamonds);
    setSessionDiamonds(0);
    addMsg("system", "聊天时间到啦～下次再见！");

    /* fetch debrief in background, then leave */
    const snapshot = roomMsgsRef.current;
    fetchDebrief(snapshot).finally(() => {
      setTimeout(() => {
        const invite =
          partnerRef.current && !friendInvitePromptShownRef.current
            ? { ...partnerRef.current }
            : null;
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setMode("companion");
        setPartner(null);
        setRoomId("");
        setActiveSpeaker(null);
        seenMsgIds.current.clear();
        setIsAiRoom(false);
        isAiRoomRef.current = false;
        setIcebreakerDone(false);
        setRoomReady(false);
        setAiBuddyName("");
        setMatchingPhase("waiting");
        if (invite) {
          friendInvitePromptShownRef.current = true;
          setFriendInvitePartner(invite);
        }
      }, 3500);
    });
  }, [mode, timeLeft, addMsg, sessionDiamonds, fetchDebrief]);

  /* ─── derived ─── */

  const tinoExpr = isRecording
    ? "excited"
    : isLoading || isTranscribing
      ? "thinking"
      : isSpeaking
        ? "waving"
        : ("happy" as const);

  const statusText = recordingError
    ? recordingError
    : isRecording
    ? "正在听你说..."
    : isTranscribing
      ? "请稍等..."
      : isLoading
        ? "请稍等..."
        : isSpeaking
          ? "听完再继续"
          : "按住右侧按钮说话";
  const statusIcon = recordingError
    ? "!"
    : isRecording
      ? "REC"
      : isTranscribing || isLoading
        ? "..."
        : isSpeaking
          ? "TTS"
          : "MIC";

  const companionStatusHint = recordingError
    ? "检查麦克风权限后，再按右侧按键试一次"
    : isRecording
      ? "松开右侧按键后发送"
      : "";

  const companionStatusAccent = recordingError
    ? "text-red-500"
    : isRecording
      ? "text-red-500"
      : isTranscribing || isLoading
        ? "text-amber-500"
        : isSpeaking
          ? "text-tino-orange"
          : "text-green-500";

  /* ─── room lyrics display ─── */

  const lyricsRef = useRef<HTMLDivElement>(null);
  const lyricsBoxRef = useRef<HTMLDivElement>(null);

  const centerSpeaker = roomDisplay?.sender || "tino";
  const roomLyricsText = roomDisplay?.content || "";
  const centerLabel =
    centerSpeaker === "tino"
      ? "Tino"
      : centerSpeaker === "ai_buddy"
        ? (aiBuddyName || "布迪")
        : centerSpeaker === "user"
          ? (userName || "我")
          : partner?.name || "小伙伴";

  useEffect(() => {
    const el = lyricsRef.current;
    const box = lyricsBoxRef.current;
    if (!el || !box || mode !== "room") return;

    el.style.animation = "none";
    el.style.transform = "translateY(0)";
    void el.offsetHeight;

    const overflow = el.scrollHeight - box.clientHeight;
    if (overflow <= 0) return;

    const ms = Math.max(overflow * 40, 3000);
    el.style.setProperty("--ly-offset", `-${overflow}px`);
    el.style.animation = `lyricsScroll ${ms}ms ease-in-out 1.5s forwards`;
  }, [roomLyricsText, mode]);

  /* ─── drift bottle handlers ─── */

  const openBottleMode = useCallback(async () => {
    setBottleSubState("menu");
    setBottleInput("");
    setBottleReplyInput("");
    setPickedBottle(null);
    setMode("bottle");
    if (!userId) return;
    try {
      const res = await fetch("/api/drift-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inbox", userId }),
      });
      const data = await res.json();
      if (data.ok) {
        setBottleInbox(data.bottles);
        setBottleInboxUnread(data.bottles.length);
      }
    } catch { /* ignore */ }
  }, [userId]);

  const handleThrowBottle = useCallback(async () => {
    if (!bottleInput.trim() || bottleLoading) return;
    if (!isEnglishOnlyBottleContent(bottleInput)) {
      setBottleThrowError("漂流瓶请用英文哦～");
      return;
    }
    setBottleThrowError(null);
    setBottleLoading(true);
    setBottleSubState("throwing");
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const res = await fetch("/api/drift-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "throw",
          userId,
          senderName: userName,
          senderGrade: userGrade,
          content: bottleInput.trim(),
          audioBase64: bottleAudioBase64 || undefined,
          mimeType: bottleAudioMime || undefined,
        }),
      });
      if (!res.ok) {
        setBottleThrowError(
          res.status === 400 ? "漂流瓶请用英文哦～" : "发送失败，请稍后再试"
        );
        setBottleSubState("throw_input");
        return;
      }
      setBottleSubState("throw_done");
      setBottleInput("");
      setBottleAudioBase64("");
      setBottleAudioMime("");
    } catch {
      setBottleSubState("throw_input");
    } finally {
      setBottleLoading(false);
    }
  }, [bottleInput, bottleAudioBase64, bottleAudioMime, bottleLoading, userId, userName, userGrade]);

  const handlePickBottle = useCallback(async () => {
    if (bottleLoading) return;
    setBottleLoading(true);
    setBottleSubState("picking");
    await new Promise((r) => setTimeout(r, 1800));
    try {
      const res = await fetch("/api/drift-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick", userId }),
      });
      const data = await res.json();
      if (data.ok && data.bottle) {
        setPickedBottle({
          id: data.bottle.id,
          senderName: data.bottle.senderName,
          senderGrade: data.bottle.senderGrade,
          content: data.bottle.content,
          audioBase64: data.bottle.audioBase64 || undefined,
          mimeType: data.bottle.mimeType || undefined,
        });
      } else {
        setPickedBottle({
          id: "",
          senderName: "",
          senderGrade: 0,
          content: data.message || "海里暂时没有瓶子",
        });
      }
      setBottleSubState("picked");
    } catch {
      setBottleSubState("menu");
    } finally {
      setBottleLoading(false);
    }
  }, [bottleLoading, userId]);

  const handleReplyBottle = useCallback(async () => {
    if (!bottleReplyInput.trim() || !pickedBottle?.id || bottleLoading) return;
    setBottleLoading(true);
    try {
      await fetch("/api/drift-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          bottleId: pickedBottle.id,
          userId,
          userName,
          content: bottleReplyInput.trim(),
        }),
      });
      setBottleSubState("reply_done");
      setBottleReplyInput("");
    } catch { /* ignore */ } finally {
      setBottleLoading(false);
    }
  }, [bottleReplyInput, pickedBottle, bottleLoading, userId, userName]);

  const fetchBottleInbox = useCallback(async () => {
    if (!userId) return;
    setBottleLoading(true);
    try {
      const res = await fetch("/api/drift-bottle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inbox", userId }),
      });
      const data = await res.json();
      if (data.ok) {
        setBottleInbox(data.bottles);
        setBottleInboxUnread(0);
      }
    } catch { /* ignore */ } finally {
      setBottleLoading(false);
    }
  }, [userId]);

  /* ─── render ─── */

  return (
    <>
      {/* Test Chat Panel - visible in development only */}
      {process.env.NODE_ENV === 'development' && (
        <TestChatPanel
          defaultOpen={true}
          onTestComplete={(results) => {
            console.log('Test completed:', results);
          }}
        />
      )}

      <DeviceFrame
        onVoiceStart={startRecording}
        onVoiceEnd={stopRecording}
        onVolumeUp={handleVolumeUp}
        onVolumeDown={handleVolumeDown}
        onPower={handlePower}
        isRecording={isRecording}
        isSpeaking={isSpeaking}
      >
        <div className="h-full min-h-0 relative">
      {friendInvitePartner && (
        <div
          className="absolute inset-0 z-[200] bg-black/70 flex items-center justify-center px-2"
          onClick={() => setFriendInvitePartner(null)}
        >
          <div
            className="w-full max-w-[168px] rounded-xl border-2 border-[#c9b8c4] bg-[#ebe4e8] p-2.5 flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 min-h-0">
              <div className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-[#f0a8c8] to-[#a890d8] flex items-center justify-center text-sm font-black text-white shadow-inner">
                {friendInvitePartner.name[0]}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-[13px] font-black text-[#1a1014] truncate">
                  {friendInvitePartner.name}
                </p>
                <p className="text-[10px] font-bold text-[#6a5864] mt-0.5">加为好友？</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setFriendInvitePartner(null)}
                className="w-full py-1.5 rounded-lg bg-[#d4cad0] text-[#4a3d44] text-[11px] font-bold active:brightness-95 border border-[#b8aab2]"
              >
                不要
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem("tino_friends_list");
                    const existing: FriendRecord[] = raw ? JSON.parse(raw) : [];
                    const p = friendInvitePartner;
                    const filtered = existing.filter(
                      (f) => f.name !== p.name || f.grade !== p.grade
                    );
                    const updated = [
                      { name: p.name, grade: p.grade, lastChatAt: Date.now() },
                      ...filtered,
                    ].slice(0, 20);
                    localStorage.setItem("tino_friends_list", JSON.stringify(updated));
                    setFriendsList(updated);
                  } catch { /* storage unavailable */ }
                  setFriendInvitePartner(null);
                  /* 在聊天室中加好友：保存后直接离房，回陪伴态并由 fetchDebrief + 复盘 effect 总结刚才聊天 */
                  if (mode === "room") {
                    leaveRoom();
                  }
                }}
                className="w-full py-2.5 rounded-lg bg-[#6b2f9a] text-white text-[12px] font-black active:brightness-95 border border-[#4a2068]"
              >
                加好友
              </button>
            </div>
          </div>
        </div>
      )}
      {!isAppReady ? (
        /* ── splash screen ── */
        <div
          className="h-full rounded-[8px] bg-gradient-to-b from-[#fde8f0] via-[#fff3f7] to-[#f0ebff] relative overflow-hidden select-none cursor-pointer touch-manipulation"
          onPointerDown={() => {
            /* 仅同步解锁播放。开屏调 getUserMedia 会弹系统麦克风框，部分 WebKit 会挂起 AudioContext，导致进主页后 TTS 不播；麦克风仍在首次按住说话时请求。 */
            unlockAudioSync();
            setIsAppReady(true);
          }}
        >
          {/* portrait — full bleed, bottom-anchored */}
          <div className="absolute inset-x-0 top-0 bottom-[25%] flex items-end justify-center">
            <Image
              src={tinoPortrait}
              alt="Tino"
              fill
              sizes="100%"
              className="object-contain object-bottom"
              style={{ mixBlendMode: "multiply" }}
              priority
            />
          </div>

          {/* bottom overlay: gradient + title + hint */}
          <div className="absolute inset-x-0 bottom-0 h-[44%] flex flex-col items-center justify-end pb-7 pt-3 bg-gradient-to-t from-[#f4eeff] from-60% via-[#f4eeff]/80 to-transparent">
            <h1 className="text-[32px] font-black tracking-[0.22em] text-[#1e1218] leading-none">TINO</h1>
            <p className="text-[12px] font-bold text-[#c4628a] mt-1 tracking-wide">你的英语小伙伴</p>
            <div className="mt-4 flex flex-col items-center gap-1.5">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-[#e4a0b8] animate-bounce"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
              <p className="text-[10px] font-semibold text-[#c4a0b0] animate-pulse">
                轻触屏幕开始
              </p>
            </div>
          </div>
        </div>
      ) : !isPowered ? (
        <div className="h-full bg-[#111] rounded-[8px] flex items-center justify-center">
          <TinoAvatar size={48} expression="happy" className="opacity-10" />
        </div>
      ) : (mode === "matching" || (mode === "room" && !roomReady)) ? (
        /* ── matching：上排我+Tino；匹配前下排「?」，成功后下排小伙伴+布迪人像铺满 ── */
        <div className="h-full relative overflow-hidden rounded-[8px] flex flex-col min-h-0">
          <div
            className="absolute inset-0"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 100% 70% at 50% -15%, rgba(120,80,220,0.45), transparent 50%), radial-gradient(ellipse 80% 50% at 50% 100%, rgba(30,140,200,0.22), transparent 45%), linear-gradient(180deg, #0a0e22 0%, #12183a 45%, #070a18 100%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(201,162,39,0.1) 8px, rgba(201,162,39,0.1) 9px)",
            }}
          />
          <div className="relative z-10 flex h-full min-h-0 flex-col">
            {(() => {
              const matchReady =
                matchingPhase === "ai_found" || (mode === "room" && !roomReady);
              const showBottomAvatars = matchReady && partner;
              /* 左上我 · 右上 Tino · 下：匹配成功前 ? / 成功后 小伙伴+布迪 */
              const cells: (
                | {
                    kind: "avatar";
                    key: string;
                    img: typeof portraitUser;
                    name: string;
                    dim?: boolean;
                    mySide: boolean;
                  }
                | { kind: "placeholder"; key: string }
              )[] = [
                {
                  kind: "avatar",
                  key: "me",
                  img: portraitUser,
                  name: userName || "我",
                  dim: false,
                  mySide: true,
                },
                {
                  kind: "avatar",
                  key: "tino",
                  img: tinoPortrait,
                  name: "Tino",
                  dim: false,
                  mySide: true,
                },
                ...(showBottomAvatars
                  ? [
                      {
                        kind: "avatar" as const,
                        key: "peer",
                        img: portraitPartner,
                        name: partner!.name || "…",
                        dim: false,
                        mySide: false,
                      },
                      {
                        kind: "avatar" as const,
                        key: "buddy",
                        img: portraitBuddy,
                        name: aiBuddyName || "布迪",
                        dim: false,
                        mySide: false,
                      },
                    ]
                  : [
                      { kind: "placeholder" as const, key: "q1" },
                      { kind: "placeholder" as const, key: "q2" },
                    ]),
              ];
              return (
                <>
                  <main className="min-h-0 flex-1 overflow-hidden">
                    <div className="grid h-full min-h-0 grid-cols-2 grid-rows-2 gap-px bg-slate-950/80">
                      {cells.map((cell) => {
                        if (cell.kind === "placeholder") {
                          return (
                            <div
                              key={cell.key}
                              className="relative flex min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden border-2 border-slate-700/90 bg-gradient-to-b from-slate-900/95 to-slate-950 shadow-inner"
                            >
                              <span className="select-none text-[min(28vw,96px)] font-black leading-none text-slate-600/85">
                                ?
                              </span>
                            </div>
                          );
                        }
                        const cardFrame = cell.mySide
                          ? "border-2 border-amber-400/95 shadow-[0_0_16px_rgba(251,191,36,0.22)]"
                          : cell.key === "peer"
                            ? "border-2 border-amber-400/90 shadow-[0_0_14px_rgba(251,191,36,0.2)]"
                            : "border border-slate-500/60 bg-slate-950/25";
                        return (
                          <div
                            key={cell.key}
                            className={`relative min-h-0 min-w-0 overflow-hidden ${cardFrame} ${
                              cell.dim ? "opacity-[0.97]" : ""
                            }`}
                          >
                            <Image
                              src={cell.img}
                              alt=""
                              fill
                              className={`object-cover object-top ${
                                cell.dim ? "brightness-[0.48] saturate-45" : ""
                              }`}
                              sizes="50vw"
                              priority={cell.key === "me"}
                            />
                            {cell.dim && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/35">
                                <span className="text-[11px] font-black tracking-[0.2em] text-white drop-shadow-md">
                                  匹配中
                                </span>
                              </div>
                            )}
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-6 pb-1.5 px-1.5">
                              <p className="truncate text-center text-[12px] font-black leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                                {cell.name}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </main>

                  {!matchReady && (
                    <footer className="shrink-0 border-t border-white/10 bg-[#070a18]/95 px-3 py-2">
                      <div className="flex items-center justify-center gap-3">
                        <div className="flex gap-1.5" aria-hidden>
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-400/90 shadow-[0_0_6px_rgba(251,191,36,0.45)]"
                              style={{ animationDelay: `${i * 180}ms` }}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={cancelMatch}
                          className="min-w-0 flex-1 rounded-lg border border-amber-400/35 bg-amber-400/12 py-2 text-[11px] font-black text-amber-50/95 transition-colors active:bg-amber-400/20 sm:max-w-[200px]"
                        >
                          取消匹配
                        </button>
                      </div>
                    </footer>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      ) : mode === "companion" ? (
        /* ── companion: portrait — character center, chat overlay bottom ── */
        <div className="relative h-full min-h-0 overflow-hidden bg-gradient-to-b from-[#fce8f4] via-[#fff0f8] to-[#ede8ff]">

          {/* Volume toast */}
          {showVolume && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {/* Friends list overlay */}
          {showFriendsList && (
            <div className="absolute inset-0 z-40 flex flex-col bg-gradient-to-b from-[#f9f4ff] via-[#fdfbff] to-[#f7f1ff]">
              <div className="px-3 pt-3 pb-2 flex-shrink-0 border-b border-[#eee3fb]">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => {
                      setFriendVoiceMemo(null);
                      setFriendVoiceMemoResult(null);
                      setShowFriendsList(false);
                    }}
                    className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[#6a4d90] bg-white border border-[#e8dcf7] shadow-[0_1px_4px_rgba(115,72,170,0.12)] active:scale-95 transition-transform"
                    aria-label="返回"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5M12 5l-7 7 7 7"/>
                    </svg>
                  </button>
                  <h2 className="min-w-0 flex-1 text-[15px] leading-tight font-black tracking-tight text-[#4f2f75] truncate">
                    我的好友
                    {friendsList.length > 0 ? (
                      <span className="font-bold text-[#9f86be]"> · {friendsList.length} 位</span>
                    ) : null}
                  </h2>
                </div>
              </div>
              {friendsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
                  <div className="w-16 h-16 rounded-2xl bg-white border border-[#ecdef6] shadow-[0_8px_20px_rgba(155,121,196,0.12)] flex items-center justify-center text-4xl">
                    🐾
                  </div>
                  <p className="text-[15px] font-black text-[#8b6aae]">还没有好友</p>
                  <p className="text-[12px] text-[#b69acb] text-center leading-relaxed">
                    和小伙伴匹配聊天后<br/>他们会出现在这里
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 pt-2 pb-5 flex flex-col gap-2 min-w-0">
                  {friendsList
                    .slice()
                    .sort((a, b) => b.lastChatAt - a.lastChatAt)
                    .map((f, i) => {
                    const AVATARS = ["🐰","🐯","🐻","🦊","🐼","🐨","🐸","🦁","🐮","🐷","🐧","🦆","🐺","🦋","🐙"];
                    let hash = 0;
                    for (let c = 0; c < f.name.length; c++) hash = (hash * 31 + f.name.charCodeAt(c)) & 0xffff;
                    const emoji = AVATARS[hash % AVATARS.length];
                    const AVATAR_COLORS = ["bg-[#e8d4f0]","bg-[#fde8c8]","bg-[#d4eef8]","bg-[#fde8e8]","bg-[#d8f0e4]"];
                    const avatarColor = AVATAR_COLORS[hash % AVATAR_COLORS.length];
                    const gradeLabel = f.grade > 0 ? `${f.grade} 年级` : "小伙伴";
                    return (
                      <div key={i} className="flex items-center gap-2 min-w-0 bg-white rounded-2xl px-2.5 py-2 border border-[#ecdef8] shadow-[0_4px_12px_rgba(150,120,186,0.09)]">
                        <div className={`w-11 h-11 shrink-0 rounded-xl ${avatarColor} flex items-center justify-center text-[22px] leading-none border border-white`}>
                          {emoji}
                        </div>
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <p className="text-[14px] font-black text-[#231628] leading-snug truncate">{f.name}</p>
                          <p className="text-[10px] font-semibold text-[#9c84b7] mt-0.5 leading-snug truncate">
                            {gradeLabel} · {formatFriendLastChatTime(f.lastChatAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFriendVoiceMemoResult(null);
                            setFriendVoiceMemo({
                              name: f.name,
                              grade: f.grade,
                              emoji,
                              avatarColor,
                            });
                          }}
                          className="shrink-0 flex items-center gap-1 pl-2 pr-2.5 py-1.5 bg-[#f1e6ff] text-[#6b4a9a] rounded-xl border border-[#d6c2f0] active:brightness-95 transition-colors"
                          aria-label="给好友留言"
                          title="给好友留言"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                          </svg>
                          <span className="text-[11px] font-black leading-none whitespace-nowrap">留言</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* 留言：小弹窗引导按住说话 */}
              {friendVoiceMemo && (
                <div
                  className="absolute inset-0 z-50 flex items-center justify-center px-4 bg-black/25"
                  onClick={() => {
                    setFriendVoiceMemo(null);
                    setFriendVoiceMemoResult(null);
                  }}
                >
                  <div
                    className="relative w-full max-w-[min(280px,92vw)] rounded-2xl bg-white border border-[#e8dcf7] shadow-[0_8px_28px_rgba(80,50,120,0.18)] px-4 pt-3 pb-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFriendVoiceMemo(null);
                        setFriendVoiceMemoResult(null);
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-[#b8a8bc] text-lg leading-none hover:bg-[#f5f0fb] active:bg-[#ede5f7]"
                      aria-label="关闭"
                    >
                      ×
                    </button>
                    <div className="flex items-center gap-2 pr-6 mb-3">
                      <div className={`w-10 h-10 shrink-0 rounded-xl ${friendVoiceMemo.avatarColor} flex items-center justify-center text-xl border border-white`}>
                        {friendVoiceMemo.emoji}
                      </div>
                      <p className="text-[14px] font-black text-[#4f2f75] truncate">给 {friendVoiceMemo.name}</p>
                    </div>
                    {!friendVoiceMemoResult ? (
                      <p className="text-[13px] text-[#6a5864] text-center font-semibold leading-relaxed">
                        按住右侧键说话
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[14px] font-bold text-[#231628] leading-snug whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto">
                          {friendVoiceMemoResult}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setFriendVoiceMemo(null);
                            setFriendVoiceMemoResult(null);
                          }}
                          className="w-full py-2 rounded-xl bg-[#8c64b8] text-white text-[13px] font-black active:scale-[0.98]"
                        >
                          好的
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Onboarding reading card */}
          {showOnboardingReadingCard && (
            <div
              className="absolute inset-0 z-30 bg-black/30 flex items-center justify-center px-4"
              onClick={dismissOnboardingReadingCard}
            >
              <div className="bg-white rounded-3xl w-full shadow-2xl overflow-hidden py-5" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 flex flex-wrap gap-2 justify-center">
                  {[
                    { word: "Nice", phonetic: "/naɪs/" },
                    { word: "to", phonetic: "/tuː/" },
                    { word: "meet", phonetic: "/miːt/" },
                    { word: "you!", phonetic: "/juː/" },
                  ].map(({ word, phonetic }, i) => (
                    <button
                      key={i}
                      onClick={() => playTTS(word.replace(/!/g, ""), "tino")}
                      className="flex flex-col items-center bg-white border border-[#ece4f8] rounded-[14px] px-3 py-2 shadow-sm active:bg-[#f3eeff] active:scale-95 transition-all"
                    >
                      <span className="text-[16px] font-black text-[#1e1218] leading-none">{word}</span>
                      <span className="text-[10px] text-[#9575cd] leading-none mt-[3px]">{phonetic}</span>
                    </button>
                  ))}
                </div>
                <div className="mx-4 mt-3 flex items-center gap-2 bg-[#f8f2ff] rounded-xl px-3 py-2">
                  <p className="flex-1 text-[13px] font-bold text-[#6a4a8a]">Nice to meet you!</p>
                  <button
                    onClick={() => playTTS("Nice to meet you!", "tino")}
                    className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7c3fa8]/10 text-[#7c3fa8] flex items-center justify-center active:bg-[#7c3fa8]/25 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                  </button>
                </div>
                <div className="mt-3 flex justify-center">
                  <p className="text-[12px] font-bold text-green-500">按住右侧按键跟读一遍</p>
                </div>
              </div>
            </div>
          )}

          {/* Character — centered, fills screen */}
          <div className="absolute inset-0">
            <Image
              src={tinoPortrait}
              alt="Tino"
              fill
              sizes="192px"
              className="object-contain"
              style={{ mixBlendMode: "multiply", objectPosition: "center 25%" }}
              priority
            />
          </div>

          {/* 摇一摇 — 人物左侧，图标按钮（与好友按钮同尺寸） */}
          <div className="absolute left-1.5 top-[30%] z-20 -translate-y-1/2 pointer-events-auto">
            <button
              type="button"
              onClick={startMatch}
              className="w-8 h-8 rounded-full bg-white/90 border border-[#ecc8d8] shadow-md text-[#c4628a] flex items-center justify-center active:scale-95 active:bg-[#fff5f8] transition-transform backdrop-blur-sm"
              aria-label="摇一摇匹配"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 10v4M2 12h2" />
                <path d="M20 10v4M22 12h-2" />
                <rect x="8" y="3" width="8" height="18" rx="2" />
                <path d="M11 19h2" strokeWidth="1.5" />
              </svg>
            </button>
          </div>

          {/* Bottom gradient fade for chat overlay readability */}
          <div
            className="absolute bottom-0 inset-x-0 pointer-events-none"
            style={{ height: "42%", background: "linear-gradient(to top, rgba(244,238,255,0.88) 30%, rgba(244,238,255,0.5) 65%, transparent)" }}
          />

          {/* TOP HUD: friends (left) | 积分（点进装扮）+ 漂流瓶 (right) */}
          <div className="absolute top-2 inset-x-2 z-20 flex items-center justify-between">
            <button
              onClick={() => setShowFriendsList(true)}
              className="w-8 h-8 rounded-full bg-white/85 border border-[#ecc8d8] shadow-md flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm relative"
              aria-label="查看好友列表"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c4628a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              {friendsList.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#f08] text-white text-[8px] font-bold flex items-center justify-center leading-none">
                  {friendsList.length > 9 ? "9+" : friendsList.length}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMode("shop")}
                className="relative w-8 h-8 rounded-full bg-white/85 border border-violet-200/90 shadow-md flex items-center justify-center text-violet-600 active:scale-95 active:bg-violet-50/90 transition-transform backdrop-blur-sm"
                aria-label={`积分 ${diamonds}，打开装扮`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span className="absolute -bottom-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-violet-100 border border-violet-200/80 text-[7px] font-black text-violet-800 tabular-nums flex items-center justify-center leading-none shadow-sm">
                  {diamonds > 999 ? "999+" : diamonds}
                </span>
              </button>
              <button
                type="button"
                onClick={openBottleMode}
                className="relative w-8 h-8 rounded-full bg-white/85 border border-[#b8d8ee] shadow-md flex items-center justify-center text-[#2a7aaa] active:scale-95 active:bg-[#e0f2fe] transition-transform backdrop-blur-sm"
                aria-label="漂流瓶"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 2h6v2h-1v1.5l2 3.5V20a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V9l2-3.5V4H9V2z" />
                  <path d="M8 10h8" />
                </svg>
                {bottleInboxUnread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[13px] h-3 px-0.5 rounded-full bg-red-500 text-white text-[7px] font-bold flex items-center justify-center leading-none border border-white">
                    {bottleInboxUnread > 9 ? "9+" : bottleInboxUnread}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* 伙伴等级（头顶；tier 0–3 → Lv.1–4，随英文输出提升） */}
          <div className="absolute top-[14%] left-0 right-0 z-20 flex justify-center pointer-events-none px-2">
            <span
              className="text-[12px] font-black tabular-nums tracking-tight text-amber-950 bg-gradient-to-b from-amber-100 via-amber-200 to-amber-300/95 border border-amber-500/50 rounded-md px-2 py-0.5 shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
              title={`等级 Lv.${companionGrowth.tier + 1} · ${companionGrowth.label}（多说英文会升级）`}
            >
              Lv.{companionGrowth.tier + 1}
            </span>
          </div>

          {/* BOTTOM chat overlay：积分提示全宽水平居中（不受左右 padding 影响） */}
          <div className="absolute bottom-0 inset-x-0 z-10 pb-2.5 flex flex-col gap-1.5">
            {diamondDelta !== null && (
              <div className="w-full flex justify-center pointer-events-none shrink-0 px-0">
                <div
                  key={pointsHintKey}
                  className="points-hint flex justify-center"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="text-[11px] font-semibold text-violet-800 bg-white/85 backdrop-blur-sm px-2.5 py-1 rounded-full border border-violet-300/70 shadow-[0_2px_12px_rgba(91,33,182,0.18)]">
                    +{diamondDelta} 积分
                  </span>
                </div>
              </div>
            )}
            <div className="px-2.5">
            {/* Speech bubble */}
            <div className="bg-white/50 backdrop-blur-md rounded-[18px] border border-white/60 shadow-lg px-3.5 py-2.5">
              <p className="text-[8px] font-bold tracking-[0.22em] text-[#c4a0b0] mb-1">T I N O</p>
              <div
                ref={companionBoxRef}
                className="max-h-[88px] overflow-y-auto"
              >
                <p className="whitespace-pre-wrap break-words text-[14px] font-black leading-snug text-[#1e1218]">
                  {displayText}
                </p>
              </div>
            </div>
            {/* Status row */}
            <div className="flex items-center justify-center gap-2 mt-1.5 min-h-[20px]">
              <span className={`text-[11px] font-bold ${companionStatusAccent}`}>{statusText}</span>
              {companionStatusHint && (
                <span className="text-[9px] text-[#c4a0b0]">{companionStatusHint}</span>
              )}
            </div>
            </div>
          </div>
        </div>
      ) : mode === "shop" ? (
        /* ── 装扮馆：积分换装扮 ── */
        <div className="flex flex-col h-full min-h-0 relative bg-gradient-to-b from-[#faf5ff] to-[#fff7ed]">
          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b border-violet-200/80">
            <button
              type="button"
              onClick={() => setMode("companion")}
              className="text-xs font-bold text-tino-orange active:opacity-60 transition-opacity"
            >
              ← 返回
            </button>
            <span className="text-[11px] font-black text-violet-700 tabular-nums">
              ⭐ {diamonds} 积分
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide min-h-0">
            <p className="text-[10px] text-[#9b87c8] mb-2 text-center leading-snug">
              说英文得积分；用积分解锁装扮，聊天室里的「你」会穿上～
            </p>
            <div className="grid grid-cols-2 gap-2">
              {OUTFITS.map((outfit) => {
                const owned = ownedOutfits.includes(outfit.id);
                const isActive = activeOutfit === outfit.id;
                const canBuy = diamonds >= outfit.price;
                return (
                  <div
                    key={outfit.id}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-colors ${
                      isActive ? "border-amber-400 bg-amber-50/80" : "border-gray-200 bg-white/90"
                    }`}
                  >
                    <div
                      className="relative w-11 h-11 rounded-full overflow-visible flex items-center justify-center"
                      style={outfit.ringStyle || undefined}
                    >
                      <Image
                        src={portraitUser}
                        alt=""
                        width={40}
                        height={40}
                        className="rounded-full object-cover object-top"
                        style={{ filter: outfit.imgFilter }}
                      />
                      {outfit.badge && (
                        <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-base leading-none">
                          {outfit.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-tino-brown text-center leading-tight">
                      {outfit.name}
                    </span>
                    {owned ? (
                      <button
                        type="button"
                        onClick={() => setActiveOutfit(outfit.id)}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold transition-colors ${
                          isActive
                            ? "bg-amber-500 text-white"
                            : "bg-gray-100 text-tino-brown active:bg-gray-200"
                        }`}
                      >
                        {isActive ? "使用中" : "穿戴"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => buyOutfit(outfit)}
                        disabled={!canBuy}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold transition-colors ${
                          canBuy
                            ? "bg-amber-400 text-white active:bg-amber-500"
                            : "bg-gray-200 text-gray-400 cursor-not-allowed"
                        }`}
                      >
                        {outfit.price} 积分
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : mode === "bottle" ? (
        /* ── drift bottle ── */
        <div
          className="flex flex-col h-full min-h-0 relative overflow-hidden select-none"
          style={{
            background:
              "linear-gradient(180deg, #0f2d5e 0%, #1768a8 30%, #20a4d4 60%, #5fd8f5 85%, #8ae8ff 100%)",
          }}
        >

          {/* Stars — twinkling for kids */}
          {[...Array(18)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white star-twinkle"
              style={{
                width: i % 3 === 0 ? 3 : 2,
                height: i % 3 === 0 ? 3 : 2,
                top: `${2 + (i * 7) % 28}%`,
                left: `${4 + (i * 14) % 92}%`,
                "--twinkle-dur": `${2 + (i % 4) * 0.8}s`,
                "--twinkle-delay": `${(i * 0.4) % 3}s`,
              } as React.CSSProperties}
            />
          ))}

          {/* Floating bubbles */}
          {[...Array(6)].map((_, i) => (
            <div
              key={`b${i}`}
              className="absolute rounded-full bubble-up pointer-events-none"
              style={{
                width: 4 + (i % 3) * 3,
                height: 4 + (i % 3) * 3,
                bottom: "10%",
                left: `${10 + i * 15}%`,
                background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.5), rgba(255,255,255,0.15))",
                "--bubble-dur": `${4 + (i % 3) * 2}s`,
                "--bubble-delay": `${i * 1.2}s`,
              } as React.CSSProperties}
            />
          ))}

          {/* Moon — bigger & warmer */}
          <div
            className="absolute top-2 right-3 w-9 h-9 rounded-full"
            style={{
              background: "radial-gradient(circle at 40% 40%, #fffbe6, #ffe49c)",
              boxShadow: "0 0 20px rgba(255,240,180,0.7), 0 0 60px rgba(255,210,120,0.3)",
            }}
            aria-hidden
          />

          {/* Header */}
          <div className="px-2 pt-1 flex-shrink-0 relative z-10">
            <button
              type="button"
              onClick={() => setMode("companion")}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-white/90 pl-2 pr-3 py-2 min-h-[44px] rounded-2xl bg-white/10 active:bg-white/25 transition-colors"
              style={{ backdropFilter: "blur(4px)" }}
            >
              <span className="text-[14px] leading-none" aria-hidden>‹</span>
              返回
            </button>
          </div>

          {/* Content */}
          <div
            className={`flex-1 relative z-10 flex flex-col min-h-0 px-4 ${
              bottleSubState === "menu"
                ? "pb-[52px]"
                : bottleSubState === "inbox"
                  ? "pb-[52px] pt-1 items-stretch"
                  : "items-center justify-center pb-10"
            }`}
          >

            {/* MENU — kids-friendly: big colorful buttons */}
            {bottleSubState === "menu" && (
              <div className="flex-1 flex flex-col min-h-0 w-full items-center px-1">
                <div className="flex-1 min-h-0" />

                <div className="flex-shrink-0 flex flex-col items-stretch w-full max-w-[220px] gap-3 pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBottleSubState("throw_input");
                      setBottleInput("");
                      setBottleAudioBase64("");
                      setBottleAudioMime("");
                      setBottleThrowError(null);
                    }}
                    className="btn-kid w-full min-h-[58px] rounded-[24px] flex items-center justify-center px-4"
                    style={{
                      background: "linear-gradient(135deg, #ff9a56 0%, #ff6b35 100%)",
                      boxShadow: "0 5px 0 #c44e1a, 0 8px 16px rgba(255,100,40,0.3)",
                    }}
                  >
                    <span className="text-[16px] font-extrabold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>扔瓶子</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePickBottle}
                    className="btn-kid w-full min-h-[58px] rounded-[24px] flex items-center justify-center px-4"
                    style={{
                      background: "linear-gradient(135deg, #4dd9c0 0%, #20b2aa 100%)",
                      boxShadow: "0 5px 0 #148a82, 0 8px 16px rgba(32,178,170,0.3)",
                    }}
                  >
                    <span className="text-[16px] font-extrabold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>捞瓶子</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBottleSubState("inbox");
                      fetchBottleInbox();
                    }}
                    className="btn-kid relative w-full min-h-[58px] rounded-[24px] flex items-center justify-center px-4"
                    style={{
                      background: "linear-gradient(135deg, #b088f9 0%, #8b5cf6 100%)",
                      boxShadow: "0 5px 0 #6335c4, 0 8px 16px rgba(139,92,246,0.3)",
                    }}
                  >
                    <span className="text-[16px] font-extrabold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.15)" }}>收件箱</span>
                    {bottleInboxUnread > 0 && (
                      <span className="absolute -top-1.5 -right-1 min-w-[24px] h-[24px] px-1.5 rounded-full bg-[#ff4757] text-white text-[12px] font-black flex items-center justify-center border-2 border-white shadow-md tabular-nums animate-bounce"
                            style={{ animationDuration: "1.5s" }}>
                        {bottleInboxUnread > 9 ? "9+" : bottleInboxUnread}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* THROW INPUT — voice */}
            {bottleSubState === "throw_input" && (
              <div className="flex flex-col items-center gap-5 pop-in w-full">
                <div className="flex flex-col items-center gap-2.5 min-h-[72px] justify-center px-2">
                  {isRecording ? (
                    <>
                      <div className="flex gap-2.5 items-end">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="w-[3px] rounded-full bg-[#ffb347] animate-bounce"
                            style={{ height: 8 + (i % 3) * 8, animationDelay: `${i * 100}ms` }}
                          />
                        ))}
                      </div>
                      <p className="text-white text-[14px] font-extrabold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                        我在听哦…🎤
                      </p>
                    </>
                  ) : isTranscribing ? (
                    <p className="text-white/85 text-[14px] font-bold animate-pulse">稍等一下哦～</p>
                  ) : bottleInput ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-[10px] text-white/50 font-semibold">你说的是：</p>
                      <p className="text-white text-[15px] font-extrabold text-center leading-relaxed px-3 py-2 rounded-2xl bg-white/10">{bottleInput}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[32px] leading-none">🎤</span>
                      <p className="text-white/85 text-[13px] font-bold text-center leading-snug">
                        按住侧面按钮说话吧！
                      </p>
                      <p className="text-white/55 text-[11px] font-semibold text-center mt-1">
                        漂流瓶请用英文哦
                      </p>
                    </div>
                  )}
                </div>

                {bottleThrowError && (
                  <p className="text-[#ffccc8] text-[12px] font-bold text-center px-4 -mt-2">
                    {bottleThrowError}
                  </p>
                )}

                {bottleInput && (
                  <div className="flex flex-nowrap justify-center items-stretch gap-2 px-2 w-full max-w-[320px] mx-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setBottleInput("");
                        setBottleAudioBase64("");
                        setBottleAudioMime("");
                        setBottleThrowError(null);
                      }}
                      className="btn-kid flex-none w-[36%] min-h-[40px] px-2 text-white/85 text-[12px] font-bold rounded-2xl bg-white/10 active:bg-white/20 transition-colors"
                    >
                      重新说
                    </button>
                    <button
                      type="button"
                      onClick={handleThrowBottle}
                      className="btn-kid flex-1 min-w-0 min-h-[40px] px-3 rounded-[18px] text-white text-[14px] font-black"
                      style={{
                        background: "linear-gradient(135deg, #ff9a56, #ff6b35)",
                        boxShadow: "0 4px 0 #c44e1a, 0 6px 12px rgba(255,100,40,0.3)",
                      }}
                    >
                      扔出去
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* THROWING ANIMATION */}
            {bottleSubState === "throwing" && (
              <div className="flex flex-col items-center gap-4">
                <div className="bottle-throw text-[58px] leading-none">🫙</div>
                <p className="text-white text-[15px] font-extrabold text-center px-4"
                   style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  嗖——飞出去啦！
                </p>
              </div>
            )}

            {/* THROW DONE */}
            {bottleSubState === "throw_done" && (
              <div className="flex flex-col items-center gap-3.5 pop-in px-3">
                <div className="text-[52px] leading-none">🎉</div>
                <p className="text-white text-[17px] font-black text-center"
                   style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  太棒了！漂走啦～
                </p>
                <p className="text-white/70 text-[12px] text-center leading-relaxed font-semibold">
                  也许有小朋友会捡到哦
                </p>
                <button
                  type="button"
                  onClick={() => setBottleSubState("menu")}
                  className="btn-kid mt-1 min-h-[48px] px-6 rounded-[20px] text-white text-[14px] font-extrabold"
                  style={{
                    background: "linear-gradient(135deg, #4dd9c0, #20b2aa)",
                    boxShadow: "0 4px 0 #148a82, 0 6px 12px rgba(32,178,170,0.25)",
                  }}
                >
                  好的
                </button>
              </div>
            )}

            {/* PICKING ANIMATION */}
            {bottleSubState === "picking" && (
              <div className="flex flex-col items-center gap-4">
                <div className="text-[52px] leading-none animate-bounce" style={{ animationDuration: "0.8s" }}>🎣</div>
                <p className="text-white text-[14px] font-extrabold"
                   style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  正在捞…
                </p>
                <div className="flex gap-2 items-center">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-[#4dd9c0] animate-bounce"
                      style={{ animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* PICKED — show bottle message */}
            {bottleSubState === "picked" && pickedBottle && (
              <div className="flex flex-col items-center gap-4 pop-in w-full">
                {pickedBottle.id ? (
                  <>
                    <div className="flex flex-col items-center gap-1.5 w-full max-w-[260px]">
                      <p className="text-white/60 text-[11px] font-semibold text-center">
                        来自 {pickedBottle.senderName}
                      </p>
                      {pickedBottle.audioBase64 && (
                        <button
                          onClick={() => playAudioBase64(pickedBottle.audioBase64!, "friend")}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 active:bg-white/25 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-white/90 shrink-0" aria-hidden>
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          <div className="flex gap-[2px] items-end">
                            {[5,9,6,11,7,10,5,8].map((h, i) => (
                              <div key={i} className="w-[2px] rounded-full bg-white/70" style={{ height: h }} />
                            ))}
                          </div>
                          <span className="text-white/60 text-[10px] font-bold">播放</span>
                        </button>
                      )}
                      <div className="w-full rounded-2xl bg-white/12 border border-white/20 px-3 py-2.5 mt-1">
                        <p className="text-white text-[14px] font-bold text-center leading-relaxed">
                          {pickedBottle.content}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-nowrap w-full max-w-[280px] gap-2 px-1">
                      <button
                        type="button"
                        onClick={() => setBottleSubState("menu")}
                        className="btn-kid flex-1 min-w-0 min-h-[40px] px-2 rounded-[16px] text-white/85 text-[12px] font-bold bg-white/10 active:bg-white/20 transition-colors"
                      >
                        放回大海
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBottleSubState("replying");
                          setBottleReplyInput("");
                        }}
                        className="btn-kid flex-1 min-w-0 min-h-[40px] px-2 rounded-[16px] text-white text-[13px] font-black"
                        style={{
                          background: "linear-gradient(135deg, #ff9a56, #ff6b35)",
                          boxShadow: "0 3px 0 #c44e1a, 0 4px 10px rgba(255,100,40,0.22)",
                        }}
                      >
                        回一句
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4 px-3">
                    <div className="text-[48px] leading-none">🐟</div>
                    <p className="text-white text-[14px] font-bold text-center leading-snug"
                       style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                      {pickedBottle.content}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setBottleSubState("throw_input");
                        setBottleInput("");
                      }}
                      className="btn-kid min-h-[50px] px-5 rounded-[20px] text-white text-[14px] font-black"
                      style={{
                        background: "linear-gradient(135deg, #ff9a56, #ff6b35)",
                        boxShadow: "0 4px 0 #c44e1a, 0 6px 10px rgba(255,100,40,0.25)",
                      }}
                    >
                      我来扔一个！
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* REPLYING — voice */}
            {bottleSubState === "replying" && (
              <div className="flex flex-col items-center gap-5 pop-in w-full px-2">
                <div className="flex flex-col items-center gap-2.5 min-h-[72px] justify-center">
                  {isRecording ? (
                    <>
                      <div className="flex gap-2.5 items-end">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="w-[3px] rounded-full bg-[#b088f9] animate-bounce"
                            style={{ height: 8 + (i % 3) * 8, animationDelay: `${i * 100}ms` }}
                          />
                        ))}
                      </div>
                      <p className="text-white text-[14px] font-extrabold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                        我在听哦…🎤
                      </p>
                    </>
                  ) : isTranscribing ? (
                    <p className="text-white/85 text-[14px] font-bold animate-pulse">稍等一下哦～</p>
                  ) : bottleReplyInput ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-[10px] text-white/50 font-semibold">你的回复：</p>
                      <p className="text-white text-[15px] font-extrabold text-center leading-relaxed px-3 py-2 rounded-2xl bg-white/10">{bottleReplyInput}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[32px] leading-none">💬</span>
                      <p className="text-white/85 text-[13px] font-bold text-center leading-snug">
                        按住侧面按钮回话吧！
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setBottleSubState("picked");
                      setBottleReplyInput("");
                    }}
                    className="btn-kid min-h-[44px] px-4 text-white/80 text-[13px] font-bold rounded-2xl bg-white/10 active:bg-white/20 transition-colors"
                  >
                    返回
                  </button>
                  {bottleReplyInput && (
                    <button
                      type="button"
                      onClick={() => setBottleReplyInput("")}
                      className="btn-kid min-h-[44px] px-4 text-white/80 text-[13px] font-bold rounded-2xl bg-white/10 active:bg-white/20 transition-colors"
                    >
                      重新说
                    </button>
                  )}
                  {bottleReplyInput && (
                    <button
                      type="button"
                      onClick={handleReplyBottle}
                      disabled={bottleLoading}
                      className="btn-kid min-h-[48px] px-5 rounded-[20px] text-white text-[15px] font-black disabled:opacity-40"
                      style={{
                        background: "linear-gradient(135deg, #b088f9, #8b5cf6)",
                        boxShadow: "0 4px 0 #6335c4, 0 6px 12px rgba(139,92,246,0.3)",
                      }}
                    >
                      {bottleLoading ? "发送中…" : "发出去"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* REPLY DONE */}
            {bottleSubState === "reply_done" && (
              <div className="flex flex-col items-center gap-3.5 pop-in px-3">
                <div className="text-[52px] leading-none">🎉</div>
                <p className="text-white text-[17px] font-black text-center"
                   style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  回信成功啦！
                </p>
                <p className="text-white/70 text-[12px] text-center leading-relaxed font-semibold">
                  对方能看到你的话啦
                </p>
                <button
                  type="button"
                  onClick={() => setBottleSubState("menu")}
                  className="btn-kid mt-1 min-h-[48px] px-6 rounded-[20px] text-white text-[14px] font-extrabold"
                  style={{
                    background: "linear-gradient(135deg, #b088f9, #8b5cf6)",
                    boxShadow: "0 4px 0 #6335c4, 0 6px 12px rgba(139,92,246,0.25)",
                  }}
                >
                  太棒了
                </button>
              </div>
            )}

            {/* INBOX */}
            {bottleSubState === "inbox" && (
              <div className="w-full flex flex-col gap-2.5 flex-1 min-h-0 max-w-[230px] self-center">
                <p className="text-white text-[15px] font-black text-center shrink-0"
                   style={{ textShadow: "0 1px 3px rgba(0,0,0,0.2)" }}>
                  我的回信
                </p>
                <div className="flex-1 min-h-0 w-full flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: 160 }}>
                  {bottleLoading ? (
                    <div className="flex justify-center py-10">
                      <div className="flex gap-2 items-center">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="w-2.5 h-2.5 rounded-full bg-[#b088f9] animate-bounce"
                            style={{ animationDelay: `${i * 180}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : bottleInbox.length === 0 ? (
                    <div className="flex flex-col items-center gap-3.5 py-6 px-2">
                      <div className="text-[44px] leading-none" aria-hidden>📭</div>
                      <p className="text-white/85 text-[13px] font-bold text-center leading-snug">
                        还没有回信
                      </p>
                      <p className="text-white/55 text-[11px] text-center font-medium">先去扔个瓶子吧～</p>
                      <button
                        type="button"
                        onClick={() => {
                          setBottleSubState("throw_input");
                          setBottleInput("");
                        }}
                        className="btn-kid min-h-[48px] px-5 rounded-[20px] text-white text-[14px] font-black"
                        style={{
                          background: "linear-gradient(135deg, #ff9a56, #ff6b35)",
                          boxShadow: "0 4px 0 #c44e1a, 0 6px 10px rgba(255,100,40,0.25)",
                        }}
                      >
                        去扔一个！
                      </button>
                    </div>
                  ) : (
                    bottleInbox.map((b, i) => (
                      <div key={i} className="flex flex-col gap-1.5 rounded-2xl bg-white/12 border border-white/20 px-3 py-2.5">
                        <p className="text-white/55 text-[10px] font-semibold leading-relaxed">我说：{b.content}</p>
                        <p className="text-white text-[13px] font-bold leading-relaxed">
                          {b.reply.repliedByName}：{b.reply.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setBottleSubState("menu")}
                  className="btn-kid shrink-0 w-full min-h-[48px] rounded-[20px] text-white text-[14px] font-extrabold"
                  style={{
                    background: "linear-gradient(135deg, #4dd9c0, #20b2aa)",
                    boxShadow: "0 4px 0 #148a82, 0 6px 10px rgba(32,178,170,0.25)",
                  }}
                >
                  回到海边
                </button>
              </div>
            )}
          </div>

          {/* Ocean waves — layered for depth */}
          <div className="absolute bottom-0 inset-x-0 pointer-events-none overflow-hidden" style={{ height: 52 }}>
            <div className="wave-anim absolute inset-0" style={{ display: "flex", width: "200%", height: "100%", animationDuration: "6s" }}>
              <svg viewBox="0 0 400 52" style={{ width: "50%", height: "100%" }} preserveAspectRatio="none">
                <path d="M0,20 C50,8 100,32 150,20 C200,8 250,32 300,20 C350,8 395,18 400,20 L400,52 L0,52 Z" fill="rgba(255,255,255,0.12)" />
              </svg>
              <svg viewBox="0 0 400 52" style={{ width: "50%", height: "100%" }} preserveAspectRatio="none">
                <path d="M0,20 C50,8 100,32 150,20 C200,8 250,32 300,20 C350,8 395,18 400,20 L400,52 L0,52 Z" fill="rgba(255,255,255,0.12)" />
              </svg>
            </div>
            <div className="wave-anim absolute inset-0" style={{ display: "flex", width: "200%", height: "100%", animationDuration: "4s", animationDirection: "reverse" }}>
              <svg viewBox="0 0 400 52" style={{ width: "50%", height: "100%" }} preserveAspectRatio="none">
                <path d="M0,30 C60,16 130,44 200,30 C270,16 340,44 400,30 L400,52 L0,52 Z" fill="rgba(150,230,255,0.15)" />
              </svg>
              <svg viewBox="0 0 400 52" style={{ width: "50%", height: "100%" }} preserveAspectRatio="none">
                <path d="M0,30 C60,16 130,44 200,30 C270,16 340,44 400,30 L400,52 L0,52 Z" fill="rgba(150,230,255,0.15)" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        /* ── room: portrait — speaker character center, chat overlay bottom ── */
        <div className="relative h-full min-h-0 overflow-hidden" style={{ background: "linear-gradient(180deg, #5bc8f5 0%, #a8dff5 28%, #fdf6e3 62%, #fde4a0 100%)" }}>

          {/* Volume toast */}
          {showVolume && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {/* Translation popup */}
          {/* Exit button */}
          <button
            className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1 bg-white/55 backdrop-blur-sm text-[#2a5a8a] text-[11px] font-bold px-2.5 py-1.5 rounded-full active:bg-white/75 transition-colors border border-white/60 shadow-sm"
            onClick={() => { if (showExitConfirm) leaveRoom(); else setShowExitConfirm(true); }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            退出
          </button>

          {/* Exit confirm toast */}
          {showExitConfirm && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 bg-white/80 text-[#2a5a8a] text-[10px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap pointer-events-none shadow-md border border-white/60 backdrop-blur-sm">
              再次点击退出聊天
            </div>
          )}

          {/* Radial warm stage — softens character edges on sunny background */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse 88% 75% at 50% 36%, rgba(255,252,230,0.92) 0%, rgba(255,240,180,0.45) 50%, transparent 72%)`
            }}
          />

          {/* Speaker character — full screen, multiply removes white bg naturally */}
          <div className="absolute inset-0">
            {centerSpeaker === "tino" ? (
              <Image
                src={portraitBuddy}
                alt="布迪"
                fill
                sizes="210px"
                className="object-contain"
                style={{ mixBlendMode: "multiply", objectPosition: "center 25%" }}
                priority
              />
            ) : centerSpeaker === "ai_buddy" ? (
              <Image
                src={portraitPartner}
                alt="Partner"
                fill
                sizes="210px"
                className="object-contain"
                style={{ mixBlendMode: "multiply", objectPosition: "center 25%" }}
              />
            ) : centerSpeaker === "user" ? (
              <div className="absolute inset-0">
                <Image
                  src={portraitUser}
                  alt="User"
                  fill
                  sizes="210px"
                  className="object-contain"
                  style={{
                    mixBlendMode: "multiply",
                    objectPosition: "center 25%",
                    filter: activeOutfitDef.imgFilter,
                  }}
                />
                {activeOutfitDef.badge && (
                  <span
                    className="absolute top-[5%] left-1/2 -translate-x-1/2 text-4xl pointer-events-none select-none drop-shadow-md z-10"
                    aria-hidden
                  >
                    {activeOutfitDef.badge}
                  </span>
                )}
              </div>
            ) : (
              <Image
                src={portraitPartner}
                alt="Friend"
                fill
                sizes="210px"
                className="object-contain"
                style={{ mixBlendMode: "multiply", objectPosition: "center 25%" }}
              />
            )}
          </div>



          {/* Bottom gradient fade — warm cream */}
          <div
            className="absolute bottom-0 inset-x-0 pointer-events-none"
            style={{ height: "55%", background: "linear-gradient(to top, rgba(253,228,155,0.97) 30%, rgba(253,240,200,0.75) 60%, transparent)" }}
          />

          {/* BOTTOM chat overlay */}
          <div className="absolute bottom-0 inset-x-0 z-10 pb-2 flex flex-col gap-1.5">
            {diamondDelta !== null && (
              <div className="w-full flex justify-center pointer-events-none shrink-0 px-0">
                <div
                  key={pointsHintKey}
                  className="points-hint flex justify-center"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="text-[11px] font-semibold text-violet-800 bg-white/85 backdrop-blur-sm px-2.5 py-1 rounded-full border border-violet-300/70 shadow-[0_2px_12px_rgba(91,33,182,0.18)]">
                    +{diamondDelta} 积分
                  </span>
                </div>
              </div>
            )}
            <div className="px-2.5">
            {(() => {
              const navMsgs = roomMsgs.filter((m) => m.sender !== "system");
              const totalNav = navMsgs.length;
              const viewIdx = totalNav === 0 ? -1 : Math.max(0, totalNav - 1 - roomViewOffset);
              const viewedMsg = viewIdx >= 0 ? navMsgs[viewIdx] : null;
              const canPrev = viewIdx > 0;
              const canNext = roomViewOffset > 0;

              const isTino = viewedMsg?.sender === "tino";
              const isBuddy = viewedMsg?.sender === "ai_buddy";
              const isUser = viewedMsg?.sender === "user";
              const isAISender = isTino || isBuddy;
              const cardName = isTino
                ? "Tino"
                : isBuddy
                ? (aiBuddyName || "布迪")
                : isUser
                ? (userName || "我")
                : (partner?.name || "小伙伴");
              const cardTranslation = viewedMsg ? roomTranslations[viewedMsg.id] : undefined;
              const isLatest = viewIdx === totalNav - 1;
              const isTyping = isLoading && isLatest && !isUser;

              return (
                <>
                  {/* System pills */}
                  {roomMsgs.filter((m) => m.sender === "system").slice(-2).map((m) => (
                    <div key={m.id} className="flex justify-center mb-1">
                      <span className="text-[9px] text-[#6a8aaa] bg-white/50 px-2.5 py-0.5 rounded-full">{m.content}</span>
                    </div>
                  ))}

                  {/* Speaker name badge — 气泡上方居中（旧版） */}
                  {viewedMsg && (
                    <div className="flex justify-center mb-1.5">
                      <span className="bg-white/70 backdrop-blur-sm text-[#1a4a7a] text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm border border-white/60">
                        {cardName}
                        {isAISender && <span className="ml-1 text-[8px] text-[#f59e0b]">AI</span>}
                      </span>
                    </div>
                  )}

                  {/* Message card */}
                  <div className="bg-white/65 backdrop-blur-md rounded-[16px] border border-white/80 min-h-[56px] shadow-md overflow-hidden">
                    <div className="px-3.5 py-2.5">
                      {isTyping ? (
                        <div className="flex gap-1.5 items-center h-8">
                          {[0,1,2].map(i => (
                            <span key={i} className="w-2.5 h-2.5 rounded-full bg-[#5bc8f5] animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                          ))}
                        </div>
                      ) : viewedMsg ? (
                        <div className="max-h-[72px] overflow-y-auto scrollbar-hide">
                          <p className="text-[14px] font-black text-[#1a2e4a] leading-snug whitespace-pre-wrap">
                            {viewedMsg.content}
                          </p>
                          {cardTranslation && (
                            <p className="text-[10px] text-[#5a7a9a] leading-snug mt-1">{cardTranslation}</p>
                          )}
                          {!cardTranslation && !isUser && (
                            <p className="text-[9px] text-[#b0c8d8] mt-0.5">翻译中...</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[12px] text-[#a0b8c8]">等待聊天开始…</p>
                      )}
                    </div>
                  </div>

                  {/* Status */}
                  <div className="flex justify-center mt-1.5">
                    <span className={`text-[11px] font-bold ${companionStatusAccent}`}>{statusText}</span>
                    {companionStatusHint && (
                      <span className="text-[9px] text-[#c4a0b0] ml-1.5">{companionStatusHint}</span>
                    )}
                  </div>
                </>
              );
            })()}
            </div>
          </div>
        </div>
      )}
      </div>
      </DeviceFrame>
    </>
  );
}
