import { BaseConfig, removeClaudeMcpBundleUserConfigTemplates } from './config.shared.js';
import { DEFAULT_INLINE_IMAGE_MAX_BYTES } from './desktop/inlineImageCap.js';
import { DEFAULT_INLINE_XML_MAX_BYTES } from './desktop/inlineXmlCap.js';
import { parseNumber } from './utils/parseNumber.js';

export class Config extends BaseConfig {
  // toolProfile lives on BaseConfig (shared with web/combined); desktop consumes it via
  // selectToolsForProfile — '' / 'full' / 'combined-lean' → full set, 'demo' → slim set.
  /**
   * Server-enforced ceiling (bytes) on inline workbook/worksheet/dashboard XML in a tool
   * result. Over this, the get-*-xml tools respond in file mode regardless of the requested
   * mode, keeping large XML out of the conversation. Env-overridable via INLINE_XML_MAX_BYTES.
   */
  inlineXmlMaxBytes: number;

  /**
   * Server-enforced ceiling on inline image payloads (decoded bytes). Over it, export-image
   * tools cache the image to a file and return its path instead of an inline base64 block.
   * Env-overridable via INLINE_IMAGE_MAX_BYTES.
   */
  inlineImageMaxBytes: number;

  /** Optional override for the External Client API discovery directory. */
  externalApiDiscoveryDir: string | undefined;

  /**
   * Session id (Desktop pid) the launching Tableau Desktop pinned via
   * `TABLEAU_DESKTOP_SESSION_ID`. When set, every session-scoped tool defaults to
   * this instance and `list-instances` is not registered, so the agent never has to
   * discover which Desktop to control. Ignored unless it is a non-blank numeric pid.
   */
  desktopSessionId: string | undefined;

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      INLINE_XML_MAX_BYTES: inlineXmlMaxBytes,
      INLINE_IMAGE_MAX_BYTES: inlineImageMaxBytes,
      TABLEAU_EXTERNAL_API_DISCOVERY_DIR: externalApiDiscoveryDir,
      TABLEAU_DESKTOP_SESSION_ID: desktopSessionId,
    } = cleansedVars;

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }

    this.externalApiDiscoveryDir = externalApiDiscoveryDir || undefined;
    this.desktopSessionId =
      desktopSessionId && /^\d+$/.test(desktopSessionId) ? desktopSessionId : undefined;

    this.inlineXmlMaxBytes = parseNumber(inlineXmlMaxBytes, {
      defaultValue: DEFAULT_INLINE_XML_MAX_BYTES,
      minValue: 1,
    });

    this.inlineImageMaxBytes = parseNumber(inlineImageMaxBytes, {
      defaultValue: DEFAULT_INLINE_IMAGE_MAX_BYTES,
      minValue: 1,
    });
  }
}

export const getDesktopConfig = (): Config => new Config();
