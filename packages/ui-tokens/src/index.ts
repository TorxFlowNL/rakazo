export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "rakazo.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  /** Modals: a step lighter than the page so they read as raised above it. */
  dialog: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  /** Fill and hairline where native Liquid Glass is unavailable (Android, iOS before 26). */
  glassFill: string;
  glassStroke: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  chatUser: string;
  /** White in both themes: the user bubble is a solid fill (light grey in dark, near-black in light). */
  chatUserForeground: string;
  muted: string;
  mutedForeground: string;
  /** Tertiary text: placeholders, list markers, quote bars, timestamps. */
  faintForeground: string;
  accent: string;
  accentForeground: string;
  /** Destructive text and outlines. */
  destructive: string;
  /** Solid destructive fill (Hang up, a filled Delete); its text is `destructiveForeground`. */
  destructiveFill: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /** Backing behind a link's site icon. White in both themes so dark logos stay visible on any bubble. */
  faviconPlate: string;
  success: string;
  warning: string;
  statusWorking: string;
  /** Unread dot. The one blue in the inbox, in both themes. */
  unread: string;
  /** Working dot on a busy bot's avatar. The one green, in both themes. */
  workingDot: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  background: "#141414",
  dialog: "#1E1E1E",
  foreground: "#FFFFFF",
  card: "#202020",
  cardForeground: "#FFFFFF",
  popover: "#202020",
  popoverForeground: "#FFFFFF",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#FFFFFF",
  primaryForeground: "#000000",
  secondary: "#7676803D",
  secondaryForeground: "#FFFFFF",
  chatUser: "#5C5C5C",
  chatUserForeground: "#FFFFFF",
  muted: "#202020",
  mutedForeground: "#EBEBF599",
  faintForeground: "#EBEBF573",
  accent: "#78788052",
  accentForeground: "#FFFFFF",
  destructive: "#FF9592",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#FCFCFC14",
  input: "#54545899",
  ring: "#3B82F6",
  sidebar: "#1E1E1E",
  sidebarForeground: "#FFFFFF",
  sidebarBorder: "#FCFCFC14",
  sidebarAccent: "#2B2B2E",
  sidebarAccentForeground: "#FFFFFF",
  link: "#459FFE",
  faviconPlate: "#FFFFFF",
  success: "#3FA266",
  warning: "#DB941E",
  statusWorking: "#459FFE",
  unread: "#006CEB",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.28)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FCFCFC",
  dialog: "#FFFFFF",
  foreground: "#000000",
  card: "#EFEFEF",
  cardForeground: "#000000",
  popover: "#FFFFFF",
  popoverForeground: "#000000",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#000000",
  primaryForeground: "#FFFFFF",
  secondary: "#7676801F",
  secondaryForeground: "#000000",
  chatUser: "#0B0B0B",
  chatUserForeground: "#FFFFFF",
  muted: "#F2F2F1",
  mutedForeground: "#3C3C43B3",
  faintForeground: "#3C3C4394",
  accent: "#78788029",
  accentForeground: "#000000",
  destructive: "#CE2C31",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#14141414",
  input: "#3C3C434A",
  ring: "#6C6C70",
  sidebar: "#F7F7F7",
  sidebarForeground: "#000000",
  sidebarBorder: "#14141414",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#000000",
  link: "#0C64C1",
  faviconPlate: "#FFFFFF",
  success: "#007041",
  warning: "#885A07",
  statusWorking: "#0C64C1",
  unread: "#006CEB",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.19)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4",
} as const satisfies ColorTokens;

/** Web and Electron only: the primary fill's hover and disabled states. Mobile has no hover. */
export type WebColorTokens = ColorTokens & {
  primaryHover: string;
  primaryDisabled: string;
};

/**
 * Web and Electron values for the tokens they draw differently from the palettes above, which
 * follow the iOS system design for mobile. Mobile reads `darkTokens` / `lightTokens`; web reads
 * `tokens.css`, rendered from these merged palettes. Surfaces are opaque; text, borders, hover
 * and selection are the ink at an opacity, so they read the same on every surface.
 */
