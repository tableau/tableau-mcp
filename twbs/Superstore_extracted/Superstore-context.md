# Workbook: Superstore_us

## Data Sources

### Sales Target
*Embedded data source*

**Dimensions:**
- `Category` [string] - used in 8 view(s)
- `Order Date` [date] - used in 17 view(s)
- `Segment` [string] - used in 8 view(s)

**Measures:**
- `Sales Target` [integer]

### Sales Commission
*Embedded data source*

**Dimensions:**
- `Estimate Compensation label` [string]
- `Total Sales label` [string]
- `Order Date` [datetime] - used in 17 view(s)
- `Region` [string] - used in 16 view(s)
- `Sales Person` [string] - used in 2 view(s)

**Measures:**
- `Achievement (estimated)` (Achievement (copy)) [integer] - used in 1 view(s)
- `Achieved Quota` (Achievement (variable) (copy)) [string]
- `Base (Variable)` [integer]
- `% of quota achieved` (Calculation_0440925131659539) [real]
- `Rank over 3` (Calculation_4120925132203686) [real] - used in 2 view(s)
- `Sort by field` (Calculation_8140925133029303) [real]
- `Commission (Variable)` [real]
- `OTE (Variable)` [real]
- `Sales` [integer] - used in 6 view(s)
- `Total Compensation` [real]

**Calculated Fields:**
- `Achievement (estimated)` [integer]
  Formula: `[Sales]`
- `Achieved Quota` [string]
  Formula: `if SUM([Achievement (copy)]) >= [Parameters].[New Quota] then "100% +"&#13;&#10;elseif SUM([Achie...`
- `Base (Variable)` [integer]
  Formula: `[Parameters].[Base Salary]`
- `% of quota achieved` [real]
  Formula: `AVG([Achievement (copy)])/[Parameters].[New Quota]`
- `Rank over 3` [real] *table calculation*
  Formula: `ROUND(INDEX() / 3 - 0.6,0) + 1`
- `Sort by field` [real]
  Formula: `if [Parameters].[Parameter 1 1]="Names" then 0&#13;&#10;elseif [Parameters].[Parameter 1 1]="% qu...`
- `Commission (Variable)` [real]
  Formula: `([Parameters].[Commission Rate]*[Sales])/100`
- `Estimate Compensation label` [string]
  Formula: `"Estimated Compensation:"`
- `OTE (Variable)` [real]
  Formula: `[Parameters].[Base Salary] + ([Parameters].[Commission Rate]*[Parameters].[New Quota])/100`
- `Total Compensation` [real]
  Formula: `MIN([Base (Variable)]) + SUM([Commission (Variable)])`
- `Total Sales label` [string]
  Formula: `"Total Sales:"`

### Sample - Superstore
*Embedded data source*

**Dimensions:**
- `:Measure Names` [string]
- `Ship Status` (Calculation_6401103171259723) [string] - used in 2 view(s)
- `Order Profitable?` (Calculation_9060122104947471) [boolean] - used in 3 view(s)
- `Category` [string] - used in 8 view(s)
- `City` [string] - used in 2 view(s)
- `Country/Region` [string]
- `Customer Name` [string] - used in 2 view(s)
- `Order Date` [date] - used in 17 view(s)
- `Order ID (Returns)` [string] *hidden*
- `Order ID` [string] - used in 1 view(s)
- `Postal Code` [string]
- `Product Name` [string] - used in 1 view(s)
- `Region (People)` [string] *hidden*
- `Region` [string] - used in 16 view(s)
- `Row ID` [integer]
- `Segment` [string] - used in 8 view(s)
- `Ship Mode` [string] - used in 4 view(s)
- `State/Province` [string] - used in 1 view(s)
- `Sub-Category` [string] - used in 1 view(s)
- `Ship Date` [date] - used in 1 view(s)
- `Customer ID` [string]
- `Product ID` [string]
- `Regional Manager` [string]
- `Returned` [string]

