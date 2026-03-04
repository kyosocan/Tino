import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tino - 你的英语小伙伴",
  description:
    "Tino 是一个陪伴型 AI 小伙伴，陪你聊天，偶尔一起说说英文",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="font-sans bg-[#1a1a2e] antialiased">
        <div className="h-dvh w-full flex items-center justify-center overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
