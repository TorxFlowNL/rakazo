import { describe, expect, it } from "vitest";
import { computersAreUnavailable } from "./computer-availability";

describe("computersAreUnavailable", () => {
  it("treats none and empty as unavailable", () => {
    expect(computersAreUnavailable("none")).toBe(true);
    expect(computersAreUnavailable("")).toBe(true);
    expect(computersAreUnavailable(null)).toBe(false);
  });

  it("treats configured providers as available", () => {
    expect(computersAreUnavailable("docker")).toBe(false);
    expect(computersAreUnavailable("e2b")).toBe(false);
  });
});
