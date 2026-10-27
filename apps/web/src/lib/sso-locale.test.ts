import { torxflowBrand } from "@rakazo/ui-tokens";
import { describe, expect, it, vi } from "vitest";
import { adoptSsoLocale } from "./sso-locale";
import { UI_LOCALE_STORAGE_KEY } from "./ui-locale";

function env(search: string, brand: typeof torxflowBrand | null = torxflowBrand) {
  const setItem = vi.fn();
  const replaceState = vi.fn();
  return {
    setItem,
    replaceState,
    options: {
      brand,
      location: { pathname: "/app/x", search, hash: "#top" },
      history: { replaceState, state: { key: 1 } },
      storage: { setItem },
    },
  };
}

describe("adoptSsoLocale", () => {
  it.each(["nl", "en", "zh-CN"])(
    "stores %s like a user choice and clears the parameter",
    (lang) => {
      const { options, setItem, replaceState } = env(`?lang=${lang}&m=1`);
      expect(adoptSsoLocale(options)).toBe(lang);
      expect(setItem).toHaveBeenCalledWith(UI_LOCALE_STORAGE_KEY, lang);
      expect(replaceState).toHaveBeenCalledWith({ key: 1 }, "", "/app/x?m=1#top");
    },
  );

  it("drops the whole query when the language was the only parameter", () => {
    const { options, replaceState } = env("?lang=nl");
    adoptSsoLocale(options);
    expect(replaceState).toHaveBeenCalledWith({ key: 1 }, "", "/app/x#top");
  });

  it("ignores a language the workspace has no catalog for, but still cleans the address", () => {
    const { options, setItem, replaceState } = env("?lang=xx");
    expect(adoptSsoLocale(options)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();
  });

  it("does nothing without the parameter", () => {
    const { options, setItem, replaceState } = env("?m=1");
    expect(adoptSsoLocale(options)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("leaves the upstream deployment alone", () => {
    const { options, setItem, replaceState } = env("?lang=nl", null);
    expect(adoptSsoLocale(options)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
