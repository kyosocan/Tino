"use client";

import Image from "next/image";
import tinoAvatar from "@/scripts/ai_api/111.png";

export default function TinoAvatar({
  size = 48,
  className = "",
  expression: _expression = "happy",
}: {
  expression?: "happy" | "excited" | "thinking" | "waving";
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={tinoAvatar}
      alt="Tino"
      width={size}
      height={size}
      className={`rounded-full object-cover object-top ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
