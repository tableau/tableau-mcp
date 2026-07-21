import { readDataAsset } from './assets.js';

type ReferenceParameter = {
  direction?: string;
  local_name?: string;
  type_id?: string;
  required?: boolean;
  comment?: string;
};

type ReferenceCommand = {
  command_name?: string;
  fully_qualified_serialized_name?: string;
  description?: string;
  value_to_users?: string;
  parameters?: ReferenceParameter[];
  opens_blocking_dialog?: boolean;
  agent_can_invoke?: boolean;
};

type ParameterTypeEntry = {
  serialized_param_name?: string;
};

type CommandsReference = {
  total_commands?: number;
  parameter_type_enums?: Record<string, ParameterTypeEntry>;
  commands?: ReferenceCommand[];
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
    (candidate) => candidate.fully_qualified_serialized_name === name,
  );
  if (!entry) {
    throw new Error(`missing reference entry for ${name}`);
  }
  return entry;
}

function paramsByLocalName(entry: ReferenceCommand): Map<string, ReferenceParameter> {
  return new Map((entry.parameters ?? []).map((param) => [param.local_name ?? '', param]));
}

describe('tableau desktop command reference sort entries', () => {
  it('pins the generated command count', () => {
    expect(loadReference().total_commands).toBe(333);
  });

  it('marks tabdoc:sort as dialog-driving and points agents at headless sort alternatives', () => {
    const reference = loadReference();
    const sort = command(reference, 'tabdoc:sort');
    const params = paramsByLocalName(sort);

    expect(sort.command_name).toBe('Sort');
    expect(sort.description).toContain('setting sort options from the UI dialog');
    expect(sort.description).toContain('updateSortDialog notification');
    expect(sort.value_to_users).toContain('Use refine-worksheet operation sort_by_field');
    expect(sort.value_to_users).toContain('tabdoc:sort-nested');
    expect(sort.opens_blocking_dialog).toBe(true);
    expect(sort.agent_can_invoke).toBe(false);
    expect(reference.parameter_type_enums?.DPI_GlobalFieldName?.serialized_param_name).toBe(
      'global-field-name',
    );
    expect(params.get('FieldName')).toMatchObject({
      direction: 'in',
      type_id: 'DPI_GlobalFieldName',
      required: true,
      comment: expect.stringContaining("qualified '[datasource].[Field]'"),
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
      comment: expect.stringContaining('default Asc'),
    });
    expect(params.get('MeasureName')).toMatchObject({
      type_id: 'DPI_SortMeasureName',
      required: false,
      comment: expect.stringContaining('required if Type=SortType::Computed'),
    });
    expect(params.get('ClearSort')).toMatchObject({
      type_id: 'DPI_ClearSort',
      required: false,
      comment: expect.stringContaining('default false'),
    });
  });

  it('pins tabdoc:sort-nested as the non-dialog nested sort command', () => {
    const sortNested = command(loadReference(), 'tabdoc:sort-nested');
    const params = paramsByLocalName(sortNested);

    expect(sortNested.command_name).toBe('SortNested');
    expect(sortNested.description).toBe('Applies a nested sort to the viz.');
    expect(sortNested.opens_blocking_dialog).toBe(false);
    expect(sortNested.agent_can_invoke).toBe(true);
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
      comment: expect.stringContaining('default Asc'),
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
