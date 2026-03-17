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
    "cursor-pointer shadow-md transition-colors bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]";
  const deviceWidth = 454;
  const deviceHeight = 292;

  return (
    <div
      className="device-scale-wrapper relative"
      style={
        {
          "--device-w": `${deviceWidth}px`,
          "--device-h": `${deviceHeight}px`,
        } as React.CSSProperties
      }
    >
      {/* Flex layout: [left btns] [device body] [right btn] */}
      <div className="flex items-center" style={{ width: deviceWidth, height: deviceHeight }}>
        {/* ── Left side buttons ── */}
        <div className="relative flex-shrink-0" style={{ width: 14, height: deviceHeight - 28 }}>
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[26px] rounded-l-[4px]`}
            style={{ top: "14%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...powerHandlers}
          />
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[34px] rounded-l-[4px]`}
            style={{ top: "36%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...volUpHandlers}
          />
          <div
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-full h-[34px] rounded-l-[4px]`}
            style={{ top: "54%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
            {...volDownHandlers}
          />
        </div>

        {/* ── Device body ── */}
        <div
          className="relative h-full flex-1 rounded-[28px] bg-gradient-to-b from-[#ECECEC] via-[#DCDCDC] to-[#CBCBCB]"
          style={{
            boxShadow:
              "0 12px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.08)",
          }}
        >
          <div
            className="absolute left-1/2 top-[10px] h-[4px] w-16 -translate-x-1/2 rounded-full bg-black/20"
            aria-hidden="true"
          />
          {/* ── 2.8 寸横屏 ── */}
          <div
            className="absolute overflow-hidden bg-tino-cream"
            style={{
              left: "9.5%",
              right: "9.5%",
              top: "10.5%",
              bottom: "10.5%",
              borderRadius: 16,
              border: "2px solid #3A3A3A",
            }}
          >
            {children}
          </div>
        </div>

        {/* ── Right: Voice button（长按不触发选中文字）── */}
        <div
          className="relative flex-shrink-0 select-none"
          style={{
            width: 34,
            height: deviceHeight - 40,
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <div
            role="button"
            tabIndex={0}
            className={`absolute w-full h-[92px] rounded-r-[8px] shadow-md cursor-pointer transition-all select-none ${
              isRecording
                ? "bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)]"
                : "bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]"
            }`}
            style={{
              top: "50%",
              right: 0,
              transform: "translateY(-50%)",
              touchAction: "none",
              WebkitTapHighlightColor: "rgba(0,0,0,0.1)",
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
