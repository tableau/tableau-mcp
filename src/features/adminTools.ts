import { Config } from '../config.js';
import { getFeatureGate } from './init.js';

/** Admin tools are enabled when either `ADMIN_TOOLS_ENABLED=true` or the `admin-tools` feature flag is set. */
export async function isAdminToolsEnabled(
  config: Pick<Config, 'adminToolsEnabled'>,
): Promise<boolean> {
  return config.adminToolsEnabled || (await getFeatureGate().isFeatureEnabled('admin-tools'));
}
