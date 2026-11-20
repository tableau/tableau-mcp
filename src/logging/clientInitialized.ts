import { log } from './logger.js';

export function logClientInitialized({
  protocolVersion,
  clientInfo,
  capabilities = {},
}: {
  protocolVersion: string | undefined;
  clientInfo: unknown;
  capabilities?: { elicitation?: unknown };
}): void {
  log({
    message: 'MCP client initialized',
    level: 'info',
    logger: 'http',
    data: {
      protocolVersion,
      clientInfo,
      capabilities,
      elicitationSupported: capabilities.elicitation !== undefined,
    },
  });
}
