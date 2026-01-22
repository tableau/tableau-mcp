import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Storage directory for CSV files (in user's home directory for reliability)
const CSV_STORAGE_DIR = path.join(os.homedir(), '.tableau-mcp', 'analysis-data');

export interface StoredCsvMetadata {
  id: string;
  filename: string;
  viewId: string;
  viewName: string;
  workbookId: string;
  rowCount: number;
  columnCount: number;
  storedAt: string;
  filePath: string;
}

export interface StoredQueryResultMetadata {
  id: string;
  filename: string;
  datasourceLuid: string;
  queryPurpose: string;
  rowCount: number;
  columnCount: number;
  storedAt: string;
  filePath: string;
}

// In-memory indexes (for prototype - would be persisted in production)
const csvIndex: Map<string, StoredCsvMetadata> = new Map();
const queryResultIndex: Map<string, StoredQueryResultMetadata> = new Map();

/**
 * Ensures the storage directory exists
 */
async function ensureStorageDir(): Promise<string> {
  await fs.mkdir(CSV_STORAGE_DIR, { recursive: true });
  return CSV_STORAGE_DIR;
}

/**
 * Stores CSV content to disk and returns metadata with a reference pointer
 */
export async function storeCsv(params: {
  content: string;
  viewId: string;
  viewName: string;
  workbookId: string;
}): Promise<StoredCsvMetadata> {
  const { content, viewId, viewName, workbookId } = params;

  const storageDir = await ensureStorageDir();
  const id = randomUUID();
  const sanitizedViewName = viewName.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${sanitizedViewName}_${id.substring(0, 8)}.csv`;
  const filePath = path.join(storageDir, filename);

  // Count rows and columns
  const lines = content.trim().split('\n');
  const rowCount = Math.max(0, lines.length - 1); // Exclude header
  const columnCount = lines[0] ? lines[0].split(',').length : 0;

  // Write file
  await fs.writeFile(filePath, content, 'utf-8');

  const metadata: StoredCsvMetadata = {
    id,
    filename,
    viewId,
    viewName,
    workbookId,
    rowCount,
    columnCount,
    storedAt: new Date().toISOString(),
    filePath,
  };

  csvIndex.set(id, metadata);

  return metadata;
}

/**
 * Stores query result (JSON) to disk and returns metadata with a reference pointer
 */
export async function storeQueryResult(params: {
  data: Record<string, unknown>[];
  datasourceLuid: string;
  queryPurpose: string;
}): Promise<StoredQueryResultMetadata> {
  const { data, datasourceLuid, queryPurpose } = params;

  const storageDir = await ensureStorageDir();
  const id = randomUUID();
  const sanitizedPurpose = queryPurpose.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `query_${sanitizedPurpose}_${id.substring(0, 8)}.json`;
  const filePath = path.join(storageDir, filename);

  // Count rows and columns
  const rowCount = data.length;
  const columnCount = data.length > 0 ? Object.keys(data[0]).length : 0;

  // Write file
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

  const metadata: StoredQueryResultMetadata = {
    id,
    filename,
    datasourceLuid,
    queryPurpose,
    rowCount,
    columnCount,
    storedAt: new Date().toISOString(),
    filePath,
  };

  queryResultIndex.set(id, metadata);

  return metadata;
}

/**
 * Retrieves query result by ID
 */
export async function getQueryResult(id: string): Promise<Record<string, unknown>[] | undefined> {
  const metadata = queryResultIndex.get(id);
  if (!metadata) return undefined;

  try {
    const content = await fs.readFile(metadata.filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Gets metadata for a stored query result
 */
export function getQueryResultMetadata(id: string): StoredQueryResultMetadata | undefined {
  return queryResultIndex.get(id);
}

/**
 * Retrieves CSV content by ID
 */
export async function getCsv(id: string): Promise<string | undefined> {
  const metadata = csvIndex.get(id);
  if (!metadata) return undefined;

  try {
    return await fs.readFile(metadata.filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Gets metadata for a stored CSV
 */
export function getCsvMetadata(id: string): StoredCsvMetadata | undefined {
  return csvIndex.get(id);
}

/**
 * Lists all stored CSVs for a workbook
 */
export function listCsvsForWorkbook(workbookId: string): StoredCsvMetadata[] {
  return Array.from(csvIndex.values()).filter((m) => m.workbookId === workbookId);
}

/**
 * Deletes a stored CSV
 */
export async function deleteCsv(id: string): Promise<boolean> {
  const metadata = csvIndex.get(id);
  if (!metadata) return false;

  try {
    await fs.unlink(metadata.filePath);
    csvIndex.delete(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears all stored CSVs (for testing)
 */
export async function clearAllCsvs(): Promise<void> {
  for (const [id] of csvIndex) {
    await deleteCsv(id);
  }
}
