/**
 * Workbook Context Store
 * 
 * In-memory store for loaded WorkbookContext objects.
 * Allows agents to load a workbook context once and query it multiple times.
 */

import type { WorkbookContext } from '../../workbookContext/types.js';

interface StoredContext {
  context: WorkbookContext;
  loadedAt: Date;
  lastAccessedAt: Date;
}

class WorkbookContextStore {
  private contexts: Map<string, StoredContext> = new Map();

  // TTL for contexts (default: 1 hour)
  private readonly ttlMs = 60 * 60 * 1000;

  /**
   * Store a workbook context with a given ID
   */
  set(contextId: string, context: WorkbookContext): void {
    this.contexts.set(contextId, {
      context,
      loadedAt: new Date(),
      lastAccessedAt: new Date(),
    });
  }

  /**
   * Get a workbook context by ID, updating last access time
   */
  get(contextId: string): WorkbookContext | undefined {
    const stored = this.contexts.get(contextId);
    if (!stored) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - stored.lastAccessedAt.getTime() > this.ttlMs) {
      this.contexts.delete(contextId);
      return undefined;
    }

    // Update last accessed time
    stored.lastAccessedAt = new Date();
    return stored.context;
  }

  /**
   * Check if a context exists
   */
  has(contextId: string): boolean {
    return this.get(contextId) !== undefined;
  }

  /**
   * Delete a context
   */
  delete(contextId: string): boolean {
    return this.contexts.delete(contextId);
  }

  /**
   * List all context IDs
   */
  list(): string[] {
    // Clean up expired contexts first
    const now = Date.now();
    for (const [id, stored] of this.contexts.entries()) {
      if (now - stored.lastAccessedAt.getTime() > this.ttlMs) {
        this.contexts.delete(id);
      }
    }
    return Array.from(this.contexts.keys());
  }

  /**
   * Clear all contexts
   */
  clear(): void {
    this.contexts.clear();
  }
}

// Singleton instance
export const workbookContextStore = new WorkbookContextStore();
