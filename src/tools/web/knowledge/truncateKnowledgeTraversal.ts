const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export function getTraversalLimit(
  configuredLimit?: number | null,
  requestedLimit?: number,
): number {
  return Math.min(requestedLimit ?? DEFAULT_LIMIT, configuredLimit ?? DEFAULT_LIMIT, MAX_LIMIT);
}

export function truncateKnowledgeArrays<T extends Record<string, unknown>, K extends keyof T>(
  result: T,
  arrays: Partial<Record<K, string>>,
  limit: number,
): T & { mcp: { resultInfo: Record<string, number | boolean> } } {
  const counts: Record<string, number | boolean> = { truncated: false };
  const bounded = { ...result };
  for (const [keyName, countLabel] of Object.entries(arrays) as [K, string][]) {
    const key = keyName;
    const items = result[key] as unknown as unknown[];
    counts[`returned${countLabel}Count`] = Math.min(items.length, limit);
    counts[`original${countLabel}Count`] = items.length;
    counts.truncated = counts.truncated === true || items.length > limit;
    bounded[key] = items.slice(0, limit) as T[K];
  }
  return { ...bounded, mcp: { resultInfo: counts } };
}
