import { exportedForTesting as configExportedForTesting } from '../config.js';
import {
  exportedForTesting as toolDescriptionsExportedForTesting,
  formatToolDescription,
} from './toolDescriptions.js';
import { toolNames } from './toolName.js';

const { resetConfig } = configExportedForTesting;
const { getCustomToolDescriptions } = toolDescriptionsExportedForTesting;

describe('toolDescriptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetConfig();
    process.env = {
      ...originalEnv,
      CUSTOM_TOOL_DESCRIPTIONS: undefined,
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('formatToolDescription', () => {
    it('should return initial description when no custom description exists', () => {
      const initialDescription = 'Initial description';
      const result = formatToolDescription('list-datasources', initialDescription);
      expect(result).toBe(initialDescription);
    });

    it('should append custom description when mode is append', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = 'list-datasources::append::Custom append text';

      const initialDescription = 'Initial description';
      const result = formatToolDescription('list-datasources', initialDescription);
      expect(result).toBe('Initial description\nCustom append text');
    });

    it('should replace description when mode is replace', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = 'list-datasources::replace::Custom replace text';

      const initialDescription = 'Initial description';
      const result = formatToolDescription('list-datasources', initialDescription);
      expect(result).toBe('Custom replace text');
    });

    it('should parse multiple custom descriptions correctly', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS =
        'list-datasources::append::Custom append text||list-fields::replace::Other text';

      const initialDescription = 'Initial description';
      const result1 = formatToolDescription('list-datasources', initialDescription);
      expect(result1).toBe('Initial description\nCustom append text');

      const result2 = formatToolDescription('list-fields', initialDescription);
      expect(result2).toBe('Other text');
    });
  });

  describe('getCustomToolDescriptions', () => {
    it('should return empty object when no custom descriptions are provided', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = '';
      expect(getCustomToolDescriptions()).toEqual({});
    });

    it('should throw error for invalid tool name', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = 'invalid_tool::append::Custom text';

      expect(() => getCustomToolDescriptions()).toThrow(
        `Invalid tool name: invalid_tool. Must be one of: ${toolNames.join(', ')}`,
      );
    });

    it('should throw error for invalid mode', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = 'list-datasources::invalid_mode::Custom text';

      expect(() => getCustomToolDescriptions()).toThrow(
        'Invalid mode: invalid_mode. Must be one of: append, replace',
      );
    });

    it('should throw error for missing description', () => {
      process.env.CUSTOM_TOOL_DESCRIPTIONS = 'list-datasources::append::';

      expect(() => getCustomToolDescriptions()).toThrow(
        'Description is required for tool: list-datasources',
      );
    });
  });
});
