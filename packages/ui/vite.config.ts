import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * The page's <head> from the application's spec: its title and description (`rules.site.copy`, else the
 * business's name and doc), a favicon when its public/ has one, and the analytics tag when
 * `rules.site.analytics` names one. Without an application, as it was.
 */
function head() {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return {
    name: "fishtea-head",
    transformIndexHtml(html: string) {
      if (!APP || !existsSync(join(APP, "spec.json"))) return html;
      const spec = JSON.parse(readFileSync(join(APP, "spec.json"), "utf8"));
      const copy = spec.rules?.site?.copy ?? {};
      const title = copy.title ?? spec.business?.name;
      const description = copy.description ?? spec.business?.doc;
      // rules.site.analytics: the GA4 tag, on the site's pages only (/admin is the operators', not the
      // audience's). Nothing of Google's loads until the visitor accepts in the consent banner (src/consent.tsx),
      // unless the site set consent: false. The id is checked by the spec (G- and letters/digits); the notice
      // is written as JSON with < escaped, so neither can leave the script.
      const an = spec.rules?.site?.analytics;
      const ga = typeof an?.google === "string" && /^G-[A-Z0-9]{4,}$/.test(an.google) ? an.google : null;
      const cfg = ga ? JSON.stringify({ google: ga, consent: an.consent !== false, notice: typeof an.notice === "string" ? an.notice : undefined }).replace(/</g, "\\u003c") : "";
      const gtag = ga ? `<script>
      window.__fishteaAnalytics = ${cfg};
      window.fishteaLoadAnalytics = function () {
        if (window.__fishteaGa) return; window.__fishteaGa = true;
        var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=${ga}"; document.head.appendChild(s);
        window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); };
        gtag("js", new Date()); gtag("config", "${ga}");
      };
      try { if (!/^\\/admin(\\/|$)/.test(location.pathname) && (!window.__fishteaAnalytics.consent || localStorage.getItem("fishtea:consent") === "granted")) window.fishteaLoadAnalytics(); } catch (e) {}
    </script>` : "";
      const tags = [
        description ? `<meta name="description" content="${esc(description)}" />` : "",
        existsSync(join(APP, "public/favicon.svg")) ? `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` : "",
        gtag,
      ].filter(Boolean).join("\n    ");
      return html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title ?? "FishTea")}</title>${tags ? `\n    ${tags}` : ""}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), head()],
  // an application's static files (images, a favicon) are served from its public/, when it has one
  ...(APP && existsSync(join(APP, "public")) ? { publicDir: join(APP, "public") } : {}),
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
  server: {
    port: 5173, host: true,
    fs: { allow: [resolve(HERE, "../.."), ...(APP ? [APP] : [])] },
    // With FISHTEA_CORE_URL (the compose file sets http://core:3000, and VITE_CORE_URL=/core) the browser
    // talks to the core through this server: one origin, so the visitor's cookie is first-party wherever
    // the page was opened, and there is no CORS to get wrong.
    ...(process.env.FISHTEA_CORE_URL ? { proxy: { "/core": { target: process.env.FISHTEA_CORE_URL, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/core/, "") } } } : {}),
  },
  build: { outDir: "dist" },
});
