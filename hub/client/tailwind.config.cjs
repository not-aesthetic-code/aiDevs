/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{tsx,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Warm linen palette
        linen: '#F6F5F2',
        'linen-dark': '#F0EEE9',
        'linen-log': '#FAFAF8',
        border: '#E5E1D8',
        'border-strong': '#CCC8BF',
        ink: '#1C1A17',
        'ink-2': '#6B665E',
        'ink-3': '#A39D94',
        'ink-muted': '#CCC8BF',
        accent: '#1D4ED8',
        'accent-soft': '#EBF2FF',
        violet: '#6D28D9',
        'violet-soft': '#F5F3FF',
        green: '#15803D',
        'green-soft': '#DCFCE7',
        red: '#DC2626',
        'red-soft': '#FEE2E2',
        amber: '#B45309',
        'amber-soft': '#FEF3C7',
        sky: '#0369A1',
        'sky-soft': '#E0F2FE',
      },
    },
  },
  plugins: [],
};
