import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Client component tests opt into happy-dom via a `// @vitest-environment
// happy-dom` docblock; everything else (worker/isolation tests) stays on node.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": new URL("./src/client", import.meta.url).pathname },
  },
  test: {
    globals: true,
    setupFiles: ["./test/setup-client.ts"],
  },
});
