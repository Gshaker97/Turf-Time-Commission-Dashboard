import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Stable vendor chunks for better long-term caching; charts (recharts)
        // split out so they only download with the page that needs them.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          dates: ['date-fns'],
          icons: ['lucide-react'],
        },
      },
    },
  },
})
