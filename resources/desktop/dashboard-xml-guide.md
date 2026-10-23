# Dashboard XML Manipulation Guide

## Dashboard Structure

A Tableau dashboard consists of zones that contain worksheets, text, images, or other dashboards.

### Basic Dashboard XML

```xml
<dashboard name="Sales Dashboard">
  <style/>
  <size maxheight="800" maxwidth="1000"/>
  <zones>
    <zone h="100000" w="100000" x="0" y="0" type-v2="layout-basic">
      <zone h="50000" w="100000" x="0" y="0" name="Sheet 1">
        <zone-style>
          <format attr="border-color" value="#000000"/>
          <format attr="border-style" value="none"/>
          <format attr="border-width" value="0"/>
          <format attr="margin" value="4"/>
        </zone-style>
      </zone>
      <zone h="50000" w="100000" x="0" y="50000" name="Sheet 2">
        <zone-style>
          <format attr="border-color" value="#000000"/>
          <format attr="border-style" value="none"/>
          <format attr="border-width" value="0"/>
          <format attr="margin" value="4"/>
        </zone-style>
      </zone>
    </zone>
  </zones>
  <simple-id uuid="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"/>
</dashboard>
```

NOTE: Worksheet view registration belongs to the dashboard window, not the dashboard fragment.
Desktop API 0.2.22 and newer repairs registration for submitted worksheet zones during dashboard
apply. See "Critical: Viewpoints" below for older-build safeguards.

NOTE: A `<datasources>` entry in the dashboard must copy the workbook's own entry (same `name` and `caption`), or leave the block out and Tableau adds it; any other entry is refused.

## Key Concepts

### Positioning System

- **Coordinates**: x, y (top-left is 0,0)
- **Dimensions**: w (width), h (height)
- **Units**: Values are in 1/100000ths (e.g., 50000 = 50%)
- **100000 = full width/height**

### Zone Types

#### 1. Container Zone (has child zones)

```xml
<zone h="100000" w="100000" x="0" y="0" type-v2="layout-basic">
  <!-- Child zones here -->
  <zone h="50000" w="50000" x="0" y="0" name="Sheet 1">
    <zone-style>
      <format attr="border-color" value="#000000"/>
      <format attr="border-style" value="none"/>
      <format attr="border-width" value="0"/>
      <format attr="margin" value="4"/>
    </zone-style>
  </zone>
</zone>
```

#### 2. Worksheet Zone (contains a worksheet)

```xml
<zone h="50000" w="50000" x="0" y="0" name="Sheet 1">
  <zone-style>
    <format attr="border-color" value="#000000"/>
    <format attr="border-style" value="none"/>
    <format attr="border-width" value="0"/>
    <format attr="margin" value="4"/>
  </zone-style>
</zone>
```

Note: The worksheet name goes in the `name` attribute on the zone itself, NOT in a child element.
Use no `type-v2` attribute (or the supported `type-v2="visual"`); never invent
`type-v2="worksheet"`, which can leave an unsafe zone that crashes Tableau when removed.

Existing blank worksheets are valid dashboard content. Do not add marks, fields, or datasource
bindings merely to place a worksheet in a dashboard. Build chart content only when the user asks for
it. A missing visual document indicates dashboard-window registration, not worksheet emptiness.

#### 3. Text Zone

```xml
<zone h="10000" w="100000" x="0" y="0" type-v2="text">
  <formatted-text>
    <run>Sales Dashboard</run>
  </formatted-text>
  <zone-style>
    <format attr="border-color" value="#000000"/>
    <format attr="border-style" value="none"/>
    <format attr="border-width" value="0"/>
    <format attr="margin" value="4"/>
  </zone-style>
</zone>
```

## Common Patterns

### Full-Width Header with Two Worksheets Below

```xml
<zones>
  <zone h="100000" w="100000" x="0" y="0" type-v2="layout-basic">
    <!-- Header: 20% height -->
    <zone h="20000" w="100000" x="0" y="0" type-v2="text">
      <formatted-text>
        <run>Dashboard Title</run>
      </formatted-text>
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>

    <!-- Left sheet: 50% width, 80% height -->
    <zone h="80000" w="50000" x="0" y="20000" name="Sheet 1">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>

    <!-- Right sheet: 50% width, 80% height -->
    <zone h="80000" w="50000" x="50000" y="20000" name="Sheet 2">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>
  </zone>
</zones>
```

(Remember: viewpoints go in the window element, not the dashboard!)

### 2x2 Grid Layout

