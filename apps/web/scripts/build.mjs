import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  configFile: false,
  root,
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(root, "index.html")
    }
  }
});

