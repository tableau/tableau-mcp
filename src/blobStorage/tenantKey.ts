import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { TenantUnavailableError } from '../errors/mcpToolError.js';
import { log } from '../logging/logger.js';

export type TenantLuids = { siteLuid: string; userLuid: string };
export type TenantIdentitySource = { getSiteLuid: () => string; getUserLuid: () => string };

// Tenant LUIDs become key path segments, so anything but a UUID (e.g. `../`) is rejected.
const tenantLuidSchema = z.string().uuid();

function isValidTenantLuids(siteLuid: string, userLuid: string): boolean {
  return (
    tenantLuidSchema.safeParse(siteLuid).success && tenantLuidSchema.safeParse(userLuid).success
  );
}

/**
 * Returns the caller's site and user LUIDs for tenant-scoping blob storage keys.
 * PAT/UAT/direct-trust sessions only have them after `useRestApi` has signed in.
 * Returns an error (fail closed) rather than producing an unscoped key.
 */
export function getTenantLuids(
  extra: TenantIdentitySource,
): Result<TenantLuids, TenantUnavailableError> {
  const siteLuid = extra.getSiteLuid();
  const userLuid = extra.getUserLuid();
  if (!isValidTenantLuids(siteLuid, userLuid)) {
    // The offending values are on the log line's site_luid/user_luid fields.
    log(
      {
        message: 'Session site/user LUID is missing or not a UUID; refusing to build a blob key.',
        level: 'error',
        logger: 'tool',
      },
      extra,
    );
    return new TenantUnavailableError().toErr();
  }
  return new Ok({ siteLuid, userLuid });
}

// The folder leads the key so prefix-based S3 lifecycle and malware-scan rules can target it.
const blobFolderSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * Builds `<folder>/<siteLuid>/<userLuid>/<rest>` so objects from different tenants never share a key
 * path. Callers pass LUIDs already validated by {@link getTenantLuids}; an invalid LUID or folder
 * here is a programming error and throws.
 */
export function buildTenantBlobKey(
  { siteLuid, userLuid }: TenantLuids,
  folder: string,
  rest: string,
): string {
  if (!isValidTenantLuids(siteLuid, userLuid)) {
    throw new Error('Invalid tenant LUIDs for blob storage key.');
  }
  if (!blobFolderSchema.safeParse(folder).success) {
    throw new Error('Invalid folder for blob storage key.');
  }
  return `${folder}/${siteLuid}/${userLuid}/${rest}`;
}
