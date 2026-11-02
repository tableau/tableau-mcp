import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/**
 * Knowledge read tools follow `KNOWLEDGE_TOOLS_ENABLED` when it is set to `true` or `false`;
 * otherwise they follow the `knowledge-tools` feature flag.
 */
export async function isKnowledgeToolsEnabled(
  config: Pick<Config, 'knowledgeToolsEnabled'>,
): Promise<boolean> {
  return (
    config.knowledgeToolsEnabled ?? (await getFeatureGate().isFeatureEnabled('knowledge-tools'))
  );
}

/**
 * Knowledge write tools follow `KNOWLEDGE_WRITE_TOOLS_ENABLED` when it is set to `true` or `false`;
 * otherwise they follow the `knowledge-write-tools` feature flag. Callers also require reads.
 */
export async function isKnowledgeWriteToolsEnabled(
  config: Pick<Config, 'knowledgeWriteToolsEnabled'>,
): Promise<boolean> {
  return (
    config.knowledgeWriteToolsEnabled ??
    (await getFeatureGate().isFeatureEnabled('knowledge-write-tools'))
  );
}
