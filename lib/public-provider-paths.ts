const PUBLIC_PROVIDER_PATHS = new Set([
  "/preferences", "/preferences/",
  "/connect/rosser-gallery", "/connect/rosser-gallery/",
  "/connect/rt-solutions", "/connect/rt-solutions/",
]);

/** Only explicit public capability routes can omit the private workspace shell. */
export function isPublicProviderPath(pathname: string): boolean {
  return PUBLIC_PROVIDER_PATHS.has(pathname);
}
