# Example Workbooks & Chart Starting Points

Reference guide for finding and using Tableau example workbooks, viz templates, and built-in sample data — useful for demos, POCs, and customer education.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create
- In-scope reason: Helps Claude point users to example workbooks and starting templates when authoring or prototyping a viz.
- Out-of-scope risk: none
- Tags: examples, templates, sample-data, demos, starting-points
- Relevant user prompts/search terms: "where are Tableau examples", "sample data for demo", "how to find workbook templates", "copy a chart from another workbook", "download from Tableau Public", "starting point for a dashboard", "corporate workbook examples", "exchange accelerator for my industry", "Superstore sample data", "reuse an existing viz"

## When to Use

Use this guide when:
- **Building a quick demo** and need a starting point for a specific chart type
- **A customer asks for an example** of a particular visualization
- **Creating a POC** using sample data that resembles a customer's use case
- **Creating a corporate dashboard** and need to align with existing Tableau Cloud/Server content, metric definitions, naming, or visual conventions
- **Checking Tableau Exchange accelerators** for a domain-specific workbook, data model, or dashboard pattern to jump-start the work
- **Looking for inspiration** from Tableau Public for a specific industry or use case
- **Injecting or copying an approved workbook/sheet** as a starting point before remapping it to the target datasource
- **Teaching a customer** how a complex chart type works by showing a working example first

---

## Precedent-First Inspiration Workflow

Before building a substantive visualization or dashboard from scratch, look for proven Tableau patterns in this order:

1. **Internal Tableau Cloud/Server content**: In corporate environments, search existing workbooks, views, dashboards, published datasources, tags, owners, and project folders for the subject area, KPI names, business process, audience, and source system. Internal examples often carry the organization's vocabulary, governed metric definitions, color conventions, filter patterns, and trusted data model choices.
2. **Tableau Exchange accelerators**: Search Exchange accelerators by industry, department, source application, or business process. Accelerators are useful for jump-starting domain layouts, metric packs, and expected dashboard sections, but always validate their data requirements and remap them to the user's available fields.
3. **Tableau Public examples**: Search public workbooks by topic, chart type, industry, and storytelling pattern. Download or inspect workbook structure when the author allows it, then adapt techniques rather than copying blindly.
4. **Template libraries and built-in samples**: Fall back to known-good sample workbooks, personal template workbooks, or Superstore/World Indicators when no closer precedent exists.

When adapting a precedent, capture what you learned: source workbook/view name or URL, author/owner when available, which layout or calculation pattern is being reused, and what was changed for the user's datasource. Do not upload private or customer data to public services. Only copy, inject, or redistribute external workbooks when permissions and license terms allow it.

### Using a precedent as a starting workbook

When an approved workbook is downloadable or available internally:

1. Open or import the workbook in Tableau Desktop.
2. Copy the relevant worksheet/dashboard or inject the workbook as a starting point.
3. Replace demo datasources with the target datasource and remap fields.
4. Rename datasources, sheets, dashboards, captions, and comments so they match the user's domain.
5. Remove unused demo data, hidden fields, stale calculations, and source-specific branding.
6. Preserve attribution/provenance in notes or documentation when an external example materially influenced the result.
7. Verify calculations, filters, actions, performance, and visual fit against the target audience and data.

---

## Built-in Sample Data

Tableau Desktop ships with sample datasets that cover common use cases.

### Sample - Superstore

Location: included in every Tableau Desktop installation; appears in the start screen under Sample Workbooks.

Fields: Order ID, Order Date, Ship Date, Customer Name, Segment, Region, State, Category, Sub-Category, Product Name, Sales, Quantity, Discount, Profit.

**Good for:** sales analytics demos, bar charts, maps, time series, profitability analysis, YoY comparisons.

### World Indicators

Built-in sample with country-level economic and demographic data. Good for map visualizations and scatter plots showing correlations across countries.

### Sample Workbooks

Tableau ships several sample workbooks demonstrating different chart types and techniques:
- **Superstore** — comprehensive sales dashboard with multiple views
- **World Indicators** — geographic and trend visualizations
- **Regional** — regional sales breakdown with filters

Access via: File → Open → Tableau Packaged Workbook → navigate to Tableau's install directory → `Samples/`.

---

## Tableau Public — Community Examples

Tableau Public (public.tableau.com) hosts public workbooks, many of which are downloadable when authors allow it. It is a strong source for inspiration and working examples of complex chart types.

### Finding examples

- **Search by chart type:** "bump chart", "waffle chart", "Sankey diagram", "chord chart"
- **Search by industry:** "healthcare dashboard", "financial reporting", "HR analytics"
- **Viz of the Day gallery:** curated examples of high-quality work updated daily
- **Author profiles:** prominent community contributors often publish tutorials alongside their vizzes

### Downloading a workbook from Tableau Public

1. Open the viz on public.tableau.com
2. Click the Download button at the bottom of the viz
3. Choose Tableau Workbook — downloads as `.twbx`
4. Open in Tableau Desktop and inspect how it was built

This is the fastest way to learn how a complex technique (e.g., a Sankey diagram, a hex map, a donut chart) is constructed. The workbook shows all calculated fields, shelf configuration, and datasource structure.

---

## Chart Type Starting Points

For common chart types, these are the quickest ways to get a working starting point in Tableau Desktop:

### Bar Chart
1. Connect to any datasource
2. Double-click a dimension → it lands on Rows
3. Double-click a measure → it lands on Columns
4. Tableau auto-creates a horizontal bar chart

### Line Chart (Time Series)
1. Drag a date dimension to Columns (appears as YEAR by default; click the `+` to expand to Month)
2. Drag a measure to Rows
3. Mark type auto-selects Line

