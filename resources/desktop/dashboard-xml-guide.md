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

NOTE: Remember to also add viewpoints to the window element! See "Critical: Viewpoints" section
below.

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
8. **Validate after changes**: Use `tableau-apply-dashboard` which validates before sending

## Critical Rules

- **Worksheet must exist**: The worksheet name in `name="Sheet 1"` MUST match an existing worksheet
  in the workbook
- **No zone-pane element**: DO NOT use `<zone-pane>` - put the worksheet name directly in the zone's
  `name` attribute
- **Include zone-style**: Every worksheet zone should have a `<zone-style>` child with border/margin
  formats
- **⚠️ CRITICAL: Sync viewpoints**: For EVERY worksheet in zones, you MUST add a matching
  `<viewpoint>` in the window element. This is separate from the dashboard element - it goes in
  `<windows><window class="dashboard">`. Without this, Tableau will fail with "Internal Error".

## Critical: Viewpoints

**IMPORTANT**: When you add worksheets to a dashboard's zones, you MUST also add corresponding
viewpoints to the dashboard's **window element** (NOT the dashboard element itself).

The viewpoints go in:
`<workbook><windows><window class="dashboard" name="DashboardName"><viewpoints>`

For each worksheet referenced in zones (by `name` attribute), add:

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

**Without matching viewpoints, Tableau will reject the dashboard with an internal error.**

## Workflow

### ⚠️ CRITICAL: Application Order Matters!

**The Problem:** `tableau-apply-workbook` replaces the **ENTIRE** workbook state. If you apply a
dashboard, then apply a stale workbook XML, your dashboard changes will be **OVERWRITTEN**.

### Recommended: Use `tableau-apply-dashboard-with-viewpoints`

This tool handles both safely:

1. Gets a fresh workbook (includes your dashboard changes)
2. Adds viewpoints automatically
3. Applies both in the correct order

```typescript
tableau-apply-dashboard-with-viewpoints({
  dashboard_name: "My Dashboard",
  dashboard_file: "path/to/dashboard.xml",
  worksheet_names: ["Sheet 1", "Sheet 2"]
})
```

### Manual Workflow (If Needed)

If you must edit manually, follow this order:

1. `tableau-get-dashboard` - Get current dashboard XML
2. Edit dashboard zones XML
3. `tableau-apply-dashboard` - Apply dashboard changes **FIRST**
4. `tableau-get-workbook` - Get **FRESH** workbook (includes dashboard changes)
5. Edit workbook to add viewpoints to the dashboard window
6. `tableau-apply-workbook` - Apply window viewpoint changes

**⚠️ WRONG ORDER (Will Overwrite Dashboard):**

```typescript
// ❌ WRONG - Stale workbook overwrites dashboard
tableau - get - workbook(); // Gets workbook
tableau - apply - dashboard(); // Applies dashboard
tableau - apply - workbook(); // Overwrites dashboard with stale workbook!
```

**✅ CORRECT ORDER:**

```typescript
// ✅ CORRECT - Fresh workbook includes dashboard
tableau - apply - dashboard(); // Apply dashboard first
tableau - get - workbook(); // Get fresh workbook (includes dashboard)
// Edit viewpoints
tableau - apply - workbook(); // Apply fresh workbook with viewpoints
```
