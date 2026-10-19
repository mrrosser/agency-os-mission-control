const NON_NAME_FIRST_TOKEN = /^(?:contact|unknown|unnamed|anonymous|n\/a|mr\.?|mrs\.?|ms\.?|miss|mx\.?|dr\.?|prof\.?|rev\.?|sir|dame|team|office|company|business|organization|organisation|sales|support|admin|info)$/i;
const ORGANIZATION_LABEL = /^(?:screen\s+printing)(?:\s|$)|\b(?:llc|inc|ltd|corp|corporation)\.?$/i;

/**
 * Resolve only when creating a pilot. Existing pilots keep their reviewed,
 * fingerprinted greeting; rendering and delivery must not re-resolve it.
 */
export function resolveWarmReconnectGreetingName(displayName: string | null | undefined): string {
  const name = String(displayName || "").trim();
  const firstToken = name
    .split(/\s+/)[0]
    ?.replace(/[\0\r\n<>]/g, "")
    .slice(0, 80) || "";

  // Do not guess a name from a title, a CRM placeholder, a reversed-name
  // label, or a recognizable organization label. Use the template fallback.
  if (
    !firstToken ||
    NON_NAME_FIRST_TOKEN.test(firstToken) ||
    /[,;:]$/.test(firstToken) ||
    ORGANIZATION_LABEL.test(name)
  ) {
    return "there";
  }

  // Preserve the existing bounded first-token behavior for ordinary names.
  return firstToken.replace(/^./, (letter) => letter.toUpperCase());
}
