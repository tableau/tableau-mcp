import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export type RoundStackedBarPreset = 'subtle';

export interface RoundStackedBarRefusal {
  ok: false;
  reason: string;
}

interface FieldSemantics {
  caption: string;
  column: string;
  columnInstance: string;
}

export interface RoundStackedBarSemanticContract {
  worksheetId: string;
  datasource: { caption: string; internalName: string };
  orientation: 'horizontal' | 'vertical';
  category: FieldSemantics;
  segment?: FieldSemantics;
  measure: FieldSemantics & { aggregation: 'SUM' };
  filter?: { caption: string; column: string; columnInstance: string; member: string };
  helperPrefix: string;
  helpers: Partial<
    Record<RoundStackedBarHelperRole, { caption: string; column: string; columnInstance?: string }>
  >;
  narration: {
    caption: { status: 'generated' | 'preserved'; text: string } | { status: 'source-suppressed' };
    altText: { status: 'generated' | 'preserved'; text: string };
  };
}

export interface RoundStackedBarPlan {
  ok: true;
  alreadyRounded: boolean;
  xml: string;
  semanticContract: RoundStackedBarSemanticContract;
}

interface ParsedXml {
  document: Document;
  worksheet: Element;
}

interface ColumnDefinition {
  caption: string;
  element: Element;
  name: string;
}

interface ColumnInstance {
  column: string;
  derivation: string;
  element: Element;
  name: string;
  type: string;
}

interface BaseShape {
  category: ColumnInstance;
  columnDefinitions: Map<string, ColumnDefinition>;
  datasourceCaption: string;
  datasourceName: string;
  dependency: Element;
  filter?: { caption: string; column: string; columnInstance: string; member: string };
  measure: ColumnInstance;
  orientation: 'horizontal' | 'vertical';
  pane: Element;
  segment?: ColumnInstance;
  table: Element;
  view: Element;
  worksheet: Element;
  worksheetId: string;
}

interface LayoutNarrationState {
  altText: Element | null;
  caption: Element | null;
  exportNoCaption: boolean;
  layoutOptions: Element | null;
}

type NarrationContract = RoundStackedBarSemanticContract['narration'];

const HELPER_SUFFIXES = [
  'seed',
  'bin',
  'dense',
  'pos',
  'neg',
  'pos_end',
  'neg_end',
  'lo',
  'hi',
  'span',
  'radius_y',
  'top_radius_y',
  'bottom_radius_y',
  'top_radius_x',
  'bottom_radius_x',
  'path',
  'x',
  'y',
] as const;

export type RoundStackedBarHelperRole = (typeof HELPER_SUFFIXES)[number];
type HelperNames = Record<RoundStackedBarHelperRole, string>;

const STACKED_ONLY_HELPER_ROLES = new Set<RoundStackedBarHelperRole>([
  'pos',
  'neg',
  'pos_end',
  'neg_end',
]);

function activeHelperRoles(shape: BaseShape): RoundStackedBarHelperRole[] {
  return shape.segment
    ? [...HELPER_SUFFIXES]
    : HELPER_SUFFIXES.filter((role) => !STACKED_ONLY_HELPER_ROLES.has(role));
}

const refusal = (reason: string): RoundStackedBarRefusal => ({ ok: false, reason });

function elements(parent: Element | Document, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .filter((node) => tagName === undefined || node.tagName === tagName);
}

function oneChild(parent: Element, tagName: string): Element | null {
  const matches = elements(parent, tagName);
  return matches.length === 1 ? matches[0] : null;
}

function parseXml(xml: string): ParsedXml | null {
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
      document.documentElement.tagName !== 'worksheet' ||
      document.getElementsByTagName('parsererror').length > 0
    ) {
      return null;
    }
    return { document, worksheet: document.documentElement };
  } catch {
    return null;
  }
}

function delimiterEnd(xml: string, start: number, delimiter: string): number {
  const index = xml.indexOf(delimiter, start);
  return index < 0 ? xml.length : index + delimiter.length;
}

function angleMarkupEnd(xml: string, start: number, declaration: boolean): number {
  let quote: '"' | "'" | null = null;
  let subsetDepth = 0;
  for (let index = start + 2; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (declaration && character === '[') {
      subsetDepth += 1;
    } else if (declaration && character === ']') {
      subsetDepth = Math.max(0, subsetDepth - 1);
    } else if (character === '>' && subsetDepth === 0) {
      return index + 1;
    }
  }
  return xml.length;
}

function canonicalizeElementStartTags(xml: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) return result + xml.slice(cursor);
    result += xml.slice(cursor, start);

    let end: number;
    let elementStart = false;
    if (xml.startsWith('<!--', start)) {
      end = delimiterEnd(xml, start + 4, '-->');
    } else if (xml.startsWith('<![CDATA[', start)) {
      end = delimiterEnd(xml, start + 9, ']]>');
    } else if (xml.startsWith('<?', start)) {
      end = delimiterEnd(xml, start + 2, '?>');
    } else if (xml.startsWith('<!', start)) {
      end = angleMarkupEnd(xml, start, true);
    } else {
      end = angleMarkupEnd(xml, start, false);
      elementStart = !xml.startsWith('</', start);
    }

    const markup = xml.slice(start, end);
    result += elementStart
      ? markup
          .replace(
            /(\s[\w:.-]+)="([^"]*)"/g,
            (_match, name: string, value: string) => `${name}='${value.replaceAll("'", '&apos;')}'`,
          )
          .replace(/\s*\/>$/, ' />')
      : markup;
    cursor = end;
  }
  return result;
}

function canonicalXml(document: Document): string {
  return canonicalizeElementStartTags(
    new XMLSerializer().serializeToString(
      document as unknown as Parameters<XMLSerializer['serializeToString']>[0],
    ),
  );
}

function columnDefinitions(dependency: Element): Map<string, ColumnDefinition> {
  const definitions = new Map<string, ColumnDefinition>();
  for (const element of elements(dependency, 'column')) {
    const name = element.getAttribute('name');
    if (!name) continue;
    definitions.set(name, {
      caption: element.getAttribute('caption') || unbracket(name),
      element,
      name,
    });
  }
  return definitions;
}

function columnInstances(dependency: Element): ColumnInstance[] {
  return elements(dependency, 'column-instance').map((element) => ({
    column: element.getAttribute('column') ?? '',
    derivation: element.getAttribute('derivation') ?? '',
    element,
    name: element.getAttribute('name') ?? '',
    type: element.getAttribute('type') ?? '',
  }));
}

