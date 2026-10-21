import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Flow read tools follow `FLOW_READ_TOOLS_ENABLED` when it is set to `true` or `false`; otherwise
 * they follow the `flow-read-tools` feature flag.
 */
export async function isFlowReadToolsEnabled(
  config: Pick<Config, 'flowReadToolsEnabled'>,
): Promise<boolean> {
  return (
    config.flowReadToolsEnabled ?? (await getFeatureGate().isFeatureEnabled('flow-read-tools'))
  );
}

/**
 * Flow write tools follow `FLOW_WRITE_TOOLS_ENABLED` when it is set to `true` or `false`; otherwise
 * they follow the `flow-write-tools` feature flag.
 */
export async function isFlowWriteToolsEnabled(
  config: Pick<Config, 'flowWriteToolsEnabled'>,
): Promise<boolean> {
  return (
    config.flowWriteToolsEnabled ?? (await getFeatureGate().isFeatureEnabled('flow-write-tools'))
  );
}
