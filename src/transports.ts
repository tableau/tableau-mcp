const transports = ['stdio', 'http'] as const;
export type TransportName = (typeof transports)[number];
export function isTransport(transport: unknown): transport is TransportName {
  return !!transports.find((t) => t === transport);
}
