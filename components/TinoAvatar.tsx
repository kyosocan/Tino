"use client";

type TinoExpression = "happy" | "excited" | "thinking" | "waving";

export default function TinoAvatar({
  expression = "happy",
  size = 48,
  className = "",
}: {
  expression?: TinoExpression;
  size?: number;
  className?: string;
}) {
  const eyeVariants: Record<TinoExpression, React.ReactNode> = {
    happy: (
      <>
        <circle cx="38" cy="42" r="4" fill="#4A3728" />
        <circle cx="62" cy="42" r="4" fill="#4A3728" />
        <circle cx="40" cy="40.5" r="1.5" fill="white" />
        <circle cx="64" cy="40.5" r="1.5" fill="white" />
      </>
    ),
    excited: (
      <>
        <ellipse cx="38" cy="42" rx="4.5" ry="5" fill="#4A3728" />
        <ellipse cx="62" cy="42" rx="4.5" ry="5" fill="#4A3728" />
        <circle cx="40" cy="40" r="2" fill="white" />
        <circle cx="64" cy="40" r="2" fill="white" />
        {/* sparkles */}
        <text x="72" y="32" fontSize="8" fill="#FFD700">
          ✦
        </text>
        <text x="22" y="34" fontSize="6" fill="#FFD700">
          ✦
        </text>
      </>
    ),
    thinking: (
      <>
        <circle cx="38" cy="42" r="3.5" fill="#4A3728" />
        <circle cx="62" cy="43" r="3.5" fill="#4A3728" />
        <circle cx="39.5" cy="40.5" r="1.5" fill="white" />
        <circle cx="63.5" cy="41.5" r="1.5" fill="white" />
        {/* raised eyebrow */}
        <path
          d="M55 34 Q60 30 67 33"
          stroke="#4A3728"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
    waving: (
      <>
        <circle cx="38" cy="42" r="4" fill="#4A3728" />
        <circle cx="62" cy="42" r="4" fill="#4A3728" />
        <circle cx="40" cy="40.5" r="1.5" fill="white" />
        <circle cx="64" cy="40.5" r="1.5" fill="white" />
      </>
    ),
  };

  const mouthVariants: Record<TinoExpression, React.ReactNode> = {
    happy: (
      <path
        d="M43 57 Q50 64 57 57"
        stroke="#4A3728"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    ),
    excited: (
      <>
        <path
          d="M42 55 Q50 66 58 55"
          stroke="#4A3728"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="50" cy="60" rx="6" ry="4" fill="#FF6B6B" opacity="0.3" />
      </>
    ),
    thinking: (
      <ellipse cx="54" cy="57" rx="3" ry="2.5" fill="#4A3728" opacity="0.6" />
    ),
    waving: (
      <path
        d="M44 56 Q50 63 56 56"
        stroke="#4A3728"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    ),
  };

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
    >
      {/* Left ear */}
      <path d="M18 38 L30 8 L42 35" fill="#FF8C42" />
      <path d="M23 36 L31 15 L39 34" fill="#FFD4B0" />
      {/* Right ear */}
      <path d="M82 38 L70 8 L58 35" fill="#FF8C42" />
      <path d="M77 36 L69 15 L61 34" fill="#FFD4B0" />
      {/* Head */}
      <circle cx="50" cy="52" r="36" fill="#FF8C42" />
      {/* Face patch */}
      <ellipse cx="50" cy="58" rx="24" ry="20" fill="#FFF0E0" />
      {/* Eyes */}
      {eyeVariants[expression]}
      {/* Nose */}
      <ellipse cx="50" cy="50" rx="3.5" ry="2.5" fill="#4A3728" />
      {/* Mouth */}
      {mouthVariants[expression]}
      {/* Cheeks */}
      <circle cx="28" cy="52" r="5" fill="#FFB085" opacity="0.5" />
      <circle cx="72" cy="52" r="5" fill="#FFB085" opacity="0.5" />
      {/* Waving hand */}
      {expression === "waving" && (
        <g className="animate-bounce">
          <circle cx="85" cy="70" r="6" fill="#FF8C42" />
          <circle cx="85" cy="70" r="4" fill="#FFF0E0" />
        </g>
      )}
    </svg>
  );
}
