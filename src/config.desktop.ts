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

  /**
   * When true, the desktop server talks to Tableau Desktop's new "External Client API"
   * (Athena V0) loopback host instead of the default Agent API. Gated on
   * `TABLEAU_EXTERNAL_API` (`1` or `true`); DEFAULT is the Agent API path.
   */
  externalApiEnabled: boolean;

  /** Optional override for the External Client API discovery directory. */
  externalApiDiscoveryDir: string | undefined;

  /**
   * Session id (Desktop pid) the launching Tableau Desktop pinned via
   * `TABLEAU_DESKTOP_SESSION_ID`. When set, every session-scoped tool defaults to
   * this instance and `list-instances` is not registered, so the agent never has to
   * discover which Desktop to control. Ignored unless it is a non-blank numeric pid.
   */
  desktopSessionId: string | undefined;

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      AGENT_API_BASE: agentApiBase,
      AGENT_API_AUTH_TOKEN: agentApiAuthToken,
      AGENT_API_POLL_INTERVAL_MS: agentApiPollIntervalMs,
      TOOL_PROFILE: toolProfile,
      INLINE_XML_MAX_BYTES: inlineXmlMaxBytes,
      TABLEAU_EXTERNAL_API: externalApi,
      TABLEAU_EXTERNAL_API_DISCOVERY_DIR: externalApiDiscoveryDir,
      TABLEAU_DESKTOP_SESSION_ID: desktopSessionId,
    } = cleansedVars;

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }

    this.externalApiEnabled = externalApi === '1' || externalApi === 'true';
    this.externalApiDiscoveryDir = externalApiDiscoveryDir || undefined;
    this.desktopSessionId =
      desktopSessionId && /^\d+$/.test(desktopSessionId) ? desktopSessionId : undefined;
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
