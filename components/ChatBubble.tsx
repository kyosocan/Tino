"use client";

import { Message } from "@/lib/types";
import TinoAvatar from "./TinoAvatar";

const senderConfig: Record<
  string,
  { align: string; bubbleBg: string; bubbleText: string; label: string }
> = {
  user: {
    align: "justify-end",
    bubbleBg: "bg-tino-blue-light",
    bubbleText: "text-tino-brown",
    label: "我",
  },
  tino: {
    align: "justify-start",
    bubbleBg: "bg-tino-orange-pale",
    bubbleText: "text-tino-brown",
    label: "Tino",
  },
  friend: {
    align: "justify-start",
    bubbleBg: "bg-tino-green-light",
    bubbleText: "text-tino-brown",
    label: "",
  },
  system: {
    align: "justify-center",
    bubbleBg: "bg-white/60",
    bubbleText: "text-tino-brown-light",
    label: "",
  },
};

export default function ChatBubble({
  message,
  friendName,
}: {
  message: Message;
  friendName?: string;
}) {
  const config = senderConfig[message.sender] || senderConfig.tino;

  if (message.sender === "system") {
    return (
      <div className="flex justify-center message-enter">
        <div
          className={`${config.bubbleBg} ${config.bubbleText} px-2.5 py-0.5 rounded-full text-[10px]`}
        >
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.sender === "user";
  const isFriend = message.sender === "friend";

  return (
    <div className={`flex ${config.align} gap-1 message-enter`}>
      {!isUser && (
        <div className="flex-shrink-0 mt-0.5">
          {message.sender === "tino" ? (
            <TinoAvatar size={20} expression="happy" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-tino-green flex items-center justify-center text-white text-[8px] font-bold">
              {(friendName || "友")[1] || "友"}
            </div>
          )}
        </div>
      )}

      <div className={`max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && (
          <div className="text-[8px] text-tino-brown-light mb-0.5 px-0.5 leading-none">
            {isFriend ? friendName || "小伙伴" : config.label}
          </div>
        )}
        <div
          className={`${config.bubbleBg} ${config.bubbleText} px-2 py-1.5 text-[11px] leading-snug whitespace-pre-wrap ${
            isUser ? "rounded-xl rounded-br-sm" : "rounded-xl rounded-bl-sm"
          }`}
        >
          {message.content}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 mt-0.5">
          <div className="w-5 h-5 rounded-full bg-tino-blue flex items-center justify-center text-white text-[8px] font-bold">
            我
          </div>
        </div>
      )}
    </div>
  );
}
