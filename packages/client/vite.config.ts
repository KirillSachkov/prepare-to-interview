import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app server serves the built client (`dist/`) under its token guard; see packages/server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
