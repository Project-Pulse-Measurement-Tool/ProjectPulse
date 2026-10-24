import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built files are served by Django under /static/; the dev server proxies /api to Django.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/static/" : "/",
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
}));
