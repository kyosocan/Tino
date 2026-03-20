"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import DeviceFrame from "@/components/DeviceFrame";
import TinoAvatar from "@/components/TinoAvatar";
import tinoPortrait from "@/scripts/ai_api/人物像.png";
import avatarUser from "@/scripts/ai_api/头像  user.png";
import avatarBuddy from "@/scripts/ai_api/头像 2.png";
import avatarFriend from "@/scripts/ai_api/头像 1.png";
import type {
  Message,
  AppMode,
  RoomPartner,
  MessageSender,
} from "@/lib/types";

/* ───────── constants ───────── */

/** Split a complete text into individual sentences for sentence-by-sentence TTS.
 *
 * Rules:
 *  1. Always split on \n (newline = natural pause boundary).
 *  2. Line contains Chinese  → split only on 。 (period); ！？ no longer split.
 *  3. Pure-English line      → split on . only when followed by
 *     space + uppercase letter, or at end of string; ! and ? no longer split.
 */
function splitIntoSentences(text: string): string[] {
  const results: string[] = [];

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const hasChinese = /[\u4e00-\u9fff]/.test(line);

    if (hasChinese) {
      /* Chinese / mixed: split only on Chinese full-stop 。 */
      const chunks = line.split(/(。+)/);
      for (let i = 0; i < chunks.length; i += 2) {
        const combined = ((chunks[i] ?? "") + (chunks[i + 1] ?? "")).trim();
        if (combined) results.push(combined);
      }
    } else {
      /* Pure English: split on . only when followed by space+uppercase or end */
      let current = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        current += ch;
        if (ch === ".") {
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
 * After step 1 a reading card appears; the remaining steps fire when the card is dismissed. */
const ONBOARDING_STEPS = [
  { delay: 1500, text: "我是 Tino，你的英语聊天小伙伴！\n我们可以一起聊天、玩游戏，还能认识新朋友～" },
  { delay: 6500, text: "遇到新朋友就可以说这句话：Nice to meet you！" },
];

const ROOM_DURATION = 300;


function formatRoomTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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

function scoreEnglish(text: string): number {
  const words = text.match(/[a-zA-Z]{2,}/g) || [];
  if (words.length === 0) return 0;
  let score = 0;
  for (const w of words) {
    if (w.length <= 3) score += 1;
    else if (w.length <= 6) score += 2;
    else score += 3;
  }
  if (/[A-Z][a-z].*\s[a-z]/.test(text) && words.length >= 3) score += 2;
  return score;
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

function loadCompanionMemory(name: string, grade: number): CompanionMemory {
  try {
    const raw = localStorage.getItem(getCompanionMemoryKey(name, grade));
    if (!raw) return createEmptyCompanionMemory();
    const parsed = JSON.parse(raw) as Partial<CompanionMemory>;
    const sanitizedMemories = Array.isArray(parsed.memories)
      ? parsed.memories
          .map((item) => toPreferenceMemory(String(item || "")))
          .filter((item): item is string => Boolean(item))
          .slice(0, 6)
      : [];
    return {
      ...createEmptyCompanionMemory(),
      ...parsed,
      memories: sanitizedMemories,
    };
  } catch {
    return createEmptyCompanionMemory();
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

/* ───────── avatar frames ───────── */

const FRAMES = [
  { id: "none", name: "默认", price: 0, style: {} as React.CSSProperties },
  { id: "gold", name: "金色光环", price: 30, style: { border: "3px solid #FFD700", boxShadow: "0 0 8px rgba(255,215,0,0.6)" } as React.CSSProperties },
  { id: "ice", name: "冰晶之环", price: 40, style: { border: "3px solid #87CEEB", boxShadow: "0 0 10px rgba(135,206,235,0.7)" } as React.CSSProperties },
  { id: "nature", name: "自然之力", price: 50, style: { border: "3px solid #3CB371", boxShadow: "0 0 8px rgba(60,179,113,0.6)" } as React.CSSProperties },
  { id: "fire", name: "烈焰之环", price: 80, style: { border: "3px solid #FF4500", boxShadow: "0 0 10px rgba(255,69,0,0.7)" } as React.CSSProperties },
  { id: "star", name: "星光闪耀", price: 100, style: { border: "3px solid #9370DB", boxShadow: "0 0 12px rgba(147,112,219,0.8)" } as React.CSSProperties },
  { id: "rainbow", name: "彩虹幻境", price: 150, style: { border: "3px solid #ff6b6b", boxShadow: "0 0 12px rgba(255,107,107,0.5), 0 0 24px rgba(107,181,255,0.3)" } as React.CSSProperties },
];

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
  const companionMemoryRef = useRef<CompanionMemory>(createEmptyCompanionMemory());

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
  const icebreakerDoneRef = useRef(false);
  useEffect(() => { icebreakerDoneRef.current = icebreakerDone; }, [icebreakerDone]);
  const [roomReady, setRoomReady] = useState(false);
  const [aiBuddyName, setAiBuddyName] = useState("");
  const roomBottomRef = useRef<HTMLDivElement>(null);

  /* room message card navigation (0 = show latest) */
  const [roomViewOffset, setRoomViewOffset] = useState(0);
  const [roomTranslations, setRoomTranslations] = useState<Record<string, string>>({});

  /* post-room debrief */
  const [pendingDebrief, setPendingDebrief] = useState<string[] | null>(null);

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

  /* icebreaker: resolver called when user sends their first reply */
  const icebreakerResolveRef = useRef<(() => void) | null>(null);

  /* silence hint: track isSpeaking prev value to detect true→false */
  const wasSpeakingRef = useRef(false);

  /* translation popup */
  const [translationPopup, setTranslationPopup] = useState<{
    chinese: string;
    english: string;
    words: { word: string; phonetic: string }[];
    voiceGuide: string;
    loading: boolean;
  } | null>(null);

  /* silence hint (room mode: shown after 7s without user speaking) */
  const SILENCE_HINT_POOL = [
    { en: "That's so cool!", zh: "太酷了！" },
    { en: "Really? Tell me more!", zh: "真的吗？再说说！" },
    { en: "I think so too!", zh: "我也这么觉得！" },
    { en: "Wow, amazing!", zh: "哇，太棒了！" },
    { en: "What do you like to do?", zh: "你喜欢做什么？" },
    { en: "Me too!", zh: "我也是！" },
    { en: "That sounds fun!", zh: "听起来很好玩！" },
  ] as const;
  const [showSilenceHint, setShowSilenceHint] = useState(false);
  const [silenceHintPhrases, setSilenceHintPhrases] = useState<{ en: string; zh: string }[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  const [showAddFriend, setShowAddFriend] = useState(false);
  type CallingFriend = { name: string; emoji: string; avatarColor: string };
  const [callingFriend, setCallingFriend] = useState<CallingFriend | null>(null);

  /* diamonds / frames */
  const [diamonds, setDiamonds] = useState(0);
  const [diamondDelta, setDiamondDelta] = useState<number | null>(null);
  const [ownedFrames, setOwnedFrames] = useState<string[]>(["none"]);
  const [activeFrame, setActiveFrame] = useState("none");

  useEffect(() => {
    try {
      const d = localStorage.getItem("tino_diamonds");
      if (d) setDiamonds(Number(d));
      const o = localStorage.getItem("tino_owned_frames");
      if (o) setOwnedFrames(JSON.parse(o));
      const a = localStorage.getItem("tino_active_frame");
      if (a) setActiveFrame(a);
      const fl = localStorage.getItem("tino_friends_list");
      if (fl) setFriendsList(JSON.parse(fl));

      localStorage.removeItem("tino_user_id");
      const savedUserId = sessionStorage.getItem("tino_user_id");
      const name = "小明";
      const grade = 1;
      const memory = loadCompanionMemory(name, grade);
      const sessionUserId = savedUserId || generateUserId();
      const greeting = buildCompanionGreeting(name, memory);
      sessionStorage.setItem("tino_user_id", sessionUserId);
      localStorage.setItem("tino_user_name", name);
      localStorage.setItem("tino_user_grade", String(grade));
      setUserId(sessionUserId);
      setUserName(name);
      setUserGrade(grade);
      companionMemoryRef.current = memory;
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
    try { localStorage.setItem("tino_owned_frames", JSON.stringify(ownedFrames)); } catch {}
  }, [ownedFrames]);
  useEffect(() => {
    try { localStorage.setItem("tino_active_frame", activeFrame); } catch {}
  }, [activeFrame]);

  useEffect(() => {
    if (diamondDelta === null) return;
    const t = setTimeout(() => setDiamondDelta(null), 1200);
    return () => clearTimeout(t);
  }, [diamondDelta]);

  const awardDiamonds = useCallback((text: string) => {
    const pts = scoreEnglish(text);
    if (pts > 0) {
      if (modeRef.current === "room") {
        setSessionDiamonds((d) => d + pts);
      } else {
        setDiamonds((d) => d + pts);
      }
      setDiamondDelta(pts);
    }
  }, []);

  const buyFrame = useCallback((frame: typeof FRAMES[number]) => {
    if (diamonds < frame.price || ownedFrames.includes(frame.id)) return;
    setDiamonds((d) => d - frame.price);
    setOwnedFrames((prev) => [...prev, frame.id]);
    setActiveFrame(frame.id);
  }, [diamonds, ownedFrames]);

  const userFrameStyle = FRAMES.find((f) => f.id === activeFrame)?.style || {};

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

  const unlockAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();

    if (!motionGrantedRef.current) {
      motionGrantedRef.current = true; // 防止并发重复请求
      const DM = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      if (typeof DM.requestPermission === "function") {
        // 必须在同步用户手势上下文里调用，此处满足（unlockAudio 由触摸/点击事件触发）
        DM.requestPermission()
          .then((result) => {
            if (result !== "granted") motionGrantedRef.current = false; // 拒绝后允许下次再试
          })
          .catch(() => { motionGrantedRef.current = false; });
      }
    }
  }, []);

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
      unlockAudio();
      const ctx = audioCtxRef.current;
      const gain = gainNodeRef.current;
      if (!ctx || !gain) return;

      ttsPending.current++;
      setIsSpeaking(true);

      const audioReady = (async (): Promise<AudioBuffer | null> => {
        try {
          const binary = atob(audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return await ctx.decodeAudioData(bytes.buffer.slice(0));
        } catch {
          return null;
        }
      })();

      ttsChain.current = ttsChain.current.then(async () => {
        try {
          const audioBuffer = await audioReady;
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
    [highlightSpeaker, unlockAudio]
  );

  /* Map speaker role to TTS voice type */
  const speakerVoiceType = (speaker?: string): string | undefined => {
    if (speaker === "ai_buddy") return "en_male_tim_uranus_bigtts";
    if (speaker === "friend")   return "en_female_dacey_uranus_bigtts";
    return undefined; // tino / user → use server-side default (TTS_VOICE_TYPE)
  };

  const playTTS = useCallback(
    (text: string, speaker?: string, onPlayStart?: () => void) => {
      unlockAudio();

      // English voices don't support Chinese characters — fall back to the default
      // multilingual voice (zh_female_vv) whenever the text contains Chinese.
      const hasChinese = /[\u4e00-\u9fff]/.test(text);
      const voiceType = hasChinese ? undefined : speakerVoiceType(speaker);
      // Include voiceType in cache key so different voices don't collide
      const cacheKey = voiceType ? `${voiceType}:${text}` : text;

      /* Start fetching audio immediately (parallel with any running chain step).
         Check in-memory cache first to avoid redundant network calls. */
      const audioReady = (async (): Promise<AudioBuffer | null> => {
        if (ttsCache.current.has(cacheKey)) return ttsCache.current.get(cacheKey)!;
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voiceType }),
          });
          const data = await res.json();
          if (!data.audioBase64 || data.error) return null;
          const ctx = audioCtxRef.current;
          if (!ctx) return null;
          const buffer = await ctx.decodeAudioData(
            Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)).buffer.slice(0)
          );
          ttsCache.current.set(cacheKey, buffer);
          return buffer;
        } catch {
          return null;
        }
      })();

      /* Reserve a chain slot NOW (in call order) so playback order matches call order
         regardless of which fetch completes first. */
      ttsPending.current++;
      setIsSpeaking(true);

      ttsChain.current = ttsChain.current.then(async () => {
        try {
          const audioBuffer = await audioReady; /* wait for this sentence's fetch */

          if (!audioBuffer) {
            onPlayStart?.();
            return;
          }

          const ctx = audioCtxRef.current;
          const gain = gainNodeRef.current;
          if (!ctx || !gain) return;

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
    [highlightSpeaker, unlockAudio]
  );

  /* Pre-fetch a TTS clip and store in cache so the room view can play it immediately. */
  const prefetchTTS = useCallback(async (text: string) => {
    if (ttsCache.current.has(text)) return;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!data.audioBase64 || data.error) return;
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const buffer = await ctx.decodeAudioData(
        Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0)).buffer.slice(0)
      );
      ttsCache.current.set(text, buffer);
    } catch { /* ignore */ }
  }, []);

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
      const sentenceEnd = /[。.]/;

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
        icebreakerResolveRef.current?.();
        icebreakerResolveRef.current = null;
        clearTimeout(silenceTimerRef.current);
        setShowSilenceHint(false);
        awardDiamonds(text);
        setTranslationPopup(null);
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
        icebreakerResolveRef.current?.();
        icebreakerResolveRef.current = null;
        clearTimeout(silenceTimerRef.current);
        setShowSilenceHint(false);
        awardDiamonds(text);
        setTranslationPopup(null);
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
        setTranslationPopup({ chinese: text, english: "", words: [], voiceGuide: "", loading: true });
        const doTranslate = async () => {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          return {
            english: (data.english || "").trim(),
            words: (data.words || []) as { word: string; phonetic: string }[],
            voiceGuide: (data.voiceGuide || "").trim(),
          };
        };
        try {
          let result = await doTranslate();
          // Retry once if the response is empty (API error or JSON parse failure)
          if (!result.english && result.words.length === 0) {
            result = await doTranslate();
          }
          setTranslationPopup({ chinese: text, english: result.english, words: result.words, voiceGuide: result.voiceGuide, loading: false });
          if (result.voiceGuide) playTTS(result.voiceGuide, "tino");
        } catch {
          setTranslationPopup({ chinese: text, english: "", words: [], voiceGuide: "", loading: false });
        }
        return;
      }
      sendRoom({
        text,
        audioBase64: audioPayload?.audioBase64,
        mimeType: audioPayload?.mimeType,
      });
    },
    [sendRoom]
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

  /* ─── companion: first-visit onboarding sequence ─── */

  /* ─── companion: play greeting TTS when device is powered on ─── */

  const greetingPlayedRef = useRef(false);
  useEffect(() => {
    if (!isPowered || mode !== "companion" || !isAppReady || greetingPlayedRef.current) return;
    const saved = displayText;
    if (!saved) return;
    greetingPlayedRef.current = true;
    setDisplayText("");
    for (const s of splitIntoSentences(saved)) {
      playTTS(s, "tino", () => {
        if (modeRef.current === "companion") setDisplayText(s);
      });
    }
  }, [isPowered, mode, displayText, isAppReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const onboardingDoneRef = useRef(false);

  /* fires when child taps "我会读啦！" on the onboarding reading card */
  const dismissOnboardingReadingCard = useCallback(() => {
    setShowOnboardingReadingCard(false);
    const shakeIntro = "棒极了！🎉\n想认识更多小朋友吗？\n摇一摇设备就能遇到真实的小伙伴！";
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
        /* After step 1 (teach greeting): invite the child to read along */
        if (i === 1) {
          playTTS("来，念一遍吧～", "tino", () => {
            if (modeRef.current === "companion") {
              setDisplayText("来，念一遍吧～");
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
    if (!pendingDebrief) return;

    debriefDeliveredRef.current = true;
    const parts = pendingDebrief;
    setPendingDebrief(null);

    const BASE_DELAY = 1200;
    const timers: ReturnType<typeof setTimeout>[] = [];

    /* header notice */
    timers.push(setTimeout(() => {
      if (modeRef.current !== "companion") return;
      const intro = "刚才跟新朋友聊得怎么样？我觉得超好玩的 😄 跟你说说我发现的事～";
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
  }, [mode, pendingDebrief]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── room: icebreaker warmup ─── */

  useEffect(() => {
    if (mode !== "room" || icebreakerDone) return;

    const AI_BUDDY_NAMES = ["Mia", "Leo", "Sunny", "Max", "Luna", "Coco", "Kai", "Ivy"];
    const buddyName = AI_BUDDY_NAMES[Math.floor(Math.random() * AI_BUDDY_NAMES.length)];
    setAiBuddyName(buddyName);

    let cancelled = false;
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    /** Wrap speakRoomSentences as a Promise so we can await it */
    const speakAsync = (sender: MessageSender, text: string) =>
      new Promise<void>((r) => speakRoomSentences(sender, text, r));

    /** Resolves when user sends their next message (resolver stored in ref) */
    const waitForUser = () =>
      new Promise<void>((r) => { icebreakerResolveRef.current = r; });

    (async () => {
      await delay(600);
      if (cancelled) return;

      const myName = userName || "小朋友";
      const friendName = partnerRef.current?.name || "小伙伴";

      if (!cancelled) setRoomReady(true);

      // Tino 介绍用户这边的孩子，说完后等用户开口
      await speakAsync(
        "tino",
        `Hi everyone! Welcome to English Corner! I'm Tino! This is my friend ${myName}! Say hi, ${myName}!`
      );
      if (cancelled) return;

      await waitForUser();
      if (cancelled) return;

      // AI buddy 介绍对面的小朋友
      await speakAsync(
        "ai_buddy",
        `Hey! I'm ${buddyName}! And I'm here with ${friendName}! Say hi, ${friendName}! Let's all chat in English together!`
      );
      if (cancelled) return;

      setIcebreakerDone(true);
    })();

    return () => {
      cancelled = true;
      /* Unblock any pending waitForUser so the async chain can exit cleanly */
      icebreakerResolveRef.current?.();
      icebreakerResolveRef.current = null;
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

  /* ─── room: silence hint — start 7 s countdown when TTS finishes ─── */

  useEffect(() => {
    if (mode !== "room") {
      clearTimeout(silenceTimerRef.current);
      setShowSilenceHint(false);
      wasSpeakingRef.current = isSpeaking;
      return;
    }

    const wasIt = wasSpeakingRef.current;
    wasSpeakingRef.current = isSpeaking;

    /* Only act on the true → false transition (TTS chain finished) */
    if (!wasIt || isSpeaking) return;

    const last = roomMsgsRef.current[roomMsgsRef.current.length - 1];
    if (!last || last.sender === "user" || last.sender === "system") return;

    clearTimeout(silenceTimerRef.current);
    const lastContent = last.content;
    const isIcebreaker = !icebreakerDoneRef.current;
    silenceTimerRef.current = setTimeout(async () => {
      if (isIcebreaker) {
        /* Icebreaker phase: fixed greeting phrases */
        setSilenceHintPhrases([
          { en: "Hi! Nice to meet you!", zh: "嗨！很高兴认识你！" },
          { en: "Hello, everyone!", zh: "大家好！" },
        ]);
        setShowSilenceHint(true);
      } else {
        /* Chat phase: fetch contextual phrases first, then show popup once */
        const fallback = (() => {
          const pool = [...SILENCE_HINT_POOL];
          const idx1 = Math.floor(Math.random() * pool.length);
          const [p1] = pool.splice(idx1, 1);
          return [p1, pool[Math.floor(Math.random() * pool.length)]];
        })();

        let phrases = fallback;
        try {
          const fetchWithTimeout = Promise.race([
            fetch("/api/suggest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lastMessage: lastContent }),
            }).then((r) => r.json()),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          const data = await fetchWithTimeout;
          if (data && Array.isArray(data.suggestions) && data.suggestions.length === 2) {
            phrases = data.suggestions;
          }
        } catch { /* keep fallback */ }

        setSilenceHintPhrases(phrases);
        setShowSilenceHint(true);
      }
    }, 7000);

    return () => clearTimeout(silenceTimerRef.current);
  }, [isSpeaking, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── silence hint: auto-play voice guide when popup appears ─── */

  useEffect(() => {
    if (!showSilenceHint || silenceHintPhrases.length === 0) return;
    /* Small delay so the popup renders before audio starts */
    const t = setTimeout(() => {
      playTTS(`试试说：${silenceHintPhrases[0].en}`, "tino");
    }, 400);
    return () => clearTimeout(t);
  }, [showSilenceHint]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── voice recording ─── */

  const startRecording = useCallback(async () => {
    if (!isPowered || isRecording) return;
    /* Stop the countdown timer when user starts speaking, but keep the hint
     * popup visible — it will dismiss once the user's message is sent. */
    clearTimeout(silenceTimerRef.current);
    unlockAudio();
    highlightSpeaker("user");
    /* Capture onboarding state NOW (before any async ops). By the time ASR
     * returns the ref will already be false, so we need the snapshot. */
    const isOnboardingRead = onboardingReadingCardRef.current;
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
          if (modeRef.current === "room") {
            await handleRoomMessage(text || "Voice message", {
              audioBase64: b64,
              mimeType: actualMime,
            });
            return;
          }
          if (!text) return;
          /* onboarding reading card: skip AI reply, just let the card auto-dismiss */
          if (isOnboardingRead) return;
          sendMessage(text);
        } catch {
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
  }, [isPowered, isRecording, sendMessage, sendRoom, handleRoomMessage, highlightSpeaker, unlockAudio]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setRecordingError("");
    setIsRecording(false);
  }, []);

  /* ─── device buttons ─── */

  const handlePower = useCallback(() => {
    unlockAudio();
    setIsPowered((p) => !p);
  }, [unlockAudio]);
  const handleVolumeUp = useCallback(() => {
    unlockAudio();
    setVolume((v) => Math.min(v + 1, 10));
    setShowVolume(true);
  }, [unlockAudio]);
  const handleVolumeDown = useCallback(() => {
    unlockAudio();
    setVolume((v) => Math.max(v - 1, 0));
    setShowVolume(true);
  }, [unlockAudio]);

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
        setPendingDebrief(data.parts as string[]);
      }
    } catch { /* silent */ }
  }, [userName]);

  const leaveRoom = useCallback(() => {
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
    setShowAddFriend(false);

    notifyMatchLeave(userId);
  }, [notifyMatchLeave, sessionDiamonds, userId, fetchDebrief]);

  const enterRoom = useCallback(
    async (rid: string, p: RoomPartner) => {
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

      try {
        const raw = localStorage.getItem("tino_friends_list");
        const existing: { name: string; grade: number; lastChatAt: number }[] = raw ? JSON.parse(raw) : [];
        const filtered = existing.filter((f) => f.name !== p.name || f.grade !== p.grade);
        const updated = [{ name: p.name, grade: p.grade, lastChatAt: Date.now() }, ...filtered].slice(0, 20);
        localStorage.setItem("tino_friends_list", JSON.stringify(updated));
        setFriendsList(updated);
      } catch { /* storage unavailable */ }

      /* Pre-fetch the welcome TTS so the room view can play it instantly */
      const myName = userName || "小朋友";
      const welcomeText = `Hi ${myName} and ${p.name || "小伙伴"}! Welcome! 快来互相打个招呼吧～`;
      await prefetchTTS(welcomeText);

      setMode("room");
    },
    [userName, prefetchTTS]
  );

  /* ─── enter AI room after 10s timeout ─── */
  const AI_PARTNER_NAMES = ["Mochi", "小A", "Kiki", "小星", "晴晴"];

  const enterAiRoom = useCallback(() => {
    const name = AI_PARTNER_NAMES[Math.floor(Math.random() * AI_PARTNER_NAMES.length)];
    const aiPartner: RoomPartner = { userId: "ai_partner", name, grade: 0 };
    setMatchingPhase("ai_found");
    setTimeout(async () => {
      setMatchingPhase("waiting");
      setIsAiRoom(true);
      isAiRoomRef.current = true;
      setRoomId("ai_room");
      setPartner(aiPartner);
      setRoomMsgs([]);
      setTimeLeft(ROOM_DURATION);
      setEnglishCount(0);
      endedRef.current = false;
      setActiveSpeaker(null);
      setRoomDisplay(null);
      setSessionDiamonds(0);
      seenMsgIds.current.clear();
      lastPollTimeRef.current = 0;

      /* Pre-fetch the welcome TTS so the room view can play it instantly */
      const myName = userName || "小朋友";
      const welcomeText = `Hi ${myName} and ${aiPartner.name}! Welcome! 快来互相打个招呼吧～`;
      await prefetchTTS(welcomeText);

      setMode("room");
    }, 1800);
  }, [userName, prefetchTTS]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMatch = useCallback(async () => {
    unlockAudio();
    setMode("matching");

    /* after 10s with no real match → arrange an AI partner */
    matchTimeoutRef.current = setTimeout(() => {
      if (matchPollRef.current) clearInterval(matchPollRef.current);
      notifyMatchLeave(userId);
      enterAiRoom();
    }, 10000);

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
            enterRoom(d.roomId, d.partner);
          }
        } catch { /* retry */ }
      }, 1500);
    } catch {
      clearTimeout(matchTimeoutRef.current);
      setMode("companion");
    }
  }, [unlockAudio, userId, userName, userGrade, enterRoom, enterAiRoom, notifyMatchLeave]);

  const cancelMatch = useCallback(() => {
    if (matchPollRef.current) clearInterval(matchPollRef.current);
    if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    notifyMatchLeave(userId);
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

  /* ─── calling screen: enter AI room after 3s using friend's name ─── */

  useEffect(() => {
    if (!callingFriend) return;
    const t = setTimeout(() => {
      const aiPartner: RoomPartner = { userId: "ai_partner", name: callingFriend.name, grade: 0 };
      setCallingFriend(null);
      setIsAiRoom(true);
      isAiRoomRef.current = true;
      setRoomId("ai_room");
      setPartner(aiPartner);
      setRoomMsgs([]);
      setTimeLeft(ROOM_DURATION);
      setEnglishCount(0);
      endedRef.current = false;
      setActiveSpeaker(null);
      setRoomDisplay(null);
      setSessionDiamonds(0);
      seenMsgIds.current.clear();
      lastPollTimeRef.current = 0;
      setMode("room");
    }, 3000);
    return () => clearTimeout(t);
  }, [callingFriend]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setShowAddFriend(false);
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

  /* ─── render ─── */

  return (
    <DeviceFrame
      onVoiceStart={startRecording}
      onVoiceEnd={stopRecording}
      onVolumeUp={handleVolumeUp}
      onVolumeDown={handleVolumeDown}
      onPower={handlePower}
      isRecording={isRecording}
      isSpeaking={isSpeaking}
    >
      {!isAppReady ? (
        /* ── splash screen ── */
        <div
          className="h-full rounded-[8px] bg-gradient-to-b from-[#fde8f0] via-[#fff3f7] to-[#f0ebff] relative overflow-hidden select-none cursor-pointer"
          onClick={() => { unlockAudio(); setIsAppReady(true); }}
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
              <p className="text-[10px] font-semibold text-[#c4a0b0] animate-pulse">轻触屏幕开始</p>
            </div>
          </div>
        </div>
      ) : !isPowered ? (
        <div className="h-full bg-[#111] rounded-[8px] flex items-center justify-center">
          <TinoAvatar size={48} expression="happy" className="opacity-10" />
        </div>
      ) : (mode === "matching" || (mode === "room" && !roomReady)) ? (
        /* ── matching animation (also shown while room TTS is loading) ── */
        <div className="h-full bg-gradient-to-b from-tino-orange/80 to-tino-blue/60 flex flex-col items-center justify-center gap-4 text-white text-center px-4">
          {matchingPhase === "ai_found" ? (
            /* partner found transition */
            <>
              <p className="text-lg font-bold animate-pulse-soft">找到小伙伴了！</p>
              <p className="text-sm opacity-80">马上开始聊天～</p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold animate-pulse-soft">
                Let&apos;s find a friend!
              </p>
              <p className="text-sm opacity-80">正在寻找小伙伴...</p>
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2.5 h-2.5 rounded-full bg-white animate-bounce"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
              <button
                onClick={cancelMatch}
                className="mt-2 px-4 py-1.5 rounded-full bg-white/20 text-white text-xs font-bold active:bg-white/30 transition-colors"
              >
                取消匹配
              </button>
            </>
          )}
        </div>
      ) : mode === "companion" ? (
        /* ── companion: VN-style — avatar bottom-left, speech bubble top-right ── */
        <div className="relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-[#fde8f0] via-[#fff3f7] to-[#f4eeff]">
          {showVolume && (
            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {/* Friends list button — top-left */}
          <button
            onClick={() => setShowFriendsList(true)}
            className="absolute top-2 left-2 z-30 w-8 h-8 rounded-full bg-white/80 border border-[#ecc8d8] shadow-md flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm"
            aria-label="查看好友列表"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c4628a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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

          {/* Friends list — full-page overlay */}
          {showFriendsList && (
            <div className="absolute inset-0 z-40 flex flex-col bg-[#f5eef8]">
              {/* header */}
              <div className="flex items-center justify-between px-4 pt-5 pb-3 flex-shrink-0">
                <button
                  onClick={() => setShowFriendsList(false)}
                  className="flex items-center gap-1.5 text-[#5b3f72] active:opacity-60 transition-opacity"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 5l-7 7 7 7"/>
                  </svg>
                  <span className="text-sm font-bold">我的好友</span>
                </button>
                {friendsList.length > 0 && (
                  <span className="text-[11px] font-semibold text-[#9b72c8] bg-[#e8d8f8] px-2.5 py-1 rounded-full">
                    {friendsList.length} 位好友
                  </span>
                )}
              </div>

              {/* list */}
              {friendsList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <div className="text-5xl">🐾</div>
                  <p className="text-sm font-bold text-[#c4a0b0]">还没有好友</p>
                  <p className="text-[11px] text-[#d4b8c8] text-center px-8">
                    和小伙伴匹配聊天后<br/>他们会出现在这里
                  </p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-2">
                  {friendsList.map((f, i) => {
                    const AVATARS = ["🐰","🐯","🐻","🦊","🐼","🐨","🐸","🦁","🐮","🐷","🐧","🦆","🐺","🦋","🐙"];
                    let hash = 0;
                    for (let c = 0; c < f.name.length; c++) hash = (hash * 31 + f.name.charCodeAt(c)) & 0xffff;
                    const emoji = AVATARS[hash % AVATARS.length];
                    const AVATAR_COLORS = [
                      "bg-[#e8d4f0]","bg-[#fde8c8]","bg-[#d4eef8]","bg-[#fde8e8]","bg-[#d8f0e4]",
                    ];
                    const avatarColor = AVATAR_COLORS[hash % AVATAR_COLORS.length];
                    const minutesAgo = Math.floor((Date.now() - f.lastChatAt) / 60000);
                    const timeLabel =
                      minutesAgo < 1 ? "刚刚" :
                      minutesAgo < 60 ? `${minutesAgo} 分钟前` :
                      minutesAgo < 1440 ? `${Math.floor(minutesAgo / 60)} 小时前` :
                      `${Math.floor(minutesAgo / 1440)} 天前`;
                    const isRecent = minutesAgo < 10;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 bg-white rounded-2xl px-3 py-3 shadow-sm"
                      >
                        {/* avatar */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-11 h-11 rounded-full ${avatarColor} flex items-center justify-center text-2xl`}>
                            {emoji}
                          </div>
                          {isRecent && (
                            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#4cd964] border-2 border-white" />
                          )}
                        </div>
                        {/* info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-[#1e1218] truncate">{f.name}</p>
                          <p className="text-[10px] text-[#b0a0b8] mt-0.5">{timeLabel} 聊过</p>
                        </div>
                        {/* call button */}
                        <button
                          onClick={() => {
                            setShowFriendsList(false);
                            setCallingFriend({ name: f.name, emoji, avatarColor });
                          }}
                          className="flex items-center gap-1 bg-[#e8f8ee] text-[#3aad5e] text-[11px] font-bold px-2.5 py-1.5 rounded-xl active:bg-[#d4f0e0] transition-colors"
                        >
                          呼叫
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.47 2 2 0 0 1 3.69 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l1.01-1.01a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Calling overlay */}
          {callingFriend && (
            <div className="absolute inset-0 z-50 bg-[#fdf0f8] flex flex-col items-center justify-center gap-5">
              {/* avatar */}
              <div className={`w-20 h-20 rounded-full ${callingFriend.avatarColor} flex items-center justify-center text-4xl shadow-md`}>
                {callingFriend.emoji}
              </div>
              {/* name */}
              <div className="text-center">
                <p className="text-[17px] font-black text-[#1e1218]">{callingFriend.name}</p>
                <p className="text-[12px] text-[#b0a0b8] mt-1 animate-pulse">正在呼叫... Calling...</p>
              </div>
              {/* cancel */}
              <button
                onClick={() => setCallingFriend(null)}
                className="w-12 h-12 rounded-full bg-[#ff4d4d] flex items-center justify-center shadow-lg active:scale-90 transition-transform"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          )}

          {/* Speech bubble */}
          <div
            className="absolute"
            style={{ left: 128, right: 10, top: 8, bottom: "26%" }}
          >
            {/* bubble body */}
            <div className="relative z-10 h-full rounded-[20px] border-2 border-[#ecc8d8] bg-[#fff6f9] px-4 py-3 shadow-[0_8px_24px_rgba(164,115,136,0.14)] flex flex-col">
              <p className="flex-shrink-0 mb-1.5 text-[9px] font-semibold tracking-[0.26em] text-[#c4a0b0]">
                T I N O
              </p>
              <div
                ref={companionBoxRef}
                className="flex-1 min-h-0 overflow-y-auto"
              >
                <p className="whitespace-pre-wrap break-words text-[17px] font-black leading-[1.5] text-[#1e1218]">
                  {displayText}
                </p>
              </div>
            </div>
          </div>

          {/* Status hint — below bubble, vertical layout */}
          <div
            className="absolute flex flex-col items-center justify-center gap-1.5"
            style={{ left: 128, right: 10, bottom: 0, height: "24%" }}
          >
            <span className={`text-[12px] font-bold ${companionStatusAccent}`}>
              {statusText}
            </span>
            {companionStatusHint && (
              <span className="text-[10px] text-[#c4a0b0]">
                {companionStatusHint}
              </span>
            )}
          </div>

          {/* 摇一摇 button — top-left, beside friends button */}
          <button
            onClick={startMatch}
            className="absolute top-2 left-12 z-30 h-8 px-2.5 rounded-full bg-white/80 border border-[#ecc8d8] shadow-md text-[#c4628a] text-[9px] font-bold flex items-center gap-1 active:bg-[#ecc8d8] transition-colors backdrop-blur-sm"
          >
            🫶 摇一摇
          </button>

          {/* Onboarding reading card — centered modal */}
          {showOnboardingReadingCard && (
            <div
              className="absolute inset-0 z-30 bg-black/30 flex items-center justify-center px-5"
              onClick={dismissOnboardingReadingCard}
            >
              <div
                className="bg-white rounded-3xl w-full shadow-2xl overflow-hidden py-5"
                onClick={(e) => e.stopPropagation()}
              >
                {/* word phonetics chips */}
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

                {/* full sentence — subtle */}
                <div className="mx-4 mt-3 flex items-center gap-2 bg-[#f8f2ff] rounded-xl px-3 py-2">
                  <p className="flex-1 text-[13px] font-bold text-[#6a4a8a]">Nice to meet you!</p>
                  <button
                    onClick={() => playTTS("Nice to meet you!", "tino")}
                    className="flex-shrink-0 w-7 h-7 rounded-full bg-[#7c3fa8]/12 text-[#7c3fa8] flex items-center justify-center active:bg-[#7c3fa8]/25 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </button>
                </div>

                {/* recording hint */}
                <div className="mt-3 flex justify-center">
                  <p className="text-[12px] font-bold text-green-500">按住右侧按键跟读一遍</p>
                </div>
              </div>
            </div>
          )}

          {/* Avatar — bottom-left corner */}
          <div
            className="absolute bottom-0 z-20"
            style={{ width: 152, height: "100%", left: -8 }}
          >
            <Image
              src={tinoPortrait}
              alt="Tino"
              fill
              sizes="112px"
              className="object-contain object-bottom"
              style={{ mixBlendMode: "screen" }}
              priority
            />
          </div>
        </div>
      ) : mode === "shop" ? (
        /* ── shop: avatar frame store ── */
        <div className="flex flex-col h-full min-h-0 relative">
          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b border-tino-orange/10">
            <button
              onClick={() => setMode("companion")}
              className="text-xs font-bold text-tino-orange active:opacity-60 transition-opacity"
            >
              ← 返回
            </button>
            <span className="text-xs font-bold text-violet-600">💎 {diamonds}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <h2 className="text-sm font-bold text-tino-brown mb-2 text-center">头像框商店</h2>
            <div className="grid grid-cols-2 gap-2">
              {FRAMES.map((frame) => {
                const owned = ownedFrames.includes(frame.id);
                const isActive = activeFrame === frame.id;
                const canBuy = diamonds >= frame.price;
                return (
                  <div
                    key={frame.id}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-colors ${
                      isActive ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="rounded-full" style={frame.id !== "none" ? frame.style : undefined}>
                      <TinoAvatar size={36} expression="happy" />
                    </div>
                    <span className="text-[10px] font-bold text-tino-brown">{frame.name}</span>
                    {owned ? (
                      <button
                        onClick={() => setActiveFrame(frame.id)}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold transition-colors ${
                          isActive
                            ? "bg-violet-500 text-white"
                            : "bg-gray-100 text-tino-brown active:bg-gray-200"
                        }`}
                      >
                        {isActive ? "使用中" : "使用"}
                      </button>
                    ) : (
                      <button
                        onClick={() => buyFrame(frame)}
                        disabled={!canBuy}
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold transition-colors ${
                          canBuy
                            ? "bg-amber-400 text-white active:bg-amber-500"
                            : "bg-gray-200 text-gray-400 cursor-not-allowed"
                        }`}
                      >
                        {frame.price} 💎
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ── room: chat bubble layout ── */
        <div className="flex flex-col h-full min-h-0 relative bg-[#fdf5ff]">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {translationPopup && (
            <div
              className="absolute inset-0 z-50 bg-black/25 flex items-center justify-center px-4"
              onClick={() => setTranslationPopup(null)}
            >
              <div
                className="bg-white rounded-[28px] w-full shadow-2xl overflow-hidden pt-5 pb-4 max-h-[85%] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {translationPopup.loading ? (
                  /* loading */
                  <div className="flex gap-1.5 items-center justify-center py-5">
                    {[0,1,2].map(i => (
                      <span key={i} className="w-2.5 h-2.5 rounded-full bg-[#c4a0e0] animate-bounce" style={{ animationDelay: `${i * 140}ms` }} />
                    ))}
                    <span className="text-[12px] text-[#9575cd] font-bold ml-2">Tino 翻译中…</span>
                  </div>
                ) : (
                  <>
                    {/* full sentence play button — top */}
                    {translationPopup.english && (
                      <div className="px-4 mb-3.5 flex justify-center">
                        <button
                          onClick={() => playTTS(translationPopup.english, "tino")}
                          className="flex items-center gap-2.5 bg-[#f3eef8] active:bg-[#e8dff5] active:scale-95 transition-all rounded-2xl px-4 py-2.5"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#7c3fa8] text-white flex items-center justify-center flex-shrink-0">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="6,3 20,12 6,21" />
                            </svg>
                          </div>
                          <span className="text-[14px] font-bold text-[#5a3880] leading-snug">{translationPopup.english}</span>
                        </button>
                      </div>
                    )}

                    {/* word phonetics cards */}
                    {translationPopup.words.length > 0 && (
                      <div className="px-4 flex flex-wrap gap-2 justify-center">
                        {translationPopup.words.map(({ word, phonetic }, i) => (
                          <button
                            key={i}
                            onClick={() => playTTS(word.replace(/[.,!?;:]/g, ""), "tino")}
                            className="flex flex-col items-center bg-white border border-[#eae2f5] rounded-2xl px-3.5 py-2.5 shadow-sm active:bg-[#f5eeff] active:scale-95 transition-all min-w-[52px]"
                          >
                            <span className="text-[17px] font-black text-[#1a1020] leading-none tracking-tight">{word}</span>
                            <span className="text-[10px] text-[#9575cd] leading-none mt-1 font-medium">{phonetic}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* recording hint */}
                    <div className="mt-3.5 flex justify-center">
                      <p className="text-[13px] font-bold text-[#22c55e]">按住右侧按键跟读一遍</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Silence hint popup ── */}
          {showSilenceHint && (
            <div
              className="absolute inset-0 z-50 bg-black/25 flex items-center justify-center px-5"
              onClick={() => setShowSilenceHint(false)}
            >
              <div
                className="bg-white rounded-3xl shadow-xl overflow-hidden w-full"
                onClick={(e) => e.stopPropagation()}
              >
                {/* header */}
                <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5">
                  <TinoAvatar size={30} expression="happy" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-black text-[#5a2d82] leading-none">轮到你说啦！</p>
                    <p className="text-[9px] text-[#b090c8] leading-none mt-0.5">按住右侧按键开口说说看 🎙️</p>
                  </div>
                  <button
                    onClick={() => setShowSilenceHint(false)}
                    className="w-5 h-5 rounded-full bg-[#f0e8fa] flex items-center justify-center active:bg-[#d5bff5] transition-colors flex-shrink-0"
                  >
                    <svg width="7" height="7" viewBox="0 0 12 12" fill="none" stroke="#9575cd" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M1 1l10 10M11 1L1 11"/>
                    </svg>
                  </button>
                </div>
                {/* divider */}
                <div className="mx-3.5 border-t border-[#f0e8fa]" />
                {/* suggestion phrases */}
                <div className="px-3.5 pt-2 pb-3 flex flex-col gap-2">
                  <p className="text-[8px] text-[#c4a8e0] font-bold tracking-widest uppercase">你可以这样说</p>
                  {silenceHintPhrases.map(({ en, zh }) => (
                    <button
                      key={en}
                      onClick={() => playTTS(en, "tino")}
                      className="flex items-center gap-2.5 bg-[#faf6ff] border border-[#ede0ff] rounded-xl px-3 py-2 active:bg-[#f0e6ff] active:scale-[0.98] transition-all text-left"
                    >
                      <div className="w-5 h-5 rounded-full bg-[#7c3fa8] flex items-center justify-center flex-shrink-0">
                        <svg width="6" height="6" viewBox="0 0 24 24" fill="white">
                          <polygon points="6,3 20,12 6,21"/>
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-black text-[#1e1218] leading-tight">{en}</p>
                        <p className="text-[10px] text-[#b090c8] leading-none mt-0.5">{zh}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showExitConfirm && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-black/70 text-white text-[10px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap pointer-events-none">
              再次点击退出聊天
            </div>
          )}

          {/* ── Header ── */}
          <div className="flex-shrink-0 flex items-center justify-between px-3 pt-2.5 pb-2 bg-gradient-to-r from-[#fce4f6] to-[#e8eeff]">
            {/* back / title */}
            <button
              className="flex items-center gap-1 text-[#7c3fa8] active:opacity-60 transition-opacity"
              onClick={() => { if (showExitConfirm) leaveRoom(); else setShowExitConfirm(true); }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7"/>
              </svg>
              <span className="text-[12px] font-black text-[#7c3fa8]">英语角</span>
            </button>

            {/* participant avatars */}
            <div className="flex items-center gap-1.5">
              {/* Tino */}
              <div className="relative">
                <TinoAvatar size={22} expression="happy" />
                <span className="absolute -top-1 -right-1.5 bg-violet-500 text-white text-[5px] font-bold px-[2.5px] py-[0.5px] rounded-sm leading-tight">AI</span>
              </div>
              {/* AI buddy */}
              <div className="relative">
                <Image src={avatarBuddy} alt="buddy" width={22} height={22} className="rounded-full object-cover object-top" style={{ width: 22, height: 22 }} />
                <span className="absolute -top-1 -right-1.5 bg-violet-500 text-white text-[5px] font-bold px-[2.5px] py-[0.5px] rounded-sm leading-tight">AI</span>
              </div>
              <span className="text-[9px] text-[#a890c8]">+</span>
              {/* User */}
              <div
                className="rounded-full overflow-hidden"
                style={{ width: 22, height: 22, ...(activeFrame !== "none" ? userFrameStyle : {}) }}
              >
                <Image src={avatarUser} alt="me" width={22} height={22} className="object-cover object-top w-full h-full" />
              </div>
              {/* Friend */}
              <div className="w-[22px] h-[22px] rounded-full overflow-hidden">
                <Image src={avatarFriend} alt={partner?.name || "友"} width={22} height={22} className="object-cover object-top w-full h-full" />
              </div>
            </div>

            {/* add friend button */}
            {(() => {
              const alreadyAdded = partner && friendsList.some(
                (f) => f.name === partner.name && f.grade === partner.grade
              );
              return alreadyAdded ? (
                <span className="px-2.5 py-1 rounded-full bg-[#ede8f8] text-[#a890c8] text-[10px] font-bold">已添加 ✓</span>
              ) : (
                <button
                  onClick={() => partner && setShowAddFriend(true)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#ede8f8] text-[#7c3fa8] active:bg-[#ddd0f4] transition-colors"
                >
                  +加好友
                </button>
              );
            })()}
          </div>

          {/* ── Add friend confirm dialog ── */}
          {showAddFriend && partner && (
            <div
              className="absolute inset-0 z-40 bg-black/40 flex items-center justify-center px-6"
              onClick={() => setShowAddFriend(false)}
            >
              <div
                className="bg-white rounded-3xl p-5 w-full shadow-xl flex flex-col items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#f9c8e0] to-[#c8a8f0] flex items-center justify-center text-xl font-black text-white">
                  {partner.name[0]}
                </div>
                <div className="text-center">
                  <p className="text-sm font-black text-[#1e1218]">添加「{partner.name}」为好友？</p>
                  <p className="text-[10px] text-[#c4a0b0] mt-0.5">之后可以在好友列表找到 ta</p>
                </div>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => setShowAddFriend(false)}
                    className="flex-1 py-2 rounded-full bg-gray-100 text-[#888] text-xs font-bold active:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      try {
                        const raw = localStorage.getItem("tino_friends_list");
                        const existing: FriendRecord[] = raw ? JSON.parse(raw) : [];
                        const filtered = existing.filter(
                          (f) => f.name !== partner.name || f.grade !== partner.grade
                        );
                        const updated = [
                          { name: partner.name, grade: partner.grade, lastChatAt: Date.now() },
                          ...filtered,
                        ].slice(0, 20);
                        localStorage.setItem("tino_friends_list", JSON.stringify(updated));
                        setFriendsList(updated);
                      } catch { /* storage unavailable */ }
                      setShowAddFriend(false);
                    }}
                    className="flex-1 py-2 rounded-full bg-[#7c3fa8] text-white text-xs font-bold active:opacity-80 transition-opacity"
                  >
                    确认添加
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Message card + navigation ── */}
          {(() => {
            const navMsgs = roomMsgs.filter((m) => m.sender !== "system");
            const totalNav = navMsgs.length;
            const viewIdx = totalNav === 0 ? -1 : Math.max(0, totalNav - 1 - roomViewOffset);
            const viewedMsg = viewIdx >= 0 ? navMsgs[viewIdx] : null;
            const canPrev = viewIdx > 0;
            const canNext = roomViewOffset > 0;

            /* card sender meta */
            const isTino = viewedMsg?.sender === "tino";
            const isBuddy = viewedMsg?.sender === "ai_buddy";
            const isUser = viewedMsg?.sender === "user";
            const isAISender = isTino || isBuddy;
            const cardName = isTino
              ? "Tino"
              : isBuddy
              ? (aiBuddyName || "Buddy")
              : isUser
              ? userName
              : (partner?.name || "小伙伴");
            const cardNameColor = isTino
              ? "#7c3fa8"
              : isBuddy
              ? "#2a8a6a"
              : isUser
              ? "#1a6fb0"
              : "#2a6a5a";
            const cardTranslation = viewedMsg ? roomTranslations[viewedMsg.id] : undefined;
            const isLatest = viewIdx === totalNav - 1;
            const isTyping = isLoading && isLatest && !isUser;

            return (
              <div className="flex-1 min-h-0 flex flex-col px-3 pt-1.5 pb-1 gap-1">
                {/* system pills */}
                {roomMsgs.filter((m) => m.sender === "system").slice(-2).map((m) => (
                  <div key={m.id} className="flex justify-center">
                    <span className="text-[9px] text-[#b090c8] bg-[#f0e8f8] px-2.5 py-0.5 rounded-full">{m.content}</span>
                  </div>
                ))}

                {/* featured message card — horizontal: avatar/name LEFT, content RIGHT */}
                <div className="flex-1 min-h-0 flex">
                  <div className="w-full bg-white rounded-3xl shadow-md overflow-hidden flex">
                    {/* left: avatar + name */}
                    <div className="flex-shrink-0 flex flex-col items-center justify-start gap-1 pt-2 px-2.5 pb-2 w-[50px]">
                      <div className="relative">
                        {!viewedMsg ? (
                          <div className="w-9 h-9 rounded-full bg-gray-100" />
                        ) : isTino ? (
                          <TinoAvatar size={36} expression="happy" />
                        ) : isBuddy ? (
                          <Image src={avatarBuddy} alt="buddy" width={36} height={36} className="rounded-full object-cover object-top" style={{ width: 36, height: 36 }} />
                        ) : isUser ? (
                          <div className="rounded-full overflow-hidden" style={{ width: 36, height: 36, ...(activeFrame !== "none" ? userFrameStyle : {}) }}>
                            <Image src={avatarUser} alt="me" width={36} height={36} className="object-cover object-top w-full h-full" />
                          </div>
                        ) : (
                          <div className="w-9 h-9 rounded-full overflow-hidden">
                            <Image src={avatarFriend} alt={partner?.name || "友"} width={36} height={36} className="object-cover object-top w-full h-full" />
                          </div>
                        )}
                        {isAISender && viewedMsg && (
                          <span className="absolute -top-1 -right-1 bg-violet-500 text-white text-[5px] font-bold px-[2.5px] py-[0.5px] rounded-sm leading-tight">AI</span>
                        )}
                      </div>
                      <span className="text-[9px] font-bold text-center leading-tight break-all" style={{ color: cardNameColor }}>
                        {cardName || "…"}
                      </span>
                      {(isTyping || (isSpeaking && isLatest && !isUser)) && (
                        <span className="text-[8px] text-gray-400 animate-pulse">说话中</span>
                      )}
                    </div>

                    {/* right: content */}
                    <div className="flex-1 min-w-0 flex flex-col overflow-hidden pt-1.5 pr-2 pb-2 pl-1">
                      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
                        {isTyping ? (
                          <div className="flex gap-1.5 items-center h-8">
                            {[0,1,2].map(i => (
                              <span key={i} className="w-2.5 h-2.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                            ))}
                          </div>
                        ) : viewedMsg ? (
                          <>
                            <p className="text-[17px] font-black text-[#1e1218] leading-snug whitespace-pre-wrap">
                              {viewedMsg.content}
                            </p>
                            {cardTranslation && (
                              <p className="text-[11px] text-gray-400 leading-snug">{cardTranslation}</p>
                            )}
                            {!cardTranslation && !isUser && (
                              <p className="text-[10px] text-gray-200">翻译中...</p>
                            )}
                          </>
                        ) : (
                          <p className="text-[13px] text-gray-300 mt-2">等待聊天开始…</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* bottom: nav arrows + companion-style status text */}
                <div className="flex-shrink-0 flex items-center justify-between">
                  <button
                    disabled={!canPrev}
                    onClick={() => setRoomViewOffset((o) => Math.min(totalNav - 1, o + 1))}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold disabled:opacity-20 active:bg-gray-100 transition-colors text-[#7c3fa8]"
                  >
                    ◀
                  </button>
                  <div className="flex flex-col items-center">
                    <span className={`text-[12px] font-bold ${companionStatusAccent}`}>{statusText}</span>
                    {companionStatusHint && (
                      <span className="text-[9px] text-[#c4a0b0]">{companionStatusHint}</span>
                    )}
                  </div>
                  <button
                    disabled={!canNext}
                    onClick={() => setRoomViewOffset((o) => Math.max(0, o - 1))}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[14px] font-bold disabled:opacity-20 active:bg-gray-100 transition-colors text-[#7c3fa8]"
                  >
                    ▶
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </DeviceFrame>
  );
}