export const webDarkOverrides = {
  background: "#161616",
  dialog: "#1F1F1F",
  foreground: "#F5F5F5",
  card: "#1F1F1F",
  cardForeground: "#F5F5F5",
  popover: "#1F1F1F",
  popoverForeground: "#F5F5F5",
  primary: "#F5F5F5",
  primaryHover: "#DBDBDB",
  primaryDisabled: "#F5F5F521",
  primaryForeground: "#121212",
  secondary: "#F5F5F50A",
  secondaryForeground: "#F5F5F5",
  chatUser: "#3E3E3E",
  chatUserForeground: "#F5F5F5",
  muted: "#1F1F1F",
  mutedForeground: "#F5F5F5A8",
  faintForeground: "#F5F5F58A",
  accent: "#F5F5F50F",
  accentForeground: "#F5F5F5",
  destructive: "#FF6463",
  destructiveFill: "#CF2B35",
  border: "#F5F5F51A",
  input: "#F5F5F538",
  ring: "#1884FC",
  sidebar: "#0E0E0E",
  sidebarForeground: "#F5F5F5",
  sidebarBorder: "#F5F5F51A",
  sidebarAccent: "#F5F5F514",
  sidebarAccentForeground: "#F5F5F5",
  link: "#4D9BFF",
  success: "#00BA69",
  warning: "#E28600",
  statusWorking: "#4D9BFF",
  unread: "#4D9BFF",
  workingDot: "#0E9F5A",
  overlay: "#000000B2",
  scrollbar: "#F5F5F538",
  scrollbarHover: "#F5F5F580",
} as const satisfies Partial<WebColorTokens>;

export const webLightOverrides = {
  background: "#FFFFFF",
  foreground: "#1C1C1C",
  card: "#F2F2F2",
  cardForeground: "#1C1C1C",
  popoverForeground: "#1C1C1C",
  primary: "#1C1C1C",
  primaryHover: "#363636",
  primaryDisabled: "#1C1C1C26",
  primaryForeground: "#FCFCFC",
  secondary: "#1C1C1C0F",
  secondaryForeground: "#1C1C1C",
  chatUser: "#1C1C1C",
  muted: "#F2F2F2",
  mutedForeground: "#1C1C1CAD",
  faintForeground: "#1C1C1C8F",
  accent: "#1C1C1C0F",
  accentForeground: "#1C1C1C",
  destructive: "#CD2834",
  destructiveFill: "#E72E3B",
  border: "#1C1C1C1F",
  input: "#1C1C1C3D",
  ring: "#1E86FC",
  sidebar: "#F5F5F5",
  sidebarForeground: "#1C1C1C",
  sidebarBorder: "#1C1C1C1F",
  sidebarAccent: "#1C1C1C14",
  sidebarAccentForeground: "#1C1C1C",
  link: "#0B6DD3",
  success: "#00854A",
  warning: "#AA6300",
  statusWorking: "#0B6DD3",
  unread: "#0B6DD3",
  workingDot: "#10AB61",
  overlay: "#00000080",
  scrollbar: "#1C1C1C3D",
  scrollbarHover: "#1C1C1C85",
} as const satisfies Partial<WebColorTokens>;

export const webDarkTokens: WebColorTokens = { ...darkTokens, ...webDarkOverrides };
export const webLightTokens: WebColorTokens = { ...lightTokens, ...webLightOverrides };

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

/** Server environment variable that picks a white-label look at runtime (one image, env decides). */
export const BRAND_ENV_KEY = "RAKAZO_BRAND";

export const BRAND_IDS = ["torxflow"] as const;

export type BrandId = (typeof BRAND_IDS)[number];

