import { describe, expect, it } from "vitest";
import {
  classifySandboxProvider,
  sandboxCheckFailureMessage,
  sandboxEnvGuidanceLines,
  sandboxEnvGuidanceText,
} from "./computer-sandbox.js";

describe("classifySandboxProvider", () => {
  it("classifies none, docker, and hosted providers", () => {
    expect(classifySandboxProvider("none")).toBe("none");
    expect(classifySandboxProvider(null)).toBe("none");
    expect(classifySandboxProvider("docker")).toBe("docker");
    expect(classifySandboxProvider("e2b")).toBe("hosted");
  });
});

describe("sandboxEnvGuidanceText", () => {
  it("uses placeholder tokens and activates only one provider", () => {
    const text = sandboxEnvGuidanceText();
    expect(text).toContain("SANDBOX_SUPERVISOR_TOKEN=<generate-a-secret>");
    expect(text).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
    expect(sandboxEnvGuidanceLines().filter((line) => /^SANDBOX_PROVIDER=/.test(line))).toEqual([
      "SANDBOX_PROVIDER=docker",
    ]);
    expect(text).toContain("# SANDBOX_PROVIDER=e2b");
    expect(text).toContain("# SANDBOX_PROVIDER=daytona");
    expect(text).toContain("# SANDBOX_PROVIDER=boat");
  });
});

describe("sandboxCheckFailureMessage", () => {
  it("returns error message or fallback", () => {
    expect(sandboxCheckFailureMessage(new Error("offline"))).toBe("offline");
    expect(sandboxCheckFailureMessage(null)).toBe("Could not reach the server");
  });
});
