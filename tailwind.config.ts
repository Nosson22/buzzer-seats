import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "marlins-blue": "#00a3e0",
        "marlins-red": "#ef3340",
        "marlins-orange": "#f77f00",
      },
    },
  },
  plugins: [],
};

export default config;
