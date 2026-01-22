/**
 * CSV Analyzer - Parses CSV and computes summary statistics
 */

export interface ColumnStats {
  name: string;
  type: 'dimension' | 'measure' | 'unknown';
  distinctCount: number;
  distinctValues?: string[]; // Only for dimensions with reasonable cardinality
  numericStats?: {
    min: number;
    max: number;
    avg: number;
    sum: number;
  };
  sampleValues: string[];
}

export interface CsvAnalysis {
  rowCount: number;
  columnCount: number;
  columns: ColumnStats[];
  sampleRows: Record<string, string>[];
}

/**
 * Parse CSV string into rows of objects
 */
function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Parse header - handle quoted values
  const headers = parseCsvLine(lines[0]);

  // Parse data rows
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line handling quoted values
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Determine if a column is numeric (measure) or categorical (dimension)
 */
function inferColumnType(values: string[]): 'dimension' | 'measure' | 'unknown' {
  if (values.length === 0) return 'unknown';

  // Sample up to 100 values
  const sample = values.slice(0, 100);
  let numericCount = 0;

  for (const val of sample) {
    if (val === '' || val === 'null' || val === 'NULL') continue;
    // Check if it's a number (including decimals and negatives)
    if (/^-?\d+\.?\d*$/.test(val.replace(/,/g, ''))) {
      numericCount++;
    }
  }

  // If more than 80% of non-empty values are numeric, treat as measure
  const nonEmptyCount = sample.filter((v) => v !== '' && v !== 'null' && v !== 'NULL').length;
  if (nonEmptyCount > 0 && numericCount / nonEmptyCount > 0.8) {
    return 'measure';
  }

  return 'dimension';
}

/**
 * Compute statistics for a single column
 */
function computeColumnStats(name: string, values: string[]): ColumnStats {
  const type = inferColumnType(values);

  // Get distinct values
  const distinctSet = new Set(values.filter((v) => v !== '' && v !== 'null' && v !== 'NULL'));
  const distinctCount = distinctSet.size;

  // Sample values (first 5 unique)
  const sampleValues = Array.from(distinctSet).slice(0, 5);

  const stats: ColumnStats = {
    name,
    type,
    distinctCount,
    sampleValues,
  };

  // For dimensions with reasonable cardinality, include all distinct values
  if (type === 'dimension' && distinctCount <= 50) {
    stats.distinctValues = Array.from(distinctSet).sort();
  }

  // For measures, compute numeric statistics
  if (type === 'measure') {
    const numericValues = values
      .map((v) => parseFloat(v.replace(/,/g, '')))
      .filter((n) => !isNaN(n));

    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      stats.numericStats = {
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        avg: sum / numericValues.length,
        sum,
      };
    }
  }

  return stats;
}

/**
 * Analyze CSV content and return summary statistics
 */
export function analyzeCsv(content: string, maxSampleRows: number = 5): CsvAnalysis {
  const { headers, rows } = parseCsv(content);

  // Compute stats for each column
  const columns: ColumnStats[] = headers.map((header) => {
    const values = rows.map((row) => row[header] ?? '');
    return computeColumnStats(header, values);
  });

  // Get sample rows
  const sampleRows = rows.slice(0, maxSampleRows);

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    columns,
    sampleRows,
  };
}

/**
 * Analyze query result (JSON array) and return summary statistics
 */
export function analyzeQueryResult(data: Record<string, unknown>[], maxSampleRows: number = 5): CsvAnalysis {
  if (data.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      sampleRows: [],
    };
  }

  // Get headers from first row
  const headers = Object.keys(data[0]);

  // Convert all values to strings for consistent analysis
  const rows: Record<string, string>[] = data.map((row) => {
    const stringRow: Record<string, string> = {};
    for (const key of headers) {
      const val = row[key];
      stringRow[key] = val === null || val === undefined ? '' : String(val);
    }
    return stringRow;
  });

  // Compute stats for each column
  const columns: ColumnStats[] = headers.map((header) => {
    const values = rows.map((row) => row[header] ?? '');
    return computeColumnStatsFromValues(header, values);
  });

  // Get sample rows
  const sampleRows = rows.slice(0, maxSampleRows);

  return {
    rowCount: rows.length,
    columnCount: headers.length,
    columns,
    sampleRows,
  };
}

/**
 * Helper to compute column stats from string values
 */
function computeColumnStatsFromValues(name: string, values: string[]): ColumnStats {
  const type = inferColumnType(values);

  // Get distinct values
  const distinctSet = new Set(values.filter((v) => v !== '' && v !== 'null' && v !== 'NULL'));
  const distinctCount = distinctSet.size;

  // Sample values (first 5 unique)
  const sampleValues = Array.from(distinctSet).slice(0, 5);

  const stats: ColumnStats = {
    name,
    type,
    distinctCount,
    sampleValues,
  };

  // For dimensions with reasonable cardinality, include all distinct values
  if (type === 'dimension' && distinctCount <= 50) {
    stats.distinctValues = Array.from(distinctSet).sort();
  }

  // For measures, compute numeric statistics
  if (type === 'measure') {
    const numericValues = values
      .map((v) => parseFloat(v.replace(/,/g, '')))
      .filter((n) => !isNaN(n));

    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      stats.numericStats = {
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        avg: sum / numericValues.length,
        sum,
      };
    }
  }

  return stats;
}

/**
 * Generate a human-readable summary of the analysis
 */
export function generateAnalysisSummary(viewName: string, analysis: CsvAnalysis): string {
  const dimensions = analysis.columns.filter((c) => c.type === 'dimension');
  const measures = analysis.columns.filter((c) => c.type === 'measure');

  const parts: string[] = [];

  parts.push(`${viewName} contains ${analysis.rowCount} rows across ${analysis.columnCount} columns.`);

  if (dimensions.length > 0) {
    const dimSummaries = dimensions.slice(0, 3).map((d) => {
      if (d.distinctValues && d.distinctValues.length <= 10) {
        return `${d.name} (${d.distinctValues.join(', ')})`;
      }
      return `${d.name} (${d.distinctCount} unique values)`;
    });
    parts.push(`Dimensions: ${dimSummaries.join('; ')}.`);
  }

  if (measures.length > 0) {
    const measureSummaries = measures.slice(0, 3).map((m) => {
      if (m.numericStats) {
        const { min, max, avg } = m.numericStats;
        return `${m.name} (range: ${formatNumber(min)} to ${formatNumber(max)}, avg: ${formatNumber(avg)})`;
      }
      return m.name;
    });
    parts.push(`Measures: ${measureSummaries.join('; ')}.`);
  }

  return parts.join(' ');
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return (n / 1000000).toFixed(1) + 'M';
  }
  if (Math.abs(n) >= 1000) {
    return (n / 1000).toFixed(1) + 'K';
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toFixed(2);
}
