"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Message } from "@/lib/types";
import TinoAvatar from "./TinoAvatar";
import ChatBubble from "./ChatBubble";
import ChatInput from "./ChatInput";
import ShakeButton from "./ShakeButton";

const GREETING_OPTIONS = [
  "嗨！我是 Tino，一只来自语言星球的小狐狸～\n今天想聊点什么呀？What do you want to talk about?",
  "你好呀～我是 Tino！\n想聊什么都可以哦。What would you like to talk about?",
  "嗨！Tino 来啦～\n我们随便聊聊吧！Do you want to talk about your day?",
  "你好！我是小狐狸 Tino～\n今天想说什么？What do you want to talk about?",
];

function pickGreetingContent(): string {
  return GREETING_OPTIONS[Math.floor(Math.random() * GREETING_OPTIONS.length)];
}

export default function CompanionChat({
  onStartMatch,
}: {
  onStartMatch: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "greeting",
      sender: "tino",
      content: pickGreetingContent(),
      timestamp: Date.now(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        sender: "user",
        content: text.trim(),
        timestamp: Date.now(),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages.slice(-20).map((m) => ({
              sender: m.sender,
              content: m.content,
            })),
            turnCount: turnCount + 1,
          }),
        });

        const data = await res.json();

        const tinoMsg: Message = {
          id: `t-${Date.now()}`,
          sender: "tino",
          content: data.reply || "嘻嘻，我走神了～再说一次吧！",
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, tinoMsg]);
        setTurnCount((c) => c + 1);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            sender: "tino",
            content: "哎呀，我的脑袋转不动啦，稍等再试试吧～",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, turnCount]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-sm border-b border-tino-orange/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <TinoAvatar size={36} expression="happy" />
          <div>
            <h1 className="text-base font-bold leading-tight">Tino</h1>
            <p className="text-[10px] text-tino-brown-light">你的英语小伙伴</p>
          </div>
        </div>
        <ShakeButton onClick={onStartMatch} />
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 chat-messages">
        {messages.map((msg) => (
          <ChatBubble key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex items-start gap-2 message-enter">
            <TinoAvatar size={32} expression="thinking" />
            <div className="bg-tino-orange-pale rounded-2xl rounded-bl-md px-4 py-3 mt-5">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-tino-orange animate-bounce"
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
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </div>
  );
}
