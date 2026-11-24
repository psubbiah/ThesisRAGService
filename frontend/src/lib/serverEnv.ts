/**
 * Read server secrets at request time.
 * Use bracket access so Next cannot replace the name with a build-time empty value.
 */
export function readServerEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  let trimmed = value.trim();
  // Common paste mistakes from dashboard copy/paste.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(trimmed)) {
    trimmed = trimmed.replace(/^bearer\s+/i, "").trim();
  }
  return trimmed.length > 0 ? trimmed : undefined;
}
