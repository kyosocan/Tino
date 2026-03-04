import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tino: {
          orange: "#FF8C42",
          "orange-light": "#FFB085",
          "orange-pale": "#FFF0E0",
          blue: "#7EC8E3",
          "blue-light": "#E8F4FD",
          cream: "#FFF8F0",
          brown: "#4A3728",
          "brown-light": "#8B7355",
          green: "#A8D5BA",
          "green-light": "#E8F8E8",
        },
      },
      fontFamily: {
        sans: ['"Nunito"', "system-ui", "sans-serif"],
      },
      animation: {
        shake: "shake 0.5s ease-in-out",
        "bounce-in": "bounceIn 0.5s ease-out",
        float: "float 3s ease-in-out infinite",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "fade-in": "fadeIn 0.3s ease-out",
      },
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-5px)" },
          "75%": { transform: "translateX(5px)" },
        },
        bounceIn: {
          "0%": { transform: "scale(0)", opacity: "0" },
          "50%": { transform: "scale(1.1)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
