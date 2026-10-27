import type { BrandConfig } from "@rakazo/ui-tokens";
import { brands, isBrandId } from "@rakazo/ui-tokens";

type BrandRoot = Pick<HTMLElement, "dataset">;

/**
 * The brand this deployment runs as, or `null` for the upstream look. The server marks the document
 * (`data-brand`) from `RAKAZO_BRAND` before the first paint (see `brand-plugin.ts`), so one build
 * serves both.
 */
export function activeBrand(
  root: BrandRoot | null = typeof document !== "undefined" ? document.documentElement : null,
): BrandConfig | null {
  const id = root?.dataset.brand;
  return isBrandId(id) ? brands[id] : null;
}
