import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',   
  css: {
    // Force-disable external PostCSS config discovery
    postcss: { plugins: [] }
  }
});
