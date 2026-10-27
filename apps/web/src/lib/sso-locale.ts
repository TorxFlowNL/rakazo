import type { BrandConfig } from "@rakazo/ui-tokens";
import { activeBrand } from "./brand";
import type { UiLocale } from "./ui-locale";
import { persistUiLocale, UI_LOCALES } from "./ui-locale";

export const SSO_LOCALE_PARAM = "lang";

type Env = {
  brand?: BrandConfig | null;
  location?: Pick<Location, "pathname" | "search" | "hash">;
  history?: Pick<History, "replaceState" | "state">;
  storage?: Pick<Storage, "setItem"> | null;
};

/**
 * A garage's dashboard signs people in with `?lang=<locale>` on the landing URL (see the
 * TorxFlow SSO endpoint), so the workspace speaks the dashboard's language. The language is stored
 * the way a choice in the language settings is, and the parameter is removed from the address.
 * Only a branded deployment listens, so an upstream link with `?lang=` changes nothing.
 */
export function adoptSsoLocale(env: Env = {}): UiLocale | null {
  const brand = env.brand !== undefined ? env.brand : activeBrand();
  const location = env.location ?? (typeof window !== "undefined" ? window.location : undefined);
  if (!brand || !location) return null;
  const params = new URLSearchParams(location.search);
  const requested = params.get(SSO_LOCALE_PARAM);
  if (requested === null) return null;
  params.delete(SSO_LOCALE_PARAM);
  const rest = params.toString();
  const history = env.history ?? (typeof window !== "undefined" ? window.history : undefined);
  history?.replaceState(
    history.state,
    "",
    `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`,
  );
  const locale = UI_LOCALES.find((candidate) => candidate === requested);
  if (!locale) return null;
  if (env.storage === undefined) persistUiLocale(locale);
  else persistUiLocale(locale, env.storage);
  return locale;
}
