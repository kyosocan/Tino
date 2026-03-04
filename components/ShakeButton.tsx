"use client";

import { useState, useCallback } from "react";

export default function ShakeButton({ onClick }: { onClick: () => void }) {
  const [isShaking, setIsShaking] = useState(false);

  const handleClick = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => {
      setIsShaking(false);
      onClick();
    }, 500);
  }, [onClick]);

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-tino-orange to-tino-orange-light text-white text-sm font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all ${
        isShaking ? "animate-shake" : ""
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isShaking ? "match-spin" : ""}
      >
        <path d="M21 12a9 9 0 0 0-9-9" />
        <path d="M3 12a9 9 0 0 0 9 9" />
        <path d="M21 12H18" />
        <path d="M6 12H3" />
        <path d="M12 3V6" />
        <path d="M12 18v3" />
      </svg>
      <span>摇一摇</span>
    </button>
  );
}
