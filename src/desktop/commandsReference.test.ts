import { readDataAsset } from './assets.js';

// Nested-schema shape (tableau-desktop-commands-reference.json, migrated in the
// command-reference refresh): the fully-qualified name lives under `serialized`, the
// parameter contract under `invocation.parameters`, codegen prose under `summary`, and
// how-invoked classification under `classification`. The agent-facing dialog policy
// (refuse tabdoc:sort, point at refine-worksheet) is NOT in this generated reference —
// it now lives in paramContractGuard.ts and is covered by paramContractGuard.test.ts.
type ReferenceParameter = {
  direction?: string;
  local_name?: string;
  type_id?: string;
  required?: boolean;
  comment?: string;
};

type ReferenceCommand = {
  name?: string;
  serialized?: { name?: string; fully_qualified_name?: string };
  summary?: { description?: string; description_source?: string };
  classification?: {
    kind?: string;
    is_user_initiated?: boolean;
    is_autonomous?: boolean;
  };
  invocation?: { parameters?: ReferenceParameter[] };
};

type ParameterTypeEntry = {
  enum_name?: string;
  serialized_param_name?: string;
};

type CommandsReference = {
  schema_version?: string;
  commands?: ReferenceCommand[];
  reference_data?: {
    parameter_type_enums?: Record<string, ParameterTypeEntry>;
  };
};

function loadReference(): CommandsReference {
  const raw = readDataAsset('tableau-desktop-commands-reference.json');
  if (raw === null) {
    throw new Error('tableau-desktop-commands-reference.json could not be read');
  }
  return JSON.parse(raw) as CommandsReference;
}

function command(reference: CommandsReference, name: string): ReferenceCommand {
  const entry = reference.commands?.find(
    (candidate) => candidate.serialized?.fully_qualified_name === name,
  );
  if (!entry) {
    throw new Error(`missing reference entry for ${name}`);
  }
  return entry;
}

function paramsByLocalName(entry: ReferenceCommand): Map<string, ReferenceParameter> {
  return new Map(
    (entry.invocation?.parameters ?? []).map((param) => [param.local_name ?? '', param]),
  );
}

describe('tableau desktop command reference sort entries', () => {
  it('pins the generated reference schema version and command count', () => {
    const reference = loadReference();
    expect(reference.schema_version).toBe('2025.2.2');
    expect(reference.commands).toHaveLength(549);
    // The parameter-type enum map moved under reference_data; its documented entry shape
    // carries an enum_name and the serialized wire name the executor expects.
    expect(reference.reference_data?.parameter_type_enums?.DPI_CardType).toMatchObject({
      enum_name: 'CardType',
      serialized_param_name: 'card-type',
    });
  });

  it('describes tabdoc:sort as the UI-dialog sort with its full parameter contract', () => {
    const reference = loadReference();
    const sort = command(reference, 'tabdoc:sort');
    const params = paramsByLocalName(sort);

    expect(sort.name).toBe('Sort');
    expect(sort.summary?.description).toContain('setting sort options from the UI dialog');
    expect(sort.summary?.description).toContain('updateSortDialog notification');
    // Codegen classification: sort is user-initiated (menu/dialog), not autonomous. The
    // agent-refusal + refine-worksheet FIX is enforced in paramContractGuard.ts.
    expect(sort.classification?.is_user_initiated).toBe(true);
    expect(sort.classification?.is_autonomous).toBe(false);

    expect(params.get('FieldName')).toMatchObject({
      direction: 'in',
      type_id: 'DPI_GlobalFieldName',
      required: true,
      comment: expect.stringContaining('field to be sorted'),
    });
    expect(params.get('Worksheet')).toMatchObject({ type_id: 'DPI_Worksheet', required: true });
    expect(params.get('Type')).toMatchObject({
      type_id: 'DPI_SortType',
      required: false,
      comment: expect.stringContaining('required if ClearSort=false'),
    });
    expect(params.get('Direction')).toMatchObject({
      type_id: 'DPI_SortDirection',
      required: false,
    });
    expect(params.get('MeasureName')).toMatchObject({
      type_id: 'DPI_SortMeasureName',
      required: false,
      comment: expect.stringContaining('required if Type=SortType::Computed'),
    });
    expect(params.get('ClearSort')).toMatchObject({
      type_id: 'DPI_ClearSort',
      required: false,
    });
  });

  it('pins tabdoc:sort-nested as the nested-sort command with its required contract', () => {
    const sortNested = command(loadReference(), 'tabdoc:sort-nested');
    const params = paramsByLocalName(sortNested);

    expect(sortNested.name).toBe('SortNested');
    expect(sortNested.summary?.description).toBe('Applies a nested sort to the viz.');
    expect(params.get('DimensionToSort')).toMatchObject({
      type_id: 'DPI_DimensionToSort',
      required: true,
    });
    expect(params.get('Worksheet')).toMatchObject({ type_id: 'DPI_Worksheet', required: true });
    expect(params.get('MeasureName')).toMatchObject({
      type_id: 'DPI_SortMeasureName',
      required: true,
    });
    expect(params.get('ShelfType')).toMatchObject({ type_id: 'DPI_ShelfType', required: true });
    expect(params.get('Direction')).toMatchObject({
      type_id: 'DPI_SortDirection',
      required: false,
    });
    expect(params.get('ClearSort')).toMatchObject({ type_id: 'DPI_ClearSort', required: false });
    expect(params.get('Dashboard')).toMatchObject({ type_id: 'DPI_Dashboard', required: false });
    expect(params.get('LevelNames')).toMatchObject({ type_id: 'DPI_LevelNames', required: false });
    expect(params.get('MemberValues')).toMatchObject({
      type_id: 'DPI_MemberValues',
      required: false,
    });
    expect(params.get('KeepFieldFilters')).toMatchObject({
      type_id: 'DPI_KeepFieldFilters',
      required: false,
    });
  });
});
