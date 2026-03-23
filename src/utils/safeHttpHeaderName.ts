export function isSafeHttpHeaderName(name: string): boolean {
  return name.length > 0 && name.length <= 256 && /^[!#$%&'*+.^_|~0-9a-z-]+$/i.test(name);
}
