import type { Result } from 'ts-results-es';

import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
  WorkbookDocument,
} from '../externalApi/executorTypes.js';
import { parseXML } from '../metadata/parser.js';
import {
  colorBaselineUnavailableFinding,
  type ColorMap,
  colorMapVerificationResult,
  colorReadbackUnavailableFinding,
  compareColorMaps,
  extractColorMaps,
  extractWorksheetStyleColorMaps,
  splitWorksheetStyleColorMaps,
  STALE_REASON,
  staleWorksheetStyleFindings,
} from '../validation/colorMapReadback.js';
import type {
  ReadbackVerificationResult,
  VerificationFinding,
} from '../validation/readback-verify.js';
import { pollReadback } from './pollReadback.js';

function describeReadError(error: ExecuteCommandError): string {
  if (error.type === 'command-failed') {
    return error.error?.message ?? error.error?.code ?? 'the document read failed';
  }
  if (error.type === 'command-timed-out') return 'the document read timed out';
  return `the document read failed (${error.type})`;
}

export function decodedId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// A datasource document holds only its own root `<style>`, so every map read from it belongs to
// the datasource that was requested, whatever its root `name` says.
// Live Desktop 0000.26.1012.0832: when a readback holds two encodings for one field, the first is
// the one the chart draws, even though the later copy in the applied document is the intended one.
function readbackMaps(xml: string, datasource: string): ColorMap[] | undefined {
  return extractColorMaps(xml, { winner: 'first' })?.map((map) => ({ ...map, datasource }));
}

function isWorksheetOrWorkbook(xml: string): boolean {
  try {
    const root = parseXML(xml) as Record<string, unknown>;
    return root.worksheet !== undefined || root.workbook !== undefined;
  } catch {
    return false;
  }
}

function groupByDatasource(maps: readonly ColorMap[]): Map<string, ColorMap[]> {
  const grouped = new Map<string, ColorMap[]>();
  for (const map of maps) {
    grouped.set(map.datasource, [...(grouped.get(map.datasource) ?? []), map]);
  }
  return grouped;
}

/**
 * The live XML to diff worksheet-style colors against, read before the apply. Reads only when the
 * payload carries such colors; a failed read means no baseline (warnings only, never an error).
 */
export async function readColorBaseline({
  appliedXml,
  read,
}: {
  appliedXml: string;
  read: () => Promise<Result<string, unknown>>;
}): Promise<string | undefined> {
  if (extractWorksheetStyleColorMaps(appliedXml).length === 0) return undefined;
  let xml: string | undefined;
  try {
    xml = (await read()).unwrapOr(undefined);
  } catch {
    return undefined;
  }
  // An unparseable baseline would read as an empty one and fail every member.
  return xml !== undefined && isWorksheetOrWorkbook(xml) ? xml : undefined;
}

/**
 * Read each owning datasource document back after a raw-XML apply and check that the requested
 * categorical member colors survived. Returns `undefined`, with no Desktop call, when the applied
 * XML carries no color map. Read failures become warning findings, so the result never errors.
 * Takes no lock itself, so callers may run it inside or after `withApplyLock`.
 */
