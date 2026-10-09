import os from 'os';

import { log } from '../../logging/logger';

type ValidPropertyValueType = string | number | boolean;
type PropertiesType = { [key: string]: ValidPropertyValueType };
const DEFAULT_HOST_NAME = 'External';
const SERVICE_NAME = 'tableau-mcp';

/** Default product-telemetry endpoint; override via PRODUCT_TELEMETRY_ENDPOINT. */
export const DEFAULT_PRODUCT_TELEMETRY_ENDPOINT = 'https://prod.telemetry.tableausoftware.com';

export type TelemetryEventType = 'tool_call' | 'tableau_mcp_event';

/**
 * Deployment-level telemetry fields shared by every event, independent of the per-call/per-request
 * properties. Resolved once from env (see {@link resolveTelemetryEnv}) so they never depend on
 * which config — web or desktop — happened to build the forwarder first.
 * Only one config exists at a time.
 */
export type TelemetryEnv = {
  endpoint: string;
  enabled: boolean;
  pod: string;
  isHyperforce: boolean;
};

/**
 * Resolve the deployment-level telemetry fields straight from env. A process runs exactly one
 * deployment, so only that variant's env is populated: web sets `SERVER`, desktop sets
 * `TABLEAU_POD_NAME`, and both resolve to the single server URL this process reports as its pod.
 * `endpoint` / `enabled` / `IS_HYPERFORCE` are read identically by both configs, so reading them
 * here (rather than from a Config) keeps resolution order-independent and avoids constructing a
 * desktop Config in an HTTP process (its constructor throws unless TRANSPORT is stdio).
 */
export function resolveTelemetryEnv(): TelemetryEnv {
  const env = process.env;
  return {
    endpoint: env.PRODUCT_TELEMETRY_ENDPOINT || DEFAULT_PRODUCT_TELEMETRY_ENDPOINT,
    enabled: env.PRODUCT_TELEMETRY_ENABLED !== 'false',
    pod: env.SERVER || env.TABLEAU_POD_NAME || '',
    isHyperforce: env.IS_HYPERFORCE === 'true',
  };
}

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
  private readonly pod: string;
  private readonly isHyperforce: boolean;

  constructor({ endpoint, enabled, pod, isHyperforce }: TelemetryEnv) {
    if (!endpoint) {
      throw new Error('Endpoint URL is required for DirectTelemetryForwarder');
    }

    this.endpoint = endpoint;
    this.enabled = enabled;
    this.pod = pod;
    this.isHyperforce = isHyperforce;
  }

  /**
   * Build and send a telemetry event. The caller passes only the per-call/per-request properties;
   * the deployment-level pod and is_hyperforce are stamped here from the resolved env.
   *
   * @param eventType - The event type/name
   * @param properties - Key-value properties for the event
   */
  send(eventType: TelemetryEventType, properties: PropertiesType): void {
    if (!this.enabled) {
      return;
    }

    try {
      const event: TableauTelemetryJsonEvent = {
        type: eventType,
        host_timestamp: formatHostTimestamp(new Date()),
        service_name: SERVICE_NAME,
        pod: this.pod,
        host_name: getDefaultHostName(),
        properties: {
          ...properties,
          podname: this.pod,
          is_hyperforce: this.isHyperforce,
        },
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
    } catch (error) {
      log({
        message: 'Telemetry request failed',
        level: 'error',
        logger: 'telemetry',
        data: error,
      });
    }
  }
}

async function sendTelemetryRequest(req: Request): Promise<void> {
  try {
    const res = await fetch(req);
    const body = await res.text();
    if (!res.ok) {
      log({
        message: `Telemetry request failed: ${res.status} ${res.statusText} - ${body}`,
        level: 'error',
        logger: 'telemetry',
      });
    }
  } catch (error) {
    log({
      message: 'Telemetry request failed',
      level: 'error',
      logger: 'telemetry',
      data: error,
    });
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

// One shared forwarder. Its deployment-level fields are resolved from env
// identical for every caller, so sharing one instance across web and desktop
// tools in the combined build is safe regardless of which tool constructs it first.
// Created on first use because env/config isn't available at module load.
let productTelemetryInstance: DirectTelemetryForwarder | null = null;

export function getProductTelemetry(): DirectTelemetryForwarder {
  if (!productTelemetryInstance) {
    productTelemetryInstance = new DirectTelemetryForwarder(resolveTelemetryEnv());
  }
  return productTelemetryInstance;
}

export const exportedForTesting = {
  DirectTelemetryForwarder,
  resetProductTelemetry: () => {
    productTelemetryInstance = null;
  },
};
