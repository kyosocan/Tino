"use client";

import { useCallback } from "react";

type Props = {
  children: React.ReactNode;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onPower: () => void;
  isRecording: boolean;
  isSpeaking?: boolean;
};

export default function DeviceFrame({
  children,
  onVoiceStart,
  onVoiceEnd,
  onVolumeUp,
  onVolumeDown,
  onPower,
  isRecording,
  isSpeaking,
}: Props) {
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      onVoiceStart();
    },
    [onVoiceStart]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      onVoiceEnd();
    },
    [onVoiceEnd]
  );

  const btnBase =
    "absolute select-none cursor-pointer shadow-md transition-colors bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] hover:from-[#B8B8B8] hover:to-[#989898] active:from-[#909090] active:to-[#808080]";

  return (
    <div className="device-scale-wrapper">
      <div className="relative" style={{ width: 332, height: 560 }}>
        {/* ── Device body ── */}
        <div
          className="absolute rounded-[28px] bg-gradient-to-b from-[#EAEAEA] to-[#D0D0D0]"
          style={{
            left: 20,
            right: 20,
            top: 0,
            bottom: 0,
            boxShadow:
              "0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.08)",
          }}
        >
          {/* ── Screen ── */}
          <div
            className="absolute overflow-hidden bg-tino-cream"
            style={{
              left: "12%",
              right: "12%",
              top: "5.5%",
              bottom: "37%",
              borderRadius: 10,
              border: "2.5px solid #3A3A3A",
            }}
          >
            {children}
          </div>

          {/* ── Speaker grills ── */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 transition-all duration-300 ${isSpeaking ? "speaker-active" : ""}`}
            style={{ bottom: "10%", width: "34%", aspectRatio: "1" }}
          >
            {[0, 16, 32, 46].map((inset) => (
              <div
                key={inset}
                className={`absolute rounded-full border transition-colors duration-300 ${isSpeaking ? "border-tino-orange" : "border-[#B8B8B8]"}`}
                style={{ inset: `${inset}%` }}
              />
            ))}
          </div>

          {/* ── Mic hole ── */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full bg-[#777]"
            style={{ bottom: "3.5%" }}
          />
        </div>

        {/* ── Left: Power button ── */}
        <button
          className={`${btnBase} left-0 w-[20px] h-[28px] rounded-l-[4px]`}
          style={{ top: "9%" }}
          onClick={onPower}
          title="关机键"
        />

        {/* ── Left: Volume + ── */}
        <button
          className={`${btnBase} left-0 w-[20px] h-[34px] rounded-l-[4px]`}
          style={{ top: "26%" }}
          onClick={onVolumeUp}
          title="音量 +"
        />

        {/* ── Left: Volume − ── */}
        <button
          className={`${btnBase} left-0 w-[20px] h-[34px] rounded-l-[4px]`}
          style={{ top: "38%" }}
          onClick={onVolumeDown}
          title="音量 −"
        />

        {/* ── Right: Voice button ── */}
        <button
          className={`absolute right-0 w-[20px] h-[72px] rounded-r-[4px] shadow-md select-none cursor-pointer transition-all ${
            isRecording
              ? "bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)]"
              : "bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] hover:from-[#B8B8B8] hover:to-[#989898] active:from-[#909090] active:to-[#808080]"
          }`}
          style={{ top: "24%" }}
          onMouseDown={onVoiceStart}
          onMouseUp={onVoiceEnd}
          onMouseLeave={isRecording ? onVoiceEnd : undefined}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          title="语音按键（按住说话）"
        />
      </div>
    </div>
  );
}
