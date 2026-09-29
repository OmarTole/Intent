import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'Intent — ежедневник', short_name: 'Intent', lang: 'ru',
      description: 'Ежедневник, привычки, задачи и важные даты.',
      theme_color: '#f5c842', background_color: '#faf9f6', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      importScripts: ['/push-handler.js'],
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      cleanupOutdatedCaches: true,
      // Personal API responses are never cached by the service worker.
      runtimeCaching: [],
    },
  })],
  server: { port: 15174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:18080' } },
  preview: { port: 15173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:18080' } },
})
