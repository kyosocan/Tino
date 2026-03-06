"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DeviceFrame from "@/components/DeviceFrame";
import TinoAvatar from "@/components/TinoAvatar";
import type {
  Message,
  AppMode,
  VirtualFriend,
  MessageSender,
} from "@/lib/types";

/* ───────── constants ───────── */

const GREETING = "嗨！我是 Tino～\n今天想聊什么呀？";

const AI2_NAME = "嘟嘟";
const AI2_EMOJI = "🐰";

const FRIENDS: VirtualFriend[] = [
  { name: "小星", englishName: "Star", grade: 3, likes: ["画画", "跑步"] },
  { name: "小月", englishName: "Luna", grade: 2, likes: ["唱歌", "跳舞"] },
  { name: "小云", englishName: "Cloud", grade: 3, likes: ["阅读", "足球"] },
  { name: "小晨", englishName: "Dawn", grade: 2, likes: ["乐高", "篮球"] },
];

const ROOM_DURATION = 300;

function getPhase(elapsed: number) {
  if (elapsed < 30) return "icebreaking" as const;
  if (elapsed < 240) return "free_chat" as const;
  if (elapsed < 270) return "game" as const;
  return "summary" as const;
}

const GLOW: Record<string, string> = {
  tino: "rgba(255,140,66,0.7)",
  ai2: "rgba(167,139,250,0.7)",
  user: "rgba(126,200,227,0.7)",
  friend: "rgba(168,213,186,0.7)",
};

/* ───────── scoring ───────── */

