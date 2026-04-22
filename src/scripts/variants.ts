export const variants = ['default'] as const;
export type Variant = (typeof variants)[number];
export function isVariant(value: unknown): value is Variant {
  return variants.some((variant) => variant === value);
}
