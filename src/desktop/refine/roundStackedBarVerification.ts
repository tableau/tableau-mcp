import { isDeepStrictEqual } from 'node:util';

import { DOMParser } from '@xmldom/xmldom';

import {
  formattedTextOwnerSemanticText,
  planRoundStackedBar,
  type RoundStackedBarHelperRole,
  type RoundStackedBarSemanticContract,
} from './roundStackedBar.js';

export type RoundStackedBarFindingCode =
  | 'xml-parse'
  | 'worksheet-identity'
  | 'worksheet-content'
  | 'workbook-identity'
  | 'action'
  | 'summary-columns'
  | 'summary-groups'
  | 'seed-evidence'
  | 'frame-domain'
  | 'path-domain'
  | 'segment-value'
  | 'stack-gap-or-overlap'
  | 'stack-order'
  | 'outer-tip'
  | 'internal-join'
  | 'helper-definition'
  | 'helper-visibility'
  | 'filter';

export interface RoundStackedBarFinding {
  code: RoundStackedBarFindingCode;
  message: string;
}

export interface RoundStackedBarVerification {
  ok: boolean;
  findings: RoundStackedBarFinding[];
}

export interface TabularData {
  worksheet?: { id?: string };
  columns: readonly unknown[];
  rows: readonly (readonly unknown[])[];
}

type FieldSemantics = RoundStackedBarSemanticContract['category'];

export interface RoundStackedBarGroup {
  category: string;
  segment?: string;
  value: number;
}

export interface RoundStackedBarBaseline {
  worksheetId: string;
  groups: readonly RoundStackedBarGroup[];
  segmentOrderFromZero: readonly string[];
  expectedVertexRows: number;
  categoryVisualOrder: 'live-only';
}

type BaselineResult =
  | { ok: true; baseline: RoundStackedBarBaseline }
  | { ok: false; reason: string };

interface ParsedPoint {
  frame: number;
  path: number;
  band: number;
  value: number;
}

interface ParsedInterval {
  category: string;
  segment?: string;
  sign: number;
  low: number;
  high: number;
  topRounded: boolean;
  topSquare: boolean;
  bottomRounded: boolean;
  bottomSquare: boolean;
}

type HelperRole = Extract<RoundStackedBarHelperRole, 'bin' | 'path' | 'x' | 'y'>;

const MAX_GROUPS = 83;
const VERTICES_PER_GROUP = 12;
const ABSOLUTE_TOLERANCE = 1e-6;
const RELATIVE_TOLERANCE = 1e-8;
// Rounded-tip detection must scale with the tip's own radius: the generated Y radius is
// min(|value|/2, 0.02*span), which for tiny values falls below ABSOLUTE_TOLERANCE while still
// producing a real rounded tip. A fraction of the expected radius stays well under the smallest
// rounded-point offset (0.292893*r) and well above float noise.
const ROUNDED_TIP_TOLERANCE_RATIO = 0.1;

function result(findings: RoundStackedBarFinding[]): RoundStackedBarVerification {
  return { ok: findings.length === 0, findings };
}

function addFinding(
  findings: RoundStackedBarFinding[],
  code: RoundStackedBarFindingCode,
  message: string,
): void {
  if (!findings.some((finding) => finding.code === code && finding.message === message)) {
    findings.push({ code, message });
  }
}

function unbracket(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function columnName(column: unknown): string {
  if (typeof column === 'string') return column;
  if (column && typeof column === 'object') {
    const candidate = column as { caption?: unknown; name?: unknown };
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.caption === 'string') return candidate.caption;
  }
  return '';
}

function normalizedLabel(value: string): string {
  let normalized = value.trim();
  let wrapper = normalized.match(/^(?:AGG|SUM)\((.*)\)$/i);
  while (wrapper) {
    normalized = wrapper[1].trim();
    wrapper = normalized.match(/^(?:AGG|SUM)\((.*)\)$/i);
  }
  const qualified = normalized.match(/^\[([^\]]+)\]\.\[([^\]]+)\]$/);
  if (qualified) {
    return `[${qualified[1].normalize('NFKC').toLocaleLowerCase('en-US')}].[${qualified[2]
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')}]`;
  }
  return unbracket(normalized).normalize('NFKC').toLocaleLowerCase('en-US');
}

function fieldAliases(field: FieldSemantics): string[] {
  return [field.caption, field.column, field.columnInstance].map(normalizedLabel);
}

function underlyingFieldAliases(
  contract: RoundStackedBarSemanticContract,
  field: Pick<FieldSemantics, 'caption' | 'column'>,
): string[] {
  const rawColumn = field.column || `[${field.caption}]`;
  return [
    field.caption,
    rawColumn,
    `[${contract.datasource.caption}].${rawColumn}`,
    `[${contract.datasource.internalName}].${rawColumn}`,
  ];
}

function resolveColumn(
  columns: readonly unknown[],
  aliases: readonly string[],
): { ok: true; index: number } | { ok: false; reason: string } {
  const wanted = new Set(aliases.map(normalizedLabel));
  const matches = columns
    .map((column, index) => ({ index, name: normalizedLabel(columnName(column)) }))
    .filter(({ name }) => wanted.has(name));
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: `expected exactly one summary column matching ${aliases.join(', ')}; found ${matches.length}.`,
    };
  }
  return { ok: true, index: matches[0].index };
}

function groupKey(category: string, segment?: string): string {
  return JSON.stringify(segment === undefined ? [category] : [category, segment]);
}

function groupLabel(category: string, segment?: string): string {
  return segment === undefined ? category : `${category} / ${segment}`;
}

function scalarMemberText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function finiteNumericCell(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function naturalCompare(left: string, right: string): number {
  const compared = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare(
    left,
    right,
  );
  return compared === 0 ? left.localeCompare(right, 'en') : compared;
}

function near(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Math.max(ABSOLUTE_TOLERANCE, Math.max(Math.abs(left), Math.abs(right)) * RELATIVE_TOLERANCE)
  );
}

