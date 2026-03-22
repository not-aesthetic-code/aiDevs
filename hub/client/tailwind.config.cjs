/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        base: '#1e1e2e',
        mantle: '#181825',
        crust: '#11111b',
        surface0: '#313244',
        surface1: '#45475a',
        overlay0: '#6c7086',
        text: '#cdd6f4',
        subtext0: '#a6adc8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        mauve: '#cba6f7',
        red: '#f38ba8',
        teal: '#94e2d5',
        peach: '#fab387',
      },
    },
  },
  plugins: [],
};
