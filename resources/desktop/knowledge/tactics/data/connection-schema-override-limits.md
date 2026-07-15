# Connection Schema Override Limits

Use this when a field's type, role, or default format keeps reverting after worksheet or datasource XML edits, especially with Excel (`excel-direct`) or CSV/text (`textscan`) connections.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: troubleshoot, safely stop retry loops
- In-scope reason: Explains when the datasource connection schema can override worksheet or datasource-level field redeclarations, and when to escalate to a data-source/connection fix.
- Out-of-scope risk: none
- Tags: datasource, connection-schema, excel-direct, textscan, metadata-records, column-datatype, datatype-override, default-format, schema-inference, typed-parse-calc, stop-condition
- Relevant user prompts/search terms: "field type keeps reverting", "Excel column inferred as string", "date field shows as text", "worksheet XML datatype change does not stick", "datasource column datatype ignored", "CSV schema override", "connection schema wins", "stop retrying apply", "fix type at data source", "use DATE or INT workaround"

## When to Use

Use this entry when a field's apparent type or format is wrong and the first XML fix does not survive a fresh `tableau-get-workbook` readback. The high-risk pattern is an existing file connection (`excel-direct` or `textscan`) whose connection/relation metadata already carries a schema decision, while the agent is only changing worksheet-level `<column>` definitions inside `datasource-dependencies`.

This is not for normal calculated field authoring. A new Tableau calc declared as a datasource `<column>` can carry its own `datatype` when inserted in the datasource's valid column location. This entry is about pre-existing physical columns whose type or format comes from the connection layer.

## Best Practices

1. **Read the connection before retrying.** Inspect the datasource's `<connection>`, `<named-connections>`, `<relation>`, relation `<columns>`, `<metadata-records>`, datasource `<column>` definitions, and worksheet `<datasource-dependencies>`. The datasource entry documents that these pieces must agree and that Excel uses `class="excel-direct"` while CSV/text uses `class="textscan"`.
2. **Treat worksheet dependencies as consumers, not the source of physical schema truth.** Worksheet-level `<column>` definitions tell the worksheet how it uses a field; they are not a reliable place to change a physical Excel/CSV field's inferred datatype. <!-- TODO-VERIFY-LIVE -->
3. **Know where `<column datatype=...>` works.** It is appropriate for authored calculated fields and for a new datasource definition you are constructing. It is not proven to override an existing file connection's physical schema after Tableau has inferred or stored that schema. <!-- TODO-VERIFY-LIVE -->
4. **Use a typed parse calc as a workaround when the source cannot be changed.** If the user cannot fix the file/data source immediately, add a new calculated field with the target type, such as `DATE(...)`, `DATEPARSE(...)`, `INT(...)`, or `FLOAT(...)`, using the parsing guidance in the date and string parsing entries. Verify the calc on real rows before building the final view.
5. **Stop and say the limit out loud.** After one targeted worksheet/datasource redeclaration and a readback that still shows the old type/format, do not keep applying variations. Tell the user the type appears controlled by the connection/data-source layer and must be fixed there, or use a typed calc workaround.

### When to STOP and Say So

Stop retrying XML applies when all of these are true:

1. The field is a physical column from an existing connection, especially `excel-direct` or `textscan`.
2. The worksheet-level `<datasource-dependencies>` or datasource-level `<column datatype=...>` edit applies but disappears, is normalized back, or the field still behaves as the old type after a fresh readback.
3. The connection/relation/metadata layer still describes the field with the old type, format, or source schema.

Say: "This looks like a connection-level schema decision, not a worksheet XML problem. I should not keep retrying worksheet applies. Please fix the field type in the data source or source file, or I can add a typed Tableau calculated field as a workaround."

## Common Mistakes

