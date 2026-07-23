// Compatibility shim for the round-2 branch: wave A lands the shared class in
// src/errors/mcpToolError.ts. Keep desktop imports stable here so reconcile is
// one import-path deletion/swap when that branch merges.
export { IncompleteOperationError } from '../../errors/mcpToolError.js';
