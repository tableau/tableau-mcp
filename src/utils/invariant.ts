export default function invariant(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ? message : 'Invariant Violation');
  }
}
