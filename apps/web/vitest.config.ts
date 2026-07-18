import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "quality-contract-assets",
      enforce: "pre",
      resolveId(source) {
        return source === "virtual:application-styles" ? "\0virtual:application-styles" : null;
      },
      load(id) {
        if (id !== "\0virtual:application-styles") return null;
        const css = readFileSync(new URL("./src/app/styles.css", import.meta.url), "utf8");
        return `export default ${JSON.stringify(css)};`;
      }
    }
  ],
  server: {
    fs: {
      allow: ["../.."]
    }
  }
});
