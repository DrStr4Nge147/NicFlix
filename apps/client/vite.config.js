import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    proxy: {
      "/api": "http://localhost:4000",
      "/assets": "http://localhost:4000"
    }
  }
});