**Measures:**
- `Days to Ship Actual` (Calculation_0831103151444568) [integer]
- `Sales Forecast` (Calculation_5421109230915137) [real]
- `Days to Ship Scheduled` (Calculation_6861103170623145) [integer]
- `Sales per Customer` (Calculation_9321103144526191) [real]
- `Profit Ratio` (Calculation_9921103144103743) [real] - used in 2 view(s)
- `Sales above Target?` (Calculation_9951107165644870) [string]
- `Discount` [real]
- `Profit` [real] - used in 1 view(s)
- `Units estimate` (Sales est (copy)) [real] *hidden*
- `Profit per Order` (Sales per Customer (copy)) [real]
- `Sales` [real] - used in 6 view(s)
- `Quantity` [integer]

**Calculated Fields:**
- `Days to Ship Actual` [integer]
  Formula: `DATEDIFF('day',[Order Date],[Ship Date])`
- `Sales Forecast` [real]
  Formula: `[Sales]*(1-[Parameters].[Parameter 2])*(1+[Parameters].[Parameter 1])`
- `Ship Status` [string]
  Formula: `if [Calculation_0831103151444568]> [Calculation_6861103170623145] then "Shipped Late" &#13;&#10;e...`
- `Days to Ship Scheduled` [integer]
  Formula: `CASE  [Ship Mode]&#13;&#10;WHEN "Same Day" THEN 0&#13;&#10;WHEN "First Class" THEN 1&#13;&#10;WHE...`
- `Order Profitable?` [boolean]
  Formula: `{fixed [Order ID]:sum([Profit])}>0&#13;&#10;// calculates the profit at the order level`
- `Sales per Customer` [real]
  Formula: `Sum([Sales])/countD([Customer Name])`
- `Profit Ratio` [real]
  Formula: `sum([Profit])/sum([Sales])`
- `Sales above Target?` [string]
  Formula: `If Sum([Sales])>SUM([federated.0hgpf0j1fdpvv316shikk0mmdlec].[Sales Target]) then "Above Target" ...`
- `Units estimate` [real]
  Formula: `ROUND([Quantity]*(1-[Parameters].[Parameter 2])*(1+[Parameters].[Parameter 1]),0)`
- `Profit per Order` [real]
  Formula: `Sum([Profit])/countD([Order ID])`

## Parameters

- `Base Salary` [integer] (range) = 50000 [min: 0]
- `Commission Rate` [real] (range) = 18.4 [min: 1, max: 100]
- `New Quota` [integer] (range) = 500000 [min: 100000]
- `Sort by` [string] (list) = Names [\% quota ascending, \% quota descending, Names]
- `New Business Growth` [real] (range) = 0.6 [min: 0, max: 1]
- `Churn Rate` [real] (range) = 0.064 [min: 0, max: 0.25]
## Required Filters

### Apply-to-All Filters
These filters apply across all worksheets:

