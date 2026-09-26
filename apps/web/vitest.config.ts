import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: [
      "lib/__tests__/**/*.test.ts",
      // Render tests live beside the surface they render, so they can import
      // app/ components without `lib/` reaching outward (web-lib-no-ui).
      "app/**/__tests__/**/*.test.ts",
    ],
  },
});
