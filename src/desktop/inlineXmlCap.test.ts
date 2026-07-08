import * as loggerModule from '../logging/logger.js';
import {
  buildApplyOverCapNote,
  buildInlineCapFileMessage,
  DEFAULT_INLINE_XML_MAX_BYTES,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from './inlineXmlCap.js';

describe('inlineXmlCap', () => {
  it('defaults the cap to 16 KiB', () => {
    expect(DEFAULT_INLINE_XML_MAX_BYTES).toBe(16 * 1024);
  });

  describe('xmlByteLength', () => {
    it('counts ASCII bytes', () => {
      expect(xmlByteLength('abc')).toBe(3);
    });

    it('counts UTF-8 multibyte characters by byte, not code unit', () => {
      // '€' is 3 bytes in UTF-8 but length 1 as a JS string.
      expect(xmlByteLength('€')).toBe(3);
    });
  });

  describe('isOverInlineXmlCap', () => {
    it('is false when bytes equal the cap (boundary is inclusive/under)', () => {
      expect(isOverInlineXmlCap(16, 16)).toBe(false);
    });

    it('is true when bytes exceed the cap', () => {
      expect(isOverInlineXmlCap(17, 16)).toBe(true);
    });

    it('is false when bytes are under the cap', () => {
      expect(isOverInlineXmlCap(1, 16)).toBe(false);
    });
  });

  describe('buildInlineCapFileMessage', () => {
    const xml =
      '<workbook><worksheets><worksheet name="Sales"/></worksheets>' +
      '<datasources><datasource caption="Superstore" name="ds1"/></datasources></workbook>';

    it('states the size, the cap, and that file mode was forced regardless of requested mode', () => {
      const message = buildInlineCapFileMessage({
        kind: 'workbook',
        label: 'Workbook',
        bytes: 40000,
        capBytes: 16384,
        xml,
      });
      expect(message).toContain('40000');
      expect(message).toContain('16384');
      expect(message).toContain('file mode');
      expect(message).toContain('regardless');
    });

    it('embeds a structural summary (byte size + names)', () => {
      const message = buildInlineCapFileMessage({
        kind: 'workbook',
        label: 'Workbook',
        bytes: 40000,
        capBytes: 16384,
        xml,
      });
      expect(message).toContain('bytes:');
      expect(message).toContain('Sales');
      expect(message).toContain('Superstore');
    });

    it('tells the agent how to work with the file via the server cache tools', () => {
      const message = buildInlineCapFileMessage({
        kind: 'workbook',
        label: 'Workbook',
        bytes: 40000,
        capBytes: 16384,
        xml,
      });
      expect(message).toContain('read-cached-xml');
      expect(message).toContain('write-cached-xml');
      expect(message).toContain('mode=file');
    });
  });

  describe('buildApplyOverCapNote', () => {
    it('notes the size, cap, and the file-mode alternative without rejecting', () => {
      const note = buildApplyOverCapNote(40000, 16384);
      expect(note).toContain('40000');
      expect(note).toContain('16384');
      expect(note).toContain('mode=file');
    });
  });

  describe('logInlineXmlCapHit', () => {
    it('logs a greppable warning with structured cap-hit data for auditing', () => {
      const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});

      logInlineXmlCapHit({
        tool: 'get-workbook-xml',
        bytes: 40000,
        capBytes: 16384,
        file: '/cache/workbook-1.xml',
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          logger: 'tool',
          message: expect.stringContaining('Inline XML cap exceeded'),
          data: expect.objectContaining({
            capHit: true,
            tool: 'get-workbook-xml',
            bytes: 40000,
            capBytes: 16384,
            file: '/cache/workbook-1.xml',
          }),
        }),
      );
    });
  });
});
