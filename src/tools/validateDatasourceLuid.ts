export function validateDatasourceLuid({ datasourceLuid }: { datasourceLuid: string }): void {
  if (!datasourceLuid) {
    throw new Error(
      'datasourceLuid must not be an empty string. Use the "list-datasources" tool to get a list of datasources and their luid.',
    );
  }
}
