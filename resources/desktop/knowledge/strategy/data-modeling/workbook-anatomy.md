# Tableau Workbook File Structure

Reference guide to the anatomy of a Tableau workbook — covering the TWB/TWBX format, major sections, and what each section controls. Useful for understanding where things live when troubleshooting or reviewing a customer's workbook.

Tags: workbook-structure, twb, twbx, xml, anatomy

**Tactics companion:** `expertise://tableau/tactics/tree/workbook-structure` — the XML/authoring mechanics for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: troubleshoot, refine
- In-scope reason: This helps Claude understand where settings live in a workbook when troubleshooting broken workbooks or explaining why workbook files are unexpectedly large during authoring.
- Out-of-scope risk: none
- Tags: workbook-structure, twb, twbx, xml, anatomy, datasources, worksheets, dashboards, parameters, connection-class
- Relevant user prompts/search terms: "what's inside a TWB file", "difference between TWB and TWBX", "where are calculated fields stored", "workbook file structure", "why is my workbook file so large", "extract embedded in workbook", "where are parameters defined", "can I open a TWB in a text editor", "workbook section breakdown", "connection types in Tableau XML"

## When to Use

Use this guide when:
- **Opening a workbook file** and wanting to understand its structure
- **Troubleshooting a broken workbook** — knowing which sections to inspect
- **Explaining to a customer** what a `.twb` vs `.twbx` file contains
- **Understanding why workbook size is large** — knowing which sections hold data

---

## TWB vs TWBX

| Format | Contains | When to use |
|---|---|---|
| `.twb` | XML only — no embedded data | When the datasource is live (server, database, published) |
| `.twbx` | Zipped package: `.twb` + data files (`.hyper` extract, images, custom shapes) | When the datasource is a local extract that needs to travel with the workbook |

A `.twbx` is just a zip file. If you need to inspect or edit it without Tableau, rename it to `.zip` and extract it. The TWB XML file inside is the workbook definition.

---

## TWB File Structure Overview

A Tableau workbook XML file is organized into a handful of major sections, in order: version-compatibility metadata, workbook-level preferences, the datasources block (all data connections, field definitions, and a dedicated `Parameters` datasource), one entry per worksheet, one per dashboard, and a UI-state block describing what's visible in Desktop. For the literal XML tree and the XPath/ElementTree navigation that walks it, see `expertise://tableau/tactics/tree/workbook-structure`.

### What each section controls

| Section | What's in it | Where you see it in Desktop |
|---|---|---|
| `datasources` | Connection strings, field definitions, calculated fields, aliases | Data pane (left sidebar), Data menu |
| `worksheets` | Rows/cols shelf config, mark type, filters, encodings, sort | Every sheet tab |
| `dashboards` | Zone layout, actions, sizing mode | Dashboard tabs |
| `windows` | Which cards are shown, parameter controls, filter cards | Marks card, Filters shelf, Pages shelf |

---

## Datasources Section

Each datasource node represents one data connection. Key things it contains:
- **Connection details** — server, database, file path (for extracts and files)
- **Column definitions** — every field's name, data type, and role
- **Calculated fields** — formula-based fields stored as column definitions with a formula child
- **Aliases** — custom member labels
- **Groups and sets** — predefined groupings

The `Parameters` datasource is a special child that holds all parameter definitions. Parameters are always in this separate, dedicated datasource — never in a data datasource.

Each connection kind (local extract, Excel, text/CSV, a relational database, or a published datasource) is identified by a distinct `class` token on the connection node, and relational sources sit inside a `federated` wrapper. For the exact `class=` token per connection type, see `expertise://tableau/tactics/tree/workbook-structure`.

---

## Worksheets Section

Each worksheet node holds:
- **View configuration** — which datasource fields are used
- **Shelf content** — what's on Rows, Columns, Color, Size, etc.
- **Mark type** — Bar, Line, Circle, Gantt Bar, etc.
- **Filters** — dimension, measure, date, Top N filters
- **Sort settings** — field-based sorts
- **Table calculations** — Compute Using configuration

---

## Dashboards Section

Each dashboard node holds:
- **Zone layout** — which sheets appear where, in what size
- **Device layouts** — phone/tablet responsive variations
- **Dashboard actions** — filter actions, highlight actions, URL/Go To Sheet actions

Dashboard actions are actually stored at the workbook root level (a sibling to `worksheets` and `dashboards`), not inside the dashboard node itself.

---

## What to Never Modify

If you ever need to open a `.twb` file in a text editor:

| Section | Why not to touch it |
|---|---|
| `document-format-change-manifest` | Version compatibility metadata — changing it can break the workbook |
| `connection` / `named-connections` | Live database/file connection strings — modifying them breaks the data source |
| `repository-location` | Server publish path — editing this confuses Tableau about where the workbook lives |
| `datasource name="Parameters"` | Parameter definitions — Tableau manages this strictly |

---

## Common Workbook File Issues

**Workbook file is unexpectedly large:**
- Check if it's a `.twbx` with a large `.hyper` extract embedded
- Check if there are many custom shapes or high-res background images embedded
- Published datasource connections (`.twb` only) are tiny; embedded extracts (`.twbx`) can be hundreds of MB

**Workbook won't open:**
- Try opening just the `.twb` (extract the XML from the `.twbx` zip)
- Check if the workbook was saved on a newer Tableau version than the one opening it — Tableau is not backward-compatible by major version
- Look for XML encoding issues if the workbook has fields with special characters in their names

**Sharing a workbook with someone who doesn't have the data:**
- Save as `.twbx` — this packages the extract with the workbook
- For live connections, the recipient needs their own database credentials

---

## Best Practices

- **Save extracts as `.twbx` for portability.** A `.twb` referencing a local extract file is useless on another machine.
- **Use published datasources when possible.** This keeps the connection config in one place on the server and makes workbooks smaller.
- **Keep calculated fields at the datasource level**, not defined per-worksheet. Datasource-level calcs are available in every worksheet and easier to maintain.
- **Parameter controls need to be shown explicitly.** Parameters defined in the workbook are invisible until you right-click them → Show Parameter Control.

---

## Common Mistakes

- Treating this guidance as generic SE enablement rather than Tableau authoring guidance.
- Applying the pattern without checking whether it fits the dashboard, visualization, or workbook context.
- Skipping validation in Tableau after making authoring changes.

## Implementation

Use this file to reason about where a given setting lives — connection strings and calcs in datasources, shelf config in worksheets, zone layout in dashboards, parameters in their dedicated datasource — and to explain TWB vs TWBX trade-offs to a customer. When you need to actually navigate or edit that XML, switch to the tactics companion `expertise://tableau/tactics/tree/workbook-structure`, then verify any change in Tableau Desktop before sharing the workbook.

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau workbook file structure (TWB/TWBX) from product documentation and SE troubleshooting practice
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