function unbracket(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function qualified(datasource: string, field: string): string {
  return `[${datasource}].${field}`;
}

function unqualify(reference: string, datasource: string): string | null {
  const prefix = `[${datasource}].`;
  return reference.startsWith(prefix) ? reference.slice(prefix.length) : null;
}

function shelfText(element: Element | null): string {
  return element?.textContent?.trim() ?? '';
}

function helperPrefix(worksheetId: string): string | null {
  const stable = worksheetId.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return stable.length >= 12 ? `__tmcp_round_${stable.slice(0, 12)}_` : null;
}

function helperNames(prefix: string): HelperNames {
  return Object.fromEntries(
    HELPER_SUFFIXES.map((suffix) => [suffix, `[${prefix}${suffix}]`]),
  ) as HelperNames;
}

function helperCaption(role: RoundStackedBarHelperRole): string {
  if (role === 'seed') return 'TMCP rounded path seed';
  if (role === 'bin') return 'TMCP rounded path frame';
  return `TMCP rounded ${role.replaceAll('_', ' ')}`;
}

function helperColumnInstance(role: RoundStackedBarHelperRole, column: string): string | undefined {
  if (role === 'bin') return `[none:${unbracket(column)}:ok]`;
  if (['path', 'x', 'y'].includes(role)) return `[usr:${unbracket(column)}:qk]`;
  return undefined;
}

function fieldSemantics(
  instance: ColumnInstance,
  definitions: Map<string, ColumnDefinition>,
): FieldSemantics {
  return {
    caption: definitions.get(instance.column)?.caption ?? unbracket(instance.column),
    column: instance.column,
    columnInstance: instance.name,
  };
}

function semanticContract(
  shape: BaseShape,
  prefix: string,
  names: HelperNames,
  narration: NarrationContract,
): RoundStackedBarSemanticContract {
  return {
    worksheetId: shape.worksheetId,
    datasource: {
      caption: shape.datasourceCaption,
      internalName: shape.datasourceName,
    },
    orientation: shape.orientation,
    category: fieldSemantics(shape.category, shape.columnDefinitions),
    ...(shape.segment ? { segment: fieldSemantics(shape.segment, shape.columnDefinitions) } : {}),
    measure: {
      ...fieldSemantics(shape.measure, shape.columnDefinitions),
      aggregation: 'SUM',
    },
    ...(shape.filter ? { filter: shape.filter } : {}),
    helperPrefix: prefix,
    helpers: Object.fromEntries(
      activeHelperRoles(shape).map((role) => {
        const column = names[role];
        const columnInstance = helperColumnInstance(role, column);
        return [
          role,
          {
            caption: helperCaption(role),
            column,
            ...(columnInstance ? { columnInstance } : {}),
          },
        ];
      }),
    ) as RoundStackedBarSemanticContract['helpers'],
    narration,
  };
}

const LAYOUT_OPTION_CHILD_ORDER = ['title', 'caption', 'alt-text', 'filter-alt-text'] as const;

function formattedTextOwnerIsWellFormed(owner: Element): boolean {
  const children = elements(owner);
  return children.length === 1 && children[0].tagName === 'formatted-text';
}

export function formattedTextOwnerSemanticText(owner: Element): string | null {
  const formatted = oneChild(owner, 'formatted-text');
  if (!formatted || elements(owner).length !== 1) return null;
  return elements(formatted, 'run')
    .map((run) => run.textContent ?? '')
    .join('');
}

function inspectLayoutNarration(
  worksheet: Element,
): { ok: true; value: LayoutNarrationState } | RoundStackedBarRefusal {
  const layouts = elements(worksheet, 'layout-options');
  if (layouts.length > 1) {
    return refusal('round_bar refuses duplicate worksheet layout-options.');
  }
  const layoutOptions = layouts[0] ?? null;
  if (!layoutOptions) {
    return {
      ok: true,
      value: { altText: null, caption: null, exportNoCaption: false, layoutOptions: null },
    };
  }

  const worksheetChildren = elements(worksheet);
  const tableIndex = worksheetChildren.findIndex((child) => child.tagName === 'table');
  if (tableIndex < 0 || worksheetChildren.indexOf(layoutOptions) > tableIndex) {
    return refusal('round_bar requires layout-options before the worksheet table.');
  }
  const exportNoCaptionValue = layoutOptions.getAttribute('export-no-caption');
  if (
    exportNoCaptionValue !== null &&
    !['true', 'false', '1', '0'].includes(exportNoCaptionValue)
  ) {
    return refusal('round_bar refuses an invalid export-no-caption value.');
  }

  const children = elements(layoutOptions);
  const positions = children.map((child) =>
    LAYOUT_OPTION_CHILD_ORDER.indexOf(child.tagName as (typeof LAYOUT_OPTION_CHILD_ORDER)[number]),
  );
  if (
    positions.some((position) => position < 0) ||
    positions.some((position, index) => index > 0 && position <= positions[index - 1])
  ) {
    return refusal(
      'round_bar refuses malformed, duplicate, or out-of-order layout-options children.',
    );
  }

  const caption = elements(layoutOptions, 'caption')[0] ?? null;
  const altText = elements(layoutOptions, 'alt-text')[0] ?? null;
  if (caption && !formattedTextOwnerIsWellFormed(caption)) {
    return refusal('round_bar refuses malformed caption ownership.');
  }
  if (altText && !formattedTextOwnerIsWellFormed(altText)) {
    return refusal('round_bar refuses malformed alt-text ownership.');
  }
  return {
    ok: true,
    value: {
      altText,
      caption,
      exportNoCaption: ['true', '1'].includes(exportNoCaptionValue ?? ''),
      layoutOptions,
    },
  };
}

function semanticNarrationText(shape: BaseShape): string {
  const category =
    shape.columnDefinitions.get(shape.category.column)?.caption ?? unbracket(shape.category.column);
  const measure =
    shape.columnDefinitions.get(shape.measure.column)?.caption ?? unbracket(shape.measure.column);
  const filter = shape.filter ? ` Filtered by ${shape.filter.caption}.` : '';
  const color = shape.segment
    ? ` Color shows details about ${shape.columnDefinitions.get(shape.segment.column)?.caption ?? unbracket(shape.segment.column)}.`
    : '';
  return `Sum of ${measure} for each ${category}.${color}${filter} Rounded corners are visual styling; values are unchanged.`;
}

function formattedNarration(
  document: Document,
  tagName: 'caption' | 'alt-text',
  text: string,
): Element {
  const owner = document.createElement(tagName);
  const formatted = document.createElement('formatted-text');
  const run = document.createElement('run');
  run.appendChild(document.createTextNode(text));
  formatted.appendChild(run);
  owner.appendChild(formatted);
  return owner;
}

function insertBeforeFirst(layoutOptions: Element, child: Element, laterTags: string[]): void {
  const later = elements(layoutOptions).find((candidate) => laterTags.includes(candidate.tagName));
  layoutOptions.insertBefore(child, later ?? null);
}

function authorNarration(
  document: Document,
  shape: BaseShape,
  state: LayoutNarrationState,
): NarrationContract {
  const text = semanticNarrationText(shape);
  let layoutOptions = state.layoutOptions;
  if (!layoutOptions) {
    layoutOptions = document.createElement('layout-options');
    shape.worksheet.insertBefore(layoutOptions, shape.table);
  }

  let caption = state.caption;
  let captionContract: NarrationContract['caption'];
  if (caption) {
    captionContract = {
      status: 'preserved',
      text: formattedTextOwnerSemanticText(caption) ?? '',
    };
  } else if (state.exportNoCaption) {
    captionContract = { status: 'source-suppressed' };
  } else {
    caption = formattedNarration(document, 'caption', text);
    insertBeforeFirst(layoutOptions, caption, ['alt-text', 'filter-alt-text']);
    captionContract = { status: 'generated', text };
  }

  let altText = state.altText;
  let altTextContract: NarrationContract['altText'];
  if (altText) {
    altTextContract = {
      status: 'preserved',
      text: formattedTextOwnerSemanticText(altText) ?? '',
    };
  } else {
    altText = formattedNarration(document, 'alt-text', text);
    insertBeforeFirst(layoutOptions, altText, ['filter-alt-text']);
    altTextContract = { status: 'generated', text };
  }
  return { altText: altTextContract, caption: captionContract };
}

function isGeneratedNarration(element: Element, text: string): boolean {
  if (element.attributes.length !== 0) return false;
  const formatted = oneChild(element, 'formatted-text');
  if (!formatted || elements(element).length !== 1 || formatted.attributes.length !== 0) {
    return false;
  }
  const runs = elements(formatted, 'run');
  return (
    runs.length === 1 &&
    elements(formatted).length === 1 &&
    runs[0].attributes.length === 0 &&
    formattedTextOwnerSemanticText(element) === text
  );
}

function roundedNarrationContract(
  shape: BaseShape,
  state: LayoutNarrationState,
): NarrationContract | null {
  if (!state.altText || (!state.caption && !state.exportNoCaption)) return null;
  const text = semanticNarrationText(shape);
  return {
    altText: {
      status: isGeneratedNarration(state.altText, text) ? 'generated' : 'preserved',
      text: formattedTextOwnerSemanticText(state.altText) ?? '',
    },
    caption: state.caption
      ? {
          status: isGeneratedNarration(state.caption, text) ? 'generated' : 'preserved',
          text: formattedTextOwnerSemanticText(state.caption) ?? '',
        }
      : { status: 'source-suppressed' },
  };
}

function readFilter(
  view: Element,
  datasource: string,
  instances: ColumnInstance[],
  definitions: Map<string, ColumnDefinition>,
): { ok: true; allowedColumn?: string; value?: BaseShape['filter'] } | RoundStackedBarRefusal {
  const filters = elements(view, 'filter');
  const slices = elements(view, 'slices');
  if (filters.length === 0) {
    if (slices.some((slice) => elements(slice, 'column').length > 0)) {
      return refusal('round_bar does not support slices without its one categorical filter.');
    }
    return { ok: true };
  }
  if (filters.length !== 1) {
    return refusal('round_bar supports at most one categorical filter.');
  }

  const filter = filters[0];
  if (filter.getAttribute('class') !== 'categorical' || filter.hasAttribute('context')) {
    return refusal('round_bar supports only one ordinary categorical filter.');
  }
  const filterReference = filter.getAttribute('column') ?? '';
  const filterCiName = unqualify(filterReference, datasource);
  const filterInstance = instances.find((instance) => instance.name === filterCiName);
  if (!filterCiName || !filterInstance || filterInstance.derivation !== 'None') {
    return refusal('the categorical filter field is not a plain field in this datasource.');
  }
  const filterDefinition = definitions.get(filterInstance.column);
  if (
    !filterDefinition ||
    filterDefinition.element.getElementsByTagName('calculation').length > 0
  ) {
    return refusal('round_bar requires a plain source filter field.');
  }

  const unions = elements(filter, 'groupfilter');
  if (unions.length !== 1 || unions[0].getAttribute('function') !== 'union') {
    return refusal('the categorical filter must contain one inclusive member union.');
  }
  const union = unions[0];
  if (union.getAttribute('user:ui-enumeration') !== 'inclusive') {
    return refusal('the categorical filter must use inclusive enumeration.');
  }
  const members = elements(union, 'groupfilter');
  if (members.length !== 1 || members[0].getAttribute('function') !== 'member') {
    return refusal('the categorical filter must contain exactly one member.');
  }
  if (members[0].getAttribute('level') !== filterCiName) {
    return refusal('the categorical member level must match the filter column instance.');
  }
  if (slices.length !== 1) {
    return refusal('the categorical filter requires one matching slice.');
  }
  const sliceColumns = elements(slices[0], 'column');
  if (sliceColumns.length !== 1 || shelfText(sliceColumns[0]) !== filterReference) {
    return refusal('the categorical filter requires one matching slice.');
  }

  const encodedMember = members[0].getAttribute('member') ?? '';
  const member =
    encodedMember.startsWith('"') && encodedMember.endsWith('"')
      ? encodedMember.slice(1, -1).replaceAll('\\"', '"')
      : encodedMember;
  return {
    ok: true,
    allowedColumn: filterInstance.column,
    value: {
      caption: definitions.get(filterInstance.column)?.caption ?? unbracket(filterInstance.column),
      column: filterInstance.column,
      columnInstance: filterInstance.name,
      member,
    },
  };
}

function baseNodes(parsed: ParsedXml):
  | {
      datasourceCaption: string;
      datasourceName: string;
      dependency: Element;
      table: Element;
      view: Element;
      worksheetId: string;
    }
  | RoundStackedBarRefusal {
  const simpleId = oneChild(parsed.worksheet, 'simple-id');
  const worksheetId = simpleId?.getAttribute('uuid') ?? '';
  if (!helperPrefix(worksheetId)) {
    return refusal('round_bar requires a stable worksheet id.');
  }
  const table = oneChild(parsed.worksheet, 'table');
  const view = table ? oneChild(table, 'view') : null;
  if (!table || !view) return refusal('round_bar requires one worksheet table and view.');

  const datasources = oneChild(view, 'datasources');
  const datasourceRefs = datasources ? elements(datasources, 'datasource') : [];
  if (datasourceRefs.length !== 1) {
    return refusal(`round_bar requires exactly one datasource (found ${datasourceRefs.length}).`);
  }
  const dependencies = elements(view, 'datasource-dependencies');
  if (dependencies.length !== 1) {
    return refusal(
      `round_bar requires exactly one datasource-dependencies block (found ${dependencies.length}).`,
    );
  }
  const datasourceName = dependencies[0].getAttribute('datasource');
  if (!datasourceName || datasourceRefs[0].getAttribute('name') !== datasourceName) {
    return refusal('the datasource reference and datasource-dependencies name must match.');
  }
  return {
    datasourceCaption: datasourceRefs[0].getAttribute('caption') || datasourceName,
    datasourceName,
    dependency: dependencies[0],
    table,
    view,
    worksheetId,
  };
}

function classifyOrdinary(
  parsed: ParsedXml,
  base: Exclude<ReturnType<typeof baseNodes>, RoundStackedBarRefusal>,
): BaseShape | RoundStackedBarRefusal {
  if (base.dependency.getElementsByTagName('table-calc').length > 0) {
    return refusal('round_bar does not support a source table calculation.');
  }
  const panes = oneChild(base.table, 'panes');
  const paneList = panes ? elements(panes, 'pane') : [];
  if (paneList.length !== 1) {
    return refusal(`round_bar requires exactly one pane (found ${paneList.length}).`);
  }
  const pane = paneList[0];
  const tableChildren = elements(base.table);
  const allowedTableChildren = new Set(['view', 'style', 'panes', 'rows', 'cols']);
  const unfamiliarTableChild = tableChildren.find(
    (element) => !allowedTableChildren.has(element.tagName),
  );
  if (unfamiliarTableChild) {
    return refusal(
      `round_bar does not support a pre-existing <${unfamiliarTableChild.tagName}> table node.`,
    );
  }
  const unfamiliarPaneChild = elements(pane).find(
    (element) => !['view', 'mark', 'encodings', 'style'].includes(element.tagName),
  );
  if (unfamiliarPaneChild) {
    return refusal(
      `round_bar does not support a pre-existing <${unfamiliarPaneChild.tagName}> pane node.`,
    );
  }
  const mark = oneChild(pane, 'mark');
  if (!mark || !['Automatic', 'Bar'].includes(mark.getAttribute('class') ?? '')) {
    return refusal('round_bar requires a single Bar or bar-shaped Automatic mark.');
  }
  const encodingContainers = elements(pane, 'encodings');
  if (encodingContainers.length > 1) {
    return refusal('round_bar requires at most one encodings container.');
  }
  const encodings = encodingContainers[0] ?? null;
  if (encodings && encodings.attributes.length > 0) {
    return refusal('round_bar requires a plain encodings container.');
  }
  const encodingList = encodings ? elements(encodings) : [];
  if (
    encodingList.some((encoding) => ['label', 'text', 'tooltip'].includes(encoding.tagName)) ||
    elements(pane, 'customized-tooltip').length > 0
  ) {
    return refusal('round_bar does not support a custom label or tooltip.');
  }
  if (
    encodingList.length > 1 ||
    (encodingList.length === 1 && encodingList[0].tagName !== 'color')
  ) {
    return refusal('round_bar supports no encoding or Segment as the sole Color encoding.');
  }

  const definitions = columnDefinitions(base.dependency);
  const instances = columnInstances(base.dependency);
  const rows = shelfText(oneChild(base.table, 'rows'));
  const cols = shelfText(oneChild(base.table, 'cols'));
  const rowCiName = unqualify(rows, base.datasourceName);
  const colCiName = unqualify(cols, base.datasourceName);
  const rowInstance = instances.find((instance) => instance.name === rowCiName);
  const colInstance = instances.find((instance) => instance.name === colCiName);
  const vertical =
    colInstance?.type === 'nominal' &&
    colInstance.derivation === 'None' &&
    rowInstance?.type === 'quantitative';
  const horizontal =
    rowInstance?.type === 'nominal' &&
    rowInstance.derivation === 'None' &&
    colInstance?.type === 'quantitative';
  if (!vertical && !horizontal) {
    return refusal('round_bar supports only one Category and one SUM measure on opposite shelves.');
  }
  const orientation = vertical ? 'vertical' : 'horizontal';
  const category = (vertical ? colInstance : rowInstance) as ColumnInstance;
  const measure = (vertical ? rowInstance : colInstance) as ColumnInstance;
  if (measure.derivation !== 'Sum') {
    return refusal('round_bar requires a SUM measure.');
  }
  const sourceMeasureDefinitions = elements(base.dependency, 'column').filter(
    (definition) => definition.getAttribute('name') === measure.column,
  );
  if (sourceMeasureDefinitions.length !== 1) {
    return refusal('round_bar refuses a duplicate or missing source measure definition.');
  }
  const colorEncoding = encodingList[0] ?? null;
  let segment: ColumnInstance | undefined;
  if (colorEncoding) {
    const segmentRef = colorEncoding.getAttribute('column') ?? '';
    const segmentCiName = unqualify(segmentRef, base.datasourceName);
    const segmentCandidates = segmentCiName
      ? instances.filter((instance) => instance.name === segmentCiName)
      : [];
    if (
      !segmentRef ||
      !hasOnlyAttributes(colorEncoding, { column: segmentRef }) ||
      elements(colorEncoding).length > 0 ||
      (colorEncoding.textContent?.trim() ?? '') !== '' ||
      !segmentCiName ||
      segmentCandidates.length !== 1 ||
      segmentCandidates[0].type !== 'nominal' ||
      segmentCandidates[0].derivation !== 'None'
    ) {
      return refusal(
        'round_bar requires one plain Color encoding qualified to the selected datasource.',
      );
    }
    segment = segmentCandidates[0];
  }
  if (segment?.name === category.name) {
    return refusal('Category and Segment must be different fields.');
  }
  if (segment) {
    const paneViews = elements(pane, 'view');
    const paneView = paneViews.length === 1 ? paneViews[0] : null;
    const breakdown = paneView ? oneChild(paneView, 'breakdown') : null;
    const breakdownValue = breakdown?.getAttribute('value') ?? '';
    if (
      !paneView ||
      paneView.attributes.length > 0 ||
      elements(paneView).length !== 1 ||
      (paneView.textContent?.trim() ?? '') !== '' ||
      !breakdown ||
      !hasOnlyAttributes(breakdown, { value: breakdownValue }) ||
      elements(breakdown).length > 0 ||
      (breakdown.textContent?.trim() ?? '') !== '' ||
      !['auto', 'on', 'off'].includes(breakdownValue)
    ) {
      return refusal('round_bar requires one plain Stack Marks setting for a Color bar.');
    }
    if (breakdownValue === 'off') {
      return refusal('round_bar does not support a Color bar when Stack Marks is off.');
    }
  }
  if (
    [category, segment, measure]
      .filter((instance): instance is ColumnInstance => !!instance)
      .some(
        (instance) =>
          (definitions.get(instance.column)?.element.getElementsByTagName('calculation').length ??
            0) > 0,
      )
  ) {
    return refusal('round_bar does not support calculated Category, Segment, or Value fields.');
  }

  const filter = readFilter(base.view, base.datasourceName, instances, definitions);
  if (!filter.ok) return filter;
  const acceptedInstanceNames = [
    category.name,
    measure.name,
    ...(segment ? [segment.name] : []),
    ...(filter.value ? [filter.value.columnInstance] : []),
  ];
  if (
    acceptedInstanceNames.some(
      (name) => instances.filter((instance) => instance.name === name).length !== 1,
    )
  ) {
    return refusal(
      'round_bar refuses duplicate Category, Segment, SUM, or filter column instances.',
    );
  }
  const acceptedDefinitionNames = [
    category.column,
    measure.column,
    ...(segment ? [segment.column] : []),
    ...(filter.allowedColumn ? [filter.allowedColumn] : []),
  ];
  if (
    acceptedDefinitionNames.some(
      (name) =>
        elements(base.dependency, 'column').filter(
          (definition) => definition.getAttribute('name') === name,
        ).length !== 1,
    )
  ) {
    return refusal(
      'round_bar refuses duplicate Category, Segment, SUM, or filter source definitions.',
    );
  }
  const allowedColumns = new Set([
    category.column,
    ...(segment ? [segment.column] : []),
    measure.column,
    ...(filter.allowedColumn ? [filter.allowedColumn] : []),
  ]);
  const extraDefinition = [...definitions.values()].find(
    (definition) => !allowedColumns.has(definition.name),
  );
  const extraInstance = instances.find((instance) => !allowedColumns.has(instance.column));
  if (extraDefinition || extraInstance) {
    return refusal('round_bar refuses an extra field outside Category, Segment, SUM, and filter.');
  }

  const anySort = Array.from(base.view.getElementsByTagName('sort'));
  if (anySort.length > 0) {
    return refusal('round_bar does not support a manual Segment order.');
  }
  const computedSorts = elements(base.view, 'computed-sort');
  if (computedSorts.length > 1) {
    return refusal('round_bar supports at most one category computed sort.');
  }
  if (computedSorts.length === 1) {
    const sort = computedSorts[0];
    if (
      sort.getAttribute('column') !== qualified(base.datasourceName, category.name) ||
      sort.getAttribute('using') !== qualified(base.datasourceName, measure.name) ||
      !['ASC', 'DESC'].includes(sort.getAttribute('direction') ?? '') ||
      elements(sort).length > 0
    ) {
      return refusal('round_bar supports only one simple category computed sort.');
    }
  }

  const tableStyle = oneChild(base.table, 'style');
  if (!tableStyle) return refusal('round_bar requires one supported worksheet style block.');
  const supportedTableStyleRules = new Set([
    'axis',
    'cell',
    'gridline',
    'mark',
    'table-div',
    'worksheet',
    'zeroline',
  ]);
  const sourceMeasure = qualified(base.datasourceName, measure.name);
  const measureScope = orientation === 'vertical' ? 'rows' : 'cols';
  const sourceMeasureAxisFormats = new Set<string>();
  const sourceMeasureTitleFormats: Element[] = [];
  for (const styleRule of elements(tableStyle, 'style-rule')) {
    const element = styleRule.getAttribute('element') ?? '';
    if (!supportedTableStyleRules.has(element)) {
      return refusal(`round_bar does not support the ${element || 'unnamed'} table style.`);
    }
    if (styleRule.getAttribute('element') !== 'axis') continue;
    if (styleRule.getElementsByTagName('encoding').length > 0) {
      return refusal('round_bar does not support a source axis encoding.');
    }
    for (const format of Array.from(styleRule.getElementsByTagName('format'))) {
      if (format.getAttribute('attr') === 'title') {
        const field = format.getAttribute('field');
        const scope = format.getAttribute('scope') ?? '';
        if (field === sourceMeasure) {
          if (scope !== measureScope) {
            return refusal(`round_bar requires the measure axis title on ${measureScope}.`);
          }
          sourceMeasureTitleFormats.push(format);
        } else if (scope === '' || scope === measureScope) {
          return refusal('round_bar refuses an ambiguous measure-axis title slot.');
        }
      }
      if (format.getAttribute('field') === sourceMeasure) {
        const signature = axisFormatSlotSignature(format);
        if (sourceMeasureAxisFormats.has(signature)) {
          return refusal('round_bar refuses a duplicate source-measure axis format.');
        }
        sourceMeasureAxisFormats.add(signature);
      }
      const attr = format.getAttribute('attr') ?? '';
      const value = (format.getAttribute('value') ?? '').toLowerCase();
      if (attr.startsWith('fixed-') || (attr === 'type' && value !== 'linear')) {
        return refusal('round_bar requires a linear auto axis.');
      }
    }
  }
  if (sourceMeasureTitleFormats.length > 1) {
    return refusal('round_bar refuses ambiguous duplicate measure axis title slots.');
  }

  const paneStyles = elements(pane, 'style');
  if (paneStyles.length > 1) {
    return refusal('round_bar supports at most one pane style block.');
  }
  if (paneStyles.length === 1) {
    const supportedPaneFormats = new Set(['mark-color', 'mark-transparency', 'size']);
    for (const styleRule of elements(paneStyles[0], 'style-rule')) {
      if (styleRule.getAttribute('element') !== 'mark') {
        return refusal('round_bar supports only mark styling inside the pane.');
      }
      if (
        Array.from(styleRule.getElementsByTagName('format')).some(
          (format) => !supportedPaneFormats.has(format.getAttribute('attr') ?? ''),
        )
      ) {
        return refusal('round_bar does not support this pane mark style.');
      }
    }
  }

  const aggregation = oneChild(base.view, 'aggregation');
  if (!aggregation || aggregation.getAttribute('value') !== 'true') {
    return refusal('round_bar requires an aggregated worksheet.');
  }
  return {
    ...base,
    category,
    columnDefinitions: definitions,
    filter: filter.value,
    measure,
    orientation,
    pane,
    segment,
    worksheet: parsed.worksheet,
  };
}

function recognizeRounded(
  parsed: ParsedXml,
  base: Exclude<ReturnType<typeof baseNodes>, RoundStackedBarRefusal>,
  prefix: string,
  names: HelperNames,
): BaseShape | RoundStackedBarRefusal | null {
  const definitions = columnDefinitions(base.dependency);
  const present = HELPER_SUFFIXES.filter((suffix) => definitions.has(names[suffix]));
  if (present.length === 0) return null;
  const panes = oneChild(base.table, 'panes');
  const paneList = panes ? elements(panes, 'pane') : [];
  const pane = paneList.length === 1 ? paneList[0] : null;
  const mark = pane ? oneChild(pane, 'mark') : null;
  if (!pane || mark?.getAttribute('class') !== 'Polygon') {
    return refusal(
      'the helper-bearing worksheet does not match the deterministic rounded signature.',
    );
  }
  const instances = columnInstances(base.dependency).filter(
    (instance) => !instance.column.startsWith(`[${prefix}`),
  );
  const encodings = oneChild(pane, 'encodings');
  const color = encodings ? elements(encodings, 'color')[0] : null;
  const segmentName = color
    ? unqualify(color.getAttribute('column') ?? '', base.datasourceName)
    : null;
  const segment = segmentName
    ? instances.find((instance) => instance.name === segmentName)
    : undefined;
  const rows = shelfText(oneChild(base.table, 'rows'));
  const cols = shelfText(oneChild(base.table, 'cols'));
  const xField = qualified(base.datasourceName, helperColumnInstance('x', names.x)!);
  const yField = qualified(base.datasourceName, helperColumnInstance('y', names.y)!);
  const productShelf = (shelf: string, helperField: string): string => {
    const match = shelf.match(/^\((\[[^\n]+?\]\.\[[^\n]+?\])\s+\*\s+(\[[^\n]+?\]\.\[[^\n]+?\])\)$/);
    return match?.[2] === helperField ? match[1] : '';
  };
  const verticalCategory = rows === yField ? productShelf(cols, xField) : '';
  const horizontalCategory = cols === xField ? productShelf(rows, yField) : '';
  const orientation = verticalCategory ? 'vertical' : horizontalCategory ? 'horizontal' : null;
  const categoryReference = verticalCategory || horizontalCategory;
  const categoryName = unqualify(categoryReference, base.datasourceName);
  const category = instances.find((instance) => instance.name === categoryName);
  const measureCandidates = instances.filter(
    (instance) => instance.derivation === 'Sum' && instance.type === 'quantitative',
  );
  if (!orientation || !category || (segmentName && !segment) || measureCandidates.length !== 1) {
    return refusal(
      'the helper-bearing worksheet does not match the deterministic rounded signature.',
    );
  }
  const filter = readFilter(base.view, base.datasourceName, instances, definitions);
  if (!filter.ok) return filter;
  const shape: BaseShape = {
    ...base,
    category,
    columnDefinitions: definitions,
    filter: filter.value,
    measure: measureCandidates[0],
    orientation,
    pane,
    segment,
    worksheet: parsed.worksheet,
  };
  const activeRoles = activeHelperRoles(shape);
  if (
    present.length !== activeRoles.length ||
    activeRoles.some(
      (role) => definitions.get(names[role])?.element.getAttribute('hidden') !== 'true',
    )
  ) {
    return refusal(
      'the helper-bearing worksheet does not match the deterministic rounded signature.',
    );
  }
  if (!hasDeterministicRoundedSignature(shape, names)) {
    return refusal(
      'the helper-bearing worksheet does not match the deterministic rounded signature.',
    );
  }
  return shape;
}

function addCalculation(
  document: Document,
  dependency: Element,
  name: string,
  caption: string,
  datatype: 'integer' | 'real',
  formula: string,
  tableCalculation: boolean,
): Element {
  const column = document.createElement('column');
  column.setAttribute('caption', caption);
  column.setAttribute('datatype', datatype);
  column.setAttribute('hidden', 'true');
  column.setAttribute('name', name);
  column.setAttribute('role', 'measure');
  column.setAttribute('type', 'quantitative');
  const calculation = document.createElement('calculation');
  calculation.setAttribute('class', 'tableau');
  calculation.setAttribute('formula', formula);
  if (tableCalculation) {
    const tableCalc = document.createElement('table-calc');
    tableCalc.setAttribute('ordering-type', 'Rows');
    calculation.appendChild(tableCalc);
  }
  column.appendChild(calculation);
  const firstInstance = elements(dependency, 'column-instance')[0] ?? null;
  dependency.insertBefore(column, firstInstance);
  return column;
}

interface HelperCalculationSpec {
  datatype: 'integer' | 'real';
  formula: string;
  role: Exclude<RoundStackedBarHelperRole, 'bin'>;
  tableCalculation: boolean;
}

function helperCalculationSpecs(shape: BaseShape, names: HelperNames): HelperCalculationSpec[] {
  const rawMeasure = shape.measure.column;
  const fixedFields = [shape.category.column, ...(shape.segment ? [shape.segment.column] : [])];
  if (shape.filter) {
    const filterInstance = columnInstances(shape.dependency).find(
      (instance) => instance.name === shape.filter?.columnInstance,
    );
    if (filterInstance) fixedFields.push(filterInstance.column);
  }
  const f = (suffix: RoundStackedBarHelperRole): string => names[suffix];
  const stackedEndpoints: Array<
    [Exclude<RoundStackedBarHelperRole, 'bin'>, string, 'integer' | 'real', boolean?]
  > = shape.segment
    ? [
        ['pos_end', `WINDOW_SUM(${f('pos')})-RUNNING_SUM(${f('pos')})+${f('pos')}`, 'real'],
        ['neg_end', `WINDOW_SUM(${f('neg')})-RUNNING_SUM(${f('neg')})+${f('neg')}`, 'real'],
        [
          'lo',
          `IF ${f('dense')} >= 0 THEN ${f('pos_end')}-${f('pos')} ELSE ${f('neg_end')} END`,
          'real',
        ],
        [
          'hi',
          `IF ${f('dense')} >= 0 THEN ${f('pos_end')} ELSE ${f('neg_end')}-${f('neg')} END`,
          'real',
        ],
        ['span', `WINDOW_SUM(${f('pos')})-WINDOW_SUM(${f('neg')})`, 'real'],
        [
          'top_radius_y',
          `IF ${f('pos')} > 0 AND ${f('pos_end')} = WINDOW_SUM(${f('pos')}) THEN ${f('radius_y')} ELSE 0 END`,
          'real',
        ],
        [
          'bottom_radius_y',
          `IF ${f('neg')} < 0 AND ${f('neg_end')} = WINDOW_SUM(${f('neg')}) THEN ${f('radius_y')} ELSE 0 END`,
          'real',
        ],
      ]
    : [
        ['pos_end', f('pos'), 'real'],
        ['neg_end', f('neg'), 'real'],
        ['lo', `IF ${f('dense')} >= 0 THEN 0 ELSE ${f('dense')} END`, 'real'],
        ['hi', `IF ${f('dense')} >= 0 THEN ${f('dense')} ELSE 0 END`, 'real'],
        ['span', `ABS(${f('dense')})`, 'real'],
        ['top_radius_y', `IF ${f('dense')} > 0 THEN ${f('radius_y')} ELSE 0 END`, 'real'],
        ['bottom_radius_y', `IF ${f('dense')} < 0 THEN ${f('radius_y')} ELSE 0 END`, 'real'],
      ];
  const endpointByRole = new Map(stackedEndpoints.map((spec) => [spec[0], spec]));
  const categoryBand = `CASE INDEX() WHEN 1 THEN -0.35 WHEN 2 THEN -0.35 WHEN 3 THEN -0.35+0.292893*${f('top_radius_x')} WHEN 4 THEN -0.35+${f('top_radius_x')} WHEN 5 THEN 0.35-${f('top_radius_x')} WHEN 6 THEN 0.35-0.292893*${f('top_radius_x')} WHEN 7 THEN 0.35 WHEN 8 THEN 0.35 WHEN 9 THEN 0.35-0.292893*${f('bottom_radius_x')} WHEN 10 THEN 0.35-${f('bottom_radius_x')} WHEN 11 THEN -0.35+${f('bottom_radius_x')} WHEN 12 THEN -0.35+0.292893*${f('bottom_radius_x')} END`;
  const measureExtent = `CASE INDEX() WHEN 1 THEN ${f('lo')}+${f('bottom_radius_y')} WHEN 2 THEN ${f('hi')}-${f('top_radius_y')} WHEN 3 THEN ${f('hi')}-0.292893*${f('top_radius_y')} WHEN 4 THEN ${f('hi')} WHEN 5 THEN ${f('hi')} WHEN 6 THEN ${f('hi')}-0.292893*${f('top_radius_y')} WHEN 7 THEN ${f('hi')}-${f('top_radius_y')} WHEN 8 THEN ${f('lo')}+${f('bottom_radius_y')} WHEN 9 THEN ${f('lo')}+0.292893*${f('bottom_radius_y')} WHEN 10 THEN ${f('lo')} WHEN 11 THEN ${f('lo')} WHEN 12 THEN ${f('lo')}+0.292893*${f('bottom_radius_y')} END`;
  const calculations: Array<
    [Exclude<RoundStackedBarHelperRole, 'bin'>, string, 'integer' | 'real', boolean?]
  > = [
    [
      'seed',
      `IF ${rawMeasure} = { FIXED ${fixedFields.join(', ')} : MIN(${rawMeasure}) } THEN 0 ELSE 11 END`,
      'integer',
      false,
    ],
    ['dense', `WINDOW_SUM(SUM(${rawMeasure}))`, 'real'],
    ['pos', `IF ${f('dense')} > 0 THEN ${f('dense')} ELSE 0 END`, 'real'],
    ['neg', `IF ${f('dense')} < 0 THEN ${f('dense')} ELSE 0 END`, 'real'],
    endpointByRole.get('pos_end')!,
    endpointByRole.get('neg_end')!,
    endpointByRole.get('lo')!,
    endpointByRole.get('hi')!,
    endpointByRole.get('span')!,
    [
      'radius_y',
      `IF ABS(${f('dense')})/2 < 0.02*${f('span')} THEN ABS(${f('dense')})/2 ELSE 0.02*${f('span')} END`,
      'real',
    ],
    endpointByRole.get('top_radius_y')!,
    endpointByRole.get('bottom_radius_y')!,
    ['top_radius_x', `IF ${f('top_radius_y')} > 0 THEN 0.06 ELSE 0 END`, 'real'],
    ['bottom_radius_x', `IF ${f('bottom_radius_y')} > 0 THEN 0.06 ELSE 0 END`, 'real'],
    ['path', 'INDEX()', 'integer'],
    ['x', shape.orientation === 'vertical' ? categoryBand : measureExtent, 'real'],
    ['y', shape.orientation === 'vertical' ? measureExtent : categoryBand, 'real'],
  ];
  const activeRoles = new Set(activeHelperRoles(shape));
  return calculations
    .filter(([role]) => activeRoles.has(role))
    .map(([role, formula, datatype, tableCalculation = true]) => ({
      datatype,
      formula,
      role,
      tableCalculation,
    }));
}

function addHelpers(document: Document, shape: BaseShape, names: HelperNames): void {
  const calculations = helperCalculationSpecs(shape, names);
  const seed = calculations[0];
  addCalculation(
    document,
    shape.dependency,
    names.seed,
    helperCaption('seed'),
    seed.datatype,
    seed.formula,
    seed.tableCalculation,
  );

  const bin = document.createElement('column');
  bin.setAttribute('aggregation', 'None');
  bin.setAttribute('caption', helperCaption('bin'));
  bin.setAttribute('datatype', 'integer');
  bin.setAttribute('hidden', 'true');
  bin.setAttribute('name', names.bin);
  bin.setAttribute('role', 'dimension');
  bin.setAttribute('type', 'ordinal');
  const binCalculation = document.createElement('calculation');
  binCalculation.setAttribute('class', 'bin');
  binCalculation.setAttribute('decimals', '0');
  binCalculation.setAttribute('formula', names.seed);
  binCalculation.setAttribute('peg', '0');
  binCalculation.setAttribute('size', '1');
  bin.appendChild(binCalculation);
  shape.dependency.insertBefore(bin, elements(shape.dependency, 'column-instance')[0] ?? null);

  for (const { role, formula, datatype, tableCalculation } of calculations.slice(1)) {
    const helper = addCalculation(
      document,
      shape.dependency,
      names[role],
      helperCaption(role),
      datatype,
      formula,
      tableCalculation,
    );
    const sourceMeasure = shape.columnDefinitions.get(shape.measure.column)?.element;
    const measureRole = shape.orientation === 'vertical' ? 'y' : 'x';
    if (role === measureRole && sourceMeasure?.hasAttribute('default-format')) {
      helper.setAttribute('default-format', sourceMeasure.getAttribute('default-format') ?? '');
    }
  }
}

function hasOnlyAttributes(element: Element, expected: Record<string, string>): boolean {
  const attributes = Array.from(element.attributes);
  return (
    attributes.length === Object.keys(expected).length &&
    attributes.every((attribute) => expected[attribute.name] === attribute.value)
  );
}

function axisFormatSlotSignature(element: Element): string {
  return JSON.stringify(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name !== 'value')
      .map((attribute) => [attribute.name, attribute.value] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function helperDefinitionsMatch(shape: BaseShape, names: HelperNames): boolean {
  const sourceMeasureDefinitions = elements(shape.dependency, 'column').filter(
    (definition) => definition.getAttribute('name') === shape.measure.column,
  );
  if (sourceMeasureDefinitions.length !== 1) return false;
  const sourceMeasureDefinition = sourceMeasureDefinitions[0];
  const definitions = elements(shape.dependency, 'column').filter((column) =>
    (column.getAttribute('name') ?? '').startsWith(`[${shape.worksheetId ? '__tmcp_round_' : ''}`),
  );
  const activeRoles = activeHelperRoles(shape);
  const expectedNames = new Set(activeRoles.map((role) => names[role]));
  const generatedDefinitions = definitions.filter((definition) =>
    expectedNames.has(definition.getAttribute('name') ?? ''),
  );
  const allPrefixedDefinitions = elements(shape.dependency, 'column').filter((column) =>
    (column.getAttribute('name') ?? '').startsWith(
      `[${unbracket(names.seed).slice(0, -'seed'.length)}`,
    ),
  );
  if (
    generatedDefinitions.length !== activeRoles.length ||
    allPrefixedDefinitions.length !== activeRoles.length
  ) {
    return false;
  }

  const specs = new Map(helperCalculationSpecs(shape, names).map((spec) => [spec.role, spec]));
  for (const role of activeRoles) {
    const definition = shape.columnDefinitions.get(names[role])?.element;
    if (!definition) return false;
    const children = elements(definition);
    if (children.length !== 1 || children[0].tagName !== 'calculation') return false;
    const calculation = children[0];
    if (role === 'bin') {
      if (
        !hasOnlyAttributes(definition, {
          aggregation: 'None',
          caption: helperCaption(role),
          datatype: 'integer',
          hidden: 'true',
          name: names[role],
          role: 'dimension',
          type: 'ordinal',
        }) ||
        !hasOnlyAttributes(calculation, {
          class: 'bin',
          decimals: '0',
          formula: names.seed,
          peg: '0',
          size: '1',
        }) ||
        elements(calculation).length !== 0
      ) {
        return false;
      }
      continue;
    }

    const spec = specs.get(role);
    const expectedDefinitionAttributes: Record<string, string> = {
      caption: helperCaption(role),
      datatype: spec?.datatype ?? '',
      hidden: 'true',
      name: names[role],
      role: 'measure',
      type: 'quantitative',
    };
    const measureRole = shape.orientation === 'vertical' ? 'y' : 'x';
    if (role === measureRole && sourceMeasureDefinition.hasAttribute('default-format')) {
      expectedDefinitionAttributes['default-format'] =
        sourceMeasureDefinition.getAttribute('default-format') ?? '';
    }
    if (
      !spec ||
      !hasOnlyAttributes(definition, expectedDefinitionAttributes) ||
      !hasOnlyAttributes(calculation, { class: 'tableau', formula: spec.formula })
    ) {
      return false;
    }
    const calculationChildren = elements(calculation);
    if (spec.tableCalculation) {
      if (
        calculationChildren.length !== 1 ||
        calculationChildren[0].tagName !== 'table-calc' ||
        !hasOnlyAttributes(calculationChildren[0], { 'ordering-type': 'Rows' })
      ) {
        return false;
      }
    } else if (calculationChildren.length !== 0) {
      return false;
    }
  }
  return true;
}

const BIN_ORDERED_GEOMETRY_ROLES = ['dense', 'pos', 'neg'] as const;
const SEGMENT_ORDERED_GEOMETRY_ROLES = {
  x: [
    'pos_end',
    'neg_end',
    'span',
    'radius_y',
    'top_radius_y',
    'bottom_radius_y',
    'top_radius_x',
    'bottom_radius_x',
  ],
  y: ['pos_end', 'neg_end', 'lo', 'hi', 'span', 'radius_y', 'top_radius_y', 'bottom_radius_y'],
} as const;

function geometryDependencyRole(shape: BaseShape, role: 'x' | 'y'): 'x' | 'y' {
  return shape.orientation === 'vertical' ? role : role === 'x' ? 'y' : 'x';
}

function expectedTableCalcSignatures(
  shape: BaseShape,
  names: HelperNames,
  role: 'x' | 'y',
): string[] {
  const binField = qualified(shape.datasourceName, names.bin);
  const activeRoles = new Set(activeHelperRoles(shape));
  const segmentField = shape.segment
    ? qualified(shape.datasourceName, shape.segment.name)
    : binField;
  return [
    `|${binField}|Field`,
    ...BIN_ORDERED_GEOMETRY_ROLES.filter((helperRole) => activeRoles.has(helperRole)).map(
      (role) => `${qualified(shape.datasourceName, names[role])}|${binField}|Field`,
    ),
    ...SEGMENT_ORDERED_GEOMETRY_ROLES[geometryDependencyRole(shape, role)]
      .filter((helperRole) => activeRoles.has(helperRole))
      .map(
        (helperRole) =>
          `${qualified(shape.datasourceName, names[helperRole])}|${segmentField}|Field`,
      ),
  ].sort();
}

function actualTableCalcSignatures(instance: Element): string[] | null {
  const tableCalcs = elements(instance);
  if (
    tableCalcs.some(
      (tableCalc) =>
        tableCalc.tagName !== 'table-calc' ||
        elements(tableCalc).length !== 0 ||
        Array.from(tableCalc.attributes).some(
          (attribute) => !['field', 'ordering-field', 'ordering-type'].includes(attribute.name),
        ),
    )
  ) {
    return null;
  }
  return tableCalcs
    .map(
      (tableCalc) =>
        `${tableCalc.getAttribute('field') ?? ''}|${tableCalc.getAttribute('ordering-field') ?? ''}|${tableCalc.getAttribute('ordering-type') ?? ''}`,
    )
    .sort();
}

function helperInstancesMatch(shape: BaseShape, names: HelperNames): boolean {
  const prefix = unbracket(names.seed).slice(0, -'seed'.length);
  const instances = elements(shape.dependency, 'column-instance').filter((instance) =>
    (instance.getAttribute('column') ?? '').startsWith(`[${prefix}`),
  );
  if (instances.length !== 4) return false;
  const byColumn = new Map(
    instances.map((instance) => [instance.getAttribute('column'), instance]),
  );
  const bin = byColumn.get(names.bin);
  const path = byColumn.get(names.path);
  const x = byColumn.get(names.x);
  const y = byColumn.get(names.y);
  if (!bin || !path || !x || !y) return false;
  if (
    !hasOnlyAttributes(bin, {
      column: names.bin,
      derivation: 'None',
      name: helperColumnInstance('bin', names.bin)!,
      pivot: 'key',
      type: 'ordinal',
    }) ||
    elements(bin).length !== 0
  ) {
    return false;
  }
  if (
    !hasOnlyAttributes(path, {
      column: names.path,
      derivation: 'User',
      name: helperColumnInstance('path', names.path)!,
      pivot: 'key',
      type: 'quantitative',
    }) ||
    JSON.stringify(actualTableCalcSignatures(path)) !==
      JSON.stringify([`|${qualified(shape.datasourceName, names.bin)}|Field`])
  ) {
    return false;
  }
  for (const [role, instance] of [
    ['x', x],
    ['y', y],
  ] as const) {
    if (
      !hasOnlyAttributes(instance, {
        column: names[role],
        derivation: 'User',
        name: helperColumnInstance(role, names[role])!,
        pivot: 'key',
        type: 'quantitative',
      }) ||
      JSON.stringify(actualTableCalcSignatures(instance)) !==
        JSON.stringify(expectedTableCalcSignatures(shape, names, role))
    ) {
      return false;
    }
  }
  return true;
}

function roundedPaneMatches(shape: BaseShape, names: HelperNames): boolean {
  const encodings = oneChild(shape.pane, 'encodings');
  if (!encodings) return false;
  const encodingChildren = elements(encodings);
  if (encodingChildren.length !== (shape.segment ? 3 : 2)) return false;
  const expectedEncodings: Record<string, string> = {
    ...(shape.segment ? { color: qualified(shape.datasourceName, shape.segment.name) } : {}),
    lod: qualified(shape.datasourceName, helperColumnInstance('bin', names.bin)!),
    path: qualified(shape.datasourceName, helperColumnInstance('path', names.path)!),
  };
  if (
    encodingChildren.some(
      (encoding) =>
        !expectedEncodings[encoding.tagName] ||
        !hasOnlyAttributes(encoding, { column: expectedEncodings[encoding.tagName] }),
    ) ||
    new Set(encodingChildren.map((encoding) => encoding.tagName)).size !== (shape.segment ? 3 : 2)
  ) {
    return false;
  }

  const tooltips = elements(shape.pane, 'customized-tooltip');
  if (tooltips.length !== 1) return false;
  const formatted = oneChild(tooltips[0], 'formatted-text');
  if (!formatted || elements(tooltips[0]).length !== 1) return false;
  const runs = elements(formatted, 'run');
  const fields: Array<[string, string]> = [
    [
      shape.columnDefinitions.get(shape.category.column)?.caption ??
        unbracket(shape.category.column),
      qualified(shape.datasourceName, shape.category.name),
    ],
    ...(shape.segment
      ? [
          [
            shape.columnDefinitions.get(shape.segment.column)?.caption ??
              unbracket(shape.segment.column),
            qualified(shape.datasourceName, shape.segment.name),
          ] as [string, string],
        ]
      : []),
    [
      shape.columnDefinitions.get(shape.measure.column)?.caption ?? unbracket(shape.measure.column),
      qualified(shape.datasourceName, shape.measure.name),
    ],
  ];
  const expectedRuns: Array<{ attributes: Record<string, string>; text: string }> = [];
  fields.forEach(([caption, reference], index) => {
    expectedRuns.push(
      { attributes: { bold: 'true' }, text: `${caption}: ` },
      { attributes: {}, text: `<${reference}>` },
    );
    if (index < fields.length - 1) expectedRuns.push({ attributes: {}, text: 'Æ\n' });
  });
  return (
    runs.length === expectedRuns.length &&
    runs.every(
      (run, index) =>
        hasOnlyAttributes(run, expectedRuns[index].attributes) &&
        run.textContent === expectedRuns[index].text,
    )
  );
}

function roundedAxesMatch(shape: BaseShape, names: HelperNames): boolean {
  const style = oneChild(shape.table, 'style');
  if (!style) return false;
  const axisRules = elements(style, 'style-rule').filter(
    (rule) => rule.getAttribute('element') === 'axis',
  );
  if (axisRules.some((rule) => rule.getElementsByTagName('encoding').length > 0)) return false;

  const formats = axisRules.flatMap((rule) => Array.from(rule.getElementsByTagName('format')));
  const sourceMeasure = qualified(shape.datasourceName, shape.measure.name);
  const measureRole = shape.orientation === 'vertical' ? 'y' : 'x';
  const bandRole = measureRole === 'y' ? 'x' : 'y';
  const measureField = qualified(
    shape.datasourceName,
    helperColumnInstance(measureRole, names[measureRole])!,
  );
  const bandField = qualified(
    shape.datasourceName,
    helperColumnInstance(bandRole, names[bandRole])!,
  );
  const measureScope = shape.orientation === 'vertical' ? 'rows' : 'cols';
  const bandScope = shape.orientation === 'vertical' ? 'cols' : 'rows';
  if (formats.some((format) => format.getAttribute('field') === sourceMeasure)) return false;

  const bandFormats = formats.filter((format) => format.getAttribute('field') === bandField);
  if (bandFormats.length !== 1) return false;
  const bandFormat = bandFormats[0];
  const bandRule = bandFormat.parentNode;
  if (
    !hasOnlyAttributes(bandFormat, {
      attr: 'display',
      class: '0',
      field: bandField,
      scope: bandScope,
      value: 'false',
    }) ||
    !bandRule ||
    bandRule.nodeType !== 1 ||
    (bandRule as Element).tagName !== 'style-rule' ||
    bandRule !== axisRules[0] ||
    !hasOnlyAttributes(bandRule as Element, { element: 'axis' })
  ) {
    return false;
  }

  const helperAxisFields = new Set(
    activeHelperRoles(shape).flatMap((role) => {
      const instance = helperColumnInstance(role, names[role]);
      return instance ? [qualified(shape.datasourceName, instance)] : [];
    }),
  );
  if (
    formats.some((format) => {
      const field = format.getAttribute('field');
      return (
        field !== null &&
        helperAxisFields.has(field) &&
        field !== bandField &&
        field !== measureField
      );
    })
  ) {
    return false;
  }

  const measureFormats = formats.filter((format) => format.getAttribute('field') === measureField);
  const measureFormatSignatures = measureFormats.map(axisFormatSlotSignature);
  const measureTitleFormats = formats.filter(
    (format) =>
      format.getAttribute('attr') === 'title' &&
      ['', measureScope].includes(format.getAttribute('scope') ?? ''),
  );
  return (
    new Set(measureFormatSignatures).size === measureFormatSignatures.length &&
    measureTitleFormats.length === 1 &&
    measureTitleFormats[0].getAttribute('field') === measureField &&
    measureTitleFormats[0].getAttribute('scope') === measureScope
  );
}

function hasDeterministicRoundedSignature(shape: BaseShape, names: HelperNames): boolean {
  const rows = oneChild(shape.table, 'rows');
  const cols = oneChild(shape.table, 'cols');
  const fullRanges = elements(shape.table, 'show-full-range');
  const fullRangeColumn = fullRanges.length === 1 ? oneChild(fullRanges[0], 'column') : null;
  const xField = qualified(shape.datasourceName, helperColumnInstance('x', names.x)!);
  const yField = qualified(shape.datasourceName, helperColumnInstance('y', names.y)!);
  const categoryField = qualified(shape.datasourceName, shape.category.name);
  const shelvesMatch =
    shape.orientation === 'vertical'
      ? shelfText(rows) === yField && shelfText(cols) === `(${categoryField} * ${xField})`
      : shelfText(rows) === `(${categoryField} * ${yField})` && shelfText(cols) === xField;
  return (
    shelvesMatch &&
    fullRanges.length === 1 &&
    fullRangeColumn !== null &&
    elements(fullRanges[0]).length === 1 &&
    shelfText(fullRangeColumn) === qualified(shape.datasourceName, names.bin) &&
    helperDefinitionsMatch(shape, names) &&
    helperInstancesMatch(shape, names) &&
    roundedPaneMatches(shape, names) &&
    roundedAxesMatch(shape, names)
  );
}

function tableCalc(document: Document, attributes: Record<string, string>): Element {
  const tableCalc = document.createElement('table-calc');
  for (const [name, value] of Object.entries(attributes)) tableCalc.setAttribute(name, value);
  return tableCalc;
}

function addColumnInstance(
  document: Document,
  dependency: Element,
  column: string,
  name: string,
  type: 'ordinal' | 'quantitative',
): Element {
  const instance = document.createElement('column-instance');
  instance.setAttribute('column', column);
  instance.setAttribute('derivation', type === 'ordinal' ? 'None' : 'User');
  instance.setAttribute('name', name);
  instance.setAttribute('pivot', 'key');
  instance.setAttribute('type', type);
  dependency.appendChild(instance);
  return instance;
}

function sortDependencyDeclarations(dependency: Element): void {
  const direct = elements(dependency);
  if (
    direct.length === 0 ||
    direct.some((element) => !['column', 'column-instance'].includes(element.tagName))
  ) {
    return;
  }
  const byName = (left: Element, right: Element): number => {
    const a = left.getAttribute('name') ?? '';
    const b = right.getAttribute('name') ?? '';
    return a < b ? -1 : a > b ? 1 : 0;
  };
  for (const declaration of direct) dependency.removeChild(declaration);
  for (const declaration of [
    ...direct.filter((element) => element.tagName === 'column').sort(byName),
    ...direct.filter((element) => element.tagName === 'column-instance').sort(byName),
  ]) {
    dependency.appendChild(declaration);
  }
}

function addHelperInstances(
  document: Document,
  shape: BaseShape,
  names: HelperNames,
): { bin: string; path: string; x: string; y: string } {
  const bin = helperColumnInstance('bin', names.bin)!;
  const path = helperColumnInstance('path', names.path)!;
  const x = helperColumnInstance('x', names.x)!;
  const y = helperColumnInstance('y', names.y)!;
  addColumnInstance(document, shape.dependency, names.bin, bin, 'ordinal');

  const binField = qualified(shape.datasourceName, names.bin);
  const segmentField = shape.segment
    ? qualified(shape.datasourceName, shape.segment.name)
    : binField;
  const activeRoles = new Set(activeHelperRoles(shape));
  const pathInstance = addColumnInstance(
    document,
    shape.dependency,
    names.path,
    path,
    'quantitative',
  );
  pathInstance.appendChild(
    tableCalc(document, { 'ordering-field': binField, 'ordering-type': 'Field' }),
  );

  for (const [column, instanceName] of [
    [names.x, x],
    [names.y, y],
  ] as const) {
    const instance = addColumnInstance(
      document,
      shape.dependency,
      column,
      instanceName,
      'quantitative',
    );
    instance.appendChild(
      tableCalc(document, { 'ordering-field': binField, 'ordering-type': 'Field' }),
    );
    for (const suffix of BIN_ORDERED_GEOMETRY_ROLES.filter((helperRole) =>
      activeRoles.has(helperRole),
    )) {
      instance.appendChild(
        tableCalc(document, {
          field: qualified(shape.datasourceName, names[suffix]),
          'ordering-field': binField,
          'ordering-type': 'Field',
        }),
      );
    }
    const role = column === names.x ? 'x' : 'y';
    for (const suffix of SEGMENT_ORDERED_GEOMETRY_ROLES[geometryDependencyRole(shape, role)].filter(
      (helperRole) => activeRoles.has(helperRole),
    )) {
      instance.appendChild(
        tableCalc(document, {
          field: qualified(shape.datasourceName, names[suffix]),
          'ordering-field': segmentField,
          'ordering-type': 'Field',
        }),
      );
    }
  }
  return { bin, path, x, y };
}

function tooltipRun(document: Document, text: string, bold = false): Element {
  const run = document.createElement('run');
  if (bold) run.setAttribute('bold', 'true');
  run.appendChild(document.createTextNode(text));
  return run;
}

function customizePane(
  document: Document,
  shape: BaseShape,
  names: HelperNames,
  instances: { bin: string; path: string; x: string; y: string },
): void {
  const mark = oneChild(shape.pane, 'mark');
  mark?.setAttribute('class', 'Polygon');
  let encodings = oneChild(shape.pane, 'encodings');
  if (!encodings) {
    encodings = document.createElement('encodings');
    const paneChildren = elements(shape.pane);
    const markIndex = mark ? paneChildren.indexOf(mark) : -1;
    shape.pane.insertBefore(encodings, paneChildren[markIndex + 1] ?? null);
  }
  while (encodings.firstChild) encodings.removeChild(encodings.firstChild);
  const generatedEncodings: Array<[string, string]> = [
    ...(shape.segment
      ? [['color', qualified(shape.datasourceName, shape.segment.name)] as [string, string]]
      : []),
    ['lod', qualified(shape.datasourceName, instances.bin)],
    ['path', qualified(shape.datasourceName, instances.path)],
  ];
  for (const [tagName, column] of generatedEncodings) {
    const encoding = document.createElement(tagName);
    encoding.setAttribute('column', column);
    encodings.appendChild(encoding);
  }

  const customized = document.createElement('customized-tooltip');
  const formatted = document.createElement('formatted-text');
  const tooltipFields: Array<[string, string]> = [
    [
      shape.columnDefinitions.get(shape.category.column)?.caption ??
        unbracket(shape.category.column),
      qualified(shape.datasourceName, shape.category.name),
    ],
    ...(shape.segment
      ? [
          [
            shape.columnDefinitions.get(shape.segment.column)?.caption ??
              unbracket(shape.segment.column),
            qualified(shape.datasourceName, shape.segment.name),
          ] as [string, string],
        ]
      : []),
    [
      shape.columnDefinitions.get(shape.measure.column)?.caption ?? unbracket(shape.measure.column),
      qualified(shape.datasourceName, shape.measure.name),
    ],
  ];
  tooltipFields.forEach(([caption, reference], index) => {
    formatted.appendChild(tooltipRun(document, `${caption}: `, true));
    formatted.appendChild(tooltipRun(document, `<${reference}>`));
    if (index < tooltipFields.length - 1) formatted.appendChild(tooltipRun(document, 'Æ\n'));
  });
  customized.appendChild(formatted);
  shape.pane.insertBefore(customized, encodings.nextSibling);

  const rows = oneChild(shape.table, 'rows');
  const cols = oneChild(shape.table, 'cols');
  if (rows && cols) {
    const category = qualified(shape.datasourceName, shape.category.name);
    const x = qualified(shape.datasourceName, instances.x);
    const y = qualified(shape.datasourceName, instances.y);
    if (shape.orientation === 'vertical') {
      rows.textContent = y;
      cols.textContent = `(${category} * ${x})`;
    } else {
      rows.textContent = `(${category} * ${y})`;
      cols.textContent = x;
    }
  }

  const style = oneChild(shape.table, 'style');
  if (style) {
    const sourceMeasure = qualified(shape.datasourceName, shape.measure.name);
    const measureField = qualified(
      shape.datasourceName,
      shape.orientation === 'vertical' ? instances.y : instances.x,
    );
    const bandField = qualified(
      shape.datasourceName,
      shape.orientation === 'vertical' ? instances.x : instances.y,
    );
    const measureScope = shape.orientation === 'vertical' ? 'rows' : 'cols';
    const bandScope = shape.orientation === 'vertical' ? 'cols' : 'rows';
    const axisRules = elements(style, 'style-rule').filter(
      (rule) => rule.getAttribute('element') === 'axis',
    );
    const primaryAxisRule = axisRules[0] ?? document.createElement('style-rule');
    if (axisRules.length === 0) {
      primaryAxisRule.setAttribute('element', 'axis');
      style.appendChild(primaryAxisRule);
      axisRules.push(primaryAxisRule);
    }
    let sourceTitleSlots = 0;
    for (const rule of axisRules) {
      for (const format of Array.from(rule.getElementsByTagName('format'))) {
        if (format.getAttribute('field') !== sourceMeasure) continue;
        if (format.getAttribute('attr') === 'title') sourceTitleSlots += 1;
        format.setAttribute('field', measureField);
      }
    }
    if (sourceTitleSlots === 0) {
      const title = document.createElement('format');
      title.setAttribute('attr', 'title');
      title.setAttribute('class', '0');
      title.setAttribute('field', measureField);
      title.setAttribute('scope', measureScope);
      title.setAttribute(
        'value',
        shape.columnDefinitions.get(shape.measure.column)?.caption ??
          unbracket(shape.measure.column),
      );
      primaryAxisRule.appendChild(title);
    }
    const format = document.createElement('format');
    format.setAttribute('attr', 'display');
    format.setAttribute('class', '0');
    format.setAttribute('field', bandField);
    format.setAttribute('scope', bandScope);
    format.setAttribute('value', 'false');
    primaryAxisRule.appendChild(format);
  }

  const showFullRange = document.createElement('show-full-range');
  const column = document.createElement('column');
  column.appendChild(document.createTextNode(qualified(shape.datasourceName, names.bin)));
  showFullRange.appendChild(column);
  shape.table.appendChild(showFullRange);
}

export function planRoundStackedBar(
  xml: string,
  options: { preset: RoundStackedBarPreset },
): RoundStackedBarPlan | RoundStackedBarRefusal {
  if ((options as { preset?: string } | undefined)?.preset !== 'subtle') {
    return refusal('round_bar currently supports only the subtle preset.');
  }
  const parsed = parseXml(xml);
  if (!parsed) return refusal('round_bar requires well-formed worksheet XML.');
  const base = baseNodes(parsed);
  if (!('table' in base)) return base;
  const prefix = helperPrefix(base.worksheetId);
  if (!prefix) return refusal('round_bar requires a stable worksheet id.');
  const names = helperNames(prefix);
  const layoutNarration = inspectLayoutNarration(parsed.worksheet);
  if (!layoutNarration.ok) return layoutNarration;

  const rounded = recognizeRounded(parsed, base, prefix, names);
  if (rounded) {
    if (!('category' in rounded)) return rounded;
    const narration = roundedNarrationContract(rounded, layoutNarration.value);
    if (!narration) {
      return refusal(
        'the helper-bearing worksheet does not match the required caption and alt-text signature.',
      );
    }
    return {
      ok: true,
      alreadyRounded: true,
      semanticContract: semanticContract(rounded, prefix, names, narration),
      xml,
    };
  }

  const shape = classifyOrdinary(parsed, base);
  if (!('category' in shape)) return shape;
  const narration = authorNarration(parsed.document, shape, layoutNarration.value);
  addHelpers(parsed.document, shape, names);
  const instances = addHelperInstances(parsed.document, shape, names);
  sortDependencyDeclarations(shape.dependency);
  customizePane(parsed.document, shape, names, instances);
  return {
    ok: true,
    alreadyRounded: false,
    semanticContract: semanticContract(shape, prefix, names, narration),
    xml: canonicalXml(parsed.document),
  };
}
