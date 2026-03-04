"use client";

import { useState, useEffect } from "react";
import TinoAvatar from "./TinoAvatar";
import type { VirtualFriend } from "@/lib/types";

const MATCH_DURATION = 3000;

export default function MatchingOverlay({
  onMatched,
}: {
  onMatched: (friend: VirtualFriend) => void;
}) {
  const [phase, setPhase] = useState<"searching" | "found">("searching");
  const [friend] = useState<VirtualFriend>(() => {
    const friends: VirtualFriend[] = [
      { name: "小星", englishName: "Star", grade: 3, likes: ["画画", "跑步"] },
      { name: "小月", englishName: "Luna", grade: 2, likes: ["唱歌", "跳舞"] },
      { name: "小云", englishName: "Cloud", grade: 3, likes: ["阅读", "足球"] },
      { name: "小晨", englishName: "Dawn", grade: 2, likes: ["乐高", "篮球"] },
      { name: "小禾", englishName: "Sunny", grade: 3, likes: ["钢琴", "游泳"] },
    ];
    return friends[Math.floor(Math.random() * friends.length)];
  });

  useEffect(() => {
    const timer = setTimeout(() => setPhase("found"), MATCH_DURATION);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase === "found") {
      const timer = setTimeout(() => onMatched(friend), 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, friend, onMatched]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-tino-orange/90 to-tino-blue/80 backdrop-blur-sm">
      {phase === "searching" ? (
        <div className="text-center text-white space-y-6">
          <div className="match-spin inline-block">
            <TinoAvatar size={80} expression="excited" />
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-bold animate-pulse-soft">
              Let&apos;s find a friend!
            </p>
            <p className="text-lg opacity-80">正在寻找小伙伴...</p>
          </div>
          <div className="flex justify-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-3 h-3 rounded-full bg-white animate-bounce"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center text-white space-y-6 animate-bounce-in">
          <p className="text-2xl font-bold">找到啦! 🎉</p>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-tino-blue flex items-center justify-center text-2xl shadow-lg">
                🧒
              </div>
              <p className="mt-1 text-sm font-semibold">你</p>
            </div>
            <TinoAvatar size={48} expression="waving" className="animate-float" />
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-tino-green flex items-center justify-center text-2xl shadow-lg">
                🧒
              </div>
              <p className="mt-1 text-sm font-semibold">{friend.name}</p>
            </div>
          </div>
          <p className="text-lg opacity-80">准备进入聊天房间...</p>
        </div>
      )}
    </div>
  );
}
