import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Raise the warn limit slightly; the pixi chunk is inherently large but is
    // now lazy-loaded (only pulled when a game board mounts, not on the lobby).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split heavy third-party deps into their own long-lived cacheable chunks.
        // `pixi` in particular is only needed inside a game (BoardCanvas is
        // React.lazy'd), so it no longer weighs down the initial lobby load.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('pixi.js') || id.includes('@pixi')) return 'pixi';
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) return 'motion';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('socket.io') ||
            id.includes('engine.io') ||
            id.includes('zustand')
          ) return 'vendor';
        },
      },
    },
  },
})
