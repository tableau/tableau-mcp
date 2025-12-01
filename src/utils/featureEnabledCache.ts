import { ExpiringMap } from './expiringMap.js';
import invariant from './invariant.js';

const TEN_MINUTES_IN_MS = 1000 * 60 * 10;

type FeatureName = 'AuthoringNewWorkbookFromFileUpload';
type MapKey = `${FeatureName}|${string}`;

const featureEnabledCache = new ExpiringMap<MapKey, boolean>({
  expirationTimeMs: TEN_MINUTES_IN_MS,
});

export async function isFeatureEnabled({
  featureName,
  server,
  siteName,
}: {
  featureName: FeatureName;
  server: string;
  siteName: string;
}): Promise<boolean> {
  invariant(server, 'Tableau server is required');
  const key = getMapKey({ featureName, server });
  let enabled = featureEnabledCache.get(key);
  if (enabled !== undefined) {
    return enabled;
  }

  enabled = await _isFeatureEnabled({ featureName, server, siteName });
  featureEnabledCache.set(key, enabled);
  return enabled;
}

async function _isFeatureEnabled({
  featureName,
  server,
  siteName,
}: {
  featureName: FeatureName;
  server: string;
  siteName: string;
}): Promise<boolean> {
  try {
    switch (featureName) {
      case 'AuthoringNewWorkbookFromFileUpload': {
        const response = await fetch(
          `${server}/vizql/show${siteName ? `/t/${siteName}` : ''}/authoring/newWorkbook/testWorkbookId/fromFileUpload/testFileUploadId`,
        );

        if (response.status === 404) {
          return false;
        }

        // Assume a non-404 means the feature is enabled, even for error responses.
        // This is a best-effort approach to determine if the feature is enabled, and may not be 100% accurate.
        return true;
      }
    }
  } catch {
    return false;
  }
}

function getMapKey({ featureName, server }: { featureName: FeatureName; server: string }): MapKey {
  return `${featureName}|${server}`;
}
