// @vitest-environment jsdom
import type { Bot } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatHeader } from "./chat-header";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
vi.mock("@rakazo/ui-web", () => ({
  BotAvatar: () => null,
  GroupAvatar: () => null,
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
}));
vi.mock("../../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderHeader(showComputer: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <ChatHeader
        inGroup={false}
        active={{ id: "bot-1", name: "Tessa", color: "#ea580c", status: "idle" } as unknown as Bot}
        activeGroup={undefined}
        activeSnapshot={null}
        phoneCallsEnabled={false}
        inCall={false}
        computerPanelOpen={false}
        showComputer={showComputer}
        onOpenNavigation={() => undefined}
        onOpenChatSettings={() => undefined}
        onCall={() => undefined}
        onToggleComputer={() => undefined}
      />,
    ),
  );
  return { host, unmount: () => act(async () => root.unmount()) };
}

it("offers the agent computer where the deployment has computers", async () => {
  const { host, unmount } = await renderHeader(true);
  expect(host.querySelector('button[aria-label="Agent computer"]')).not.toBeNull();
  await unmount();
});

it("has no computer button where the deployment has none", async () => {
  const { host, unmount } = await renderHeader(false);
  expect(host.querySelector('button[aria-label="Agent computer"]')).toBeNull();
  await unmount();
});
