import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { isTableauVersionAtLeast } from '../../utils/isTableauVersionAtLeast.js';
import { queryDatasourceToolDescription20253 } from './descriptions/2025.3.js';
import { queryDatasourceToolDescription } from './descriptions/default.js';

export function getQueryDatasourceToolDescription(productVersion: ProductVersion): string {
  if (isTableauVersionAtLeast({ productVersion, minVersion: '2025.3.0' })) {
    return queryDatasourceToolDescription20253;
  }

  return queryDatasourceToolDescription;
}
