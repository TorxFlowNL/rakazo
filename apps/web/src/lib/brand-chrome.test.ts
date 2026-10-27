import { describe, expect, it } from "vitest";
import {
  isBranded,
  productName,
  showAppearanceSetting,
  showComputerSetupHelp,
  showComputerUi,
  showMarketing,
  showPasskeyOffer,
  showPasskeySettings,
  showPasskeySignIn,
} from "./brand-chrome";

const upstream = { dataset: {} } as never;
const torxflow = { dataset: { brand: "torxflow" } } as never;

describe("without a brand", () => {
  it("keeps the upstream chrome", () => {
    expect(isBranded(upstream)).toBe(false);
    expect(productName(upstream)).toBe("Rakazo");
    expect(showPasskeyOffer(upstream)).toBe(true);
    expect(showPasskeySettings(upstream)).toBe(true);
    expect(showPasskeySignIn(upstream)).toBe(true);
    expect(showMarketing(upstream)).toBe(true);
    expect(showAppearanceSetting(upstream)).toBe(true);
    expect(showComputerSetupHelp(upstream)).toBe(true);
  });

  it("always shows the computer, whatever the server reports", () => {
    for (const provider of [undefined, null, "docker", "e2b", "none", ""]) {
      expect(showComputerUi(provider, upstream)).toBe(true);
    }
  });
});

describe("under the TorxFlow brand", () => {
  it("drops the passkey offer, settings and sign-in", () => {
    expect(showPasskeyOffer(torxflow)).toBe(false);
    expect(showPasskeySettings(torxflow)).toBe(false);
    expect(showPasskeySignIn(torxflow)).toBe(false);
  });

  it("drops marketing, the appearance switch and the computer setup guidance", () => {
    expect(isBranded(torxflow)).toBe(true);
    expect(showMarketing(torxflow)).toBe(false);
    expect(showAppearanceSetting(torxflow)).toBe(false);
    expect(showComputerSetupHelp(torxflow)).toBe(false);
  });

  it("names the product after the brand", () => {
    expect(productName(torxflow)).toBe("Assistenten");
  });

  it("shows the computer only once the server says one exists", () => {
    expect(showComputerUi(undefined, torxflow)).toBe(false);
    expect(showComputerUi(null, torxflow)).toBe(false);
    expect(showComputerUi("none", torxflow)).toBe(false);
    expect(showComputerUi("", torxflow)).toBe(false);
    expect(showComputerUi("docker", torxflow)).toBe(true);
  });
});

describe("an unknown brand name", () => {
  it("is the upstream look", () => {
    const unknown = { dataset: { brand: "other" } } as never;
    expect(isBranded(unknown)).toBe(false);
    expect(showPasskeyOffer(unknown)).toBe(true);
  });
});
