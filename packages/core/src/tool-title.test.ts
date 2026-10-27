import { describe, expect, it } from "vitest";
import {
  humanizeToolIdsInText,
  MAX_TOOL_TITLE_LENGTH,
  normalizeStepLabel,
  normalizeToolTitle,
  stripToolPrefix,
  toolDisplayName,
} from "./tool-title.js";

describe("toolDisplayName", () => {
  it("prefers the server's title over the id", () => {
    expect(
      toolDisplayName({
        name: "mcp__torxflow__request_appointment",
        title: "Afspraakverzoek aanmaken",
      }),
    ).toBe("Afspraakverzoek aanmaken");
  });

  it("collapses whitespace in a title and ignores a blank one", () => {
    expect(toolDisplayName({ name: "web_search", title: "  Voorraad\n doorzoeken " })).toBe(
      "Voorraad doorzoeken",
    );
    expect(toolDisplayName({ name: "web_search", title: "   " })).toBe("Web search");
  });

  it.each([
    ["mcp__torxflow__check_apk_status", "Check apk status"],
    ["mcp__torxflow__request_appointment", "Request appointment"],
    ["mcp__pc-files__read_text_file", "Read text file"],
    ["mcp__jira__getJiraIssue", "Get jira issue"],
    ["installed__inst-1__list_contacts", "List contacts"],
    ["web_search", "Web search"],
    ["request_takeover", "Request takeover"],
    ["SLACK_FIND_CHANNELS", "Slack find channels"],
    ["getJiraIssue", "Get jira issue"],
    ["list-open-orders", "List open orders"],
    ["shell", "Shell"],
  ])("spells %s out as %s", (name, expected) => {
    expect(toolDisplayName({ name })).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ name: "" }],
    [{ name: "   " }],
    [{ name: 42 }],
    [{ name: "mcp__" }],
    [{ name: "mcp____" }],
    [{ name: "___" }],
    [{ title: 7 }],
  ])("never throws or returns an empty name for %j", (tool) => {
    const shown = toolDisplayName(tool as never);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).not.toContain("__");
    expect(shown).not.toContain("mcp__");
  });
});

describe("stripToolPrefix", () => {
  it("removes the server prefix only", () => {
    expect(stripToolPrefix("mcp__torxflow__check_apk_status")).toBe("check_apk_status");
    expect(stripToolPrefix("mcp__a__b__c")).toBe("b__c");
    expect(stripToolPrefix("web_search")).toBe("web_search");
    expect(stripToolPrefix("mcp_computer_click")).toBe("mcp_computer_click");
  });
});

describe("normalizeToolTitle", () => {
  it("returns a bounded single line, or nothing", () => {
    expect(normalizeToolTitle(undefined)).toBeUndefined();
    expect(normalizeToolTitle(12)).toBeUndefined();
    expect(normalizeToolTitle(" \n ")).toBeUndefined();
    const long = normalizeToolTitle("x".repeat(MAX_TOOL_TITLE_LENGTH + 50));
    expect(long).toHaveLength(MAX_TOOL_TITLE_LENGTH);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("humanizeToolIdsInText", () => {
  it("replaces connector tool ids inside a sentence", () => {
    expect(humanizeToolIdsInText("Review before mcp__torxflow__check_apk_status")).toBe(
      "Review before Check apk status",
    );
    expect(humanizeToolIdsInText("Review before mcp__tasklog__add_task → Renew passport")).toBe(
      "Review before Add task → Renew passport",
    );
    expect(humanizeToolIdsInText("Review before web_fetch → example.test")).toBe(
      "Review before web_fetch → example.test",
    );
  });
});

describe("normalizeStepLabel", () => {
  it("repairs a step label saved from a raw MCP id", () => {
    expect(normalizeStepLabel("Mcp  torxflow  check apk status")).toBe("Check apk status");
    expect(normalizeStepLabel("Mcp  pc-files  read text file")).toBe("Read text file");
  });

  it("leaves other labels alone", () => {
    expect(normalizeStepLabel("Slack find channels")).toBe("Slack find channels");
    expect(normalizeStepLabel("Mcp tools")).toBe("Mcp tools");
  });
});
