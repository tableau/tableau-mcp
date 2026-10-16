import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
  WorkbookDocument,
} from '../externalApi/executorTypes.js';
import {
  type ColorMap,
  colorMapVerificationResult,
  colorReadbackUnavailableFinding,
  compareColorMaps,
  extractColorMaps,
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

function decodedId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// A datasource document holds only its own root `<style>`, so every map read from it belongs to
// the datasource that was requested, whatever its root `name` says.
function readbackMaps(xml: string, datasource: string): ColorMap[] | undefined {
  return extractColorMaps(xml)?.map((map) => ({ ...map, datasource }));
}

/**
 * Read each owning datasource document back after a raw-XML apply and check that the requested
 * categorical member colors survived. Returns `undefined`, with no Desktop call, when the applied
 * XML carries no color map. Read failures become warning findings, so the result never errors.
 * Must run after the apply lock is released.
 */
export async function readColorMapsBack({
  appliedXml,
  datasourceId,
  executor,
  signal,
}: {
  appliedXml: string;
  /** Inventory id of the applied datasource; omit to resolve each map's datasource by name. */
  datasourceId?: string;
} & WithExecutorAndAbortSignal): Promise<ReadbackVerificationResult | undefined> {
  const intended = extractColorMaps(appliedXml);
  if (intended === undefined || intended.length === 0) {
    return undefined;
  }

  const byDatasource = new Map<string, ColorMap[]>();
  for (const map of intended) {
    byDatasource.set(map.datasource, [...(byDatasource.get(map.datasource) ?? []), map]);
  }

  const findings: VerificationFinding[] = [];
  const ids = new Map<string, string>();
  if (datasourceId !== undefined) {
    for (const name of byDatasource.keys()) ids.set(name, datasourceId);
  } else {
    // Inventory ids are the URL-encoded internal name, which is the XML `name` attribute.
    const inventory = await executor.listWorkbookDatasources(signal);
    if (inventory.isErr()) {
      const detail = `could not list workbook datasources: ${describeReadError(inventory.error)}`;
      for (const name of byDatasource.keys()) {
        findings.push(colorReadbackUnavailableFinding(name, detail));
      }
    } else {
      for (const name of byDatasource.keys()) {
        const item = (inventory.value.datasources ?? []).find(
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
    let polled: Awaited<ReturnType<typeof pollReadback<WorkbookDocument, ExecuteCommandError>>>;
    try {
      polled = await pollReadback({
        read: () => executor.getDatasourceDocument(id, signal),
        settled: (document) => {
          const readback = readbackMaps(document.xml, name);
          return readback === undefined || compareColorMaps(maps, readback).length === 0;
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
    findings.push(...compareColorMaps(maps, readback));
  }

  return colorMapVerificationResult(findings, appliedXml);
}