```xml
<zones>
  <zone h="100000" w="100000" x="0" y="0" type-v2="layout-basic">
    <!-- Top-left -->
    <zone h="50000" w="50000" x="0" y="0" name="Sheet 1">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>

    <!-- Top-right -->
    <zone h="50000" w="50000" x="50000" y="0" name="Sheet 2">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>

    <!-- Bottom-left -->
    <zone h="50000" w="50000" x="0" y="50000" name="Sheet 3">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>

    <!-- Bottom-right -->
    <zone h="50000" w="50000" x="50000" y="50000" name="Sheet 4">
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="4"/>
      </zone-style>
    </zone>
  </zone>
</zones>
```

## Tips for Manipulation

1. **Always wrap zones in a container**: The root `<zones>` element should contain one main zone at
   (0,0) with full dimensions and `type-v2="layout-basic"`
2. **Check worksheet names**: Use worksheet-list readback to get available worksheet names - the
   worksheet MUST exist in the workbook
3. **Positions must add up**: x + w should not exceed parent width, y + h should not exceed parent
   height
4. **Keep UUIDs**: Don't change existing `<simple-id uuid="..."/>` unless creating new dashboards
5. **Zone IDs**: Each zone needs a unique `id` attribute (use sequential integers)
6. **Worksheet zones**: To reference a worksheet, use the `name` attribute directly on the zone
   element (NOT a child `<zone-pane>` element)
7. **Zone styling**: Worksheet zones should include `<zone-style>` with border and margin formatting
8. **Validate after changes**: Use `apply-dashboard` which validates before sending

## Critical Rules

- **Worksheet must exist**: The worksheet name in `name="Sheet 1"` MUST match an existing worksheet
  in the workbook
- **No zone-pane element**: DO NOT use `<zone-pane>` - put the worksheet name directly in the zone's
  `name` attribute
- **Include zone-style**: Every worksheet zone should have a `<zone-style>` child with border/margin
  formats
- **Worksheet content may be blank**: Placement does not require marks or fields.
- **View registration is separate**: Every referenced worksheet needs a corresponding dashboard
  window view. Desktop API 0.2.22 and newer repairs missing registrations for submitted zones. On
  older or unknown versions, register the worksheets in Desktop before applying the layout.

## Critical: Viewpoints

**IMPORTANT**: Worksheet view registration belongs to the dashboard's **window element** (NOT the
dashboard element itself). Native `HasVisualDoc` checks that registration; it does not check marks
or fields in the worksheet.

The viewpoints go in:
`<workbook><windows><window class="dashboard" name="DashboardName"><viewpoints>`

For each worksheet referenced in zones (by `name` attribute), the window has a corresponding
viewpoint, for example:

```xml
<viewpoint name="WorksheetName">
  <zoom type="entire-view"/>
</viewpoint>
```

Example: If your dashboard has zones with `name="Sheet 1"` and `name="Sheet 2"`, the window needs:

```xml
<window class="dashboard" name="My Dashboard">
  <viewpoints>
    <viewpoint name="Sheet 1">
      <zoom type="entire-view"/>
    </viewpoint>
    <viewpoint name="Sheet 2">
      <zoom type="entire-view"/>
    </viewpoint>
  </viewpoints>
  <active id="-1"/>
  <simple-id uuid="{...}"/>
</window>
```

The dashboard-only endpoint repairs missing view registrations for submitted worksheet zones on
Desktop API 0.2.22 and newer, including blank worksheets. MCP verifies repaired registration in
readback before reporting success. Existing viewpoint settings are preserved. Extra requested
worksheet names outside the submitted zones must already be registered, even on supported builds.

On older or unknown API versions, missing registration is blocked before dispatch. Add the
worksheets to the dashboard in Desktop, then re-read the dashboard before retrying. Do not populate
a blank worksheet, change its zone type, or replace the whole workbook as a workaround.

## Workflow

1. Confirm the dashboard and referenced worksheets exist in the open workbook.
2. Check the discovered Desktop API version. On older or unknown versions, add any unregistered
   worksheets to the dashboard in Desktop first, without changing their content.
3. Use `get-dashboard-xml` to read the current dashboard fragment.
4. Edit the fragment's zones, retaining the dashboard identity and valid worksheet zone types.
5. Use `apply-dashboard` for the surgical dashboard-only write, then inspect readback.

The apply path reads a locked live snapshot for registration checks, pins the Desktop instance, and
checks cached source drift. It never falls back to a worksheet or whole-workbook write.
Whole-workbook replacement can overwrite concurrent edits, even when based on a fresh read. If
verification fails after an accepted write, changes may have been applied: re-read before retrying
rather than blindly repeating the apply.
