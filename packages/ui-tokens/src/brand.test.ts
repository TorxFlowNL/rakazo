import { describe, expect, it } from "vitest";
import {
  BRAND_ENV_KEY,
  brandBootstrapScript,
  brandManifestOverrides,
  parseBrand,
  renderTokensCss,
  torxflowBrand,
  torxflowTokens,
  webLightTokens,
} from "./index.js";

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe("parseBrand", () => {
  it("is the upstream look without a value", () => {
    expect(parseBrand(undefined)).toBeNull();
    expect(parseBrand(null)).toBeNull();
    expect(parseBrand("")).toBeNull();
    expect(parseBrand("   ")).toBeNull();
  });

  it("names the TorxFlow brand, whatever the case or padding", () => {
    for (const raw of ["torxflow", "TorxFlow", "  torxflow\n"]) {
      expect(parseBrand(raw)).toMatchObject({ id: "torxflow", productName: "Assistenten" });
    }
  });

  it("refuses an unknown brand so a typo stops the server", () => {
    expect(() => parseBrand("rakazoo")).toThrow(`${BRAND_ENV_KEY} must be one of torxflow`);
  });
});

describe("TorxFlow palette", () => {
  it("is the dashboard's: orange accent, white surfaces, slate-50 canvas, neutral ink", () => {
    expect(torxflowTokens).toMatchObject({
      primary: "#EA580C",
      primaryHover: "#C2410C",
      background: "#F8FAFC",
      card: "#FFFFFF",
      sidebar: "#FFFFFF",
      sidebarAccent: "#FFF7ED",
      sidebarAccentForeground: "#C2410C",
      foreground: "#09090B",
      mutedForeground: "#737373",
      border: "#E5E5E5",
    });
  });

  it("keeps text readable on its surfaces", () => {
    const pairs: [string, string, number][] = [
      [torxflowTokens.foreground, torxflowTokens.background, 4.5],
      [torxflowTokens.cardForeground, torxflowTokens.card, 4.5],
      [torxflowTokens.mutedForeground, torxflowTokens.card, 4.5],
      [torxflowTokens.link, torxflowTokens.card, 4.5],
      [torxflowTokens.sidebarAccentForeground, torxflowTokens.sidebarAccent, 4.5],
      [torxflowTokens.destructive, torxflowTokens.card, 4.5],
      [torxflowTokens.success, torxflowTokens.card, 4.5],
      [torxflowTokens.warning, torxflowTokens.card, 4.5],
      // The orange fill carries bold control labels, as in the dashboard's own buttons.
      [torxflowTokens.primaryForeground, torxflowTokens.primary, 3],
      [torxflowTokens.chatUserForeground, torxflowTokens.chatUser, 3],
    ];
    for (const [text, surface, minimum] of pairs) {
      expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("is a light palette", () => {
    expect(torxflowBrand.appearance).toBe("light");
    expect(luminance(torxflowTokens.background)).toBeGreaterThan(0.9);
  });
});

describe("tokens.css brand block", () => {
  const css = renderTokensCss();
  const block = css.slice(css.indexOf(':root[data-brand="torxflow"] {'));

  it("outranks the theme blocks and carries the palette, font and radius", () => {
    expect(block).toContain("color-scheme: light;");
    expect(block).toContain("--primary: #ea580c;");
    expect(block).toContain("--sidebar-accent: #fff7ed;");
    expect(block).toContain("--font-sans: Inter,");
    expect(block).toContain("--radius: 0.75rem;");
  });

  it("keeps regular text at 400 on macOS too", () => {
    expect(block).toMatch(
      /:root\[data-brand="torxflow"\]\[data-os="mac"\] \{\s*--font-weight-normal: 400;\s*\}/,
    );
  });

  it("leaves the upstream blocks untouched", () => {
    expect(css).toContain(`--background: ${webLightTokens.background.toLowerCase()};`);
    expect(css.indexOf(':root[data-brand="torxflow"]')).toBeGreaterThan(
      css.indexOf('[data-theme="light"] {'),
    );
  });
});

describe("brandBootstrapScript", () => {
  type Fake = {
    dataset: Record<string, string>;
    title: string;
    attrs: Record<string, string>;
  };

  function run(): Fake {
    const fake: Fake = { dataset: {}, title: "Rakazo", attrs: {} };
    const element = (key: string) => ({
      setAttribute: (name: string, value: string) => {
        fake.attrs[`${key}:${name}`] = value;
      },
    });
    const document = {
      documentElement: { dataset: fake.dataset },
      get title() {
        return fake.title;
      },
      set title(value: string) {
        fake.title = value;
      },
      querySelector: (selector: string) => element(selector),
    };
    new Function("document", brandBootstrapScript(torxflowBrand))(document);
    return fake;
  }

  it("marks the document before first paint with brand and fixed appearance", () => {
    const fake = run();
    expect(fake.dataset).toEqual({ brand: "torxflow", appearance: "light" });
    expect(fake.title).toBe("Assistenten");
  });

  it("names the page and its chrome after the brand, not Rakazo", () => {
    const { attrs } = run();
    expect(attrs['meta[name="theme-color"]:content']).toBe("#ffffff");
    expect(attrs['meta[name="apple-mobile-web-app-title"]:content']).toBe("Assistenten");
    expect(attrs['link[rel="icon"][type="image/png"]:href']).toBe("/brand/torxflow/favicon.png");
    expect(JSON.stringify(attrs)).not.toMatch(/rakazo/i);
  });
});

describe("brandManifestOverrides", () => {
  it("renames the install and swaps in the brand icons", () => {
    const manifest = brandManifestOverrides(torxflowBrand);
    expect(manifest).toMatchObject({
      name: "Assistenten",
      short_name: "Assistenten",
      theme_color: "#ffffff",
    });
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/brand/torxflow/icon-192.png",
      "/brand/torxflow/icon-512.png",
      "/brand/torxflow/icon-192.png",
      "/brand/torxflow/icon-512.png",
    ]);
  });
});
