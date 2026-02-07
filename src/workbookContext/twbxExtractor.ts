/**
 * TWBX Extractor
 * 
 * Extracts the TWB (Tableau Workbook XML) file from a TWBX (packaged workbook) archive.
 * TWBX files are ZIP archives containing:
 * - The .twb file (XML workbook definition)
 * - Data/ folder with extracts (optional)
 * - Other resources
 */

import AdmZip from 'adm-zip';

export interface TwbxContents {
  /** The TWB XML content as a string */
  twbXml: string;
  /** The name of the TWB file found in the archive */
  twbFilename: string;
  /** List of all files in the archive (for debugging/info) */
  allFiles: string[];
}

export interface TwbxExtractionError {
  type: 'invalid-zip' | 'no-twb-found' | 'extraction-failed';
  message: string;
}

/**
 * Extracts the TWB XML content from a TWBX buffer.
 * 
 * @param twbxBuffer - The TWBX file content as a Buffer
 * @returns The extracted TWB content or an error
 */
export function extractTwbFromTwbx(
  twbxBuffer: Buffer
): TwbxContents | TwbxExtractionError {
  try {
    const zip = new AdmZip(twbxBuffer);
    const entries = zip.getEntries();

    // Get all file names for debugging
    const allFiles = entries.map(e => e.entryName);

    // Find the .twb file (should be at root level)
    const twbEntry = entries.find(entry =>
      entry.entryName.endsWith('.twb') &&
      !entry.entryName.includes('/') // Root level only
    );

    if (!twbEntry) {
      // Try finding any .twb file if not at root
      const anyTwbEntry = entries.find(entry => entry.entryName.endsWith('.twb'));

      if (!anyTwbEntry) {
        return {
          type: 'no-twb-found',
          message: `No .twb file found in archive. Files present: ${allFiles.join(', ')}`,
        };
      }

      // Use the nested one
      const twbXml = anyTwbEntry.getData().toString('utf-8');
      return {
        twbXml,
        twbFilename: anyTwbEntry.entryName,
        allFiles,
      };
    }

    const twbXml = twbEntry.getData().toString('utf-8');

    return {
      twbXml,
      twbFilename: twbEntry.entryName,
      allFiles,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid or unsupported zip')) {
      return {
        type: 'invalid-zip',
        message: 'The provided file is not a valid ZIP/TWBX archive',
      };
    }

    return {
      type: 'extraction-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Checks if an extraction result is an error
 */
export function isExtractionError(
  result: TwbxContents | TwbxExtractionError
): result is TwbxExtractionError {
  return 'type' in result && ['invalid-zip', 'no-twb-found', 'extraction-failed'].includes(result.type);
}

/**
 * Extracts TWB from a TWBX file on disk.
 * 
 * @param twbxPath - Path to the TWBX file
 * @returns The extracted TWB content or an error
 */
export async function extractTwbFromTwbxFile(
  twbxPath: string
): Promise<TwbxContents | TwbxExtractionError> {
  try {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(twbxPath);
    return extractTwbFromTwbx(buffer);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return {
        type: 'extraction-failed',
        message: `File not found: ${twbxPath}`,
      };
    }

    return {
      type: 'extraction-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
