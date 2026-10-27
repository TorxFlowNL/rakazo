/**
 * How a tool is named to a person. Connector tools arrive as ids such as
 * `mcp__torxflow__check_apk_status`; a person should read "Check apk status", or the
 * short label the tool's own server declared (the MCP `title`).
 */

/** A server-declared title longer than this is cut, so a hostile server cannot fill a card. */
export const MAX_TOOL_TITLE_LENGTH = 120;

/** `mcp__<server>__<tool>` and the `installed__<install>__<tool>` form of an installed connector. */
const PREFIXED_TOOL_NAME = /^(?:mcp|installed)__.+?__(.+)$/s;
const PREFIXED_TOOL_ID_IN_TEXT = /\b(?:mcp|installed)__[\w-]+?__[\w-]+/g;
/** What `humanizeToolName` used to produce for an MCP id: "Mcp  server  tool name". */
const LEGACY_MCP_STEP_LABEL = /^Mcp {2}\S+ {2}(\S.*)$/;

/** A title as a single trimmed line of bounded length, or undefined when nothing is left. */
export function normalizeToolTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > MAX_TOOL_TITLE_LENGTH
    ? `${line.slice(0, MAX_TOOL_TITLE_LENGTH - 1)}…`
    : line;
}

/** The tool's own name without its server prefix. */
export function stripToolPrefix(name: string): string {
  return PREFIXED_TOOL_NAME.exec(name)?.[1] ?? name;
}

/** snake_case, kebab-case, camelCase and SCREAMING_SNAKE to one lowercase sentence, first letter up. */
function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.\s]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The name to show for a tool: its server-declared `title` when it has one, otherwise the
 * id without its server prefix, spelled out as words. Never throws, never returns the raw
 * prefixed id, and never returns an empty string.
 */
export function toolDisplayName(
  tool: { name?: unknown; title?: unknown } | null | undefined,
): string {
  const title = normalizeToolTitle(tool?.title);
  if (title) return title;
  const name = typeof tool?.name === "string" ? tool.name : "";
  return humanizeIdentifier(stripToolPrefix(name)) || humanizeIdentifier(name) || "Tool";
}

/** Replaces every connector tool id inside a sentence with its readable name. */
export function humanizeToolIdsInText(text: string): string {
  return text.replace(PREFIXED_TOOL_ID_IN_TEXT, (id) => toolDisplayName({ name: id }));
}

/** A stored step label, with the readable form for a label saved from a raw MCP id. */
export function normalizeStepLabel(label: string): string {
  const legacy = LEGACY_MCP_STEP_LABEL.exec(label)?.[1];
  return legacy ? legacy.charAt(0).toUpperCase() + legacy.slice(1) : label;
}
