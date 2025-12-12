declare module 'ssrfcheck' {
  export function isSSRFSafeURL(
    input: string,
    config: { allowedProtocols: string[]; autoPrependProtocol: boolean },
  ): boolean;
}
