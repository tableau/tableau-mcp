export function validateDatasourceLuid({ datasourceLuid }: { datasourceLuid: string }): void {
  if (!datasourceLuid) {
    throw new Error('datasourceLuid must be a non-empty string.');
  }
}
