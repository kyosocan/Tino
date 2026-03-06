"use client";

import { useCallback, useRef, useEffect } from "react";

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
  const voiceBtnRef = useRef<HTMLDivElement>(null);
  const volUpRef = useRef<HTMLDivElement>(null);
  const volDownRef = useRef<HTMLDivElement>(null);
  const powerRef = useRef<HTMLDivElement>(null);
  const touchedRef = useRef(false);
  const recordingRef = useRef(isRecording);
  useEffect(() => { recordingRef.current = isRecording; }, [isRecording]);

  const cbRefs = useRef({ onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower });
  useEffect(() => {
    cbRefs.current = { onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower };
  }, [onVoiceStart, onVoiceEnd, onVolumeUp, onVolumeDown, onPower]);

  useEffect(() => {
    const voice = voiceBtnRef.current;
    const volUp = volUpRef.current;
    const volDown = volDownRef.current;
    const power = powerRef.current;
    if (!voice) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      touchedRef.current = true;
      cbRefs.current.onVoiceStart();
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      touchedRef.current = true;
      cbRefs.current.onVoiceEnd();
    };
    const onClick = () => {
      if (touchedRef.current) { touchedRef.current = false; return; }
      if (recordingRef.current) cbRefs.current.onVoiceEnd();
      else cbRefs.current.onVoiceStart();
    };

    voice.addEventListener("touchstart", onTouchStart, { passive: false });
    voice.addEventListener("touchend", onTouchEnd, { passive: false });
    voice.addEventListener("click", onClick);

    const makeTap = (fn: () => void) => {
      let tapped = false;
      const ts = (e: TouchEvent) => { e.preventDefault(); tapped = true; fn(); };
      const cl = () => { if (tapped) { tapped = false; return; } fn(); };
      return { ts, cl };
    };

    const vu = makeTap(() => cbRefs.current.onVolumeUp());
    const vd = makeTap(() => cbRefs.current.onVolumeDown());
    const pw = makeTap(() => cbRefs.current.onPower());

    volUp?.addEventListener("touchstart", vu.ts, { passive: false });
    volUp?.addEventListener("click", vu.cl);
    volDown?.addEventListener("touchstart", vd.ts, { passive: false });
    volDown?.addEventListener("click", vd.cl);
    power?.addEventListener("touchstart", pw.ts, { passive: false });
    power?.addEventListener("click", pw.cl);

    return () => {
      voice.removeEventListener("touchstart", onTouchStart);
      voice.removeEventListener("touchend", onTouchEnd);
      voice.removeEventListener("click", onClick);
      volUp?.removeEventListener("touchstart", vu.ts);
      volUp?.removeEventListener("click", vu.cl);
      volDown?.removeEventListener("touchstart", vd.ts);
      volDown?.removeEventListener("click", vd.cl);
      power?.removeEventListener("touchstart", pw.ts);
      power?.removeEventListener("click", pw.cl);
    };
  }, []);

  const btnBase =
    "cursor-pointer shadow-md transition-colors bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]";

  return (
    <div className="device-scale-wrapper relative">
      {/* Flex layout: [left btns] [device body] [right btn] */}
      <div className="flex" style={{ width: 260, height: 432 }}>
        {/* ── Left side buttons ── */}
        <div className="relative flex-shrink-0" style={{ width: 22 }}>
          <div
            ref={powerRef}
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-[12px] h-[30px] rounded-l-[3px]`}
            style={{ top: "9%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
          />
          <div
            ref={volUpRef}
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-[12px] h-[38px] rounded-l-[3px]`}
            style={{ top: "22%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
          />
          <div
            ref={volDownRef}
            role="button"
            tabIndex={0}
            className={`absolute ${btnBase} w-[12px] h-[38px] rounded-l-[3px]`}
            style={{ top: "35%", left: 0, touchAction: "manipulation", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
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
        <div className="relative flex-shrink-0" style={{ width: 22 }}>
          <div
            ref={voiceBtnRef}
            role="button"
            tabIndex={0}
            className={`absolute w-full h-[120px] rounded-r-[5px] shadow-md cursor-pointer transition-all ${
              isRecording
                ? "bg-red-500 shadow-[0_0_16px_rgba(239,68,68,0.5)]"
                : "bg-gradient-to-b from-[#C8C8C8] to-[#A8A8A8] active:from-[#909090] active:to-[#808080]"
            }`}
            style={{ top: "20%", right: 0, touchAction: "none", WebkitTapHighlightColor: "rgba(0,0,0,0.1)" }}
          />
        </div>
      </div>
    </div>
  );
}
