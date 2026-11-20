import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client communicates with the backend exclusively over the JSON API.
// In development, /api is proxied to the Express server so the SPA and API
// share an origin (avoids CORS and matches the production single-origin setup).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
