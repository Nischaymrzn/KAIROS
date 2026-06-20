import react from "@vitejs/plugin-react";
export default {
  plugins: [react()],
  build: {
    ssr: "scripts/ssrcheck.jsx",
    outDir: ".ssrcheck",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "check.mjs" } },
  },
};