- `Order Date` [quantitative] = [#2021-01-03# to #2024-12-30#]

## Worksheets

### CommissionProjection
*Title: Total Compensation with These Assumptions*
- Mark type: Automatic
- Rows: Calculation_4120925132203686, Sales Person
- Columns: Multiple Values
- Filters: 1 (0 context)

### CustomerOverview
- Mark type: Automatic
- Rows: Region
- Columns: , Multiple Values
- Filters: 7 (0 context)

### CustomerRank
*Title: Customer Ranking*
- Mark type: Automatic
- Rows: Customer Name
- Columns: Sales
- Filters: 6 (0 context)

### CustomerScatter
*Title: Sales and Profit by Customer*
- Mark type: Automatic
- Rows: Profit
- Columns: Sales
- Filters: 6 (0 context)

### DaystoShip
*Title: Days to Ship by Product for<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[qr:Order Date:ok]>of<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[yr:Order Date:ok]>*
- Mark type: Automatic
- Rows: Product Name
- Columns: Order Date
- Filters: 8 (0 context)

### Forecast
*Title: Sales Forecast*
- Mark type: Automatic
- Rows: Segment, fVal
- Columns: Order Date
- Filters: 2 (0 context)

### OTE
*Title: Estimated Compensation:Æ&#10;*
- Mark type: Automatic
- Rows: none
- Columns: none
- Filters: 1 (0 context)

### Performance
*Title: Sales Performance vs Target*
- Mark type: Bar
- Rows: Order Date, Order Date, Segment
- Columns: Category, Sales
- Filters: 2 (0 context)
- Type-in calculations: 1
  - `SUM([Sales])-SUM([Sales Target].[Sales Target])`: SUM([Sales])-SUM([federated.0hgpf0j1fdpvv316shikk0mmdlec].[Sales Target])

### Product Detail Sheet
- Mark type: Automatic
- Rows: Order ID, Customer Name, Order Date, Ship Date, Ship Mode
- Columns: none
- Filters: 10 (0 context)

### ProductDetails
*Title: Sales and Profit by Product Names
                            
Year: <[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[yr:Order Date:ok]>, Month: <[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[mn:Order Date:ok]>, Product Category: <[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[none:Category:nk]>*
- Mark type: Circle
- Rows: Category, Sub-Category
- Columns: Segment, Sales
- Filters: 7 (0 context)

### ProductView
*Title: Sales by Product Category*
- Mark type: Square
- Rows: Category, Order Date
- Columns: Order Date
- Filters: 3 (0 context)

### QuotaAttainment
*Title: Estimated Quota Attainment Results with These Assumptions*
- Mark type: Automatic
- Rows: Calculation_4120925132203686, Sales Person
- Columns: Achievement (copy)

### Sale Map
*Title: Sales by Geography*
- Mark type: Multipolygon
- Rows: Latitude (generated)
- Columns: Longitude (generated)
- Filters: 4 (0 context)

### Sales
*Title: Estimated Sales:Æ&#10;*
- Mark type: Automatic
- Rows: none
- Columns: none
- Filters: 1 (0 context)

### Sales by Product
*Title: Monthly Sales by Product Category - States/Provinces:<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[State/Province]>*
- Mark type: Area
- Rows: Category, Sales
- Columns: Order Date
- Filters: 6 (0 context)

### Sales by Segment
*Title: Monthly Sales by Segment - States/Provinces:<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[State/Province]>*
- Mark type: Area
- Rows: Segment, Sales
- Columns: Order Date
- Filters: 6 (0 context)

### ShipSummary
- Mark type: Automatic
- Rows: none
- Columns: cnt
- Filters: 5 (0 context)

### ShippingTrend
*Title: Shipments by Mode*
- Mark type: Area
- Rows: __tableau_internal_object_id__
- Columns: Order Date, Order Date
- Filters: 6 (0 context)

### Tooltip: Profit Ratio by City
*Title: Profit Ratio by City*
- Mark type: Automatic
- Rows: City
- Columns: Calculation_9921103144103743
- Filters: 3 (0 context)

### Total Sales
*Title: Executive Overview - Profitability(<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[State/Province]>)*
- Mark type: Automatic
- Rows: none
- Columns: none
- Filters: 6 (0 context)

### What If Forecast
*Title: What if Forecast Based on<[federated.10nnk8d1vgmw8q17yu76u06pnbcj].[yr:Order Date:ok]>Sales (<[Parameters].[Parameter 1]>Growth,<[Parameters].[Parameter 2]>Churn)*
- Mark type: Automatic
- Rows: none
- Columns: none
- Filters: 4 (0 context)
- Type-in calculations: 1
  - `SUM([Sales])-SUM([Sales Forecast])`: SUM([Sales])-SUM([Calculation_5421109230915137])

### type-in calc demonstration
- Mark type: Automatic
- Rows: Calculation_3436176182975791105
- Columns: none
- Type-in calculations: 1
  - `SPLIT([Customer Name]," ", 2)`: SPLIT([Customer Name]," ", 2)


## Dashboards

### Commission Model
*Title: Sales Commission Model*
- Worksheets: QuotaAttainment, CommissionProjection, Sales, OTE
- Actions: 1 (0 filter, 1 highlight)

### Customers
*Title: Customer Analysis*
- Worksheets: CustomerScatter, CustomerRank, CustomerOverview
- Actions: 3 (1 filter, 2 highlight)

### Order Details
*Title: <Sheet Name>*
- Worksheets: Product Detail Sheet

### Overview
*Title: Executive Overview - Profitability*
- Worksheets: Total Sales, Sale Map, Sales by Segment, Sales by Product
- Actions: 3 (1 filter, 2 highlight)

### Product
*Title: Product Drilldown*
- Worksheets: ProductView, ProductDetails
- Actions: 1 (1 filter, 0 highlight)

### Shipping
*Title: On-Time Shipment Trends*
- Worksheets: ShipSummary, ShippingTrend, DaystoShip
- Actions: 2 (2 filter, 0 highlight)
