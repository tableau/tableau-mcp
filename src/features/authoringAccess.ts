import { isSlackClient } from '../telemetry/clientDisplayName.js';
import { getFeatureGate } from './init.js';

/** Slack clients may use authoring tools only when `authoring-with-slack` is enabled. */
export async function isAuthoringAllowedForClient(clientId?: string): Promise<boolean> {
  return (
    (await getFeatureGate().isFeatureEnabled('authoring-with-slack')) || !isSlackClient(clientId)
  );
}
