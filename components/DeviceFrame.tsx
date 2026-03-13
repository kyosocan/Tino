"use client";

import { useCallback, useEffect, useRef } from "react";

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
  const pressHandledRef = useRef(false);
  const touchRecordingRef = useRef(false);

  const cbRefs = useRef({ onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower });
  useEffect(() => {
    cbRefs.current = { onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower };
  }, [onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower]);

  const handleVoicePressStart = useCallback(() => {
    if (touchRecordingRef.current || isRecording) return;
    touchRecordingRef.current = true;
    cbRefs.current.onVoiceStart();
  }, [isRecording]);

  const handleVoicePressEnd = useCallback(() => {
    if (!touchRecordingRef.current && !isRecording) return;
    touchRecordingRef.current = false;
    cbRefs.current.onVoiceEnd();
  }, [isRecording]);

  const handleVoicePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      pressHandledRef.current = true;
      handleVoicePressStart();
    },
    [handleVoicePressStart]
  );

  const handleVoicePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      pressHandledRef.current = true;
      handleVoicePressEnd();
    },
    [handleVoicePressEnd]
  );

  const handleVoiceTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      pressHandledRef.current = true;
      handleVoicePressStart();
    },
    [handleVoicePressStart]
  );

  const handleVoiceTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      pressHandledRef.current = true;
      handleVoicePressEnd();
    },
    [handleVoicePressEnd]
  );

  const handleVoiceClick = useCallback(() => {
    if (pressHandledRef.current) {
      pressHandledRef.current = false;
      return;
    }
    if (isRecording) handleVoicePressEnd();
    else handleVoicePressStart();
  }, [handleVoicePressEnd, handleVoicePressStart, isRecording]);

  const makeTapHandlers = useCallback((fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      pressHandledRef.current = true;
      fn();
    },
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      pressHandledRef.current = true;
      fn();
    },
    onClick: () => {
      if (pressHandledRef.current) {
        pressHandledRef.current = false;
        return;
      }
      fn();
    },
  }), []);

  const powerHandlers = makeTapHandlers(() => cbRefs.current.onPower());
  const volUpHandlers = makeTapHandlers(() => cbRefs.current.onVolumeUp());
  const volDownHandlers = makeTapHandlers(() => cbRefs.current.onVolumeDown());

  const btnBase =
    "cursor-pointer shadow-md transition-colors bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]";

  return (
    <div className="device-scale-wrapper relative">
      {/* Flex layout: [left btns] [device body] [right btn] */}
      <div className="flex" style={{ width: 260, height: 432 }}>
        {/* ── Left side buttons ── */}
        <div className="relative flex-shrink-0" style={{ width: 12 }}>
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[30px] rounded-l-[3px]`}
            style={{ top: "9%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...powerHandlers}
          />
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[38px] rounded-l-[3px]`}
            style={{ top: "22%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...volUpHandlers}
          />
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[38px] rounded-l-[3px]`}
            style={{ top: "35%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...volDownHandlers}
          />
        </div>

        {/* ── Device body ── */}
        <div
          className="relative flex-1 rounded-[22px] bg-gradient-to-b from-[#EAEAEA] to-[#D0D0D0]"
          style={{
            boxShadow:
              "0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.08)",
          }}
        >
          {/* ── Screen ── */}
          <div
            className="absolute overflow-hidden bg-tino-cream"
            style={{
              left: "5%",
              right: "5%",
              top: "3%",
              bottom: "36%",
              borderRadius: 10,
              border: "2px solid #3A3A3A",
            }}
          >
            {children}
          </div>

          {/* ── Speaker grills ── */}
          <div
            className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
            style={{ bottom: "8%", width: "40%", aspectRatio: "1" }}
          >
            {[0, 18, 34, 48].map((inset) => (
              <div
                key={inset}
                className="absolute rounded-full border border-[#B8B8B8]"
                style={{ inset: `${inset}%` }}
              />
            ))}
          </div>

          {/* ── Mic hole ── */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-[4px] h-[4px] rounded-full bg-[#777]"
            style={{ bottom: "3%" }}
          />
        </div>

        {/* ── Right: Voice button ── */}
        <div className="relative flex-shrink-0" style={{ width: 28 }}>
          <div
            role="button"
            tabIndex={0}
            className={`absolute w-full h-[120px] rounded-r-[5px] shadow-md cursor-pointer transition-all ${
              isRecording
                ? "bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)]"
                : "bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]"
            }`}
            style={{ top: "20%", right: 0, touchAction: "none", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            onPointerDown={handleVoicePointerDown}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerUp}
            onTouchStart={handleVoiceTouchStart}
            onTouchEnd={handleVoiceTouchEnd}
            onTouchCancel={handleVoiceTouchEnd}
            onClick={handleVoiceClick}
          />
        </div>
      </div>
    </div>
  );
}
