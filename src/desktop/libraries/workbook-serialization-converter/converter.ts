/**
 * Main converter API for converting between JSON and XML formats.
 */

import { JSONFormatter } from './jsonFormatter.js';
import { JSONParser } from './jsonParser.js';
import { XMLFormatter } from './xmlFormatter.js';
import { XMLParser } from './xmlParser.js';

/**
 * Convert JSON format to XML format.
 *
 * @param jsonString JSON string in Tableau workbook format
 * @returns XML string representation
 * @throws Error if JSON is invalid or malformed
 */
export function jsonToXml(jsonString: string): string {
  // Parse JSON to DOM
  const parser = new JSONParser(jsonString);
  const dom = parser.parse();

  // Format DOM to XML
  const formatter = new XMLFormatter();
  return formatter.formatDOM(dom);
}

/**
 * Convert XML format to JSON format.
 *
 * @param xmlString XML string representation
 * @returns JSON string in Tableau workbook format
 * @throws Error if XML is invalid or malformed
 */
export function xmlToJson(xmlString: string): string {
  // Parse XML to DOM
  const parser = new XMLParser(xmlString);
  const dom = parser.parse();

  // Format DOM to JSON
  const formatter = new JSONFormatter();
  return formatter.formatDOM(dom);
}

/**
 * Convert TDS (Tableau Data Source) JSON format to XML format.
 *
 * TDS files contain a standalone datasource element, which is a subset
 * of a workbook. This function handles the datasource root element.
 *
 * @param jsonString JSON string in Tableau datasource format
 * @returns XML string representation of the datasource
 * @throws Error if JSON is invalid or malformed
 */
export function tdsJsonToXml(jsonString: string): string {
  // Parse JSON to DOM
  const parser = new JSONParser(jsonString);
  const dom = parser.parse(); // Format DOM to XML
  const formatter = new XMLFormatter();
  return formatter.formatDOM(dom);
} /**
 * Convert TDS (Tableau Data Source) XML format to JSON format.
 *
 * TDS files contain a standalone datasource element, which is a subset
 * of a workbook. This function handles the datasource root element.
 *
 * @param xmlString XML string representation of the datasource
 * @returns JSON string in Tableau datasource format
 * @throws Error if XML is invalid or malformed
 */
export function tdsXmlToJson(xmlString: string): string {
  // Parse XML to DOM
  const parser = new XMLParser(xmlString);
  const dom = parser.parse(); // Format DOM to JSON
  const formatter = new JSONFormatter();
  return formatter.formatDOM(dom);
}