### Scatter Plot
1. Drag a measure to Columns, a different measure to Rows
2. Mark type auto-selects Circle
3. Drag a dimension to Color or Detail to control granularity

### Map
1. Drag a geographic dimension (State, Country, ZIP) to the canvas — Tableau auto-creates a map
2. Or double-click the geographic field in the Data pane
3. Drop a measure on Color for a choropleth, or on Size for a symbol map

### Gantt Chart
1. Drag a date to Columns as a continuous (green) date
2. Drag the task/entity dimension to Rows
3. Change mark type to Gantt Bar
4. Drag a duration measure to Size

### Text Table / Crosstab
1. Drag dimensions to Rows and/or Columns
2. Drag measures to Text on the marks card
3. Mark type auto-selects Text

### BAN (Big Number KPI)
1. Create a new worksheet
2. Drag an aggregated measure to Text
3. Change mark type to Text
4. Format the text size to 36-48pt via Format → Font → Marks
5. Suppress axes and gridlines

---

## Designing a Demo Workbook

When building a demo workbook for a customer meeting:

**Start with the customer's data if possible.** A demo on fake data is less compelling than one that shows the customer's own field names and patterns. Even a CSV export of 500 rows from their system is better than Superstore.

**If using sample data, pick the closest analogy:**

| Customer domain | Sample data substitute |
|---|---|
| Retail / e-commerce | Superstore (orders, products, geography) |
| Global / international | World Indicators (countries, metrics) |
| CRM / sales pipeline | Superstore (Customer, Segment, Profit as revenue proxy) |
| HR / workforce | Build manually from a small CSV — no good built-in analog |

**Keep the demo workbook focused:**
- 3-4 sheets maximum for a 30-minute demo
- One clear analytical question per sheet
- Show the "wow" viz first (the most visually impressive), not last
- Include at least one interactive element (filter, parameter, action) to demonstrate engagement

---

## Reusing Charts Across Workbooks

When you have a chart that works well and want to use a similar one in another workbook:

**Copy sheets between workbooks:**
1. Open both workbooks in Tableau Desktop
2. Right-click the source sheet tab → Copy Sheet
3. Switch to the target workbook → right-click blank area in the tab bar → Paste Sheet

Note: copied sheets bring their datasource dependencies with them. If the target workbook uses a different datasource, you'll need to re-map the fields (Tableau prompts you to do this).

**Saving a template workbook:**
Keep a personal "template library" `.twbx` with working examples of complex charts (Gantt, bump chart, trellis, sparkline table). When you need one, open the library, copy the sheet to the customer workbook, and remap fields.

---

## Best Practices

- **Start with internal Tableau precedents in corporate contexts.** Existing Cloud/Server workbooks usually reflect the organization's trusted metrics, terminology, governance, and design conventions better than generic examples.
- **Check Tableau Exchange accelerators before designing a domain dashboard from scratch.** Accelerators can provide a useful data model, metric inventory, and layout scaffold even when they need remapping.
- **Download working examples from Tableau Public before building from scratch.** For complex chart types (Sankey, waffle, hex map), building from an existing working example is 10x faster than constructing from scratch.
- **Preserve attribution and provenance.** Note the internal workbook, Exchange accelerator, or Tableau Public example that shaped the design, especially when copying sheets, calculations, or layout patterns.
- **Use Superstore for training and demos, not for polished customer work.** Customers can tell when a demo uses sample data. Use real or realistic data when the stakes are higher.
- **Keep a personal template workbook.** Complex charts (trellis, sparkline table, KPI scorecard) take time to configure correctly. Save working versions you can copy from rather than rebuilding each time.
- **Match the demo workbook to the customer's sophistication level.** A highly technical customer will appreciate seeing the calc fields and data model. An executive audience wants to see the dashboard, not the mechanics.

---

## Common Mistakes

1. **Starting from scratch without checking organizational precedent.** In corporate contexts, this often misses trusted metric definitions, naming conventions, and dashboard interaction patterns users already expect.
2. **Using Superstore for a customer who sells services, not physical goods.** The "Orders", "Products", "Shipping" framing doesn't resonate with a professional services or SaaS customer. Build a quick custom CSV that uses their vocabulary.
3. **Copying a public workbook without checking permissions or preserving attribution.** Tableau Public is public, not automatically license-free for redistribution or uncredited reuse.
4. **Uploading private or customer data to a public service to test a public example.** Keep sensitive data inside approved systems; adapt the workbook locally or use synthetic/sample data.
5. **Showing a demo at 1920x1080 to a customer who views Tableau on a 1366x768 laptop.** What looks good on your monitor may be unreadable at their resolution. Test the dashboard at the target size before the meeting.
6. **Forgetting to package the extract with the workbook.** Sending a `.twb` (not `.twbx`) to a customer who doesn't have your database access means they open a blank workbook. Always send `.twbx` when sharing standalone workbooks.
7. **Copying a sheet from Superstore into a customer workbook and leaving "Orders" as the datasource name.** Rename the datasource to match the customer's data immediately after copying.
8. **Building the demo the day before the meeting.** Complex chart types require iteration. Build the demo at least 2-3 days early to have time to troubleshoot and polish.

---

## Implementation

Use the sections above as the implementation reference for Tableau authoring. Apply the relevant pattern in the workbook or dashboard, then verify the result in Tableau for correctness, readability, and customer-safe behavior.

## Source and Confidence

- Source/evidence type: internal-doc
- Source: imported from prior Tableau authoring knowledge base (mbradbourne)
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-22
