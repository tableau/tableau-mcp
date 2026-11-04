import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';

// Data apps are hosted extension packages, which Tableau can only host on 2026.3.0+.
// Below this floor the scaffolded app can never be published, so the tool is not registered.
const DATA_APP_MIN_PRODUCT_VERSION = '2026.3.0';

export function isDataAppVersionSupported(productVersion: ProductVersion): boolean {
  return getResultForTableauVersion({
    productVersion,
    mappings: { [DATA_APP_MIN_PRODUCT_VERSION]: true, default: false },
  });
}
