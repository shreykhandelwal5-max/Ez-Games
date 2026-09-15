import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    target: 'es2020',
    minify: 'terser',
    terserOptions: { compress: { drop_console: true, drop_debugger: true } },
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Firebase never blocks the first paint (every import is dynamic), and
        // splitting it per product means a signed-out visitor downloads auth
        // without dragging Firestore and Analytics along with it.
        manualChunks(id) {
          // Normalise Windows separators before matching package paths.
          const path = id.replace(/\\/g, '/');
          if (!path.includes('node_modules')) return;
          if (path.includes('firebase/firestore')) return 'fb-firestore';
          if (path.includes('firebase/auth')) return 'fb-auth';
          if (path.includes('firebase/analytics')) return 'fb-analytics';
          if (path.includes('firebase/')) return 'fb-core';
        },
      },
    },
  },
});
