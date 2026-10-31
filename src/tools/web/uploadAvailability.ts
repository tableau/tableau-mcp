import { isAuthoringAllowedForClient } from '../../features/authoringAccess.js';
import { getFeatureGate } from '../../features/init.js';

// Single source for whether publish-workbook / publish-datasource (the upload consumers) are
// available; shared by their `disabled` checks and request-upload's allow-list.
export async function isWorkbookPublishAvailable(clientId?: string): Promise<boolean> {
  return await isAuthoringAllowedForClient(clientId);
}

export async function isDatasourcePublishAvailable(clientId?: string): Promise<boolean> {
  return (
    (await isAuthoringAllowedForClient(clientId)) &&
    (await getFeatureGate().isFeatureEnabled('datasource-authoring'))
  );
}