export function captureRoundStackedBarBaseline(
  summary: TabularData,
  contract: RoundStackedBarSemanticContract,
): BaselineResult {
  if (summary.worksheet?.id !== contract.worksheetId) {
    return {
      ok: false,
      reason: 'Summary worksheet identity does not match the planned worksheet.',
    };
  }

  const category = resolveColumn(summary.columns, fieldAliases(contract.category));
  const segment = contract.segment
    ? resolveColumn(summary.columns, fieldAliases(contract.segment))
    : undefined;
  const measure = resolveColumn(summary.columns, [
    ...fieldAliases(contract.measure),
    `${contract.measure.aggregation}(${contract.measure.caption})`,
  ]);
  if (!category.ok || (segment && !segment.ok) || !measure.ok) {
    return {
      ok: false,
      reason: [category, segment, measure]
        .flatMap((entry) => (entry && !entry.ok ? [entry.reason] : []))
        .join(' '),
    };
  }

  const groups: RoundStackedBarGroup[] = [];
  const seen = new Set<string>();
  for (const row of summary.rows) {
    const categoryValue = row[category.index];
    if (categoryValue === null || categoryValue === undefined) {
      return { ok: false, reason: 'Summary contains a null Category key.' };
    }
    const normalizedCategory = scalarMemberText(categoryValue);
    if (normalizedCategory === null) {
      return { ok: false, reason: 'Summary Category keys must be finite scalar values.' };
    }
    const segmentValue = segment?.ok ? row[segment.index] : undefined;
    if (segment && (segmentValue === null || segmentValue === undefined)) {
      return { ok: false, reason: 'Summary contains a null Segment key.' };
    }
    const normalizedSegment = segment ? scalarMemberText(segmentValue) : null;
    if (segment && normalizedSegment === null) {
      return { ok: false, reason: 'Summary Segment keys must be finite scalar values.' };
    }
    const value = Number(row[measure.index]);
    if (!Number.isFinite(value)) {
      return { ok: false, reason: 'Every visible group must have a finite SUM measure.' };
    }
    if (near(value, 0)) {
      return { ok: false, reason: 'Every visible group must have a nonzero SUM measure.' };
    }
    const key = groupKey(normalizedCategory, normalizedSegment ?? undefined);
    if (seen.has(key)) {
      return { ok: false, reason: `Summary contains duplicate bar group key ${key}.` };
    }
    seen.add(key);
    groups.push({
      category: normalizedCategory,
      value,
      ...(normalizedSegment !== null ? { segment: normalizedSegment } : {}),
    });
  }
  if (groups.length === 0 || groups.length > MAX_GROUPS) {
    return {
      ok: false,
      reason: `Rounded bars require 1–${MAX_GROUPS} visible groups (found ${groups.length}).`,
    };
  }

  const segmentOrderFromZero = contract.segment
    ? [...new Set(groups.map((group) => group.segment!))].sort((left, right) =>
        naturalCompare(right, left),
      )
    : [];
  return {
    ok: true,
    baseline: {
      worksheetId: contract.worksheetId,
      groups,
      segmentOrderFromZero,
      expectedVertexRows: groups.length * VERTICES_PER_GROUP,
      categoryVisualOrder: 'live-only',
    },
  };
}

export function verifyRoundStackedBarSeedEvidence(
  underlying: TabularData,
  baseline: RoundStackedBarBaseline,
  contract: RoundStackedBarSemanticContract,
): RoundStackedBarVerification {
  const findings: RoundStackedBarFinding[] = [];
  const category = resolveColumn(
    underlying.columns,
    underlyingFieldAliases(contract, contract.category),
  );
  const segment = contract.segment
    ? resolveColumn(underlying.columns, underlyingFieldAliases(contract, contract.segment))
    : undefined;
  const measure = resolveColumn(
    underlying.columns,
    underlyingFieldAliases(contract, contract.measure),
  );
  const filter = contract.filter
    ? resolveColumn(
        underlying.columns,
        underlyingFieldAliases(contract, {
          caption: contract.filter.caption,
          column: contract.filter.column,
        }),
      )
    : undefined;
  if (!category.ok || (segment && !segment.ok) || !measure.ok || (filter && !filter.ok)) {
    addFinding(
      findings,
      'seed-evidence',
      `Underlying data does not expose one unambiguous Category, ${contract.segment ? 'Segment, ' : ''}measure, and optional filter column.`,
    );
    return result(findings);
  }

  const visible = new Set(baseline.groups.map((group) => groupKey(group.category, group.segment)));
  const values = new Map<string, Set<number>>();
  for (const row of underlying.rows) {
    if (contract.filter && filter?.ok) {
      const member = scalarMemberText(row[filter.index]);
      if (member === null || member !== contract.filter.member) {
        addFinding(
          findings,
          'filter',
          `Underlying data contains a row outside filter member ${JSON.stringify(contract.filter.member)}.`,
        );
        continue;
      }
    }
    const categoryValue = row[category.index];
    const segmentValue = segment?.ok ? row[segment.index] : undefined;
    const normalizedCategory = scalarMemberText(categoryValue);
    const normalizedSegment = segment ? scalarMemberText(segmentValue) : null;
    if (normalizedCategory === null || (segment !== undefined && normalizedSegment === null)) {
      continue;
    }
    const key = groupKey(normalizedCategory, normalizedSegment ?? undefined);
    if (!visible.has(key)) continue;
    const rawValue = row[measure.index];
    const value =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string' && rawValue.trim() !== ''
          ? Number(rawValue)
          : Number.NaN;
    if (!Number.isFinite(value)) continue;
    const distinct = values.get(key) ?? new Set<number>();
    distinct.add(value);
    values.set(key, distinct);
  }

  for (const group of baseline.groups) {
    const key = groupKey(group.category, group.segment);
    const count = values.get(key)?.size ?? 0;
    if (count < 2) {
      addFinding(
        findings,
        'seed-evidence',
        `${groupLabel(group.category, group.segment)} has ${count} distinct finite raw measure value(s); two are required.`,
      );
    }
  }
  return result(findings);
}

