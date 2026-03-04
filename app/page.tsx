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

/* ───────── component ───────── */

export default function Home() {
  /* device */
  const [isPowered, setIsPowered] = useState(true);
  const [volume, setVolume] = useState(5);
  const [showVolume, setShowVolume] = useState(false);

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
  const roomTurnRef = useRef(0);
  const gameRef = useRef(false);
  const summaryRef = useRef(false);
  const introRef = useRef(false);
  const endedRef = useRef(false);
  const moderatorRef = useRef<"tino" | "ai2">("tino");

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
    (text: string, speaker?: string) => {
      ttsChain.current = ttsChain.current.then(async () => {
        const ctx = audioCtxRef.current;
        const gain = gainNodeRef.current;
        if (!ctx || !gain) return;

        try {
          if (ctx.state === "suspended") await ctx.resume();
          if (speaker) highlightSpeaker(speaker);
          setIsSpeaking(true);

          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          const data = await res.json();
          if (!data.audioBase64 || data.error) {
            setIsSpeaking(false);
            return;
          }

          const binary = atob(data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);

          const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
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
          setIsSpeaking(false);
        }
      });
    },
    [highlightSpeaker]
  );

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
      if (sender !== "system") highlightSpeaker(sender);
    },
    [highlightSpeaker]
  );

  const speak = useCallback(
    (sender: MessageSender, content: string) => {
      addMsg(sender, content);
      if (sender !== "system" && sender !== "user") {
        playTTS(content, sender);
      }
    },
    [addMsg, playTTS]
  );

  /* ─── companion chat ─── */

  const sendCompanion = useCallback(
    async (text: string) => {
      if (isLoading) return;
      addMsg("user", text);
      setIsLoading(true);
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
          }),
        });
        const data = await res.json();
        const reply = data.reply || "嘻嘻，再说一次吧～";
        speak("tino", reply);
        setDisplayText(reply);
        setTurnCount((c) => c + 1);
      } catch {
        const fb = "哎呀，我走神了～再说一次吧！";
        speak("tino", fb);
        setDisplayText(fb);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, companionMsgs, turnCount, addMsg, speak]
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
      roomTurnRef.current += 1;
      setIsLoading(true);

      await new Promise((r) => setTimeout(r, 600 + Math.random() * 1000));
      const fd = await callRoom("friend_reply", { userMessage: text });
      if (fd?.reply) speak("friend", fd.reply);
      roomTurnRef.current += 1;

      if (roomTurnRef.current % 3 === 0) {
        await new Promise((r) => setTimeout(r, 500));
        const who = moderatorRef.current;
        moderatorRef.current = who === "tino" ? "ai2" : "tino";
        const hd = await callRoom("host_comment");
        if (hd?.reply) speak(who, hd.reply);
      }
      setIsLoading(false);
    },
    [isLoading, addMsg, speak, callRoom]
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
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
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
            body: JSON.stringify({ audioBase64: b64, mimeType: "audio/webm" }),
          });
          const data = await res.json();
          if (data.text) sendMessage(data.text);
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

  /* ─── matching ─── */

  const startMatch = useCallback(() => {
    unlockAudio();
    setMode("matching");
    const f = FRIENDS[Math.floor(Math.random() * FRIENDS.length)];
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
      setMode("room");
    }, 3000);
  }, [unlockAudio]);

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

    (async () => {
      const d1 = await callRoom("tino_intro", { userName: "小朋友" });
      speak(
        "tino",
        d1?.reply ||
          "嘿嘿，我来给大家介绍一下！This is my best friend！我们经常一起聊天哦～"
      );

      await new Promise((r) => setTimeout(r, 3500));
      const d2 = await callRoom("ai2_intro");
      speak(
        "ai2",
        d2?.reply ||
          `我也带了一个好朋友！This is ${friend.englishName}! ${friend.name}喜欢${friend.likes.join("和")}哦～`
      );

      await new Promise((r) => setTimeout(r, 3000));
      const d3 = await callRoom("friend_self_intro");
      speak(
        "friend",
        d3?.reply ||
          `大家好！I'm ${friend.englishName}! Nice to meet you! 我喜欢${friend.likes[0]}～`
      );

      await new Promise((r) => setTimeout(r, 3000));
      const d4 = await callRoom("warmup");
      speak(
        "tino",
        d4?.reply ||
          "太棒了！Now it's your turn! 说说你自己吧，你叫什么名字？喜欢什么呀？"
      );
    })();
  }, [mode, friend, addMsg, speak, callRoom]);

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
    addMsg("system", "聊天时间到啦～下次再见！");
    setTimeout(() => {
      setMode("companion");
      setFriend(null);
      setActiveSpeaker(null);
    }, 3500);
  }, [mode, timeLeft, addMsg]);

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
          : "按住右侧按键说话";

  const statusIcon = isRecording
    ? "🔴"
    : isTranscribing
      ? "⏳"
      : isLoading
        ? "💭"
        : isSpeaking
          ? "🔊"
          : "🟢";

  const recentRoomMsgs = roomMsgs.slice(-4);

  /* ─── avatar ring helper ─── */

  const avatarRing = (id: string, children: React.ReactNode, label: string) => {
    const active = activeSpeaker === id;
    return (
      <div className="flex flex-col items-center gap-0.5" key={id}>
        <div
          className={`rounded-full p-[3px] transition-all duration-300 ${active ? "ring-[2.5px] scale-110" : "ring-[2.5px] ring-transparent"}`}
          style={
            active
              ? {
                  boxShadow: `0 0 14px 4px ${GLOW[id]}`,
                  outline: `2.5px solid ${GLOW[id]}`,
                }
              : undefined
          }
        >
          {children}
        </div>
        <span className="text-[9px] text-tino-brown-light font-semibold leading-none">
          {label}
        </span>
      </div>
    );
  };

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
        /* ── companion: avatar + speech + status ── */
        <div className="flex flex-col h-full relative">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
            <span className="text-sm font-bold text-tino-brown">Tino</span>
            <button
              onClick={startMatch}
              className="px-2.5 py-1 rounded-full bg-tino-orange/15 text-tino-orange text-xs font-bold active:bg-tino-orange/25 transition-colors"
            >
              🌪️ 摇一摇
            </button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-5 gap-4">
            <TinoAvatar
              size={80}
              expression={tinoExpr}
              className={isRecording ? "animate-pulse-soft" : "animate-float"}
            />
            <div
              className="w-full bg-tino-orange-pale rounded-2xl px-4 py-3 text-center shadow-sm animate-fade-in"
              key={displayText}
            >
              <p className="text-sm leading-relaxed text-tino-brown whitespace-pre-wrap">
                {displayText}
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 py-3 text-center">
            <p className="text-base font-bold text-tino-brown-light">
              {statusIcon} {statusText}
            </p>
          </div>
        </div>
      ) : (
        /* ── room ── */
        <div className="flex flex-col h-full relative">
          {showVolume && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="bg-black/60 text-white rounded-2xl px-5 py-3 text-lg font-bold">
                🔊 {volume}
              </div>
            </div>
          )}

          {/* 4 avatars */}
          <div className="flex items-center justify-center gap-4 px-2 pt-3 pb-1 flex-shrink-0">
            {avatarRing(
              "tino",
              <TinoAvatar size={30} expression="happy" />,
              "Tino"
            )}
            {avatarRing(
              "ai2",
              <div className="w-[30px] h-[30px] rounded-full bg-violet-400 text-white text-base flex items-center justify-center">
                {AI2_EMOJI}
              </div>,
              AI2_NAME
            )}
            {avatarRing(
              "user",
              <div className="w-[30px] h-[30px] rounded-full bg-tino-blue text-white text-[11px] font-bold flex items-center justify-center">
                我
              </div>,
              "我"
            )}
            {avatarRing(
              "friend",
              <div className="w-[30px] h-[30px] rounded-full bg-tino-green text-white text-[11px] font-bold flex items-center justify-center">
                {friend?.name[1]}
              </div>,
              friend?.name || ""
            )}
          </div>

          {/* phase */}
          <div className="px-3 py-1 text-center flex-shrink-0">
            <span className="text-xs text-tino-brown-light font-semibold">
              {phase === "icebreaking" && "🤝 互相认识一下"}
              {phase === "free_chat" && "💬 自由聊天"}
              {phase === "game" && "🎮 小游戏"}
              {phase === "summary" && "🌟 即将结束"}
            </span>
          </div>

          {/* recent messages */}
          <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-2 chat-messages">
            {recentRoomMsgs.map((msg) => (
              <RoomBubble
                key={msg.id}
                msg={msg}
                friendName={friend?.name || ""}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 message-enter">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-tino-brown-light/40 animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* status */}
          <div className="flex-shrink-0 py-2 text-center border-t border-tino-orange/10">
            <p className="text-sm font-bold text-tino-brown-light">
              {statusIcon} {statusText}
            </p>
          </div>
        </div>
      )}
    </DeviceFrame>
  );
}

