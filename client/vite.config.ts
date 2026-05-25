import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Fresh HoopIQ court app. The 3D scene is the product, so the build is tuned
 * around getting it on screen quickly.
 *
 * Chunking: everything used to land in one 1.2 MB entry file, which the browser
 * had to download, parse and execute before anything at all appeared. three.js is
 * most of that weight and it changes only when the dependency is upgraded, so
 * splitting it out lets it stay in cache across deploys while the app code, which
 * changes constantly, is re-fetched on its own.
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, host: true },
  preview: { port: 5199, host: true },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber", "@react-three/drei"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
