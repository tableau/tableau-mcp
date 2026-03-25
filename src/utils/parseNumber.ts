export function parseNumber(
  value: string | undefined,
  {
    defaultValue,
    minValue,
    maxValue,
  }: { defaultValue: number; minValue?: number; maxValue?: number } = {
    defaultValue: 0,
    minValue: Number.NEGATIVE_INFINITY,
    maxValue: Number.POSITIVE_INFINITY,
  },
): number {
  if (!value) {
    return defaultValue;
  }

  const number = parseFloat(value);
  return isNaN(number) ||
    (minValue !== undefined && number < minValue) ||
    (maxValue !== undefined && number > maxValue)
    ? defaultValue
    : number;
}
