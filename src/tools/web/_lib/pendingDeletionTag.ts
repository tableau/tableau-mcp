import { z } from 'zod';

import { CleanupBatchExpiredError } from '../../../errors/mcpToolError.js';

/**
 * Pending-deletion marker vocabulary (W-24311035).
 *
 * A delete-content preview marks a workbook/datasource with a date-stamped tag in the EXACT format
 * `pending-deletion-YYYY-MM-DD`, where the date is the UTC cleanup date of the preview (no time
 * suffix). The date is the cleanup-batch identity: a confirm accepts only the marker of the batch it
 * names, so a marker left by an earlier, abandoned preview cannot silently authorize a later batch.
 *
 * The undated `pending-deletion` label written by earlier versions is recognized as LEGACY so the
 * list tools and the remove action can find and clear it, but it is never accepted as confirm evidence.
 *
 * A batch also EXPIRES: a confirm naming a batch older than PENDING_DELETION_MAX_AGE_DAYS is
 * rejected, so a marker orphaned by a crashed or abandoned preview stops authorizing deletes on its
 * own, even if nobody cleans it up.
 */
export const PENDING_DELETION_TAG_PREFIX = 'pending-deletion';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CLEANUP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MARKER_PATTERN = /^pending-deletion(?:-(\d{4}-\d{2}-\d{2}))?$/;

export type PendingDeletionMarker =
  | { tag: string; kind: 'dated'; cleanupDate: string }
  | { tag: string; kind: 'legacy'; cleanupDate: null };

/** The UTC calendar date of `now` as YYYY-MM-DD — the cleanup date a preview stamps. */
export function getUtcCleanupDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The marker label for a cleanup batch, e.g. `pending-deletion-2026-09-25`. */
export function formatPendingDeletionTag(cleanupDate: string): string {
  return `${PENDING_DELETION_TAG_PREFIX}-${cleanupDate}`;
}

/** True when `value` is a YYYY-MM-DD string naming a real calendar date (rejects 2026-02-30). */
export function isValidCleanupDate(value: string): boolean {
  if (!CLEANUP_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && getUtcCleanupDate(parsed) === value;
}

/**
 * Parses a tag label into a pending-deletion marker, or null when the label is not one. Labels with
 * a malformed date (e.g. `pending-deletion-2026-13-01`) are NOT markers.
 */
export function parsePendingDeletionTag(label: string): PendingDeletionMarker | null {
  const match = label.match(MARKER_PATTERN);
  if (!match) {
    return null;
  }
  const cleanupDate = match[1];
  if (cleanupDate === undefined) {
    return { tag: label, kind: 'legacy', cleanupDate: null };
  }
  return isValidCleanupDate(cleanupDate) ? { tag: label, kind: 'dated', cleanupDate } : null;
}

/** All pending-deletion markers among a resource's tags (REST `tags.tag[]` shape). */
export function getPendingDeletionMarkers(
  tags: { tag?: Array<{ label: string }> } | undefined,
): PendingDeletionMarker[] {
  return (tags?.tag ?? [])
    .map((t) => parsePendingDeletionTag(t.label))
    .filter((m): m is PendingDeletionMarker => m !== null);
}

/**
 * Zod schema for a `cleanupDate` tool argument: a real YYYY-MM-DD calendar date that is not in the
 * future (UTC). Rejecting future dates stops a caller from pre-staging evidence for a later batch.
 */
export const cleanupDateSchema = z
  .string()
  .refine(isValidCleanupDate, 'cleanupDate must be a valid date in the format YYYY-MM-DD')
  .refine(
    (value) => value <= getUtcCleanupDate(),
    'cleanupDate must not be in the future (dates are UTC)',
  );

/** Whole UTC calendar days from `cleanupDate` to today (0 for a batch opened today). */
export function getCleanupBatchAgeDays(cleanupDate: string, now: Date = new Date()): number {
  const today = Date.parse(`${getUtcCleanupDate(now)}T00:00:00Z`);
  return Math.round((today - Date.parse(`${cleanupDate}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Rejects a confirm whose cleanup batch is older than `maxAgeDays`. Returns the error to surface, or
 * null when the batch is still within the window. The marker is NOT removed: expiry only stops it
 * authorizing a delete; clearing it stays an explicit delete-content action "remove-pending-tags" call.
 */
export function checkCleanupBatchAge({
  cleanupDate,
  maxAgeDays,
  now = new Date(),
}: {
  cleanupDate: string;
  maxAgeDays: number;
  now?: Date;
}): CleanupBatchExpiredError | null {
  const ageDays = getCleanupBatchAgeDays(cleanupDate, now);
  if (ageDays <= maxAgeDays) {
    return null;
  }
  return new CleanupBatchExpiredError(
    `Cleanup batch ${cleanupDate} is ${ageDays} days old, past the ${maxAgeDays}-day limit ` +
      `(PENDING_DELETION_MAX_AGE_DAYS), so its ${formatPendingDeletionTag(cleanupDate)} marker can ` +
      'no longer authorize a delete. Nothing was deleted. Run a new delete-content preview to open ' +
      "today's batch, and clear the expired marker with delete-content action " +
      '"remove-pending-tags".',
  );
}