function helperCaption(contract: RoundStackedBarSemanticContract, role: HelperRole): string | null {
  return contract.helpers[role]?.caption ?? null;
}

function verifySummaryColumns(
  summary: TabularData,
  contract: RoundStackedBarSemanticContract,
):
  | {
      ok: true;
      category: number;
      segment?: number;
      frame: number;
      path: number;
      x: number;
      y: number;
    }
  | { ok: false; reason: string } {
  const captions = {
    bin: helperCaption(contract, 'bin'),
    path: helperCaption(contract, 'path'),
    x: helperCaption(contract, 'x'),
    y: helperCaption(contract, 'y'),
  };
  if (Object.values(captions).some((caption) => !caption)) {
    return { ok: false, reason: 'The semantic contract does not identify all geometry helpers.' };
  }
  const resolved = {
    category: resolveColumn(summary.columns, fieldAliases(contract.category)),
    segment: contract.segment
      ? resolveColumn(summary.columns, fieldAliases(contract.segment))
      : undefined,
    frame: resolveColumn(summary.columns, [captions.bin ?? '']),
    path: resolveColumn(summary.columns, [captions.path ?? '']),
    x: resolveColumn(summary.columns, [captions.x ?? '']),
    y: resolveColumn(summary.columns, [captions.y ?? '']),
  };
  if (
    !resolved.category.ok ||
    (resolved.segment && !resolved.segment.ok) ||
    !resolved.frame.ok ||
    !resolved.path.ok ||
    !resolved.x.ok ||
    !resolved.y.ok
  ) {
    return {
      ok: false,
      reason: Object.values(resolved)
        .flatMap((entry) => (entry && !entry.ok ? [entry.reason] : []))
        .join(' '),
    };
  }
  return {
    ok: true,
    category: resolved.category.index,
    ...(resolved.segment?.ok ? { segment: resolved.segment.index } : {}),
    frame: resolved.frame.index,
    path: resolved.path.index,
    x: resolved.x.index,
    y: resolved.y.index,
  };
}

function isTopRounded(points: Map<number, ParsedPoint>, high: number, tolerance: number): boolean {
  const p2 = points.get(2)?.value ?? Number.NaN;
  const p3 = points.get(3)?.value ?? Number.NaN;
  return p2 < high - tolerance && p3 > p2 + tolerance;
}

function isTopSquare(points: Map<number, ParsedPoint>, high: number, tolerance: number): boolean {
  return [2, 3, 4, 5, 6, 7].every(
    (path) => Math.abs((points.get(path)?.value ?? Number.NaN) - high) <= tolerance,
  );
}

function isBottomRounded(
  points: Map<number, ParsedPoint>,
  low: number,
  tolerance: number,
): boolean {
  const p1 = points.get(1)?.value ?? Number.NaN;
  const p9 = points.get(9)?.value ?? Number.NaN;
  return p1 > low + tolerance && p9 > low + tolerance;
}

function isBottomSquare(points: Map<number, ParsedPoint>, low: number, tolerance: number): boolean {
  return [1, 8, 9, 10, 11, 12].every(
    (path) => Math.abs((points.get(path)?.value ?? Number.NaN) - low) <= tolerance,
  );
}

