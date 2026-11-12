import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Tableau Agent tools (CABU dashboard/datasource Q&A: `cabu-start-conversation`, `cabu-ask`) are
 * demo/experimental and off by default. They follow `TABLEAU_AGENT_TOOLS_ENABLED` when it is set
 * to `true` or `false`; otherwise they follow the `tableau-agent-tools` feature flag.
 */
export async function isTableauAgentToolsEnabled(
  config: Pick<Config, 'tableauAgentToolsEnabled'>,
): Promise<boolean> {
  return (
    config.tableauAgentToolsEnabled ??
    (await getFeatureGate().isFeatureEnabled('tableau-agent-tools'))
  );
}
