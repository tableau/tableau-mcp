import { BaseConfig, removeClaudeMcpBundleUserConfigTemplates } from './config.shared.js';
import { AgentApiClientConfig } from './desktop/getAgentApiClient.js';
import { DEFAULT_INLINE_XML_MAX_BYTES } from './desktop/inlineXmlCap.js';
import { milliseconds } from './utils/milliseconds.js';
import { parseNumber } from './utils/parseNumber.js';

export class Config extends BaseConfig {
  agentApiClientConfig: AgentApiClientConfig;
  /**
   * Which set of desktop tools to register (W60 spike lever 1 / preamble P1). Normalized
   * (trim + lowercase). '' (unset) or 'full' registers the full set; 'demo' registers the
   * slim fast-path + escalation-fallback set; any other value falls back to full with a
   * logged warning. Slimming the registered surface cuts per-turn schema tokens/latency.
   */
  toolProfile: string;
  /**
   * Server-enforced ceiling (bytes) on inline workbook/worksheet/dashboard XML in a tool
   * result. Over this, the get-*-xml tools respond in file mode regardless of the requested
   * mode, keeping large XML out of the conversation. Env-overridable via INLINE_XML_MAX_BYTES.
   */
  inlineXmlMaxBytes: number;

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      AGENT_API_BASE: agentApiBase,
      AGENT_API_AUTH_TOKEN: agentApiAuthToken,
      AGENT_API_POLL_INTERVAL_MS: agentApiPollIntervalMs,
      TOOL_PROFILE: toolProfile,
      INLINE_XML_MAX_BYTES: inlineXmlMaxBytes,
    } = cleansedVars;

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }

    this.toolProfile = (toolProfile ?? '').trim().toLowerCase();

    this.inlineXmlMaxBytes = parseNumber(inlineXmlMaxBytes, {
      defaultValue: DEFAULT_INLINE_XML_MAX_BYTES,
      minValue: 1,
    });

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