export async function readColorMapsBack({
  appliedXml,
  baselineXml,
  datasourceId,
  workbookApply = false,
  executor,
  signal,
}: {
  appliedXml: string;
  /**
   * The sheet's (or workbook's) live XML from just before the apply. Worksheet-style members it
   * already holds are stale and only warn; without it every worksheet-style member is stale.
   */
  baselineXml?: string;
  /** Inventory id of the applied datasource; omit to resolve each map's datasource by name. */
  datasourceId?: string;
  /** apply-workbook cannot replace a datasource map that already exists; the failure says so. */
  workbookApply?: boolean;
} & WithExecutorAndAbortSignal): Promise<ReadbackVerificationResult | undefined> {
  const datasourceMaps = extractColorMaps(appliedXml);
  if (datasourceMaps === undefined) return undefined;
  const { authored, stale } = splitWorksheetStyleColorMaps(
    extractWorksheetStyleColorMaps(appliedXml),
    baselineXml === undefined ? undefined : extractWorksheetStyleColorMaps(baselineXml),
  );
  const hasIntended = datasourceMaps.length + authored.length > 0;
  if (!hasIntended && stale.length === 0) return undefined;

  const byDatasource = groupByDatasource(datasourceMaps);
  const authoredByDatasource = groupByDatasource(authored);
  const staleByDatasource = groupByDatasource(stale);
  const names = new Set([
    ...byDatasource.keys(),
    ...authoredByDatasource.keys(),
    ...staleByDatasource.keys(),
  ]);

  const findings: VerificationFinding[] = [];
  let worksheetStylePlacement = false;
  let datasourceColorChanged = false;
  const ids = new Map<string, string>();
  if (datasourceId !== undefined) {
    for (const name of names) ids.set(name, datasourceId);
  } else {
    // Inventory ids are the URL-encoded internal name, which is the XML `name` attribute.
    let failure: string | undefined;
    let datasources: Array<{ id?: string }> = [];
    try {
      const inventory = await executor.listWorkbookDatasources(signal);
      if (inventory.isErr()) failure = describeReadError(inventory.error);
      else datasources = inventory.value.datasources ?? [];
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure !== undefined) {
      const detail = `could not list workbook datasources: ${failure}`;
      for (const name of names) {
        findings.push(colorReadbackUnavailableFinding(name, detail));
      }
    } else {
      for (const name of names) {
        const item = datasources.find(
          (candidate) => typeof candidate.id === 'string' && decodedId(candidate.id) === name,
        );
        if (item?.id === undefined) {
          findings.push(
            colorReadbackUnavailableFinding(
              name,
              'the datasource is not in the workbook inventory',
            ),
          );
        } else {
          ids.set(name, item.id);
        }
      }
    }
  }

  for (const [name, id] of ids) {
    const maps = byDatasource.get(name) ?? [];
    const authoredMaps = authoredByDatasource.get(name) ?? [];
    let polled: Awaited<ReturnType<typeof pollReadback<WorkbookDocument, ExecuteCommandError>>>;
    try {
      polled = await pollReadback({
        read: () => executor.getDatasourceDocument(id, signal),
        settled: (document) => {
          const readback = readbackMaps(document.xml, name);
          return (
            readback === undefined ||
            (compareColorMaps(maps, readback).length === 0 &&
              compareColorMaps(authoredMaps, readback).length === 0)
          );
        },
        signal,
      });
    } catch (error) {
      // The apply already landed: an abort between polls must not turn it into a tool error.
      const detail = error instanceof Error ? error.message : String(error);
      findings.push(
        colorReadbackUnavailableFinding(name, `the readback was interrupted (${detail})`),
      );
      continue;
    }
    if (!polled.ok) {
      findings.push(colorReadbackUnavailableFinding(name, describeReadError(polled.error)));
      continue;
    }
    const readback = readbackMaps(polled.value.xml, name);
    if (readback === undefined) {
      findings.push(
        colorReadbackUnavailableFinding(name, 'the datasource document could not be parsed'),
      );
      continue;
    }
    // Authored sheet-level maps are compared on their own: merged with a datasource map that
    // already holds the default palette, they would pass on the datasource color.
    const datasourceFindings = compareColorMaps(maps, readback);
    const authoredFindings = compareColorMaps(authoredMaps, readback);
    if (datasourceFindings.some((finding) => finding.reason === 'color-mismatch')) {
      datasourceColorChanged = true;
    }
    if (authoredFindings.length > 0) worksheetStylePlacement = true;
    const seen = new Set<string>();
    for (const finding of [
      ...datasourceFindings,
      ...authoredFindings,
      ...staleWorksheetStyleFindings(staleByDatasource.get(name) ?? [], readback),
    ]) {
      if (seen.has(finding.message)) continue;
      seen.add(finding.message);
      findings.push(finding);
    }
  }
  if (baselineXml === undefined && findings.some((finding) => finding.reason === STALE_REASON)) {
    findings.push(colorBaselineUnavailableFinding());
  }

  return colorMapVerificationResult(findings, appliedXml, {
    hasIntended,
    worksheetStylePlacement,
    existingMapNotReplaced: workbookApply && datasourceColorChanged,
  });
}
