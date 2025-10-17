import { BoundedContext } from '../config.js';

export async function isDatasourceAllowed({
  datasourceLuid,
  boundedContext: { datasourceIds, projectIds },
  getDatasourceProjectId,
}: {
  datasourceLuid: string;
  boundedContext: BoundedContext;
  getDatasourceProjectId: () => Promise<string>;
}): Promise<{ allowed: true } | { allowed: false; message: string }> {
  if (datasourceIds && !datasourceIds.has(datasourceLuid)) {
    return {
      allowed: false,
      message: [
        'The set of allowed data sources that can be queried is limited by the server configuration.',
        `Querying the datasource with LUID ${datasourceLuid} is not allowed.`,
      ].join(' '),
    };
  }

  if (projectIds) {
    let allowed = projectIds.size > 0;
    if (allowed) {
      const datasourceProjectId = await getDatasourceProjectId();
      allowed = projectIds.has(datasourceProjectId);
    }

    if (!allowed) {
      return {
        allowed: false,
        message: [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          `Querying the datasource with LUID ${datasourceLuid} is not allowed because it does not belong to an allowed project.`,
        ].join(' '),
      };
    }
  }

  return { allowed: true };
}
