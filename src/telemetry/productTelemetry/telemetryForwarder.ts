import os from 'os';

type ValidPropertyValueType = string | number | boolean;
type PropertiesType = { [key: string]: ValidPropertyValueType };
const DEFAULT_HOST_NAME = 'External';
const SERVICE_NAME = 'tableau-mcp';

export type TelemetryEventType = 'tool_call';

export type ProductTelemetryBase = {
  endpoint: string;
  siteLuid: string;
  podName: string;
  enabled: boolean;
  isHyperforce: boolean;
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
  private readonly podName: string;

  /**
   * @param endpoint - The telemetry endpoint URL
   * @param enabled - Whether telemetry is enabled
   * @param podName - The pod name for telemetry events
   */
  constructor(endpoint: string, enabled: boolean, podName: string) {
    if (!endpoint) {
      throw new Error('Endpoint URL is required for DirectTelemetryForwarder');
    }

    this.endpoint = endpoint;
    this.enabled = enabled;
    this.podName = podName;
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
      pod: this.podName,
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

    const req = new Request(this.endpoint, init);
    // Intentionally not awaiting: telemetry should not block execution.
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

export function getProductTelemetry(
  endpoint: string,
  enabled: boolean,
  podName: string,
): DirectTelemetryForwarder {
  if (!productTelemetryInstance) {
    productTelemetryInstance = new DirectTelemetryForwarder(endpoint, enabled, podName);
  }
  return productTelemetryInstance;
}

export const exportedForTesting = {
  DirectTelemetryForwarder,
  resetProductTelemetry: () => {
    productTelemetryInstance = null;
  },
};
