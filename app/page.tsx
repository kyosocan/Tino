"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DeviceFrame from "@/components/DeviceFrame";
import TinoAvatar from "@/components/TinoAvatar";
import type {
  Message,
  AppMode,
  RoomPartner,
  MessageSender,
} from "@/lib/types";

/* ───────── constants ───────── */

const GREETING = "嗨！我是 Tino～\n你的英语聊天小助手！\n今天先来一句：How is your day going?";

const ROOM_DURATION = 300;

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
    return {
      ...createEmptyCompanionMemory(),
      ...parsed,
      memories: Array.isArray(parsed.memories) ? parsed.memories.slice(0, 6) : [],
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

function pickMemorySnippet(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length < 4) return null;
  if (/[?？]$/.test(cleaned) && cleaned.length < 12) return null;

  const meaningfulPattern =
    /(我叫|我是|我喜欢|我最喜欢|今天|因为|想要|my name is|i am|i'm|i like|i love|my favorite|today|because)/i;
  const englishWords = cleaned.match(/[a-zA-Z]{2,}/g) || [];

  if (!meaningfulPattern.test(cleaned) && englishWords.length < 4 && cleaned.length < 10) {
    return null;
  }

  return cleaned.slice(0, 48);
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
  const remembered = memory.memories[0];

  if (remembered) {
    return `嗨，${name}！我还记得你之前提过“${remembered}”。\n我们今天就接着这个话题聊，好吗？`;
  }

  return `嗨，${name}！今天先练一句很自然的英文：How is your day going?\n你先用这句话开头就好。`;
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
  const [loginName, setLoginName] = useState("");
  const [loginGrade, setLoginGrade] = useState(0);

  /* mode */
  const [mode, setMode] = useState<AppMode>("login");
  const modeRef = useRef<AppMode>("login");
  useEffect(() => { modeRef.current = mode; }, [mode]);

  /* partner (real person) */
  const [partner, setPartner] = useState<RoomPartner | null>(null);
  const [roomId, setRoomId] = useState("");

  /* chat context */
  const [companionMsgs, setCompanionMsgs] = useState<Message[]>([
    { id: "g", sender: "tino", content: GREETING, timestamp: Date.now() },
  ]);
  const [roomMsgs, setRoomMsgs] = useState<Message[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const companionMemoryRef = useRef<CompanionMemory>(createEmptyCompanionMemory());

  /* companion display */
  const [displayText, setDisplayText] = useState(GREETING);

  /* recording */
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

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

  /* translation popup */
  const [translationPopup, setTranslationPopup] = useState<{
    chinese: string;
    english: string;
    loading: boolean;
  } | null>(null);

  /* exit confirmation */
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  useEffect(() => {
    if (!showExitConfirm) return;
    const t = setTimeout(() => setShowExitConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [showExitConfirm]);

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

      localStorage.removeItem("tino_user_id");
      const savedUserId = sessionStorage.getItem("tino_user_id");
      const savedName = localStorage.getItem("tino_user_name");
      const savedGrade = localStorage.getItem("tino_user_grade");
      if (savedName && savedGrade) {
        const grade = Number(savedGrade);
        const memory = loadCompanionMemory(savedName, grade);
        const sessionUserId = savedUserId || generateUserId();
        const greeting = buildCompanionGreeting(savedName, memory);
        sessionStorage.setItem("tino_user_id", sessionUserId);
        setUserId(sessionUserId);
        setUserName(savedName);
        setUserGrade(grade);
        companionMemoryRef.current = memory;
        setDisplayText(greeting);
        setCompanionMsgs([
          { id: "g", sender: "tino", content: greeting, timestamp: Date.now() },
        ]);
        setMode("companion");
      }
    } catch { /* SSR or unavailable */ }
  }, []);

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
      motionGrantedRef.current = true;
      const DM = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<string>;
      };
      if (typeof DM.requestPermission === "function") {
        DM.requestPermission().catch(() => {});
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
      const ctx = audioCtxRef.current;
      const gain = gainNodeRef.current;
      if (!ctx || !gain || !audioBase64) return;

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
    [highlightSpeaker]
  );

  const playTTS = useCallback(
    (text: string, speaker?: string, onPlayStart?: () => void) => {
      const audioReady = (async (): Promise<AudioBuffer | null> => {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!data.audioBase64 || data.error) return null;
          return await audioCtxRef.current!.decodeAudioData(
            Uint8Array.from(atob(data.audioBase64), (char) => char.charCodeAt(0)).buffer.slice(0)
          );
        } catch {
          return null;
        }
      })();
      audioReady.then((audioBuffer) => {
        if (!audioBuffer) {
          onPlayStart?.();
          return;
        }

        const ctx = audioCtxRef.current;
        const gain = gainNodeRef.current;
        if (!ctx || !gain) return;

        ttsPending.current++;
        setIsSpeaking(true);

        ttsChain.current = ttsChain.current.then(async () => {
          try {
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
      });
    },
    [highlightSpeaker]
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
              shownText += (shownText ? "\n" : "") + s;
              setDisplayText(shownText);
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
          playTTS(reply, "tino", () => setDisplayText(reply));
        }

        setTurnCount((c) => c + 1);
      } catch {
        const fb = "哎呀，我走神了～再说一次吧！";
        speak("tino", fb);
        setDisplayText(fb);
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

  /* ─── room: send message to server ─── */

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
        setTranslationPopup(null);
      } catch {
        addMsg("system", "消息发送失败，请重试");
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, roomId, userId, userName, addMsg, awardDiamonds]
  );

  /* ─── room: Chinese detection wrapper ─── */

  const handleRoomMessage = useCallback(
    async (
      text: string,
      audioPayload?: { audioBase64?: string; mimeType?: string }
    ) => {
      if (containsChinese(text)) {
        setTranslationPopup({ chinese: text, english: "", loading: true });
        try {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          setTranslationPopup({
            chinese: text,
            english: data.english || "I want to say something!",
            loading: false,
          });
        } catch {
          setTranslationPopup({
            chinese: text,
            english: "I want to say something!",
            loading: false,
          });
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
      if (!text.trim()) return;
      if (modeRef.current === "room") handleRoomMessage(text.trim());
      else sendCompanion(text.trim());
    },
    [sendCompanion, handleRoomMessage]
  );

  /* ─── room: polling for partner messages ─── */

  useEffect(() => {
    if (mode !== "room" || !roomId) return;

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
          addMsg(sender, m.content);
          if (sender === "friend" && m.audioBase64) {
            playAudioBase64(m.audioBase64, sender, () => {
              setRoomDisplay({ sender, content: m.content });
            });
          } else {
            playTTS(m.content, sender, () => {
              setRoomDisplay({ sender, content: m.content });
            });
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
  }, [mode, roomId, userId, addMsg, playAudioBase64, playTTS]);

  /* ─── voice recording ─── */

  const startRecording = useCallback(async () => {
    if (!isPowered || isRecording) return;
    unlockAudio();
    highlightSpeaker("user");
    try {
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
    } catch {
      /* mic denied */
    }
  }, [isPowered, isRecording, sendMessage, sendRoom, handleRoomMessage, highlightSpeaker, unlockAudio]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
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

  /* ─── login ─── */

  const handleLogin = useCallback(() => {
    const name = loginName.trim();
    if (!name || loginGrade < 1) return;
    const uid = generateUserId();
    const memory = loadCompanionMemory(name, loginGrade);
    const greeting = buildCompanionGreeting(name, memory);
    companionMemoryRef.current = memory;
    unlockAudio();
    setUserId(uid);
    setUserName(name);
    setUserGrade(loginGrade);
    try {
      sessionStorage.setItem("tino_user_id", uid);
      localStorage.removeItem("tino_user_id");
      localStorage.setItem("tino_user_name", name);
      localStorage.setItem("tino_user_grade", String(loginGrade));
    } catch {}
    setDisplayText(greeting);
    setCompanionMsgs([{
      id: "g",
      sender: "tino",
      content: greeting,
      timestamp: Date.now(),
    }]);
    setMode("companion");
    playTTS(greeting, "tino", () => setDisplayText(greeting));
  }, [loginName, loginGrade, playTTS, unlockAudio]);

  const handleLogout = useCallback(() => {
    try {
      sessionStorage.removeItem("tino_user_id");
      localStorage.removeItem("tino_user_id");
      localStorage.removeItem("tino_user_name");
      localStorage.removeItem("tino_user_grade");
    } catch {}
    companionMemoryRef.current = createEmptyCompanionMemory();
    setUserId("");
    setUserName("");
    setUserGrade(0);
    setLoginName("");
    setLoginGrade(0);
    setMode("login");
  }, []);

  /* ─── matching ─── */

  const leaveRoom = useCallback(() => {
    endedRef.current = true;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setDiamonds((d) => d + sessionDiamonds);
    setSessionDiamonds(0);
    setMode("companion");
    setPartner(null);
    setRoomId("");
    setActiveSpeaker(null);
    setShowExitConfirm(false);
    setRoomDisplay(null);
    seenMsgIds.current.clear();
    lastPollTimeRef.current = 0;

    fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leave", userId }),
    }).catch(() => {});
  }, [sessionDiamonds, userId]);

  const enterRoom = useCallback(
    (rid: string, p: RoomPartner) => {
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
      setMode("room");
    },
    []
  );

  const startMatch = useCallback(async () => {
    unlockAudio();
    setMode("matching");

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
            if (matchPollRef.current) clearInterval(matchPollRef.current);
            enterRoom(d.roomId, d.partner);
          }
        } catch { /* retry */ }
      }, 1500);
    } catch {
      setMode("companion");
    }
  }, [unlockAudio, userId, userName, userGrade, enterRoom]);

  const cancelMatch = useCallback(() => {
    if (matchPollRef.current) clearInterval(matchPollRef.current);
    fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leave", userId }),
    }).catch(() => {});
    setMode("companion");
  }, [userId]);

  /* cleanup match polling on unmount */
  useEffect(() => {
    return () => {
      if (matchPollRef.current) clearInterval(matchPollRef.current);
    };
  }, []);

  /* ─── shake-to-match ─── */

  const shakeRef = useRef({ count: 0, lastTime: 0, lastX: 0, lastY: 0, lastZ: 0 });
  const shakeCooldownRef = useRef(false);

  useEffect(() => {
    if (!isPowered) return;

    const THRESHOLD = 25;
    const SHAKE_COUNT = 3;
    const SHAKE_WINDOW = 800;

    const onMotion = (e: DeviceMotionEvent) => {
      if (modeRef.current !== "companion" || shakeCooldownRef.current) return;
      const acc = e.accelerationIncludingGravity;
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
    setTimeout(() => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      setMode("companion");
      setPartner(null);
      setRoomId("");
      setActiveSpeaker(null);
      seenMsgIds.current.clear();
    }, 3500);
  }, [mode, timeLeft, addMsg, sessionDiamonds]);

  /* ─── derived ─── */

  const tinoExpr = isRecording
    ? "excited"
    : isLoading || isTranscribing
      ? "thinking"
      : isSpeaking
        ? "waving"
        : ("happy" as const);

  const statusText = isRecording
    ? "正在听你说..."
    : isTranscribing
      ? "识别中..."
      : isLoading
        ? "Tino 在想..."
        : isSpeaking
          ? "在说话..."
          : "按住右侧按钮说话";

  const statusIcon = isRecording
    ? "🔴"
    : isTranscribing
      ? "⏳"
      : isLoading
        ? "💭"
        : isSpeaking
          ? "🔊"
          : "🟢";

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
      {!isPowered ? (
        <div className="h-full bg-[#111] rounded-[8px] flex items-center justify-center">
          <TinoAvatar size={48} expression="happy" className="opacity-10" />
        </div>
      ) : mode === "login" ? (
        /* ── login screen ── */
        <div className="flex flex-col h-full items-center justify-center px-5 gap-2">
          <TinoAvatar size={48} expression="waving" className="animate-float" />
          <p className="text-sm text-tino-brown text-center font-bold leading-snug">
            嗨！我是 Tino！<br />你的英语聊天小助手
          </p>

          <div className="w-full mt-1">
            <input
              type="text"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="输入你的名字"
              maxLength={10}
              className="w-full px-3 py-2 rounded-xl bg-white border border-tino-orange/20 text-sm text-center placeholder:text-tino-brown-light/50 focus:outline-none focus:border-tino-orange/50 focus:ring-2 focus:ring-tino-orange/10"
            />
          </div>

          <div className="w-full">
            <p className="text-[10px] text-tino-brown-light text-center mb-1">你几年级？</p>
            <div className="flex justify-center gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <button
                  key={g}
                  onClick={() => setLoginGrade(g)}
                  className={`w-7 h-7 rounded-full text-xs font-bold transition-all ${
                    loginGrade === g
                      ? "bg-tino-orange text-white scale-110"
                      : "bg-tino-orange/10 text-tino-orange active:bg-tino-orange/20"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={!loginName.trim() || loginGrade < 1}
            className="mt-1 px-6 py-2 rounded-full bg-tino-orange text-white text-sm font-bold shadow-md active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            开始聊天！
          </button>
        </div>
      ) : mode === "matching" ? (
        /* ── matching animation ── */
        <div className="h-full bg-gradient-to-b from-tino-orange/80 to-tino-blue/60 flex flex-col items-center justify-center gap-4 text-white text-center px-4">
          <div className="match-spin">
            <TinoAvatar size={64} expression="excited" />
          </div>
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
        </div>
      ) : mode === "companion" ? (
        /* ── companion: avatar + speech ── */
        <div className="flex flex-col h-full min-h-0 relative">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
            <button
              onClick={() => setMode("shop")}
              className="relative flex items-center gap-1 px-2 py-1 rounded-full bg-violet-50 text-xs font-bold text-violet-600 active:bg-violet-100 transition-colors"
            >
              💎 {diamonds}
              {diamondDelta !== null && (
                <span className="absolute -top-3 left-full ml-0.5 text-[10px] text-green-500 font-bold diamond-float">
                  +{diamondDelta}
                </span>
              )}
            </button>
            <button
              onClick={startMatch}
              className="px-2.5 py-1 rounded-full bg-tino-orange/15 text-tino-orange text-xs font-bold active:bg-tino-orange/25 transition-colors"
            >
              🌪️ 摇一摇
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-5 gap-3 min-h-0">
            <TinoAvatar
              size={72}
              expression={tinoExpr}
              className={`flex-shrink-0 ${isRecording ? "animate-pulse-soft" : "animate-float"}`}
            />
            <div
              ref={companionBoxRef}
              className="w-full flex-shrink-0 bg-tino-orange-pale rounded-2xl px-4 py-2 text-center shadow-sm overflow-y-auto"
              style={{ maxHeight: "5.5em" }}
            >
              <p className="text-sm leading-relaxed text-tino-brown whitespace-pre-wrap">
                {displayText}
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 py-2 text-center">
            <p className="text-xs font-bold text-tino-brown-light">
              {statusIcon} {statusText}
            </p>
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
        /* ── room: real-time chat ── */
        <div className="flex flex-col h-full min-h-0 relative">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {/* translation popup */}
          {translationPopup && (
            <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center px-3">
              <div className="bg-white rounded-2xl p-4 max-w-[210px] w-full text-center shadow-xl">
                <p className="text-[10px] text-gray-400 mb-1">你想说的是：</p>
                <p className="text-sm font-bold text-tino-brown mb-2 leading-snug">
                  {translationPopup.chinese}
                </p>
                <p className="text-[10px] text-gray-400 mb-1">用英文可以这样说：</p>
                {translationPopup.loading ? (
                  <p className="text-sm text-tino-orange animate-pulse my-2">翻译中...</p>
                ) : (
                  <p className="text-sm font-bold text-tino-orange leading-snug">
                    {translationPopup.english}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* exit toast */}
          {showExitConfirm && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 bg-black/70 text-white text-[10px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap pointer-events-none">
              再次点击退出聊天
            </div>
          )}

          {/* participant strip */}
          <div className="flex items-start justify-center gap-6 px-2 pt-3 pb-0.5 flex-shrink-0">
            {([
              {
                id: "tino" as const,
                label: "Tino",
                node: <TinoAvatar size={28} expression="happy" />,
                isAI: true,
              },
              {
                id: "user" as const,
                label: userName || "我",
                node: (
                  <div
                    className="w-7 h-7 rounded-full bg-tino-blue text-white text-[9px] font-bold flex items-center justify-center"
                    style={activeFrame !== "none" ? userFrameStyle : undefined}
                  >
                    我
                  </div>
                ),
                isAI: false,
              },
              {
                id: "friend" as const,
                label: partner?.name || "小伙伴",
                node: (
                  <div className="w-7 h-7 rounded-full bg-tino-green text-white text-[9px] font-bold flex items-center justify-center">
                    {partner?.name?.[0] || "?"}
                  </div>
                ),
                isAI: false,
              },
            ]).map(({ id, label, node, isAI }) => (
              <div
                key={id}
                className={`flex flex-col items-center transition-all duration-300 ${
                  centerSpeaker === id ? "opacity-100 scale-110" : "opacity-30"
                }`}
                style={{ width: 40, height: 48 }}
                onClick={
                  id === "user"
                    ? () => {
                        if (showExitConfirm) leaveRoom();
                        else setShowExitConfirm(true);
                      }
                    : undefined
                }
              >
                <div className="relative">
                  {node}
                  {isAI && (
                    <span className="absolute -top-1.5 -right-2 bg-violet-500 text-white text-[5px] font-bold px-[3px] py-[0.5px] rounded-sm leading-tight">
                      AI
                    </span>
                  )}
                </div>
                <span className="mt-0.5 text-[7px] font-bold text-tino-brown truncate max-w-[40px]">
                  {label}
                </span>
                {(id === "user" || id === "friend") && (
                  <span className="relative text-[8px] font-bold text-violet-500 leading-none">
                    💎{id === "user" ? sessionDiamonds : 0}
                    {id === "user" && diamondDelta !== null && (
                      <span className="absolute -top-2.5 left-full ml-0.5 text-[9px] text-green-500 font-bold diamond-float whitespace-nowrap">
                        +{diamondDelta}
                      </span>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* center: speaker + lyrics */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4">
            <div
              className="rounded-full p-0.5 transition-all duration-500"
              key={centerSpeaker}
              style={
                activeSpeaker
                  ? { boxShadow: `0 0 14px 4px ${GLOW[activeSpeaker] || GLOW.tino}` }
                  : undefined
              }
            >
              {centerSpeaker === "tino" && (
                <TinoAvatar
                  size={48}
                  expression={tinoExpr}
                  className={activeSpeaker === "tino" ? "animate-pulse-soft" : "animate-float"}
                />
              )}
              {centerSpeaker === "user" && (
                <div
                  className="w-12 h-12 rounded-full bg-tino-blue text-white text-base font-bold flex items-center justify-center"
                  style={activeFrame !== "none" ? userFrameStyle : undefined}
                >
                  我
                </div>
              )}
              {centerSpeaker === "friend" && (
                <div className="w-12 h-12 rounded-full bg-tino-green text-white text-base font-bold flex items-center justify-center">
                  {partner?.name?.[0] || "?"}
                </div>
              )}
            </div>

            <span className="mt-1 text-[10px] font-bold text-tino-brown">{centerLabel}</span>

            {/* lyrics text area */}
            <div
              ref={lyricsBoxRef}
              className="mt-1.5 w-full overflow-hidden"
              style={{ height: "3.9em", lineHeight: "1.45" }}
            >
              <div
                ref={lyricsRef}
                key={roomLyricsText}
                className="text-center text-xs text-tino-brown whitespace-pre-wrap lyrics-enter"
                style={{ lineHeight: "1.5" }}
              >
                {roomLyricsText}
              </div>
            </div>
          </div>

          <div className="flex-shrink-0 px-2 py-1 text-center">
            <p className="text-[11px] leading-tight font-bold text-tino-brown-light">
              {statusIcon} {statusText}
            </p>
          </div>
        </div>
      )}
    </DeviceFrame>
  );
}
