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
  trimmed = trimmed
    .replace(/^openai\s*api\s*key\s*[:=]\s*/i, "")
    .replace(/^api[_-]?key\s*[:=]\s*/i, "")
    .trim();
  // Keys should be a single token; collapse accidental whitespace/newlines.
  if (/\s/.test(trimmed)) {
    trimmed = trimmed.replace(/\s+/g, "");
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Non-secret shape info for diagnostics (never returns the key). */
export function describeApiKeyShape(apiKey: string | undefined): {
  present: boolean;
  looks_like_openai: boolean;
  prefix: string | null;
  length: number;
} {
  if (!apiKey) {
    return {
      present: false,
      looks_like_openai: false,
      prefix: null,
      length: 0,
    };
  }
  const prefix = apiKey.startsWith("sk-proj-")
    ? "sk-proj-"
    : apiKey.startsWith("sk-")
      ? "sk-"
      : apiKey.slice(0, 4);
  return {
    present: true,
    looks_like_openai: apiKey.startsWith("sk-"),
    prefix,
    length: apiKey.length,
  };
}
