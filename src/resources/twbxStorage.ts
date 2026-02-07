/**
 * TWBX Storage Module
 * 
 * Stores downloaded Tableau workbook files (.twbx) on disk
 * and provides access to them via unique IDs.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Storage directory for TWBX files (in user's home directory for reliability)
const TWBX_STORAGE_DIR = path.join(os.homedir(), '.tableau-mcp', 'workbooks');

export interface StoredTwbxMetadata {
  id: string;
  filename: string;
  workbookId: string;
  workbookName: string;
  fileSize: number;
  storedAt: string;
  filePath: string;
}

// In-memory index (for prototype - would be persisted in production)
const twbxIndex: Map<string, StoredTwbxMetadata> = new Map();

/**
 * Ensures the storage directory exists
 */
async function ensureStorageDir(): Promise<string> {
  await fs.mkdir(TWBX_STORAGE_DIR, { recursive: true });
  return TWBX_STORAGE_DIR;
}

/**
 * Stores TWBX content to disk and returns metadata with a reference pointer
 */
export async function storeTwbx(params: {
  content: Buffer;
  workbookId: string;
  workbookName: string;
}): Promise<StoredTwbxMetadata> {
  const { content, workbookId, workbookName } = params;

  const storageDir = await ensureStorageDir();
  const id = randomUUID();
  const sanitizedName = workbookName.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `${sanitizedName}_${id.substring(0, 8)}.twbx`;
  const filePath = path.join(storageDir, filename);

  // Write file as binary
  await fs.writeFile(filePath, content);

  const metadata: StoredTwbxMetadata = {
    id,
    filename,
    workbookId,
    workbookName,
    fileSize: content.length,
    storedAt: new Date().toISOString(),
    filePath,
  };

  twbxIndex.set(id, metadata);

  return metadata;
}

/**
 * Retrieves TWBX content by ID
 */
export async function getTwbx(id: string): Promise<Buffer | undefined> {
  const metadata = twbxIndex.get(id);
  if (!metadata) return undefined;

  try {
    return await fs.readFile(metadata.filePath);
  } catch {
    return undefined;
  }
}

/**
 * Gets metadata for a stored TWBX
 */
export function getTwbxMetadata(id: string): StoredTwbxMetadata | undefined {
  return twbxIndex.get(id);
}

/**
 * Finds stored TWBX by workbook ID
 */
export function findTwbxByWorkbookId(workbookId: string): StoredTwbxMetadata | undefined {
  return Array.from(twbxIndex.values()).find((m) => m.workbookId === workbookId);
}

/**
 * Lists all stored TWBX files
 */
export function listAllTwbx(): StoredTwbxMetadata[] {
  return Array.from(twbxIndex.values());
}

/**
 * Deletes a stored TWBX
 */
export async function deleteTwbx(id: string): Promise<boolean> {
  const metadata = twbxIndex.get(id);
  if (!metadata) return false;

  try {
    await fs.unlink(metadata.filePath);
    twbxIndex.delete(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears all stored TWBX files (for testing)
 */
export async function clearAllTwbx(): Promise<void> {
  for (const [id] of twbxIndex) {
    await deleteTwbx(id);
  }
}

/**
 * Gets the storage directory path (for testing)
 */
export function getStorageDir(): string {
  return TWBX_STORAGE_DIR;
}
