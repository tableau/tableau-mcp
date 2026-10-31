import { BoundedContext } from '../../../overridableConfig.js';
import { LineageWireNode } from '../../../sdks/tableau/methods/dataLineage.js';
import { LineageKind } from '../../../sdks/tableau/types/dataLineage.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';

/** Gate all identities before they can enter a result or a dependency path. */
export function lineageAccess(
  extra: TableauWebRequestHandlerExtra,
  bounds: BoundedContext,
): (node: LineageWireNode, kind: LineageKind) => Promise<boolean> {
  const bounded = Object.values(bounds).some((value) => value !== null && value !== undefined);
  const workbook = async (id?: string | null): Promise<boolean> =>
    !!id && (await resourceAccessChecker.isWorkbookAllowed({ workbookId: id, extra })).allowed;
  return async (node, kind) => {
    if (kind === 'column') {
      // External columns have no supported project/tag/workbook scope mapping.
      // Do not let an arbitrary external root bypass configured restrictions.
      return !bounded;
    }
    if (kind === 'flow' || kind.startsWith('flow-')) {
      const owners =
        kind === 'flow'
          ? [{ luid: node.luid }]
          : Array.isArray(node.flow)
            ? node.flow
            : [node.flow];
      const ids = owners.map((owner) => owner?.luid).filter((id): id is string => !!id);
      if (!ids.length) return !bounded;
      for (const flowId of ids) {
        if (!(await resourceAccessChecker.isFlowAllowed({ flowId, extra })).allowed) return false;
      }
      return true;
    }
    if (kind === 'field' || kind === 'datasource') {
      const owner = kind === 'field' ? node.datasource : node;
      if (!owner) return !bounded;
      if (owner.__typename === 'EmbeddedDatasource') {
        // Metadata embedded IDs are NOT REST-queryable datasource LUIDs. The
        // authoritative parent workbook is sufficient only without a datasource
        // ID ceiling, matching the existing embedded-datasource scope policy.
        return !bounds.datasourceIds && (bounded ? await workbook(owner.workbook?.luid) : true);
      }
      if (!owner.luid) return !bounded;
      return (
        await resourceAccessChecker.isDatasourceAllowed({ datasourceLuid: owner.luid, extra })
      ).allowed;
    }
    if (kind === 'sheet' || kind === 'dashboard') {
      if (bounds.viewIds && (!node.luid || !bounds.viewIds.has(node.luid))) return false;
      if (
        node.luid &&
        !(await resourceAccessChecker.isViewAllowed({ viewId: node.luid, extra })).allowed
      )
        return false;
      return !bounded || (await workbook(node.workbook?.luid));
    }
    if (kind === 'workbook') return !bounded || (await workbook(node.luid));
    return false;
  };
}
