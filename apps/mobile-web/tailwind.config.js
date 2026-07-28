/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#09090B",
        surface: "#111113",
        card: "#18181B",
        border: "#2A2A2E",
        primary: "#6366F1"
      }
    }
  }
};