export function verifyRoundStackedBarPostSummary(
  readback: TabularData,
  baseline: RoundStackedBarBaseline,
  contract: RoundStackedBarSemanticContract,
): RoundStackedBarVerification {
  const findings: RoundStackedBarFinding[] = [];
  if (readback.worksheet?.id !== baseline.worksheetId) {
    addFinding(
      findings,
      'worksheet-identity',
      'Post-apply summary came from a different worksheet.',
    );
  }
  const indices = verifySummaryColumns(readback, contract);
  if (!indices.ok) {
    addFinding(findings, 'summary-columns', indices.reason);
    return result(findings);
  }

  const baselineByKey = new Map(
    baseline.groups.map((group) => [groupKey(group.category, group.segment), group]),
  );
  const rowsByKey = new Map<string, ParsedPoint[]>();
  for (const row of readback.rows) {
    const category = scalarMemberText(row[indices.category]);
    const segment = indices.segment === undefined ? null : scalarMemberText(row[indices.segment]);
    if (category === null || (indices.segment !== undefined && segment === null)) {
      addFinding(
        findings,
        'summary-groups',
        'Post-apply summary contains a null or non-scalar bar group key.',
      );
      continue;
    }
    const key = groupKey(category, segment ?? undefined);
    const x = finiteNumericCell(row[indices.x]);
    const y = finiteNumericCell(row[indices.y]);
    const point: ParsedPoint = {
      frame: finiteNumericCell(row[indices.frame]),
      path: finiteNumericCell(row[indices.path]),
      band: contract.orientation === 'vertical' ? x : y,
      value: contract.orientation === 'vertical' ? y : x,
    };
    const points = rowsByKey.get(key) ?? [];
    points.push(point);
    rowsByKey.set(key, points);
  }

  const actualKeys = [...rowsByKey.keys()].sort();
  const expectedKeys = [...baselineByKey.keys()].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    addFinding(
      findings,
      'summary-groups',
      'Post-apply bar group keys do not exactly match the baseline.',
    );
  }
  if (readback.rows.length !== baseline.expectedVertexRows || readback.rows.length > 996) {
    addFinding(
      findings,
      'summary-groups',
      `Expected ${baseline.expectedVertexRows} geometry rows; found ${readback.rows.length}.`,
    );
  }

  const intervals: ParsedInterval[] = [];
  for (const [key, group] of baselineByKey) {
    const points = rowsByKey.get(key) ?? [];
    const frames = points.map((point) => point.frame).sort((left, right) => left - right);
    const paths = points.map((point) => point.path).sort((left, right) => left - right);
    const fullFrames =
      frames.length === VERTICES_PER_GROUP &&
      frames.every((frame, index) => Number.isInteger(frame) && frame === index);
    const fullPaths =
      paths.length === VERTICES_PER_GROUP &&
      paths.every((path, index) => Number.isInteger(path) && path === index + 1);
    if (!fullFrames) {
      addFinding(
        findings,
        'frame-domain',
        `${groupLabel(group.category, group.segment)} lacks frames 0–11 exactly once.`,
      );
    }
    if (!fullPaths || points.some((point) => point.path !== point.frame + 1)) {
      addFinding(
        findings,
        'path-domain',
        `${groupLabel(group.category, group.segment)} lacks paths 1–12 paired to frames.`,
      );
    }
    if (!fullFrames || !fullPaths) continue;
    if (points.some((point) => !Number.isFinite(point.band) || !Number.isFinite(point.value))) {
      addFinding(
        findings,
        'segment-value',
        `${groupLabel(group.category, group.segment)} has non-finite polygon coordinates.`,
      );
      continue;
    }
    if (
      points.some(
        (point) =>
          point.band < -0.35 - ABSOLUTE_TOLERANCE || point.band > 0.35 + ABSOLUTE_TOLERANCE,
      )
    ) {
      addFinding(
        findings,
        'segment-value',
        `${groupLabel(group.category, group.segment)} exceeds the supported X domain.`,
      );
    }

    const byPath = new Map(points.map((point) => [point.path, point]));
    const high = Math.max(byPath.get(4)?.value ?? Number.NaN, byPath.get(5)?.value ?? Number.NaN);
    const low = Math.min(byPath.get(10)?.value ?? Number.NaN, byPath.get(11)?.value ?? Number.NaN);
    if (!near(high - low, Math.abs(group.value))) {
      addFinding(
        findings,
        'segment-value',
        `${groupLabel(group.category, group.segment)} polygon span does not match its baseline value.`,
      );
    }
    const categorySpan = baseline.groups
      .filter((candidate) => candidate.category === group.category)
      .reduce((sum, candidate) => sum + Math.abs(candidate.value), 0);
    const expectedRadius = Math.min(Math.abs(group.value) / 2, 0.02 * categorySpan);
    const roundedTipTolerance = expectedRadius * ROUNDED_TIP_TOLERANCE_RATIO;
    const topRounded = isTopRounded(byPath, high, roundedTipTolerance);
    const bottomRounded = isBottomRounded(byPath, low, roundedTipTolerance);
    const topRadiusX = topRounded ? 0.06 : 0;
    const bottomRadiusX = bottomRounded ? 0.06 : 0;
    const expectedX = [
      -0.35,
      -0.35,
      -0.35 + 0.292893 * topRadiusX,
      -0.35 + topRadiusX,
      0.35 - topRadiusX,
      0.35 - 0.292893 * topRadiusX,
      0.35,
      0.35,
      0.35 - 0.292893 * bottomRadiusX,
      0.35 - bottomRadiusX,
      -0.35 + bottomRadiusX,
      -0.35 + 0.292893 * bottomRadiusX,
    ];
    if (
      expectedX.some(
        (expected, index) => !near(byPath.get(index + 1)?.band ?? Number.NaN, expected),
      )
    ) {
      addFinding(
        findings,
        'segment-value',
        `${groupLabel(group.category, group.segment)} does not use the exact subtle 12-point band geometry.`,
      );
    }
    const sameSignOrder = contract.segment
      ? baseline.segmentOrderFromZero.filter((segment) =>
          baseline.groups.some(
            (candidate) =>
              candidate.category === group.category &&
              candidate.segment === segment &&
              Math.sign(candidate.value) === Math.sign(group.value),
          ),
        )
      : [];
    const outerSegment = sameSignOrder[sameSignOrder.length - 1];
    const expectedTopRadius =
      group.value > 0 && (!contract.segment || group.segment === outerSegment) ? expectedRadius : 0;
    const expectedBottomRadius =
      group.value < 0 && (!contract.segment || group.segment === outerSegment) ? expectedRadius : 0;
    const expectedY = [
      low + expectedBottomRadius,
      high - expectedTopRadius,
      high - 0.292893 * expectedTopRadius,
      high,
      high,
      high - 0.292893 * expectedTopRadius,
      high - expectedTopRadius,
      low + expectedBottomRadius,
      low + 0.292893 * expectedBottomRadius,
      low,
      low,
      low + 0.292893 * expectedBottomRadius,
    ];
    if (
      expectedY.some(
        (expected, index) => !near(byPath.get(index + 1)?.value ?? Number.NaN, expected),
      )
    ) {
      addFinding(
        findings,
        'segment-value',
        `${groupLabel(group.category, group.segment)} does not use the exact subtle 12-point measure geometry.`,
      );
    }
    intervals.push({
      category: group.category,
      segment: group.segment,
      sign: Math.sign(group.value),
      low,
      high,
      topRounded,
      topSquare: isTopSquare(byPath, high, roundedTipTolerance),
      bottomRounded,
      bottomSquare: isBottomSquare(byPath, low, roundedTipTolerance),
    });
  }

  if (!contract.segment) {
    for (const group of baseline.groups) {
      const interval = intervals.find((candidate) => candidate.category === group.category);
      if (!interval) continue;
      const beginsAtZero = near(group.value > 0 ? interval.low : interval.high, 0);
      if (!beginsAtZero) {
        addFinding(
          findings,
          'segment-value',
          `${group.category} simple bar does not begin at zero.`,
        );
      }
      const nonzeroTipRounded = group.value > 0 ? interval.topRounded : interval.bottomRounded;
      const zeroTipSquare =
        group.value > 0
          ? interval.bottomSquare && !interval.bottomRounded
          : interval.topSquare && !interval.topRounded;
      if (!nonzeroTipRounded) {
        addFinding(findings, 'outer-tip', `${group.category} nonzero tip is not rounded.`);
      }
      if (!zeroTipSquare) {
        addFinding(findings, 'segment-value', `${group.category} zero tip is not square.`);
      }
    }
    return result(findings);
  }

  for (const category of new Set(baseline.groups.map((group) => group.category))) {
    for (const sign of [1, -1]) {
      const chain = intervals
        .filter((interval) => interval.category === category && interval.sign === sign)
        .sort((left, right) => (sign > 0 ? left.low - right.low : right.high - left.high));
      if (chain.length === 0) continue;
      const expectedOrder = baseline.segmentOrderFromZero.filter((segment) =>
        baseline.groups.some(
          (group) =>
            group.category === category &&
            group.segment === segment &&
            Math.sign(group.value) === sign,
        ),
      );
      if (
        JSON.stringify(chain.map((interval) => interval.segment)) !== JSON.stringify(expectedOrder)
      ) {
        addFinding(
          findings,
          'stack-order',
          `${category} ${sign > 0 ? 'positive' : 'negative'} stack is not reverse-natural from zero outward.`,
        );
      }
      if (!near(sign > 0 ? chain[0].low : chain[0].high, 0)) {
        addFinding(findings, 'stack-gap-or-overlap', `${category} stack does not begin at zero.`);
      }
      for (let index = 1; index < chain.length; index += 1) {
        const previous = chain[index - 1];
        const current = chain[index];
        const touching =
          sign > 0 ? near(previous.high, current.low) : near(previous.low, current.high);
        if (!touching) {
          addFinding(
            findings,
            'stack-gap-or-overlap',
            `${category} stack contains a gap or overlap.`,
          );
        }
      }

      chain.forEach((interval, index) => {
        const outer = index === chain.length - 1;
        if (sign > 0) {
          if (!interval.bottomSquare || interval.bottomRounded || (!outer && !interval.topSquare)) {
            addFinding(
              findings,
              'internal-join',
              `${category} positive stack has a rounded internal join.`,
            );
          }
          if (outer && !interval.topRounded) {
            addFinding(findings, 'outer-tip', `${category} positive outer tip is not rounded.`);
          }
        } else {
          if (!interval.topSquare || interval.topRounded || (!outer && !interval.bottomSquare)) {
            addFinding(
              findings,
              'internal-join',
              `${category} negative stack has a rounded internal join.`,
            );
          }
          if (outer && !interval.bottomRounded) {
            addFinding(findings, 'outer-tip', `${category} negative outer tip is not rounded.`);
          }
        }
      });
    }
  }
  return result(findings);
}

