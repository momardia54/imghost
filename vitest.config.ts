import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "test-password" },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
