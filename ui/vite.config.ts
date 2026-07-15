import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built app works embedded in an iframe under any path.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", sourcemap: false },
});
