import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ContentNotStaleError,
  McpToolError,
  StalenessUnverifiedError,
} from '../../../errors/mcpToolError.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { executeAdminInsightsQuery } from '../adminInsights/adminInsightsToolBase.js';
import {
  _buildSiteContentQuery,
  _siteContentRowSchema,
  computeStaleRows,
} from '../adminInsights/getStaleContentReport.js';
import { ADMIN_INSIGHTS_DATASETS } from '../adminInsights/resolver.js';

/**
 * Staleness precondition for delete-content workbook/datasource deletes (W-24311035).
 *
 * Re-evaluates the item against the SAME source and rule that define "stale" for the Stale Content
 * Cleanup feature: Admin Insights *Site Content* `Last Accessed At` (falling back to `Created At`
 * for never-accessed content), stale when `daysSinceLastUse > minAgeDays` (reusing
 * computeStaleRows). On top of that, an ACTIVITY check blocks the delete when the item was accessed
 * on or after the cleanup batch's date — the batch was assessed before that use, so its decision is
 * out of date.
 *
 * Fails CLOSED: when the check cannot be evaluated (Admin Insights unavailable, the Site Content
 * schema lacks `Item LUID`, or the item is not in the extract yet) it returns
 * StalenessUnverifiedError — missing data never authorizes a deletion.
 *
 * Known limitation: Site Content refreshes roughly daily, so access within the last ~24 hours may
 * not be visible yet.
 */
export async function checkContentStillStale({
  restApi,
  resourceType,
  resourceId,
  minAgeDays,
  cleanupDate,
  now = new Date(),
}: {
  restApi: RestApi;
  resourceType: 'workbook' | 'datasource';
  resourceId: string;
  minAgeDays: number;
  cleanupDate: string;
  now?: Date;
}): Promise<Result<void, McpToolError>> {
  const itemType = resourceType === 'workbook' ? 'Workbook' : 'Datasource';
  const label = resourceType === 'workbook' ? 'workbook' : 'data source';
  const undo =
    'If it should be kept, clear its marker with delete-content ' +
    `(action: "remove-pending-tags", resourceType: "${resourceType}", resourceIds: ["${resourceId}"]).`;

  const query: Query = {
    fields: _buildSiteContentQuery([itemType], null).fields,
    filters: [
      {
        field: { fieldCaption: 'Item Type' },
        filterType: 'SET',
        values: [itemType],
        exclude: false,
      },
      {
        field: { fieldCaption: 'Item LUID' },
        filterType: 'SET',
        values: [resourceId],
        exclude: false,
      },
    ],
  };

  const queryResult = await executeAdminInsightsQuery({
    restApi,
    datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
    query,
  });
  if (queryResult.isErr()) {
    return new StalenessUnverifiedError(
      `Deletion blocked: could not verify that ${label} ${resourceId} is still stale because the ` +
        `Admin Insights Site Content data could not be queried (${queryResult.error.message}). ` +
        'Deleting workbooks and data sources requires Admin Insights (Tableau Cloud).',
    ).toErr();
  }

  const parsed = z.array(_siteContentRowSchema).safeParse(queryResult.value.data ?? []);
  const rows = parsed.success ? parsed.data.filter((row) => row['Item LUID'] === resourceId) : [];
  if (rows.length === 0) {
    return new StalenessUnverifiedError(
      `Deletion blocked: ${label} ${resourceId} was not found in Admin Insights Site Content, so ` +
        'its current staleness cannot be verified. Recently created or renamed content may take ' +
        'about a day to appear.',
    ).toErr();
  }

  // computeStaleRows also drops rows it cannot classify (no Item ID/Name, Admin Insights project).
  // Those are unverifiable rather than "recently used", so report them as such.
  if (rows.some((row) => !row['Item ID'] || !row['Item Name'])) {
    return new StalenessUnverifiedError(
      `Deletion blocked: the Admin Insights Site Content row for ${label} ${resourceId} is ` +
        'incomplete, so its current staleness cannot be verified.',
    ).toErr();
  }

  // Every matching row must qualify (conservative if the extract ever carries duplicates).
  const staleRows = computeStaleRows({ universe: rows, thresholdDays: minAgeDays, today: now });
  if (staleRows.length < rows.length) {
    const lastUsed = rows
      .map((row) => row['Last Accessed At'] ?? row['Created At'])
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1);
    return new ContentNotStaleError(
      `Deletion blocked: ${label} ${resourceId} no longer meets the stale-content criteria ` +
        `(last used ${lastUsed ? lastUsed.slice(0, 10) : 'at an unknown date'}; threshold ` +
        `${minAgeDays} days). ${undo}`,
    ).toErr();
  }

  const batchStartMs = Date.parse(`${cleanupDate}T00:00:00Z`);
  const accessedSinceBatch = rows
    .map((row) => row['Last Accessed At'])
    .filter((value): value is string => typeof value === 'string')
    .find((value) => parseUtc(value) >= batchStartMs);
  if (accessedSinceBatch) {
    return new ContentNotStaleError(
      `Deletion blocked: ${label} ${resourceId} was accessed on ${accessedSinceBatch.slice(0, 10)}, ` +
        `on or after its cleanup batch date ${cleanupDate}, so that batch's assessment is out of ` +
        `date. ${undo}`,
    ).toErr();
  }

  return Ok.EMPTY;
}

// Admin Insights timestamps are UTC; treat an offset-less value as UTC rather than host-local time.
function parseUtc(value: string): number {
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}
