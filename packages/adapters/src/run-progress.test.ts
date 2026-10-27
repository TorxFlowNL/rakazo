import { describe, expect, it } from "vitest";
import type { ReplyState } from "./run-context.js";
import { flushPendingTools, tryFlushPendingTools } from "./run-progress.js";

function replyWith(pending: Array<[name: string, title?: string]>, text = ""): ReplyState {
  return {
    currentTextSegment: text,
    messageSegments: [],
    pendingToolNames: pending.map(([name]) => name),
    pendingToolTitles: new Map(
      pending.flatMap(([name, title]) => (title ? [[name, title] as const] : [])),
    ),
  } as unknown as ReplyState;
}

describe("flushPendingTools", () => {
  it("labels each flushed step with its tool's title, or the readable id without one", () => {
    const reply = replyWith([
      ["mcp__torxflow__check_apk_status", "APK-status opzoeken"],
      ["mcp__torxflow__list_stock"],
    ]);

    flushPendingTools(reply);

    expect(reply.messageSegments).toEqual([
      {
        kind: "steps",
        steps: [
          { label: "APK-status opzoeken", count: 1 },
          { label: "List stock", count: 1 },
        ],
      },
    ]);
    expect(reply.pendingToolNames).toEqual([]);
    expect(reply.pendingToolTitles.size).toBe(0);
  });

  it("waits for a sentence end before flushing, keeping the titles meanwhile", () => {
    const reply = replyWith([["mcp__torxflow__check_apk_status", "APK-status opzoeken"]], "Let me");

    tryFlushPendingTools(reply);
    expect(reply.messageSegments).toEqual([]);
    expect(reply.pendingToolTitles.get("mcp__torxflow__check_apk_status")).toBe(
      "APK-status opzoeken",
    );

    reply.currentTextSegment = "Let me look.";
    tryFlushPendingTools(reply);
    expect(reply.messageSegments).toEqual([
      { kind: "text", text: "Let me look." },
      { kind: "steps", steps: [{ label: "APK-status opzoeken", count: 1 }] },
    ]);
  });
});
