/**
 * Script to dump workbook context to a JSON file for inspection.
 * 
 * Usage:
 *   npx tsx src/workbookContext/dumpContext.ts <path-to-twb> [output-file]
 * 
 * Examples:
 *   npx tsx src/workbookContext/dumpContext.ts ./twbs/Superstore_extracted/Superstore.twb
 *   npx tsx src/workbookContext/dumpContext.ts ./twbs/Superstore_extracted/Superstore.twb ./output/superstore-context.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseTwbFile } from './twbParser';
import { generateContextSummary } from './contextFormatter';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx src/workbookContext/dumpContext.ts <path-to-twb> [output-file]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx src/workbookContext/dumpContext.ts ./twbs/Superstore_extracted/Superstore.twb');
    console.log('  npx tsx src/workbookContext/dumpContext.ts ./twbs/Superstore_extracted/Superstore.twb ./superstore-context.json');
    process.exit(1);
  }

  const twbPath = args[0];
  const outputPath = args[1] || twbPath.replace(/\.twb$/i, '-context.json');

  console.log(`Parsing: ${twbPath}`);

  try {
    const context = await parseTwbFile(twbPath, {
      includeFilterDetails: true,
      includeMarksDetails: true,
      includeActions: true,
    });

    // Write the full context as JSON
    const jsonOutput = JSON.stringify(context, null, 2);
    fs.writeFileSync(outputPath, jsonOutput, 'utf-8');
    console.log(`Full context written to: ${outputPath}`);

    // Also write a markdown summary
    const mdPath = outputPath.replace(/\.json$/i, '.md');
    const mdOutput = generateContextSummary(context, {
      format: 'markdown',
      includeHiddenFields: true,
      includeFormulas: true,
      includeWorksheets: true,
      includeDashboards: true,
      includeFilterDetails: true,
    });
    fs.writeFileSync(mdPath, mdOutput, 'utf-8');
    console.log(`Markdown summary written to: ${mdPath}`);

    // Print quick stats
    console.log('');
    console.log('=== Quick Stats ===');
    console.log(`Workbook: ${context.workbookName}`);
    console.log(`Data Sources: ${context.dataSources.length}`);

    let totalFields = 0;
    let totalCalcs = 0;
    let hiddenFields = 0;

    for (const ds of context.dataSources) {
      totalFields += ds.fields.length;
      totalCalcs += ds.calculations.length;
      hiddenFields += ds.fields.filter(f => f.isHidden).length;
      console.log(`  - ${ds.dataSourceName}: ${ds.fields.length} fields, ${ds.calculations.length} calcs`);
    }

    console.log(`Total Fields: ${totalFields} (${hiddenFields} hidden)`);
    console.log(`Total Calculations: ${totalCalcs}`);
    console.log(`Parameters: ${context.parameters.length}`);
    console.log(`Worksheets: ${context.worksheets.length}`);
    console.log(`Dashboards: ${context.dashboards.length}`);
    console.log(`Required Filters: ${context.requiredFilters.dataSourceFilters.length} data source, ${context.requiredFilters.applyToAllFilters.length} apply-to-all`);

  } catch (error) {
    console.error('Error parsing TWB:', error);
    process.exit(1);
  }
}

main();
