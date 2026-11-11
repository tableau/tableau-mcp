import {
  getWorksheetFieldPlacements,
  WorksheetFieldPlacements,
} from '../../../../desktop/metadata/fields.js';
import type { EncodingType } from '../../../../desktop/metadata/types.js';
import { prefillNextAction, StructuredResult, withNextAction } from '../../structuredContent.js';

export type FieldRemovalPlacement = 'Rows shelf' | 'Columns shelf' | `${EncodingType} encoding`;

/** Shared by the tool and its in-memory eval so the model receives the same success guidance. */
export function removeFieldResult(
  placement: FieldRemovalPlacement,
  worksheetFile: string,
  columnRef: string,
  modifiedXml: string,
): StructuredResult<{
  message: string;
  file: string;
  applied: false;
  removed: { columnRef: string; placement: FieldRemovalPlacement };
  currentPlacements: WorksheetFieldPlacements;
}> {
  const isDetail = placement === 'lod encoding' || placement === 'detail encoding';
  return withNextAction(
    {
      message:
        `Successfully removed field from ${isDetail ? 'Detail (lod) encoding' : placement}. ` +
        'Removal is complete in this draft; other placements are unchanged. ' +
        (isDetail
          ? 'Detail and lod are aliases for the same encoding. Do not repeat this removal using the other alias. '
          : '') +
        `Updated file: ${worksheetFile}. ` +
        'These draft edits have not been applied. Current placements are included below ' +
        '(encodings cover the first pane). If further verification is needed, use read-cached-xml ' +
        'with filePath set to this file. Do not use get-worksheet-xml to verify pending edits; ' +
        'it reads live state and resets the edit buffer. ' +
        'Use apply-worksheet with this file to apply changes.',
      file: worksheetFile,
      applied: false,
      removed: { columnRef, placement: isDetail ? 'lod encoding' : placement },
      currentPlacements: getWorksheetFieldPlacements(modifiedXml),
    },
    prefillNextAction('Apply worksheet edits'),
  );
}
