"use client";

import Link from "next/link";
import LunaTalkTestRunner from "@/components/LunaTalkTestRunner";

export default function TestPage() {
  return (
    <div className="min-h-dvh w-full self-stretch bg-[#e8e4de] flex flex-col">
      <header className="shrink-0 px-4 py-2 flex justify-between items-center border-b border-stone-200/80 bg-[#e8e4de]">
        <Link href="/" className="text-sm text-purple-700 hover:underline">
          ← 返回首页
        </Link>
        <span className="text-xs text-stone-500">Luna Talk 自动测试</span>
      </header>
      <LunaTalkTestRunner fullPage />
    </div>
  );
}
