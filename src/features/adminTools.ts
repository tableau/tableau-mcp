import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/** Admin tools require both `ADMIN_TOOLS_ENABLED=true` and the `admin-tools` feature flag. */
export async function isAdminToolsEnabled(
  config: Pick<Config, 'adminToolsEnabled'>,
): Promise<boolean> {
  return config.adminToolsEnabled || (await getFeatureGate().isFeatureEnabled('admin-tools'));
}
