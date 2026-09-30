import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which application this bundle wears. `FISHTEA_APP_DIR` (the ui container sets /app) points `#generated`
 * at that application's `.fishtea/ui/` — its design systems, views and shell, written by `fishtea
 * ui-assets` — and lets Vite read files there. Without one, or before ui-assets has run, the base in
 * src/generated stands: the framework's own container, its own tokens.
 *
 *   #generated         the application's generated registry and stylesheet, or the base
 *   @app               the application directory (a shell reads spec.json through it)
 *   @fishtea/ui        this package's src, for shells and views to build on
 *   @fishtea/plugins   the framework's builtin plugins, wherever this framework lives
 *   @fishtea/present   the layout language (@fishtea/spec's present.ts), which pour.present is written in
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = process.env.FISHTEA_APP_DIR ? resolve(process.env.FISHTEA_APP_DIR) : null;
const own = APP ? join(APP, ".fishtea", "ui") : null;
const generated = own && existsSync(join(own, "plugins.generated.ts")) ? own : join(HERE, "src/generated");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "#generated": generated,
      "@app": APP ?? join(HERE, "src/generated"),
      "@fishtea/ui": join(HERE, "src"),
      "@fishtea/plugins": resolve(HERE, "../../plugins"),
      // the layout language, alone: present.ts imports nothing, so it is safe in a browser bundle
      "@fishtea/present": resolve(HERE, "../spec/src/present.ts"),
    },
    // A view or a shell lives outside this package, so its bare imports would otherwise look for a
    // node_modules beside it that is not there. They share this package's copies instead.
    dedupe: ["react", "react-dom", "lucide-react"],
  },
  server: { port: 5173, host: true, fs: { allow: [resolve(HERE, "../.."), ...(APP ? [APP] : [])] } },
  build: { outDir: "dist" },
});
