/** Palette façon TradingView (thème sombre). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tv: {
          bg: '#131722',
          panel: '#1e222d',
          border: '#2a2e39',
          text: '#d1d4dc',
          muted: '#787b86',
          up: '#26a69a',
          down: '#ef5350',
          blue: '#2962ff',
          orange: '#ff9800',
        },
      },
    },
  },
  plugins: [],
};