function parseXml(xml: string, root: 'worksheet' | 'workbook'): Document | null {
  let parseFailed = false;
  try {
    const document = new DOMParser({
      onError: (level) => {
        if (level !== 'warning') parseFailed = true;
      },
    }).parseFromString(String(xml ?? '').trim(), 'application/xml') as unknown as Document;
    if (
      parseFailed ||
      !document.documentElement ||
      document.documentElement.tagName !== root ||
      document.getElementsByTagName('parsererror').length > 0
    ) {
      return null;
    }
    return document;
  } catch {
    return null;
  }
}

function childElements(parent: Element | Document, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .filter((node) => tagName === undefined || node.tagName === tagName);
}

function oneChild(parent: Element, tagName: string): Element | null {
  const matches = childElements(parent, tagName);
  return matches.length === 1 ? matches[0] : null;
}

interface CanonicalElementOptions {
  helperPrefix?: string;
  unorderedColumnInstanceTableCalcs?: boolean;
}

function hasOnlyWhitespaceText(element: Element): boolean {
  return Array.from(element.childNodes).every(
    (node) => node.nodeType === 1 || (node.nodeValue ?? '').trim() === '',
  );
}

function isGeneratedGeometryInstance(element: Element, helperPrefix: string): boolean {
  if (element.tagName !== 'column-instance') return false;
  const column = element.getAttribute('column') ?? '';
  return ['bin', 'path', 'x', 'y'].some((role) => column === `[${helperPrefix}${role}]`);
}

function isFieldAddressingTableCalc(element: Element): boolean {
  return (
    element.tagName === 'table-calc' &&
    element.getAttribute('ordering-type') === 'Field' &&
    Array.from(element.attributes).every((attribute) =>
      ['field', 'ordering-field', 'ordering-type'].includes(attribute.name),
    ) &&
    element.childNodes.length === 0
  );
}