1. **Looping at the worksheet layer.** Rewriting the same `<datasource-dependencies><column datatype=...>` shape cannot fix a field whose source schema is controlled by the connection. <!-- TODO-VERIFY-LIVE -->
2. **Assuming datasource `<column>` redeclaration always wins.** Existing repo evidence confirms connection-level `default-format` can override both worksheet and datasource field formatting. The same limit for physical-column datatype is based on pilot episode evidence and still needs live verification. <!-- TODO-VERIFY-LIVE -->
3. **Editing live connection nodes to force a type.** The datasource guidance says not to modify `connection` or `named-connections` in an existing datasource; they contain live file paths and authentication details.
4. **Using `DATEPARSE` without checking connection type.** The date handling entry says `DATEPARSE` silently returns null on live SQL connections. Prefer source-layer casts for live SQL, or verify the calc directly.
5. **Casting dirty strings wholesale.** `INT([CompoundString])` or `FLOAT([CompoundString])` returns null/zero when the string contains labels or delimiters. Split or regex-extract first.

## Implementation

### Confirmed connection-format limit

The datasource entry documents a confirmed limitation for formatting: an Excel connection-level schema can define a field format that wins over both worksheet-level and datasource-level `default-format` edits. That proves the broad shape of the limit: some field presentation facts are owned by the connection schema, not by the worksheet.

```xml
<!-- Existing connection-level schema owns the physical field fact. -->
<connection class="excel-direct" ... />

<!-- These worksheet/datasource redeclarations can be stripped or ignored
     when the connection schema wins. -->
<column datatype="date" name="[Order Date]" role="dimension" type="ordinal" />
```

### Best-evidence datatype example

The following is the best-evidence stop pattern from episode mining, not a live-verified recipe. <!-- TODO-VERIFY-LIVE -->

```xml
<!-- Source connection has inferred [Ship Date] as string/text. -->
<connection class="excel-direct" ... />
<relation connection="excel-direct.orders" name="Orders" table="[Orders$]" type="table">
  <columns gridOrigin="A1:F5000:no:A1:F5000:0" header="yes" outcome="6">
    <column datatype="string" name="Ship Date" ordinal="4" />
  </columns>
</relation>

<!-- A worksheet-only redeclaration is not the fix. -->
<datasource-dependencies datasource="Sample Orders">
  <column datatype="date" name="[Ship Date]" role="dimension" type="ordinal" />
  <column-instance column="[Ship Date]" derivation="None" name="[none:Ship Date:ok]" pivot="key" type="ordinal" />
</datasource-dependencies>
```

What does **not** work: repeatedly changing only the worksheet dependency or shelf column-instance after readback shows the source field is still a string. Stop and escalate to the data source, or author a new calc:

```xml
<column caption="Ship Date (Parsed)" datatype="date" name="[Ship Date Parsed]" role="dimension" type="ordinal">
  <calculation class="tableau" formula="DATE([Ship Date])" />
</column>
```

Use `DATEPARSE("yyyy-MM-dd", [Ship Date])` only when that function is valid for the connection type; for live SQL, push the cast into SQL or the source layer. For numeric fields stored as text, use `INT([Field])` / `FLOAT([Field])` only after cleaning or extracting the numeric token when needed.

### Decision workflow

1. Re-read the workbook and identify the datasource/field path.
2. If the field is a generated Tableau calc, fix the datasource calc `<column>` and its `datatype`.
3. If the field is a physical Excel/CSV column, inspect relation `<columns>` and `<metadata-records>` for the source type.
4. Make at most one targeted XML correction at the highest safe layer you own, then apply and read back.
5. If Tableau restores the old type/format, stop. Tell the user the connection schema wins and offer the typed calc workaround.

## Related Knowledge

- Extends [Workbook XML: Adding and Refactoring Datasources](datasources.md): turns the existing connection-level format limitation and metadata-record guidance into a stop rule for type/schema override failures.
- See [Tableau Date Handling in Workbook XML](tableau-date-handling.md): date parse and `DATEPARSE` connection caveats.
- See [Parse Numbers Out of a Compound String Field](parse-number-from-compound-string.md): safe numeric parsing before `INT()` / `FLOAT()`.

## Source and Confidence

- Source/evidence type: repo evidence plus pilot episode mining
- Source: `data/knowledge/tactics/data/datasources.md` connection-class, metadata-record, and connection-level format override guidance; `data/knowledge/tactics/data/tableau-date-handling.md`; `data/knowledge/tactics/data/parse-number-from-compound-string.md`; June 2026 interaction-learning episode reporting an Excel connection-level schema override that worksheet XML could not fix.
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-12
