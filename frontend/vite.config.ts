import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En dev, le backend tourne sur :8080 ; en prod il sert lui-même le build.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
