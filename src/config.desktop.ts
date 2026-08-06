import { BaseConfig, removeClaudeMcpBundleUserConfigTemplates } from './config.shared.js';
import {
  DEFAULT_DESKTOP_CALL_TIMEOUT_MS,
  MIN_DESKTOP_CALL_TIMEOUT_MS,
} from './desktop/callDeadline.js';
import {
  DEFAULT_IMAGE_EXPORT_TIMEOUT_MS,
  DEFAULT_INLINE_IMAGE_MAX_BYTES,
} from './desktop/limits/inlineImageCap.js';
import { DEFAULT_INLINE_XML_MAX_BYTES } from './desktop/limits/inlineXmlCap.js';
import { parseSessionPid } from './desktop/session/parseSessionPid.js';
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

  /**
   * Deadline (ms) applied to the image-render call in the export-image tools. Bounds the
   * unbounded hang seen when Tableau Desktop is showing a modal dialog that blocks rendering,
   * converting it into a reportable timeout error. Env-overridable via IMAGE_EXPORT_TIMEOUT_MS.
   */
  imageExportTimeoutMs: number;

  /** Optional override for the External Client API discovery directory. */
  externalApiDiscoveryDir: string | undefined;

  /**
   * Session id (Desktop pid) the launching Tableau Desktop pinned via
   * `TABLEAU_DESKTOP_SESSION_ID`. When set, every session-scoped tool defaults to
   * this instance, so the agent never has to discover which Desktop to control. The pin
   * is a default, not an invariant: `list-instances` stays registered and the agent may
   * still target another open Desktop. Ignored unless it is a non-blank numeric pid.
   */
  desktopSessionId: string | undefined;

  /**
   * Wall-clock ceiling (ms) on a single desktop tool call. Past it the call aborts and the
   * agent is told Desktop stopped answering. Env-overridable via TABLEAU_DESKTOP_CALL_TIMEOUT_MS;
   * values under MIN_DESKTOP_CALL_TIMEOUT_MS are ignored because they would cut real work.
   */
  desktopCallTimeoutMs: number;

  constructor() {
    super();

    const cleansedVars = removeClaudeMcpBundleUserConfigTemplates(process.env);
    const {
      INLINE_XML_MAX_BYTES: inlineXmlMaxBytes,
      INLINE_IMAGE_MAX_BYTES: inlineImageMaxBytes,
      IMAGE_EXPORT_TIMEOUT_MS: imageExportTimeoutMs,
      TABLEAU_EXTERNAL_API_DISCOVERY_DIR: externalApiDiscoveryDir,
      TABLEAU_DESKTOP_SESSION_ID: desktopSessionId,
      TABLEAU_DESKTOP_CALL_TIMEOUT_MS: desktopCallTimeoutMs,
    } = cleansedVars;

    if (this.transport !== 'stdio') {
      throw new Error('TRANSPORT must be "stdio" for Tableau Desktop authoring');
    }

    this.externalApiDiscoveryDir = externalApiDiscoveryDir || undefined;
    this.desktopSessionId =
      desktopSessionId && parseSessionPid(desktopSessionId) !== undefined
        ? desktopSessionId
        : undefined;

    this.inlineXmlMaxBytes = parseNumber(inlineXmlMaxBytes, {
      defaultValue: DEFAULT_INLINE_XML_MAX_BYTES,
      minValue: 1,
    });

    this.inlineImageMaxBytes = parseNumber(inlineImageMaxBytes, {
      defaultValue: DEFAULT_INLINE_IMAGE_MAX_BYTES,
      minValue: 1,
    });

    this.imageExportTimeoutMs = parseNumber(imageExportTimeoutMs, {
      defaultValue: DEFAULT_IMAGE_EXPORT_TIMEOUT_MS,
      minValue: 1,
    });

    this.desktopCallTimeoutMs = parseNumber(desktopCallTimeoutMs, {
      defaultValue: DEFAULT_DESKTOP_CALL_TIMEOUT_MS,
      minValue: MIN_DESKTOP_CALL_TIMEOUT_MS,
    });
  }
}

export const getDesktopConfig = (): Config => new Config();