export interface BrandConfig {
  id: BrandId;
  /** The name in the tab title, install prompt and anywhere the product names itself. */
  productName: string;
  description: string;
  /** The one appearance of this brand; the appearance switch is not offered. */
  appearance: ResolvedAppearance;
  /** UI language until the user, or the site that signed them in, picks another. */
  locale: string;
  /** Browser chrome colour around the page (`<meta name="theme-color">`, PWA manifest). */
  themeColor: string;
  /** Web font stack, for `--font-sans`. */
  fontSans: string;
  /** Icons for the tab and install prompt, relative to the site root. */
  icons: { favicon: string; appleTouch: string; icon192: string; icon512: string };
}

/**
 * The garage dashboard's palette: white surfaces on a slate-50 canvas, orange as the only accent,
 * neutral ink. Values come from TorxFlow's globals.css and its dashboard nav (active row
 * `#fff7ed` / `#c2410c`).
 */
export const torxflowTokens = {
  background: "#F8FAFC",
  dialog: "#FFFFFF",
  foreground: "#09090B",
  card: "#FFFFFF",
  cardForeground: "#09090B",
  popover: "#FFFFFF",
  popoverForeground: "#09090B",
  glassFill: "#FFFFFF",
  glassStroke: "#E5E5E5",
  primary: "#EA580C",
  primaryForeground: "#FFFFFF",
  primaryHover: "#C2410C",
  primaryDisabled: "#EA580C59",
  secondary: "#F5F5F5",
  secondaryForeground: "#404040",
  chatUser: "#EA580C",
  chatUserForeground: "#FFFFFF",
  muted: "#F5F5F5",
  mutedForeground: "#737373",
  faintForeground: "#A3A3A3",
  accent: "#F5F5F5",
  accentForeground: "#09090B",
  destructive: "#DC2626",
  destructiveFill: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#E5E5E5",
  input: "#E5E5E5",
  ring: "#EA580C",
  sidebar: "#FFFFFF",
  sidebarForeground: "#09090B",
  sidebarBorder: "#E5E5E5",
  sidebarAccent: "#FFF7ED",
  sidebarAccentForeground: "#C2410C",
  link: "#C2410C",
  faviconPlate: "#FFFFFF",
  success: "#15803D",
  warning: "#B45309",
  statusWorking: "#EA580C",
  unread: "#EA580C",
  workingDot: "#22C55E",
  overlay: "#09090B66",
  scrollbar: "#0000001F",
  scrollbarHover: "#00000040",
} as const satisfies WebColorTokens;

export const torxflowBrand = {
  id: "torxflow",
  productName: "Assistenten",
  description: "Jouw AI-collega's voor de garage.",
  appearance: "light",
  locale: "nl",
  themeColor: "#FFFFFF",
  fontSans: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  icons: {
    favicon: "/brand/torxflow/favicon.png",
    appleTouch: "/brand/torxflow/apple-touch-icon.png",
    icon192: "/brand/torxflow/icon-192.png",
    icon512: "/brand/torxflow/icon-512.png",
  },
} as const satisfies BrandConfig;

export const brands: Record<BrandId, BrandConfig & { tokens: WebColorTokens }> = {
  torxflow: { ...torxflowBrand, tokens: torxflowTokens },
};

export function isBrandId(value: string | null | undefined): value is BrandId {
  return (BRAND_IDS as readonly string[]).includes(value ?? "");
}

/**
 * The brand an environment value names. Empty or unset is the upstream look (`null`); an unknown
 * name throws, so a typo stops the server instead of silently serving the wrong product.
 */
export function parseBrand(raw: string | null | undefined): BrandConfig | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (!isBrandId(value)) {
    throw new Error(`${BRAND_ENV_KEY} must be one of ${BRAND_IDS.join(", ")} (got "${raw}").`);
  }
  return brands[value];
}

/**
 * Script text that runs before the first paint, ahead of `theme.js`: marks the document with the
 * brand and its fixed appearance, and names the page. A file rather than inline script because
 * the CSP blocks inline scripts.
 */
