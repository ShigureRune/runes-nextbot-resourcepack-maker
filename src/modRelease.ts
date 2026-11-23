/** Verified official downloadable JAR URL for Rune's Nextbot MOD.
 * Leave null until the actual .jar asset is published and its origin verified.
 * Example format: https://github.com/OWNER/REPOSITORY/releases/download/v1.0.0/runes-nextbot-v1.0.0.jar
 * The URL above is an example only; no asset with that path is claimed to exist.
 */
export const MOD_DOWNLOAD_JAR_URL: string | null = null;

/** Reject page links and unexpected schemes: only a direct HTTPS .jar asset is acceptable. */
export function verifiedJarUrl(candidate: string | null): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.pathname.toLowerCase().endsWith('.jar') ||
        url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Provide a filename hint to browsers that honor the download attribute. */
export function jarFilename(jarUrl: string): string {
  const raw = new URL(jarUrl).pathname.split('/').pop() ?? '';
  try {
    const name = decodeURIComponent(raw);
    return name && !name.includes('/') && !name.includes('\\') ? name : 'runes-nextbot.jar';
  } catch {
    return 'runes-nextbot.jar';
  }
}
