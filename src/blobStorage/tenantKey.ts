import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../errors/mcpToolError.js';

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
 * Returns the caller's site and user LUIDs for tenant-scoping blob storage keys. Must be called
 * after `useRestApi` has run so PAT/UAT/direct-trust sessions reflect the signed-in identity.
 * Returns an error (fail closed) rather than producing an unscoped key.
 */
export function getTenantLuids(extra: TenantIdentitySource): Result<TenantLuids, UnknownError> {
  const siteLuid = extra.getSiteLuid();
  const userLuid = extra.getUserLuid();
  if (!isValidTenantLuids(siteLuid, userLuid)) {
    return new UnknownError(
      'Unable to determine the signed-in Tableau site and user for blob storage.',
    ).toErr();
  }
  return new Ok({ siteLuid, userLuid });
}

/**
 * Scopes a logical blob key under `<siteLuid>/<userLuid>/` so objects from different tenants never
 * share a key path. Callers pass LUIDs already validated by {@link getTenantLuids}; an invalid LUID
 * here is a programming error and throws.
 */
export function buildTenantBlobKey({ siteLuid, userLuid }: TenantLuids, key: string): string {
  if (!isValidTenantLuids(siteLuid, userLuid)) {
    throw new Error('Invalid tenant LUIDs for blob storage key.');
  }
  return `${siteLuid}/${userLuid}/${key}`;
}