function canonicalElement(element: Element, options: CanonicalElementOptions = {}): string {
  const attributes = Array.from(element.attributes)
    .map((attribute) => [attribute.name, attribute.value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(' ');
  const directChildren = childElements(element);
  if (
    options.helperPrefix &&
    element.tagName === 'datasource-dependencies' &&
    hasOnlyWhitespaceText(element) &&
    directChildren.every((child) => ['column', 'column-instance'].includes(child.tagName))
  ) {
    const columns = directChildren
      .filter((child) => child.tagName === 'column')
      .map((child) => canonicalElement(child, options))
      .sort()
      .join('');
    const instances = directChildren
      .filter((child) => child.tagName === 'column-instance')
      .map((child) => canonicalElement(child, options))
      .sort()
      .join('');
    return `<${element.tagName}${attributes ? ` ${attributes}` : ''}>${columns}${instances}</${element.tagName}>`;
  }
  if (
    element.tagName === 'column-instance' &&
    hasOnlyWhitespaceText(element) &&
    ((options.unorderedColumnInstanceTableCalcs &&
      directChildren.every(isFieldAddressingTableCalc)) ||
      (options.helperPrefix &&
        isGeneratedGeometryInstance(element, options.helperPrefix) &&
        directChildren.every((child) => child.tagName === 'table-calc')))
  ) {
    const tableCalcs = directChildren
      .map((child) => canonicalElement(child, options))
      .sort()
      .join('');
    return `<${element.tagName}${attributes ? ` ${attributes}` : ''}>${tableCalcs}</${element.tagName}>`;
  }
  const children = Array.from(element.childNodes)
    .map((node) => {
      if (node.nodeType === 1) return canonicalElement(node as Element, options);
      if (node.nodeType === 3 || node.nodeType === 4) {
        const value = node.nodeValue ?? '';
        return value.trim() === '' ? '' : value;
      }
      return '';
    })
    .filter(Boolean)
    .join('');
  return `<${element.tagName}${attributes ? ` ${attributes}` : ''}>${children}</${element.tagName}>`;
}

function effectiveNamespaceDeclaration(element: Element, attributeName: string): string | null {
  let current: Node | null = element;
  while (current?.nodeType === 1) {
    const currentElement = current as Element;
    if (currentElement.hasAttribute(attributeName)) {
      return currentElement.getAttribute(attributeName);
    }
    current = current.parentNode;
  }
  return null;
}

function canonicalElementsWithEquivalentRootNamespaces(
  left: Element,
  right: Element,
  options: CanonicalElementOptions = {},
): boolean {
  const leftClone = left.cloneNode(true) as Element;
  const rightClone = right.cloneNode(true) as Element;
  const rootNamespaceDeclarations = new Set(
    [...Array.from(left.attributes), ...Array.from(right.attributes)]
      .map((attribute) => attribute.name)
      .filter((name) => name === 'xmlns' || name.startsWith('xmlns:')),
  );
  for (const declaration of rootNamespaceDeclarations) {
    const leftEffective = effectiveNamespaceDeclaration(left, declaration);
    const rightEffective = effectiveNamespaceDeclaration(right, declaration);
    if (leftEffective !== null && leftEffective === rightEffective) {
      leftClone.removeAttribute(declaration);
      rightClone.removeAttribute(declaration);
    }
  }
  return canonicalElement(leftClone, options) === canonicalElement(rightClone, options);
}

function simpleId(worksheet: Element): string {
  return oneChild(worksheet, 'simple-id')?.getAttribute('uuid') ?? '';
}

function worksheetTable(worksheet: Element): Element | null {
  return oneChild(worksheet, 'table');
}

function worksheetView(worksheet: Element): Element | null {
  const table = worksheetTable(worksheet);
  return table ? oneChild(table, 'view') : null;
}

function helperDefinitionElements(parent: Element, prefix: string): Element[] {
  return childElements(parent, 'column').filter((column) =>
    unbracket(column.getAttribute('name') ?? '').startsWith(prefix),
  );
}

function helperDefinitions(parent: Element, prefix: string): Map<string, Element> {
  const definitions = new Map<string, Element>();
  for (const column of helperDefinitionElements(parent, prefix)) {
    definitions.set(column.getAttribute('name') ?? '', column);
  }
  return definitions;
}

function contractHelperNames(contract: RoundStackedBarSemanticContract): string[] {
  return Object.values(contract.helpers).flatMap((helper) => (helper ? [helper.column] : []));
}

function verifyHelperScope(
  findings: RoundStackedBarFinding[],
  label: string,
  scope: Element | null,
  expected: Map<string, Element>,
  expectedNames: readonly string[],
  prefix: string,
): void {
  if (!scope) {
    addFinding(findings, 'helper-definition', `${label} helper scope is missing.`);
    return;
  }
  const actualElements = helperDefinitionElements(scope, prefix);
  const actual = helperDefinitions(scope, prefix);
  if (
    actualElements.length !== expectedNames.length ||
    actual.size !== expectedNames.length ||
    expectedNames.some((name) => !actual.has(name)) ||
    [...actual.keys()].some((name) => !expectedNames.includes(name))
  ) {
    addFinding(
      findings,
      'helper-definition',
      `${label} does not contain exactly the ${expectedNames.length} contract helpers.`,
    );
  }
  for (const name of expectedNames) {
    const expectedDefinition = expected.get(name);
    const definition = actual.get(name);
    if (!definition || !expectedDefinition) continue;
    if (definition.getAttribute('hidden') !== 'true') {
      addFinding(findings, 'helper-visibility', `${label} helper ${name} is visible.`);
    }
    if (canonicalElement(definition) !== canonicalElement(expectedDefinition)) {
      addFinding(
        findings,
        'helper-definition',
        `${label} helper ${name} differs from the intended definition.`,
      );
    }
  }
}

function findDependency(worksheet: Element, datasource: string): Element | null {
  const view = worksheetView(worksheet);
  if (!view) return null;
  const dependencies = childElements(view, 'datasource-dependencies').filter(
    (dependency) => dependency.getAttribute('datasource') === datasource,
  );
  return dependencies.length === 1 ? dependencies[0] : null;
}

function topLevelContainer(workbook: Element, tagName: string): Element | null {
  return oneChild(workbook, tagName);
}

function targetWorkbookOwners(
  workbook: Element,
  contract: RoundStackedBarSemanticContract,
): { worksheets: Element[]; datasources: Element[] } {
  const worksheets = topLevelContainer(workbook, 'worksheets');
  const datasources = topLevelContainer(workbook, 'datasources');
  return {
    worksheets: worksheets
      ? childElements(worksheets, 'worksheet').filter(
          (worksheet) => simpleId(worksheet) === contract.worksheetId,
        )
      : [],
    datasources: datasources
      ? childElements(datasources, 'datasource').filter(
          (datasource) => datasource.getAttribute('name') === contract.datasource.internalName,
        )
      : [],
  };
}

function hasNonEmptyTopLevelActions(workbook: Element): boolean {
  return childElements(workbook, 'actions').some(
    (actions) =>
      actions.attributes.length > 0 ||
      Array.from(actions.childNodes).some(
        (node) =>
          node.nodeType === 1 ||
          ((node.nodeType === 3 || node.nodeType === 4) && Boolean(node.nodeValue?.trim())),
      ),
  );
}

function canonicalUnrelatedWorkbookContent(
  workbook: Element,
  contract: RoundStackedBarSemanticContract,
  stripExpectedTargetHelpers: boolean,
  stripHostAddedAltTextManifest = false,
): string | null {
  const clone = workbook.cloneNode(true) as Element;
  const owners = targetWorkbookOwners(clone, contract);
  if (owners.worksheets.length !== 1 || owners.datasources.length !== 1) return null;
  owners.worksheets[0].parentNode?.removeChild(owners.worksheets[0]);
  if (stripExpectedTargetHelpers) {
    const expectedHelpers = new Set(contractHelperNames(contract));
    for (const column of childElements(owners.datasources[0], 'column')) {
      if (expectedHelpers.has(column.getAttribute('name') ?? '')) {
        owners.datasources[0].removeChild(column);
      }
    }
  }
  const windows = topLevelContainer(clone, 'windows');
  if (windows) {
    for (const window of childElements(windows, 'window')) {
      window.removeAttribute('active');
      window.removeAttribute('maximized');
    }
  }
  if (stripHostAddedAltTextManifest) {
    const manifests = childElements(clone, 'document-format-change-manifest');
    const markers =
      manifests.length === 1 ? childElements(manifests[0], 'AccessibilityEditableAltText') : [];
    if (
      markers.length === 1 &&
      markers[0].attributes.length === 0 &&
      childElements(markers[0]).length === 0 &&
      Array.from(markers[0].childNodes).every(
        (node) =>
          (node.nodeType === 3 || node.nodeType === 4) && (node.nodeValue ?? '').trim() === '',
      )
    ) {
      markers[0].parentNode?.removeChild(markers[0]);
    }
  }
  return canonicalElement(clone, { unorderedColumnInstanceTableCalcs: true });
}

function worksheetAddsAltText(source: Element, intended: Element): boolean {
  const sourceLayouts = childElements(source, 'layout-options');
  const intendedLayouts = childElements(intended, 'layout-options');
  const sourceAltTexts = sourceLayouts.flatMap((layout) => childElements(layout, 'alt-text'));
  const intendedAltTexts = intendedLayouts.flatMap((layout) => childElements(layout, 'alt-text'));
  return (
    sourceAltTexts.length === 0 &&
    intendedAltTexts.length === 1 &&
    formattedTextOwnerSemanticText(intendedAltTexts[0]) !== null
  );
}

function hasOneManifestWithoutAltTextMarker(workbook: Element): boolean {
  const manifests = childElements(workbook, 'document-format-change-manifest');
  return (
    manifests.length === 1 &&
    childElements(manifests[0], 'AccessibilityEditableAltText').length === 0
  );
}

export function verifyRoundStackedBarSourceWorkbook(
  sourceWorkbookXml: string,
  contract: RoundStackedBarSemanticContract,
  sourceWorksheetXml: string,
): RoundStackedBarVerification {
  const findings: RoundStackedBarFinding[] = [];
  const document = parseXml(sourceWorkbookXml, 'workbook');
  const sourceWorksheetDocument = parseXml(sourceWorksheetXml, 'worksheet');
  if (!document || !sourceWorksheetDocument) {
    if (!document) addFinding(findings, 'xml-parse', 'Source workbook XML is not well formed.');
    if (!sourceWorksheetDocument) {
      addFinding(findings, 'xml-parse', 'Locked source worksheet XML is not well formed.');
    }
    return result(findings);
  }
  const workbook = document.documentElement;
  const sourceWorksheet = sourceWorksheetDocument.documentElement;
  const owners = targetWorkbookOwners(workbook, contract);
  const worksheetName = owners.worksheets[0]?.getAttribute('name')?.trim() ?? '';
  if (owners.worksheets.length !== 1 || worksheetName === '') {
    addFinding(
      findings,
      'workbook-identity',
      'Source workbook must contain exactly one named worksheet with the planned stable id.',
    );
  } else {
    if (!canonicalElementsWithEquivalentRootNamespaces(owners.worksheets[0], sourceWorksheet)) {
      addFinding(
        findings,
        'workbook-identity',
        'Source workbook target worksheet differs from the locked standalone source worksheet.',
      );
    }
  }
  if (hasNonEmptyTopLevelActions(workbook)) {
    addFinding(
      findings,
      'action',
      'Source workbook contains top-level actions; rounded-bar conversion cannot prove their dashboard-wide semantics safe.',
    );
  }
  if (owners.datasources.length !== 1) {
    addFinding(
      findings,
      'workbook-identity',
      'Source workbook must contain exactly one top-level target datasource.',
    );
  }

  const datasources = topLevelContainer(workbook, 'datasources');
  if (datasources) {
    for (const datasource of childElements(datasources, 'datasource')) {
      for (const column of helperDefinitionElements(datasource, contract.helperPrefix)) {
        addFinding(
          findings,
          'helper-definition',
          `Source workbook datasource ${JSON.stringify(datasource.getAttribute('name') ?? '')} already contains planned-prefix column ${JSON.stringify(column.getAttribute('name') ?? '')}.`,
        );
      }
    }
  }
  return result(findings);
}

export function verifyRoundStackedBarStructure(input: {
  sourceWorksheetXml: string;
  intendedWorksheetXml: string;
  readbackWorksheetXml: string;
  sourceWorkbookXml: string;
  readbackWorkbookXml: string;
  contract: RoundStackedBarSemanticContract;
}): RoundStackedBarVerification {
  const findings: RoundStackedBarFinding[] = [];
  const sourceDocument = parseXml(input.sourceWorksheetXml, 'worksheet');
  const intendedDocument = parseXml(input.intendedWorksheetXml, 'worksheet');
  const readbackDocument = parseXml(input.readbackWorksheetXml, 'worksheet');
  const readbackWorkbookDocument = parseXml(input.readbackWorkbookXml, 'workbook');
  const sourceWorkbookDocument = parseXml(input.sourceWorkbookXml, 'workbook');
  for (const [label, document] of [
    ['source worksheet', sourceDocument],
    ['intended worksheet', intendedDocument],
    ['readback worksheet', readbackDocument],
    ['readback workbook', readbackWorkbookDocument],
    ['source workbook', sourceWorkbookDocument],
  ] as const) {
    if (!document) addFinding(findings, 'xml-parse', `${label} XML is not well formed.`);
  }
  if (
    !sourceDocument ||
    !intendedDocument ||
    !readbackDocument ||
    !readbackWorkbookDocument ||
    !sourceWorkbookDocument
  ) {
    return result(findings);
  }

  const source = sourceDocument.documentElement;
  const intended = intendedDocument.documentElement;
  const readback = readbackDocument.documentElement;
  const expectedPlan = planRoundStackedBar(input.sourceWorksheetXml, { preset: 'subtle' });
  const verificationContract = expectedPlan.ok ? expectedPlan.semanticContract : input.contract;
  let intendedMatchesExpected = false;
  if (!expectedPlan.ok) {
    addFinding(
      findings,
      'worksheet-content',
      'The locked source worksheet no longer produces a valid rounded-bar plan.',
    );
  } else {
    if (!isDeepStrictEqual(input.contract, expectedPlan.semanticContract)) {
      addFinding(
        findings,
        'worksheet-content',
        'The supplied semantic contract differs from the deterministic rounded-bar plan.',
      );
    }
    const expectedDocument = parseXml(expectedPlan.xml, 'worksheet');
    intendedMatchesExpected = Boolean(
      expectedDocument &&
      canonicalElementsWithEquivalentRootNamespaces(expectedDocument.documentElement, intended, {
        helperPrefix: verificationContract.helperPrefix,
      }),
    );
    if (!intendedMatchesExpected) {
      addFinding(
        findings,
        'worksheet-content',
        'The intended worksheet differs from the deterministic rounded-bar transform of the locked source.',
      );
    }
  }
  if (
    !canonicalElementsWithEquivalentRootNamespaces(intended, readback, {
      helperPrefix: verificationContract.helperPrefix,
    })
  ) {
    addFinding(
      findings,
      'worksheet-content',
      'The standalone readback worksheet differs from the intended rounded-bar worksheet.',
    );
  }

  const readbackPlan = planRoundStackedBar(input.readbackWorksheetXml, { preset: 'subtle' });
  if (
    !readbackPlan.ok ||
    !readbackPlan.alreadyRounded ||
    !expectedPlan.ok ||
    !isDeepStrictEqual(readbackPlan.semanticContract, expectedPlan.semanticContract)
  ) {
    addFinding(
      findings,
      'worksheet-content',
      'The standalone readback worksheet is not the exact rounded-bar contract recognized by the planner.',
    );
  }

  const expectedNames = contractHelperNames(verificationContract);
  if (expectedNames.length === 0 || new Set(expectedNames).size !== expectedNames.length) {
    addFinding(
      findings,
      'helper-definition',
      'The semantic contract must name a non-empty set of unique active helpers.',
    );
  }
  const intendedDependency = findDependency(intended, verificationContract.datasource.internalName);
  const expectedHelpers = intendedDependency
    ? helperDefinitions(intendedDependency, verificationContract.helperPrefix)
    : new Map<string, Element>();

  const workbookRoot = readbackWorkbookDocument.documentElement;
  const sourceWorkbook = sourceWorkbookDocument.documentElement;
  const sourceOwners = targetWorkbookOwners(sourceWorkbook, verificationContract);
  const readbackOwners = targetWorkbookOwners(workbookRoot, verificationContract);
  const workbookOwnersUnique =
    sourceOwners.worksheets.length === 1 &&
    sourceOwners.datasources.length === 1 &&
    readbackOwners.worksheets.length === 1 &&
    readbackOwners.datasources.length === 1;
  if (!workbookOwnersUnique) {
    addFinding(
      findings,
      'workbook-identity',
      'Source and readback workbooks must each contain exactly one target worksheet and target datasource.',
    );
  }
  const datasources = topLevelContainer(workbookRoot, 'datasources');
  const datasource = readbackOwners.datasources.length === 1 ? readbackOwners.datasources[0] : null;
  verifyHelperScope(
    findings,
    'readback workbook datasource',
    datasource,
    expectedHelpers,
    expectedNames,
    verificationContract.helperPrefix,
  );
  if (datasources) {
    for (const candidate of childElements(datasources, 'datasource')) {
      if (
        candidate !== datasource &&
        helperDefinitions(candidate, verificationContract.helperPrefix).size > 0
      ) {
        addFinding(
          findings,
          'helper-definition',
          `Rounded-bar helpers leaked into datasource ${JSON.stringify(candidate.getAttribute('name') ?? '')}.`,
        );
      }
    }
  }

  const workbookSheet =
    readbackOwners.worksheets.length === 1 ? readbackOwners.worksheets[0] : undefined;
  if (!workbookSheet) {
    addFinding(
      findings,
      'workbook-identity',
      'Readback workbook no longer contains the same worksheet identity.',
    );
  } else {
    if (
      !canonicalElementsWithEquivalentRootNamespaces(workbookSheet, readback, {
        helperPrefix: verificationContract.helperPrefix,
      })
    ) {
      addFinding(
        findings,
        'workbook-identity',
        'Readback workbook worksheet differs from the standalone Polygon readback.',
      );
    }
  }
  if (workbookOwnersUnique) {
    const sourceUnrelated = canonicalUnrelatedWorkbookContent(
      sourceWorkbook,
      verificationContract,
      false,
    );
    const readbackUnrelated = canonicalUnrelatedWorkbookContent(
      workbookRoot,
      verificationContract,
      true,
      intendedMatchesExpected &&
        worksheetAddsAltText(source, intended) &&
        hasOneManifestWithoutAltTextMarker(sourceWorkbook),
    );
    if (!sourceUnrelated || !readbackUnrelated || sourceUnrelated !== readbackUnrelated) {
      addFinding(
        findings,
        'workbook-identity',
        'Workbook content outside the target worksheet and intended rounded-bar helpers changed.',
      );
    }
  }
  return result(findings);
}
