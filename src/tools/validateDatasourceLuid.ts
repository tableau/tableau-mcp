export function validateDatasourceLuid({ datasourceLuid }: { datasourceLuid: string }): void {
  if (!datasourceLuid) {
    throw new Error(
      'datasourceLuid must be a non-empty string. Use the "list-datasources" tool to get a list of datasources and their luid.',
    );
  }
}
