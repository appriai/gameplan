import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // Excalidraw checks this at module scope; Vite must inline it or the
    // bundle throws on `process is not defined` in the browser
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3939",
      "/ws": { target: "ws://localhost:3939", ws: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 3000,
  },
});
