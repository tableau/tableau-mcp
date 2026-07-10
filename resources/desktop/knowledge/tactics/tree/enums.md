# Reference: Field & Workbook Enums (from TWB XSD)

Use these values when constructing workbook JSON. For the full list, call `lookup_workbook_schema` with the enum name.

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, format
- In-scope reason: Enums provide valid values for mark types, field roles, datatypes, zone types, and filter classes that Claude must use when constructing correct workbook JSON or XML.
- Out-of-scope risk: none
- Tags: enums, mark-types, field-roles, field-types, datatype, derivation, column-instance-naming, dashboard-zone-types, filter-classes, groupfilter-functions, xsd-reference
- Relevant user prompts/search terms: "mark class Bar Line Circle Heatmap", "role dimension measure type nominal ordinal quantitative", "datatype string integer real boolean date datetime", "zone type-v2 layout-basic layout-flow visual filter paramctrl", "filter class categorical quantitative relative-date", "groupfilter function union member intersection"

## Mark types (`PrimitiveType-ST` — mark `class` attribute)
`Automatic` | `Bar` | `Line` | `Area` | `Circle` | `Square` | `Text` | `Pie` | `Shape` | `GanttBar` | `Polygon` | `Heatmap` | `Multipolygon`

## Field roles and types
- **role**: `dimension` | `measure`
- **type**: `nominal` | `ordinal` | `quantitative`
- **datatype** (`Data-Type-ST`): `string` | `integer` | `real` | `boolean` | `date` | `datetime`

## Column instance naming: `[derivation:FieldName:typePivot]`
- **derivation**: `None` (dimension), `Sum`, `Avg`, `Min`, `Max`, `Count`, `CountD`, `Median`, `Attr`, `User` (table calcs), `Year`, `Quarter`, `Month`, `Day`, `TruncYear`, `TruncMonth`, `TruncDay`
- **typePivot**: `nk` (nominal-key), `qk` (quantitative-key), `ok` (ordinal-key)
- **rows/cols format**: `[datasourceId].[column-instance-name]`

## Dashboard zone types (`ZoneType-ST` — zone `type-v2` attribute)
`layout-basic` | `layout-flow` | `visual` | `text` | `bitmap` | `web` | `filter` | `paramctrl` | `color` | `shape` | `size` | `map` | `title` | `empty`

> **Note:** In Tableau-generated workbooks, worksheet zones may omit `type-v2` — the `name` attribute alone identifies them. When creating dashboards via JSON, `type-v2="visual"` works but isn't always present in Tableau's own output.

## Zone layout strategies (`ZoneLayoutType-ST`)
`basic` | `free-form` | `flow` | `distribute-evenly` | `trivial`

## Filter classes (`Filter-Class-ST`)
`categorical` | `quantitative` | `relative-date`

## Groupfilter functions (`Function-ST`)
`union` | `member` | `intersection` | `except` | `range` | `filter` | `level-members` | `empty-level`


