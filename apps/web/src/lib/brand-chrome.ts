import { activeBrand } from "./brand";
import { computersAreUnavailable } from "./computer-availability";

type Root = Parameters<typeof activeBrand>[0];

/** What the product calls itself where a name is needed and the upstream wording names it. */
const UPSTREAM_PRODUCT_NAME = "Rakazo";

/**
 * What a white-label deployment renders. Each predicate answers "is this piece of chrome shown?";
 * with no brand (the upstream look) the answer keeps upstream behaviour. `root` is for tests.
 */

export function isBranded(root?: Root): boolean {
  return activeBrand(root) !== null;
}

/** The brand's product name, or Rakazo's own where there is no brand. */
export function productName(root?: Root): string {
  return activeBrand(root)?.productName ?? UPSTREAM_PRODUCT_NAME;
}

/**
 * The "Add a passkey" offer. A branded deployment signs people in through the site that hosts it,
 * so there is no Rakazo login to protect. The session does not say which provider signed in, so
 * the brand alone decides.
 */
export function showPasskeyOffer(root?: Root): boolean {
  return !isBranded(root);
}

/** The passkey rows in account settings; same reasoning as the offer. */
export function showPasskeySettings(root?: Root): boolean {
  return !isBranded(root);
}

/** "Sign in with a passkey" on the sign-in page; a branded deployment has none enrolled. */
export function showPasskeySignIn(root?: Root): boolean {
  return !isBranded(root);
}

/**
 * Everything aimed at someone signing up for the product: the signup survey, onboarding tours,
 * "import from another agent", app-download prompts, plans and upgrade promos, the support chat.
 */
export function showMarketing(root?: Root): boolean {
  return !isBranded(root);
}

/** The appearance picker; a brand fixes one appearance. */
export function showAppearanceSetting(root?: Root): boolean {
  return activeBrand(root)?.appearance === undefined;
}

/**
 * The computer button, panel and settings for one bot's computer. Upstream always shows them. A
 * branded deployment hides them where the server says there are no computers (`sandboxProvider`
 * of `none`), and until the server has said so, rather than flash a button it may then take away.
 */
export function showComputerUi(sandboxProvider: string | null | undefined, root?: Root): boolean {
  if (!isBranded(root)) return true;
  if (sandboxProvider == null) return false;
  return !computersAreUnavailable(sandboxProvider);
}

/**
 * The Settings → Computer section, which explains how to turn computers on. A branded deployment
 * is configured by its operator, so its users never see that guidance.
 */
export function showComputerSetupHelp(root?: Root): boolean {
  return !isBranded(root);
}
