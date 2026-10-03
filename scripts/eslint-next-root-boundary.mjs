/**
 * The Next lint plugin's only fast-glob call expands settings.next.rootDir.
 * This single-root app uses context.cwd instead. Its scoped tinyglobby alias
 * removes the unpatched braces dependency; it is not a general fast-glob shim.
 * Fail explicitly if a future config starts depending on those glob semantics.
 */
export function assertDefaultNextRootDirectory(config) {
  for (const entry of config.flat(Infinity)) {
    const next = entry?.settings?.next;
    if (next && typeof next === "object" && "rootDir" in next) {
      throw new Error(
        "settings.next.rootDir requires a reviewed glob migration before use. " +
          "The Next lint dependency replacement supports this app's default cwd only; " +
          "see docs/reports/2026-10-03-dependency-repair.md.",
      );
    }
  }
  return config;
}
