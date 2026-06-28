import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const WEB_HOST = "0.0.0.0";
const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        demo: "demo.html",
      },
    },
  },
  server: {
    host: WEB_HOST,
    open: "/?mode=preview",
    port: DEV_PORT,
  },
  preview: {
    host: WEB_HOST,
    port: PREVIEW_PORT,
  },
});
