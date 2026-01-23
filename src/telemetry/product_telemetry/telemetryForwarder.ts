import os from 'os';

export type ValidPropertyValueType = string | number | boolean;
export type PropertiesType = { [key: string]: ValidPropertyValueType };

export interface DirectTelemetryForwarderOptions {
  /**
   * HTTP method for sending events. Default: 'PUT'
   */
  httpMethod?: 'POST' | 'PUT';

  /**
   * Custom pod identifier. Default: document.domain (browser) or empty string (Node)
   */
  pod?: string;

  /**
   * Custom host_name identifier. Default: document.domain (browser) or empty string (Node)
   */
  hostName?: string;
}

/**
 * A simplified telemetry forwarder that sends events directly to Tableau's
 * telemetry JSON endpoint (e.g., qa.telemetry.tableausoftware.com).
 */
export class DirectTelemetryForwarder {
  private readonly endpoint: string;
  private readonly httpMethod: 'POST' | 'PUT';
  private readonly pod: string;
  private readonly hostName: string;

  /**
   * @param endpoint - The telemetry endpoint URL (e.g., 'https://qa.telemetry.tableausoftware.com')
   * @param options - Optional configuration
   */
  constructor(endpoint: string, options: DirectTelemetryForwarderOptions = {}) {
    if (!endpoint) {
      throw new Error('Endpoint URL is required for DirectTelemetryForwarder');
    }

    if (typeof fetch === 'undefined' || typeof Request === 'undefined') {
      throw new Error('The fetch API is not available. Add a polyfill like "whatwg-fetch".');
    }

    this.endpoint = endpoint;
    this.httpMethod = options.httpMethod ?? 'PUT';
    this.pod = options.pod ?? getDefaultPod();
    this.hostName = options.hostName ?? getDefaultHostName();
  }

  /**
   * Build and send a telemetry event.
   *
   * @param eventType - The event type/name
   * @param serviceName - The service name emitting the event
   * @param properties - Key-value properties for the event
   */
  public send(eventType: string, serviceName: string, properties: PropertiesType): void {
    const event = {
      type: eventType,
      host_timestamp: formatHostTimestampUtc(new Date()),
      service_name: serviceName,
      pod: this.pod,
      host_name: this.hostName,
      properties,
    };

    const init: RequestInit = {
      method: this.httpMethod,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'default',
      mode: 'cors',
      credentials: 'omit',
      body: JSON.stringify([event]),
    };

    const req = new Request(this.endpoint, init);
    fetch(req).catch((error) => console.error('DirectTelemetryForwarder error:', error));
  }
}

const getDefaultHostName = (): string => {
  return os.hostname();
};

const getDefaultPod = (): string => {
  return process.env.POD_NAME ?? '';
};

/**
 * Format: "yyyy-MM-dd HH:mm:ss,SSS +0000" in UTC
 */
const formatHostTimestampUtc = (d: Date): string => {
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  const pad3 = (n: number): string => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`);

  const yyyy = d.getUTCFullYear();
  const MM = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const HH = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const SSS = pad3(d.getUTCMilliseconds());

  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss},${SSS} +0000`;
};
