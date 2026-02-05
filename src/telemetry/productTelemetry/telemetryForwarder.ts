import os from 'os';

export type ValidPropertyValueType = string | number | boolean;
export type PropertiesType = { [key: string]: ValidPropertyValueType };
const DEFAULT_HOST_NAME = 'External';
const SERVICE_NAME = 'tableau-mcp';

export type ProductTelemetryBase = {
  endpoint: string;
  siteName: string;
  podName: string;
};

export type TableauTelemetryJsonEvent = {
  type: string;
  host_timestamp: string;
  host_name: string;
  service_name: string;
  pod?: string;
  properties: PropertiesType;
};

export interface DirectTelemetryForwarderOptions {
  /**
   * HTTP method for sending events. Default: 'PUT'
   */
  httpMethod?: 'POST' | 'PUT';
  /**
   * Service name. Default: 'tableau-mcp'
   */
  serviceName?: string;
}

/**
 * A simplified telemetry forwarder that sends events directly to Tableau's
 * telemetry JSON endpoint (e.g., qa.telemetry.tableausoftware.com).
 */
export class DirectTelemetryForwarder {
  private readonly endpoint: string;
  private readonly httpMethod: 'POST' | 'PUT';

  /**
   * @param endpoint - The telemetry endpoint URL
   * @param options - Optional configuration
   */
  constructor(endpoint: string, options: DirectTelemetryForwarderOptions = {}) {
    if (!endpoint) {
      throw new Error('Endpoint URL is required for DirectTelemetryForwarder');
    }

    this.endpoint = endpoint;
    this.httpMethod = options.httpMethod ?? 'PUT';
  }

  /**
   * Build and send a telemetry event.
   *
   * @param eventType - The event type/name
   * @param serviceName - The service name emitting the event
   * @param properties - Key-value properties for the event
   */
  send(eventType: string, properties: PropertiesType): void {
    if (process.env.PRODUCT_TELEMETRY_ENABLED === 'false') {
      return;
    }

    const event: TableauTelemetryJsonEvent = {
      type: eventType,
      host_timestamp: formatHostTimestamp(new Date()),
      service_name: SERVICE_NAME,
      pod: getDefaultPod(),
      host_name: getDefaultHostName(),
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

    // eslint-disable-next-line no-console
    console.log('[Telemetry] Sending event:', JSON.stringify(event, null, 2));

    const req = new Request(this.endpoint, init);
    fetch(req)
      .then(async (res) => {
        const body = await res.text();
        if (!res.ok) {
          console.error(`[Telemetry] Failed: ${res.status} ${res.statusText}`, body);
        } else {
          // eslint-disable-next-line no-console
          console.log(`[Telemetry] Success: ${res.status}`, body);
        }
      })
      .catch((error) => console.error('[Telemetry] Network error:', error));
  }
}

const getDefaultPod = (): string => {
  return process.env.SERVER || '';
};

const getDefaultHostName = (): string => {
  return os.hostname() ?? DEFAULT_HOST_NAME;
};

/**
 * Format: ISO 8601 (e.g., "2026-02-05T14:30:00.123Z")
 */
const formatHostTimestamp = (d: Date): string => {
  return d.toISOString();
};
