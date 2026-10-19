import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Flow tools follow `FLOW_TOOLS_ENABLED` when it is set to `true` or `false`; otherwise they follow
 * the `flow-tools` feature flag.
 */
export async function isFlowToolsEnabled(
  config: Pick<Config, 'flowToolsEnabled'>,
): Promise<boolean> {
  return config.flowToolsEnabled ?? (await getFeatureGate().isFeatureEnabled('flow-tools'));
}

/**
 * Flow write tools require the Flow tools, then follow `FLOW_WRITE_TOOLS_ENABLED` when it is set to
 * `true` or `false`; otherwise they follow the `flow-write-tools` feature flag.
 */
export async function isFlowWriteToolsEnabled(
  config: Pick<Config, 'flowToolsEnabled' | 'flowWriteToolsEnabled'>,
): Promise<boolean> {
  return (
    (await isFlowToolsEnabled(config)) &&
    (config.flowWriteToolsEnabled ?? (await getFeatureGate().isFeatureEnabled('flow-write-tools')))
  );
}
