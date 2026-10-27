import { describe, expect, it } from "vitest";
import { activeBrand } from "./brand";
import { brandedAppearance } from "./ui-appearance";
import { resolveUiLocale } from "./ui-locale";

const root = (brand?: string) => ({ dataset: brand === undefined ? {} : { brand } }) as never;

describe("activeBrand", () => {
  it("is the upstream look unless the server marked the document", () => {
    expect(activeBrand(root())).toBeNull();
    expect(activeBrand(root(""))).toBeNull();
    expect(activeBrand(root("unknown"))).toBeNull();
    expect(activeBrand(null)).toBeNull();
  });

  it("finds the TorxFlow brand", () => {
    expect(activeBrand(root("torxflow"))).toMatchObject({
      id: "torxflow",
      productName: "Assistenten",
      appearance: "light",
    });
  });
});

describe("a branded document", () => {
  it("has no appearance lock when upstream", () => {
    expect(brandedAppearance()).toBeNull();
  });

  it("speaks the brand's language until a choice is stored", () => {
    const base = { navigatorLanguage: "de-DE", envDefault: null, storage: null };
    expect(resolveUiLocale({ ...base, brandLocale: "nl" })).toBe("nl");
    expect(resolveUiLocale({ ...base, brandLocale: null })).toBe("de");
    expect(resolveUiLocale({ ...base, stored: "en", brandLocale: "nl" })).toBe("en");
  });
});
