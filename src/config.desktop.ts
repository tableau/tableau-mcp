import { BaseConfig, removeClaudeMcpBundleUserConfigTemplates } from './config.shared.js';
import { AgentApiClientConfig } from './desktop/getAgentApiClient.js';
import { milliseconds } from './utils/milliseconds.js';
import { parseNumber } from './utils/parseNumber.js';
export class Config extends BaseConfig {
  agentApiClientConfig: AgentApiClientConfig;

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      AGENT_API_BASE: agentApiBase,
      AGENT_API_AUTH_TOKEN: agentApiAuthToken,
      AGENT_API_POLL_INTERVAL_MS: agentApiPollIntervalMs,
    } = cleansedVars;

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }

    this.agentApiClientConfig = {
      agentApiBase: agentApiBase ?? 'http://127.0.0.1:8765/api/v1',
      authToken: agentApiAuthToken ?? '',
      commandTimeoutMs: this.maxRequestTimeoutMs,
      pollIntervalMs: parseNumber(agentApiPollIntervalMs, {
        defaultValue: milliseconds.fromSeconds(1),
        minValue: milliseconds.fromSeconds(1),
        maxValue: milliseconds.fromSeconds(10),
      }),
    };
  }
}

export const getDesktopConfig = (): Config => new Config();
