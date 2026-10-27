/** Whether the server runs no computers (`SANDBOX_PROVIDER` of `none`, or empty). */
export function computersAreUnavailable(sandboxProvider: string | null | undefined): boolean {
  return sandboxProvider === "none" || sandboxProvider === "";
}
