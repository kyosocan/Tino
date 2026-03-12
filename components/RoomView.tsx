"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "@/lib/types";

type RoomPhase = "icebreaking" | "free_chat" | "game" | "summary";
type VirtualFriend = { name: string; englishName: string; grade: number; likes: string[] };
import TinoAvatar from "./TinoAvatar";
import ChatBubble from "./ChatBubble";
import ChatInput from "./ChatInput";

const ROOM_DURATION = 300;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getPhase(elapsed: number): RoomPhase {
  if (elapsed < 30) return "icebreaking";
  if (elapsed < 240) return "free_chat";
  if (elapsed < 270) return "game";
  return "summary";
}

export default function RoomView({
  friend,
  onEnd,
}: {
  friend: VirtualFriend;
  onEnd: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(ROOM_DURATION);
  const [ended, setEnded] = useState(false);
  const [englishCount, setEnglishCount] = useState(0);
  const turnRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const gameTriggeredRef = useRef(false);
  const summaryTriggeredRef = useRef(false);
  const introSentRef = useRef(false);

  const elapsed = ROOM_DURATION - timeLeft;
  const phase = getPhase(elapsed);

  const addMessage = useCallback(
    (sender: Message["sender"], content: string) => {
      const msg: Message = {
        id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender,
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);

      const englishWordRegex = /[a-zA-Z]{2,}/g;
      const matches = content.match(englishWordRegex) || [];
      if (matches.length >= 2) setEnglishCount((c) => c + 1);
    },
    []
  );

  const callRoomApi = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      try {
        const recentMsgs = messages
          .slice(-12)
          .map((m) => `${m.sender}: ${m.content}`)
          .join("\n");

        const res = await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            phase,
            turnIndex: turnRef.current,
            friendName: friend.name,
            friendEnglishName: friend.englishName,
            friendGrade: friend.grade,
            friendLikes: friend.likes,
            recentContext: recentMsgs,
            englishCount,
            ...extra,
          }),
        });
        return await res.json();
      } catch {
        return null;
      }
    },
    [messages, phase, friend, englishCount]
  );

  // Scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Room intro
  useEffect(() => {
    if (introSentRef.current) return;
    introSentRef.current = true;

    addMessage(
      "system",
      `${friend.name} (${friend.englishName}) 加入了聊天室`
    );

    (async () => {
      const data = await callRoomApi("intro");
      if (data?.reply) {
        addMessage("tino", data.reply);
      } else {
        addMessage(
          "tino",
          `Welcome! 大家好！我们来认识一下吧～\n先用英文介绍自己：My name is... I like... I am in Grade...`
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Game trigger
  useEffect(() => {
    if (phase === "game" && !gameTriggeredRef.current) {
      gameTriggeredRef.current = true;
      addMessage("system", "🎮 小游戏时间！");
      (async () => {
        const data = await callRoomApi("game");
        if (data?.reply) {
          addMessage("tino", data.reply);
        } else {
          addMessage(
            "tino",
            "Game time! 谁能用英文说出三种水果？🍎🍌🍊\nWho can name three fruits in English?"
          );
        }
      })();
    }
  }, [phase, addMessage, callRoomApi]);

  // Summary trigger
  useEffect(() => {
    if (phase === "summary" && !summaryTriggeredRef.current) {
      summaryTriggeredRef.current = true;
      (async () => {
        const data = await callRoomApi("summary");
        if (data?.reply) {
          addMessage("tino", data.reply);
        } else {
          addMessage(
            "tino",
            `今天你们说了 ${englishCount} 句英文！Great job! 👏\nYou two are amazing friends!`
          );
        }
      })();
    }
  }, [phase, addMessage, callRoomApi, englishCount]);

  // Auto end
  useEffect(() => {
    if (timeLeft === 0 && !ended) {
      setEnded(true);
      addMessage("system", "聊天时间到啦！下次再见～");
      setTimeout(onEnd, 4000);
    }
  }, [timeLeft, ended, addMessage, onEnd]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading || ended) return;

      addMessage("user", text.trim());
      turnRef.current += 1;
      setIsLoading(true);

      // Friend reply after a short delay
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));

      const friendData = await callRoomApi("friend_reply", {
        userMessage: text.trim(),
      });
      if (friendData?.reply) {
        addMessage("friend", friendData.reply);
      }

      turnRef.current += 1;

      // Tino hosts every 3 turns
      if (turnRef.current % 3 === 0) {
        await new Promise((r) => setTimeout(r, 600));
        const hostData = await callRoomApi("host_comment");
        if (hostData?.reply) {
          addMessage("tino", hostData.reply);
        }
      }

      setIsLoading(false);
    },
    [isLoading, ended, addMessage, callRoomApi]
  );

  const timerColor =
    timeLeft <= 30
      ? "text-red-500"
      : timeLeft <= 60
        ? "text-tino-orange"
        : "text-tino-brown-light";

  return (
    <div className="flex flex-col h-full">
      {/* Room header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-sm border-b border-tino-orange/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <TinoAvatar size={28} expression="excited" />
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full bg-tino-blue flex items-center justify-center text-white text-[10px] font-bold">
              我
            </div>
            <span className="text-xs text-tino-brown-light">×</span>
            <div className="w-6 h-6 rounded-full bg-tino-green flex items-center justify-center text-white text-[10px] font-bold">
              {friend.name.charAt(1)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full bg-white shadow-sm text-sm font-mono font-bold ${timerColor}`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatTime(timeLeft)}
          </div>
        </div>
      </header>

      {/* Phase indicator */}
      <div className="px-4 py-1.5 bg-gradient-to-r from-tino-orange/5 to-tino-blue/5 text-center">
        <span className="text-xs text-tino-brown-light">
          {phase === "icebreaking" && "🤝 破冰阶段 - 互相认识一下吧"}
          {phase === "free_chat" && "💬 自由聊天 - 聊你们感兴趣的话题"}
          {phase === "game" && "🎮 小游戏时间 - 一起来玩！"}
          {phase === "summary" && "🌟 即将结束 - 今天表现太棒了"}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 chat-messages">
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            friendName={friend.name}
          />
        ))}
        {isLoading && (
          <div className="flex items-start gap-2 message-enter">
            <div className="w-8 h-8 rounded-full bg-tino-green flex items-center justify-center text-white text-xs font-bold">
              {friend.name.charAt(1)}
            </div>
            <div className="bg-tino-green-light rounded-2xl rounded-bl-md px-4 py-3 mt-5">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-tino-green animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        disabled={isLoading || ended}
      />
    </div>
  );
}
