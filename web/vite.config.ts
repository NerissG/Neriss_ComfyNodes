import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte(), cssInjectedByJsPlugin()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    license: { fileName: "THIRD_PARTY_NOTICES.md" },
    rollupOptions: {
      input: "src/extension.ts",
      output: {
        entryFileNames: "image-editor.js",
        assetFileNames: "image-editor.[ext]",
      },
    },
  },
});
