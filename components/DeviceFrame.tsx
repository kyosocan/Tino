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
  const rightBtnRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const el = rightBtnRef.current;
    if (!el) return;
    const preventSelect = (e: Event) => e.preventDefault();
    el.addEventListener("selectstart", preventSelect);
    return () => el.removeEventListener("selectstart", preventSelect);
  }, []);

  const btnBase =
    "cursor-pointer transition-colors bg-gradient-to-b from-[#B8B8B8] to-[#989898] active:from-[#808080] active:to-[#707070]";

  // Full-screen 2.8" phone: screen 200×267 (3:4), body 210×282, ultra-thin bezels
  const deviceBodyWidth = 210;
  const deviceBodyHeight = 282;
  const leftBtnWidth = 10;
  const rightBtnWidth = 26;
  const totalWidth = deviceBodyWidth + leftBtnWidth + rightBtnWidth;
  const totalHeight = deviceBodyHeight;

  return (
    <div
      className="device-scale-wrapper relative"
      style={
        {
          "--device-w": `${totalWidth}px`,
          "--device-h": `${totalHeight}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="flex items-stretch"
        style={{ width: totalWidth, height: totalHeight }}
      >
        {/* ── Left buttons: power + volume ── */}
        <div className="relative flex-shrink-0" style={{ width: leftBtnWidth, height: totalHeight }}>
          <div
            role="button" tabIndex={0}
            className={`absolute ${btnBase} w-full h-[18px] rounded-l-[3px]`}
            style={{ top: "8%", left: 0, touchAction: "manipulation" }}
            {...powerHandlers}
          />
          <div
            role="button" tabIndex={0}
            className={`absolute ${btnBase} w-full h-[32px] rounded-l-[3px]`}
            style={{ top: "38%", left: 0, touchAction: "manipulation" }}
            {...volUpHandlers}
          />
          <div
            role="button" tabIndex={0}
            className={`absolute ${btnBase} w-full h-[32px] rounded-l-[3px]`}
            style={{ top: "55%", left: 0, touchAction: "manipulation" }}
            {...volDownHandlers}
          />
        </div>

        {/* ── Device body ── */}
        <div
          className="relative flex-1 rounded-[26px]"
          style={{
            background: "linear-gradient(160deg, #2a2a2a 0%, #1a1a1a 50%, #111111 100%)",
            boxShadow:
              "0 16px 56px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.12)",
          }}
        >
          {/* Front camera dot */}
          <div
            className="absolute top-[1.8%] left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full bg-[#2a2a2a] border border-black/60"
            style={{ boxShadow: "inset 0 0 2px rgba(0,0,0,0.8)" }}
            aria-hidden="true"
          />

          {/* ── Full-bleed screen with ultra-thin bezel ── */}
          <div
            className="absolute overflow-hidden bg-tino-cream"
            style={{
              left: 5,
              right: 5,
              top: 5,
              bottom: 5,
              borderRadius: 22,
              border: "1px solid rgba(0,0,0,0.5)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
          >
            {children}
          </div>
        </div>

        {/* ── Right: Voice button ── */}
        <div
          className="relative flex-shrink-0 select-none"
          style={{
            width: rightBtnWidth,
            height: totalHeight,
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <div
            role="button"
            tabIndex={0}
            className={`absolute w-full h-[80px] rounded-r-[6px] cursor-pointer transition-all select-none ${
              isRecording
                ? "bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.6)] recording-pulse"
                : btnBase
            }`}
            style={{
              top: "35%",
              right: 0,
              transform: "translateY(-50%)",
              touchAction: "none",
              WebkitUserSelect: "none",
              userSelect: "none",
              WebkitTouchCallout: "none",
            }}
            onPointerDown={handleVoicePointerDown}
            onPointerUp={handleVoicePointerUp}
            onPointerCancel={handleVoicePointerUp}
            onTouchStart={handleVoiceTouchStart}
            onTouchEnd={handleVoiceTouchEnd}
            onTouchCancel={handleVoiceTouchEnd}
            onClick={handleVoiceClick}
            onContextMenu={(e) => e.preventDefault()}
            ref={rightBtnRef}
          />
        </div>
      </div>
    </div>
  );
}
