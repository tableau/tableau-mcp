import { Ok, Result } from 'ts-results-es';

import { ArgsValidationError } from '../../errors/mcpToolError.js';
import { ProductVersion } from '../../sdks/tableau/types/serverInfo.js';
import { getResultForTableauVersion } from '../../utils/isTableauVersionAtLeast.js';

const MIN_VERSION_FOR_SVG = '2026.2.0';

export function getImageFormatForVersion(
  desiredFormat: 'PNG' | 'SVG' | undefined,
  productVersion: ProductVersion,
): Result<'PNG' | 'SVG' | undefined, ArgsValidationError> {
  // Version check for format parameter
  const supportsFormat = getResultForTableauVersion({
    productVersion,
    mappings: {
      [MIN_VERSION_FOR_SVG]: true,
      default: false,
    },
  });

  // If SVG is requested but version is too old, return an error
  if (desiredFormat === 'SVG' && !supportsFormat) {
    return new ArgsValidationError(
      `SVG format requires Tableau Server ${MIN_VERSION_FOR_SVG} or later. Current version: ${productVersion.value}`,
    ).toErr();
  }

  // If PNG is requested but version is too old, omit format parameter (PNG is default)
  const formatToUse = desiredFormat === 'PNG' && !supportsFormat ? undefined : desiredFormat;
  return Ok(formatToUse);
}
