import { ExpiringMap } from './expiringMap.js';

const TEN_MINUTES_IN_MS = 1000 * 60 * 10;

type FeatureName = 'AuthoringNewWorkbookFromFileUpload';
type MapKey = `${FeatureName}|${string}`;

const featureEnabledCache = new ExpiringMap<MapKey, boolean>({
  expirationTimeMs: TEN_MINUTES_IN_MS,
});

export async function isFeatureEnabled({
  featureName,
  server,
}: {
  featureName: FeatureName;
  server: string;
}): Promise<boolean> {
  const key = getMapKey({ featureName, server });
  let enabled = featureEnabledCache.get(key);
  if (enabled !== undefined) {
    return enabled;
  }

  enabled = await _isFeatureEnabled({ featureName, server });
  featureEnabledCache.set(key, enabled);
  return enabled;
}

async function _isFeatureEnabled({
  featureName,
  server,
}: {
  featureName: FeatureName;
  server: string;
}): Promise<boolean> {
  try {
    switch (featureName) {
      case 'AuthoringNewWorkbookFromFileUpload': {
        const response = await fetch(
          `${server}/vizql/show/authoring/newWorkbook/testWorkbookId/fromFileUpload/testFileUploadId`,
        );
        return response.ok;
      }
    }
  } catch {
    return false;
  }
}

function getMapKey({ featureName, server }: { featureName: FeatureName; server: string }): MapKey {
  return `${featureName}|${server}`;
}