/* ─── Room bubble ─── */

function RoomBubble({
  msg,
  friendName,
}: {
  msg: Message;
  friendName: string;
}) {
  if (msg.sender === "system") {
    return (
      <div className="text-center message-enter">
        <span className="text-xs text-tino-brown-light bg-white/50 px-2.5 py-0.5 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  const isUser = msg.sender === "user";
  const isTino = msg.sender === "tino";
  const isAi2 = msg.sender === "ai2";

  const bgColor = isUser
    ? "bg-tino-blue-light"
    : isTino
      ? "bg-tino-orange-pale"
      : isAi2
        ? "bg-violet-100"
        : "bg-tino-green-light";

  const label = isUser
    ? "我"
    : isTino
      ? "Tino"
      : isAi2
        ? AI2_NAME
        : friendName;

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} message-enter`}
    >
      <div className="max-w-[85%]">
        <div
          className={`text-[10px] ${isUser ? "text-right" : "text-left"} text-tino-brown-light mb-0.5 px-1`}
        >
          {label}
        </div>
        <div
          className={`${bgColor} text-tino-brown text-xs leading-relaxed px-3 py-2 whitespace-pre-wrap ${isUser ? "rounded-xl rounded-br-sm" : "rounded-xl rounded-bl-sm"}`}
        >
          {msg.content}
        </div>
      </div>
    </div>
  );
}
