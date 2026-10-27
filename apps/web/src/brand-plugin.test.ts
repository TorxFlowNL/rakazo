import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { torxflowBrand } from "@rakazo/ui-tokens";
import type { Connect, ResolvedConfig } from "vite";
import { describe, expect, it, vi } from "vitest";
import { brandedThemeScript, brandMiddleware, rakazoBrand } from "./brand-plugin";
import { webManifest } from "./pwa/plugin";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const themeScript = readFileSync(`${publicDir}/theme.js`, "utf8");

function request(url: string) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: (chunk?: string) => {
      body = chunk;
    },
  };
  const next = vi.fn();
  brandMiddleware(torxflowBrand, publicDir)({ url } as Connect.IncomingMessage, res as never, next);
  return { headers, body, next };
}

describe("branded theme.js", () => {
  it("sets the brand ahead of the unchanged theme bootstrap", () => {
    const { body, headers, next } = request("/theme.js?v=1");
    expect(next).not.toHaveBeenCalled();
    expect(headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(headers["cache-control"]).toBe("no-cache");
    expect(body).toBe(brandedThemeScript(torxflowBrand, themeScript));
    expect(body?.indexOf('root.dataset.brand = "torxflow"')).toBeLessThan(
      body?.indexOf("localStorage") ?? 0,
    );
  });

  it("lets the fixed appearance beat the stored preference and the OS scheme", () => {
    const script = brandedThemeScript(torxflowBrand, themeScript);
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const document = {
      documentElement: root,
      title: "",
      querySelector: () => ({ setAttribute: () => undefined }),
    };
    new Function("document", "navigator", "localStorage", "matchMedia", script)(
      document,
      { platform: "Win32", maxTouchPoints: 0 },
      { getItem: () => "dark" },
      () => ({ matches: false }),
    );
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("serves the manifest under the brand's name and icons", () => {
    const { body, headers } = request("/site.webmanifest");
    expect(headers["content-type"]).toBe("application/manifest+json; charset=utf-8");
    const manifest = JSON.parse(body ?? "{}");
    expect(manifest).toMatchObject({ name: "Assistenten", theme_color: "#ffffff", start_url: "/" });
    expect(JSON.stringify(manifest)).not.toMatch(/rakazo/i);
  });

  it("passes every other request on", () => {
    for (const url of ["/", "/assets/index.js", "/theme.js.map", "/api/auth/get-session"]) {
      expect(request(url).next).toHaveBeenCalledTimes(1);
    }
  });
});

describe("rakazoBrand plugin", () => {
  const server = () => {
    const use = vi.fn();
    return { use, server: { middlewares: { use } } as never };
  };
  const configure = (brand: typeof torxflowBrand | null) => {
    const plugin = rakazoBrand(brand);
    (plugin.configResolved as (config: ResolvedConfig) => void)({ publicDir } as ResolvedConfig);
    const dev = server();
    const preview = server();
    (plugin.configureServer as (server: never) => void)(dev.server);
    (plugin.configurePreviewServer as (server: never) => void)(preview.server);
    return { dev: dev.use, preview: preview.use };
  };

  it("answers on the dev and preview servers when a brand is set", () => {
    const { dev, preview } = configure(torxflowBrand);
    expect(dev).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a brand, so the static files are served as built", () => {
    const { dev, preview } = configure(null);
    expect(dev).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
});

describe("web manifest", () => {
  it("is upstream's without a brand", () => {
    expect(webManifest()).toMatchObject({ name: "Rakazo", short_name: "Rakazo" });
    expect(webManifest(null)).toEqual(webManifest());
  });

  it("is the brand's with one", () => {
    expect(webManifest(torxflowBrand)).toMatchObject({
      name: "Assistenten",
      background_color: "#ffffff",
    });
  });
});
