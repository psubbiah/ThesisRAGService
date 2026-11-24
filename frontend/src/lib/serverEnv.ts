/**
 * Read server secrets at request time.
 * Use bracket access so Next cannot replace the name with a build-time empty value.
 */
export function readServerEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