export function brandBootstrapScript(brand: BrandConfig): string {
  const meta = (selector: string, content: string) =>
    `set(${JSON.stringify(selector)},${JSON.stringify(content)});`;
  const link = (selector: string, href: string) =>
    `setLink(${JSON.stringify(selector)},${JSON.stringify(href)});`;
  return `${[
    "(() => {",
    "  const root = document.documentElement;",
    `  root.dataset.brand = ${JSON.stringify(brand.id)};`,
    `  root.dataset.appearance = ${JSON.stringify(brand.appearance)};`,
    `  document.title = ${JSON.stringify(brand.productName)};`,
    '  const set = (selector, content) => document.querySelector(selector)?.setAttribute("content", content);',
    '  const setLink = (selector, href) => document.querySelector(selector)?.setAttribute("href", href);',
    `  ${meta('meta[name="theme-color"]', brand.themeColor.toLowerCase())}`,
    `  ${meta('meta[name="apple-mobile-web-app-title"]', brand.productName)}`,
    `  ${meta('meta[name="description"]', brand.description)}`,
    `  ${link('link[rel="icon"][type="image/png"]', brand.icons.favicon)}`,
    `  ${link('link[rel="apple-touch-icon"]', brand.icons.appleTouch)}`,
    "})();",
  ].join("\n")}\n`;
}

/** The web manifest of a branded install; `null` is the upstream manifest. */
export function brandManifestOverrides(brand: BrandConfig) {
  const icons = [
    { src: brand.icons.icon192, sizes: "192x192", type: "image/png" },
    { src: brand.icons.icon512, sizes: "512x512", type: "image/png" },
  ];
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: brand.description,
    background_color: brand.themeColor.toLowerCase(),
    theme_color: brand.themeColor.toLowerCase(),
    icons: [
      ...icons.map((icon) => ({ ...icon, purpose: "any" })),
      ...icons.map((icon) => ({ ...icon, purpose: "maskable" })),
    ],
  };
}

export const RADIUS = "0.75rem";

export const fontWeight = { regular: "400", medium: "500", semibold: "600" } as const;

/**
 * Native text styles on the system font, in points: iOS body text is 17/22. Titles use the
 * font's own line spacing, written out so they don't inherit a smaller body line height.
 */
export const typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 },
} as const;

/**
 * Text grows with the iOS text size until body text reaches 23pt, the xxxLarge size. Larger
 * accessibility sizes keep that size, so message bubbles, rows and cards keep their layout.
 */
export const MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

/** The ink of a drawn bot's eyes, the same on every body colour and in both themes. */
export const botEyeColor = "#101014";

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "system";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

/** The web and Electron palette; `tokensForAppearance` is the mobile one. */
export function webTokensForAppearance(appearance: ResolvedAppearance): WebColorTokens {
  return appearance === "light" ? webLightTokens : webDarkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof WebColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: WebColorTokens) {
  const lines = (Object.keys(palette) as (keyof WebColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/**
 * A brand's tokens over the light palette. `:root[data-brand]` outranks `[data-theme]`, so the
 * brand wins whichever appearance the document carries; regular text stays at 400 even on macOS,
 * where upstream raises it to 420 for the system font.
 */
function renderBrandBlock(id: BrandId): string {
  const brand = brands[id];
  const selector = `:root[data-brand="${id}"]`;
  const colors = renderBlock(selector, brand.appearance, brand.tokens).replace(
    `\n  --radius: ${RADIUS};\n}`,
    `\n  --radius: ${RADIUS};\n  --font-sans: ${brand.fontSans};\n  --font-weight-normal: 400;\n}`,
  );
  return `${colors}\n\n${selector}[data-os="mac"] {\n  --font-weight-normal: 400;\n}`;
}

/** The CSS in `tokens.css` (web and Electron). Generated from the web palettes so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @rakazo/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", webDarkTokens),
    renderBlock('[data-theme="light"]', "light", webLightTokens),
    ...(Object.keys(brands) as BrandId[]).map(renderBrandBlock),
  ].join("\n\n")}\n`;
}
