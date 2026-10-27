import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrandConfig } from "@rakazo/ui-tokens";
import { brandBootstrapScript } from "@rakazo/ui-tokens";
import type { Connect, Plugin } from "vite";
import { webManifest } from "./pwa/plugin.js";

const THEME_SCRIPT = "/theme.js";
const MANIFEST = "/site.webmanifest";

/** `theme.js` with the brand's bootstrap ahead of it, so the brand is set before first paint. */
export function brandedThemeScript(brand: BrandConfig, themeScript: string): string {
  return `${brandBootstrapScript(brand)}${themeScript}`;
}

export function brandMiddleware(brand: BrandConfig, publicDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = req.url?.split("?", 1)[0];
    if (pathname !== THEME_SCRIPT && pathname !== MANIFEST) {
      next();
      return;
    }
    res.setHeader("cache-control", "no-cache");
    if (pathname === MANIFEST) {
      res.setHeader("content-type", "application/manifest+json; charset=utf-8");
      res.end(JSON.stringify(webManifest(brand), null, 2));
      return;
    }
    res.setHeader("content-type", "text/javascript; charset=utf-8");
    res.end(brandedThemeScript(brand, readFileSync(path.join(publicDir, "theme.js"), "utf8")));
  };
}

/**
 * `RAKAZO_BRAND` is read when the server starts, not when the app is built: the same image serves
 * the upstream look or a brand, so the two files the browser loads before React are answered here.
 * Without a brand this plugin does nothing and the static files are served as built.
 */
export function rakazoBrand(brand: BrandConfig | null): Plugin {
  let publicDir = "";
  return {
    name: "rakazo-brand",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      if (brand) server.middlewares.use(brandMiddleware(brand, publicDir));
    },
    configurePreviewServer(server) {
      if (brand) server.middlewares.use(brandMiddleware(brand, publicDir));
    },
  };
}
