export interface FieldRewriteEvent {
  requested: string;
  applied: string;
  reason: string;
  fabricated?: boolean;
  datasource?: string;
}

export type FieldRewriteListener = (event: FieldRewriteEvent) => void;

let listener: FieldRewriteListener | null = null;

export function setFieldRewriteListener(fn: FieldRewriteListener | null): void {
  listener = fn;
}

export function emitFieldRewrite(event: FieldRewriteEvent): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // Listener errors must never affect the apply path.
  }
}
