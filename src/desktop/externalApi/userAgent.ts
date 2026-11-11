import pkg from '../../../package.json';

export const DESKTOP_MCP_NAME = 'tableau-desktop-mcp';

const PRODUCT_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:\/[!#$%&'*+.^_`|~0-9A-Za-z-]+)?$/;

export function parseUserAgentPrefix(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && PRODUCT_TOKEN.test(trimmed) ? trimmed : undefined;
}

export function buildDesktopUserAgent(prefix?: string): string {
  const own = `${DESKTOP_MCP_NAME}/${pkg.version}`;
  // Desktop reads only the leading product token as the caller.
  return prefix ? `${prefix} ${own}` : own;
}
