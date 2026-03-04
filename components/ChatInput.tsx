"use client";

import { useState, useRef, useCallback } from "react";

export default function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const toggleRecording = useCallback(async () => {
    if (isRecording && recorderRef.current) {
      recorderRef.current.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () =>
              resolve((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });

          const res = await fetch("/api/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: base64, mimeType: "audio/webm" }),
          });
          const data = await res.json();
          if (data.text) onSend(data.text);
        } catch {
          /* ASR unavailable, silently ignore */
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      /* mic access denied */
    }
  }, [isRecording, onSend]);

  return (
    <div className="flex items-center gap-2 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white border-t border-tino-orange/10">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isTranscribing ? "正在识别..." : "跟 Tino 说点什么吧..."
        }
        disabled={disabled || isRecording || isTranscribing}
        className="flex-1 px-4 py-2.5 rounded-full bg-tino-cream border border-tino-orange/20 focus:outline-none focus:border-tino-orange/50 focus:ring-2 focus:ring-tino-orange/10 text-sm placeholder:text-tino-brown-light/50 transition-all"
      />

      {text.trim() ? (
        <button
          onClick={handleSend}
          disabled={disabled}
          className="w-10 h-10 rounded-full bg-tino-orange text-white flex items-center justify-center shadow-md hover:bg-tino-orange-light active:scale-95 transition-all disabled:opacity-50"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </button>
      ) : (
        <button
          onClick={toggleRecording}
          disabled={disabled || isTranscribing}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
            isRecording
              ? "bg-red-500 text-white recording-pulse"
              : "bg-tino-orange/10 text-tino-orange hover:bg-tino-orange/20"
          } disabled:opacity-50`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      )}
    </div>
  );
}
