import os from 'os';

type ValidPropertyValueType = string | number | boolean;
type PropertiesType = { [key: string]: ValidPropertyValueType };
const DEFAULT_HOST_NAME = 'External';
const SERVICE_NAME = 'tableau-mcp';

type TelemetryEventType = 'tool_call';

export type ProductTelemetryBase = {
  endpoint: string;
  siteName: string;
  podName: string;
  enabled: boolean;
};

export type TableauTelemetryJsonEvent = {
  type: TelemetryEventType;
  host_timestamp: string;
  host_name: string;
  service_name: string;
  pod?: string;
  properties: PropertiesType;
};

/**
 * A simplified telemetry forwarder that sends events directly to Tableau's
 * telemetry JSON endpoint (e.g., qa.telemetry.tableausoftware.com).
 */
class DirectTelemetryForwarder {
  private readonly endpoint: string;
  private readonly enabled: boolean;

  /**
   * @param endpoint - The telemetry endpoint URL
   * @param enabled - Whether telemetry is enabled
   */
  constructor(endpoint: string, enabled: boolean) {
    if (!endpoint) {
      throw new Error('Endpoint URL is required for DirectTelemetryForwarder');
    }

    this.endpoint = endpoint;
    this.enabled = enabled;
  }

  /**
   * Build and send a telemetry event.
   *
   * @param eventType - The event type/name
   * @param properties - Key-value properties for the event
   */
  send(eventType: TelemetryEventType, properties: PropertiesType): void {
    if (!this.enabled) {
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
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([event]),
    };

    // eslint-disable-next-line no-console
    console.log('[Telemetry] Sending event:', JSON.stringify(event, null, 2));

    const req = new Request(this.endpoint, init);
    sendTelemetryRequest(req);
  }
}

async function sendTelemetryRequest(req: Request): Promise<void> {
  try {
    const res = await fetch(req);
    const body = await res.text();
    if (!res.ok) {
      console.error(`[Telemetry] Failed: ${res.status} ${res.statusText}`, body);
    }
  } catch (error) {
    console.error('[Telemetry] Network error:', error);
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

// Singleton access pattern
let productTelemetryInstance: DirectTelemetryForwarder | null = null;

export function getProductTelemetry(endpoint: string, enabled: boolean): DirectTelemetryForwarder {
  if (!productTelemetryInstance) {
    productTelemetryInstance = new DirectTelemetryForwarder(endpoint, enabled);
  }
  return productTelemetryInstance;
}

export const exportedForTesting = {
  DirectTelemetryForwarder,
};