function parseGradeFromSpeech(text: string): number {
  const t = text.replace(/\s/g, "").trim();
  const n = ["一", "二", "三", "四", "五", "六"];
  for (let i = 0; i < 6; i++) {
    if (t.includes(n[i]) || t === String(i + 1)) return i + 1;
  }
  const m = t.match(/[1-6]/);
  if (m) return Number(m[0]);
  return 0;
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
  const [userName, setUserName] = useState("");
  const [userGrade, setUserGrade] = useState(0);
  const [onboardStep, setOnboardStep] = useState(0);
  const [onboardHeard, setOnboardHeard] = useState("");
  const onboardStepRef = useRef(0);
  const userNameRef = useRef("");
  const userGradeRef = useRef(0);
  useEffect(() => { onboardStepRef.current = onboardStep; }, [onboardStep]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { userGradeRef.current = userGrade; }, [userGrade]);

  /* mode */
  const [mode, setMode] = useState<AppMode>("companion");
  const [friend, setFriend] = useState<VirtualFriend | null>(null);

  /* chat context (internal, not rendered as list in companion) */
  const [companionMsgs, setCompanionMsgs] = useState<Message[]>([
    { id: "g", sender: "tino", content: GREETING, timestamp: Date.now() },
  ]);
  const [roomMsgs, setRoomMsgs] = useState<Message[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

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
  const [friendDiamonds, setFriendDiamonds] = useState(0);
  const [friendDiamondDelta, setFriendDiamondDelta] = useState<number | null>(null);
  const roomTurnRef = useRef(0);
  const gameRef = useRef(false);
  const summaryRef = useRef(false);
  const introRef = useRef(false);
  const endedRef = useRef(false);
  const moderatorRef = useRef<"tino" | "ai2">("tino");

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
      const savedName = localStorage.getItem("tino_user_name");
      const savedGrade = localStorage.getItem("tino_user_grade");
      if (savedName && savedGrade) {
        setUserName(savedName);
        setUserGrade(Number(savedGrade));
      } else {
        setMode("onboarding");
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

  useEffect(() => {
    if (friendDiamondDelta === null) return;
    const t = setTimeout(() => setFriendDiamondDelta(null), 1200);
    return () => clearTimeout(t);
  }, [friendDiamondDelta]);

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

  /* TTS playback via AudioContext (mobile-compatible) */
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

  const playTTS = useCallback(
    (text: string, speaker?: string, onPlayStart?: () => void) => {
      const ctx = audioCtxRef.current;
      const gain = gainNodeRef.current;
      if (!ctx || !gain) return;

      ttsPending.current++;
      setIsSpeaking(true);

      const audioReady = (async (): Promise<AudioBuffer | null> => {
        try {
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!data.audioBase64 || data.error) return null;

          const binary = atob(data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);

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
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
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
      const sentenceEnd = /[。！？!?\n]/;
      const clauseEnd = /[，,、；;：:]/;

      while (true) {
        const m = remaining.match(sentenceEnd);
        if (m && m.index !== undefined) {
          const s = remaining.slice(0, m.index + 1).trim();
          remaining = remaining.slice(m.index + 1);
          if (s) completed.push(s);
          continue;
        }
        if (remaining.length > 35) {
          const cm = remaining.match(clauseEnd);
          if (cm && cm.index !== undefined && cm.index > 0) {
            const s = remaining.slice(0, cm.index + 1).trim();
            remaining = remaining.slice(cm.index + 1);
            if (s) completed.push(s);
            continue;
          }
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
      addMsg,
      awardDiamonds,
      speak,
      playTTS,
      highlightSpeaker,
      splitSentences,
    ]
  );

  /* ─── room chat ─── */

  const callRoom = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!friend) return null;
      try {
        const recent = roomMsgs
          .slice(-10)
          .map((m) => `${m.sender}: ${m.content}`)
          .join("\n");
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            phase: getPhase(ROOM_DURATION - timeLeft),
            turnIndex: roomTurnRef.current,
            friendName: friend.name,
            friendEnglishName: friend.englishName,
            friendGrade: friend.grade,
            friendLikes: friend.likes,
            recentContext: recent,
            englishCount,
            ...extra,
          }),
        });
        return await res.json();
      } catch {
        return null;
      }
    },
    [friend, roomMsgs, timeLeft, englishCount]
  );

  const sendRoom = useCallback(
    async (text: string) => {
      if (isLoading || endedRef.current) return;
      addMsg("user", text);
      awardDiamonds(text);
      roomTurnRef.current += 1;
      setIsLoading(true);

      await new Promise((r) => setTimeout(r, 600 + Math.random() * 1000));
      const fd = await callRoom("friend_reply", { userMessage: text });
      if (fd?.reply) {
        const fpts = scoreEnglish(fd.reply);
        if (fpts > 0) {
          setFriendDiamonds((d) => d + fpts);
          setFriendDiamondDelta(fpts);
        }
        speak("friend", fd.reply);
      }
      roomTurnRef.current += 1;

      if (roomTurnRef.current % 3 === 0) {
        await ttsChain.current;
        const who = moderatorRef.current;
        moderatorRef.current = who === "tino" ? "ai2" : "tino";
        const hd = await callRoom("host_comment");
        if (hd?.reply) speak(who, hd.reply);
      }
      setIsLoading(false);
    },
    [isLoading, addMsg, awardDiamonds, speak, callRoom]
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (modeRef.current === "room") sendRoom(text.trim());
      else sendCompanion(text.trim());
    },
    [sendCompanion, sendRoom]
  );

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
        try {
          const reader = new FileReader();
          const b64 = await new Promise<string>((resolve) => {
            reader.onloadend = () =>
              resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });
          const res = await fetch("/api/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: b64, mimeType: actualMime }),
          });
          const data = await res.json();
          const text = (data.text || "").trim();
          if (!text) return;

          if (modeRef.current === "onboarding") {
            const step = onboardStepRef.current;
            setOnboardHeard(text);
            if (step === 0) {
              const name = text.slice(0, 10).replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "") || text.slice(0, 10);
              if (name) {
                setUserName(name);
                setOnboardHeard("");
                setOnboardStep(1);
              }
            } else {
              const grade = parseGradeFromSpeech(text);
              if (grade >= 1 && grade <= 6) {
                const name = userNameRef.current;
                setUserGrade(grade);
                try {
                  localStorage.setItem("tino_user_name", name);
                  localStorage.setItem("tino_user_grade", String(grade));
                } catch {}
                const greeting = `哇，${grade}年级啦！So cool!\n${name}，我们一起聊天吧～`;
                setDisplayText(greeting);
                setCompanionMsgs([{
                  id: "g",
                  sender: "tino",
                  content: greeting,
                  timestamp: Date.now(),
                }]);
                setMode("companion");
              }
            }
            return;
          }
          sendMessage(text);
        } catch {
          /* ASR unavailable */
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
  }, [isPowered, isRecording, sendMessage, highlightSpeaker, unlockAudio]);

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

  /* pre-fetched intro lines */
  const prefetchedIntro = useRef<{
    tino?: string; ai2?: string; friendIntro?: string; warmup?: string;
  }>({});

  const prefetchIntro = useCallback(async (f: VirtualFriend) => {
    const base = {
      phase: "icebreaking",
      turnIndex: 0,
      friendName: f.name,
      friendEnglishName: f.englishName,
      friendGrade: f.grade,
      friendLikes: f.likes,
      recentContext: "",
      englishCount: 0,
    };
    const call = async (action: string, extra: Record<string, unknown> = {}) => {
      try {
        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...base, ...extra }),
        });
        const data = await res.json();
        return data?.reply || null;
      } catch { return null; }
    };
    const [tino, ai2, friendIntro, warmup] = await Promise.all([
      call("tino_intro", { userName: userName || "小朋友" }),
      call("ai2_intro"),
      call("friend_self_intro"),
      call("warmup", { userName: userName || "小朋友" }),
    ]);
    prefetchedIntro.current = { tino, ai2, friendIntro, warmup };
  }, []);

  const leaveRoom = useCallback(() => {
    endedRef.current = true;
    setDiamonds((d) => d + sessionDiamonds);
    setSessionDiamonds(0);
    setMode("companion");
    setFriend(null);
    setActiveSpeaker(null);
    setShowExitConfirm(false);
    setRoomDisplay(null);
  }, [sessionDiamonds]);

  /* ─── matching ─── */

  const startMatch = useCallback(() => {
    unlockAudio();
    setMode("matching");
    const f = FRIENDS[Math.floor(Math.random() * FRIENDS.length)];
    prefetchedIntro.current = {};
    prefetchIntro(f);
    setTimeout(() => {
      setFriend(f);
      setRoomMsgs([]);
      setTimeLeft(ROOM_DURATION);
      setEnglishCount(0);
      roomTurnRef.current = 0;
      gameRef.current = false;
      summaryRef.current = false;
      introRef.current = false;
      endedRef.current = false;
      moderatorRef.current = "tino";
      setActiveSpeaker(null);
      setRoomDisplay(null);
      setSessionDiamonds(0);
      setFriendDiamonds(0);
      setMode("room");
    }, 3000);
  }, [unlockAudio, prefetchIntro]);

  /* ─── shake-to-match (mobile accelerometer) ─── */

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
    if (mode !== "room" || introRef.current || !friend) return;
    introRef.current = true;
    addMsg("system", `${friend.name} 加入了聊天`);

    const pre = prefetchedIntro.current;

    speak(
      "tino",
      pre.tino ||
        `嘿嘿，我来给大家介绍一下！This is my best friend ${userName || "小朋友"}！我们经常一起聊天哦～`
    );

    (async () => {
      await ttsChain.current;

      speak(
        "ai2",
        pre.ai2 ||
          `我也带了一个好朋友！This is ${friend.englishName}! ${friend.name}喜欢${friend.likes.join("和")}哦～`
      );
      await ttsChain.current;

      speak(
        "friend",
        pre.friendIntro ||
          `大家好！I'm ${friend.englishName}! Nice to meet you! 我喜欢${friend.likes[0]}～`
      );
      await ttsChain.current;

      speak(
        "tino",
        pre.warmup ||
          `太棒了！Now let's chat! ${userName || "小朋友"}，你喜欢什么呀？Tell us!`
      );
    })();
  }, [mode, friend, addMsg, speak]);

  const elapsed = ROOM_DURATION - timeLeft;
  const phase = getPhase(elapsed);

  useEffect(() => {
    if (mode !== "room") return;
    if (phase === "game" && !gameRef.current) {
      gameRef.current = true;
      addMsg("system", "🎮 小游戏时间！");
      (async () => {
        const d = await callRoom("game");
        speak("tino", d?.reply || "Game time! 谁能用英文说三种水果？🍎🍌🍊");
      })();
    }
    if (phase === "summary" && !summaryRef.current) {
      summaryRef.current = true;
      (async () => {
        const d = await callRoom("summary");
        speak(
          "tino",
          d?.reply || `你们说了 ${englishCount} 句英文！Great job! 👏`
        );
      })();
    }
  }, [mode, phase, addMsg, speak, callRoom, englishCount]);

  useEffect(() => {
    if (mode !== "room" || timeLeft > 0 || endedRef.current) return;
    endedRef.current = true;
    setDiamonds((d) => d + sessionDiamonds);
    setSessionDiamonds(0);
    addMsg("system", "聊天时间到啦～下次再见！");
    setTimeout(() => {
      setMode("companion");
      setFriend(null);
      setActiveSpeaker(null);
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
      : centerSpeaker === "ai2"
        ? AI2_NAME
        : centerSpeaker === "user"
          ? (userName || "我")
          : friend?.name || "";

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
      ) : mode === "onboarding" ? (
        <div className="flex flex-col h-full items-center justify-center px-5 gap-3">
          <TinoAvatar
            size={64}
            expression={isRecording ? "excited" : isTranscribing ? "thinking" : "waving"}
            className={isRecording ? "animate-pulse-soft" : "animate-float"}
          />
          {onboardStep === 0 ? (
            <>
              <p className="text-sm text-tino-brown text-center font-bold">
                嗨！我是 Tino～<br />一只来自语言星球的小狐狸 🦊<br />你叫什么名字呀？
              </p>
              <p className="text-xs text-tino-brown-light text-center">
                按住右侧按钮告诉我吧～
              </p>
              {onboardHeard && (
                <p className="text-xs text-tino-orange font-bold">
                  你说的是：{onboardHeard}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-tino-brown text-center font-bold">
                {userName}，好好听的名字！<br />Nice to meet you! 嘻嘻～<br />那你现在几年级啦？
              </p>
              <p className="text-xs text-tino-brown-light text-center">
                按住右侧按钮说话（一年级、二年级…都可以哦）
              </p>
              {onboardHeard && (
                <p className="text-xs text-tino-orange font-bold">
                  你说的是：{onboardHeard}
                </p>
              )}
            </>
          )}
        </div>
      ) : mode === "matching" ? (
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
        </div>
      ) : mode === "companion" ? (
        /* ── companion: avatar + speech ── */
        <div className="flex flex-col h-full relative">
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
        <div className="flex flex-col h-full relative">
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
        /* ── room: speaker stage ── */
        <div className="flex flex-col h-full relative">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
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
          <div className="flex items-start justify-center gap-3 px-2 pt-4 pb-1 flex-shrink-0">
            {([
              { id: "tino" as const, node: <TinoAvatar size={28} expression="happy" />, isAI: true },
              { id: "ai2" as const, node: <div className="w-7 h-7 rounded-full bg-violet-400 text-white text-[13px] flex items-center justify-center">{AI2_EMOJI}</div>, isAI: true },
              { id: "user" as const, node: <div className="w-7 h-7 rounded-full bg-tino-blue text-white text-[9px] font-bold flex items-center justify-center" style={activeFrame !== "none" ? userFrameStyle : undefined}>我</div>, isAI: false },
              { id: "friend" as const, node: <div className="w-7 h-7 rounded-full bg-tino-green text-white text-[9px] font-bold flex items-center justify-center">{friend?.name?.[1]}</div>, isAI: false },
            ]).map(({ id, node, isAI }) => (
              <div
                key={id}
                className={`flex flex-col items-center transition-all duration-300 ${
                  centerSpeaker === id ? "opacity-100 scale-110" : "opacity-30"
                }`}
                style={{ width: 36, height: 44 }}
                onClick={id === "user" ? () => { if (showExitConfirm) leaveRoom(); else setShowExitConfirm(true); } : undefined}
              >
                <div className="relative">
                  {node}
                  {isAI && (
                    <span className="absolute -top-1.5 -right-2 bg-violet-500 text-white text-[5px] font-bold px-[3px] py-[0.5px] rounded-sm leading-tight">AI</span>
                  )}
                </div>
                <span className="relative mt-0.5 text-[8px] font-bold text-violet-500 leading-none whitespace-nowrap">
                  {(id === "user" || id === "friend") ? (
                    <>
                      💎{id === "user" ? sessionDiamonds : friendDiamonds}
                      {id === "user" && diamondDelta !== null && (
                        <span className="absolute -top-2.5 left-full ml-0.5 text-[9px] text-green-500 font-bold diamond-float whitespace-nowrap">
                          +{diamondDelta}
                        </span>
                      )}
                      {id === "friend" && friendDiamondDelta !== null && (
                        <span className="absolute -top-2.5 left-full ml-0.5 text-[9px] text-green-500 font-bold diamond-float whitespace-nowrap">
                          +{friendDiamondDelta}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="invisible">💎0</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* center: speaker + lyrics + status */}
          <div className="flex-1 flex flex-col items-center justify-center px-4">
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
              {centerSpeaker === "ai2" && (
                <div className="w-12 h-12 rounded-full bg-violet-400 text-white text-2xl flex items-center justify-center">
                  {AI2_EMOJI}
                </div>
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
                  {friend?.name?.[1]}
                </div>
              )}
            </div>

            <span className="mt-1 text-[10px] font-bold text-tino-brown">{centerLabel}</span>

            {/* lyrics text area */}
            <div
              ref={lyricsBoxRef}
              className="mt-2 w-full overflow-hidden"
              style={{ height: "4.5em", lineHeight: "1.5" }}
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

          <div className="flex-shrink-0 py-2 text-center">
            <p className="text-xs font-bold text-tino-brown-light">
              {statusIcon} {statusText}
            </p>
          </div>
        </div>
      )}
    </DeviceFrame>
  );
}

