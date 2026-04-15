// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type EmptyObject = {};

export type HostSandboxCapabilities = Partial<{
  /** Permissions granted by the host (camera, microphone, geolocation, clipboard-write). */
  permissions: Partial<{
    camera: EmptyObject;
    microphone: EmptyObject;
    geolocation: EmptyObject;
    clipboardWrite: EmptyObject;
  }>;

  /** CSP domains approved by the host. */
  csp: Partial<{
    /** Approved origins for network requests (fetch/XHR/WebSocket). */
    connectDomains: Array<string>;

    /** Approved origins for static resources (scripts, images, styles, fonts). */
    resourceDomains: Array<string>;

    /** Approved origins for nested iframes (frame-src directive). */
    frameDomains: Array<string>;

    /** Approved base URIs for the document (base-uri directive). */
    baseUriDomains: Array<string>;
  }>;
}>;
