/** Port of ghidra-prep file_inputs.source_row_number_name, backed by the
 * native GenerateSourceRowNumberUtils contract. Never replace a real column. */
export function sourceRowNumberName(
  fields: Array<{ name: string; isGenerated?: unknown }>,
): string {
  const base = 'Source Row Number';
  const saved = fields.find((field) => field.isGenerated === true && field.name.startsWith(base));
  if (saved) return saved.name;
  let count = 0;
  let suffix = 0;
  for (const field of fields) {
    if (field.name === base) count++;
    else if (/^Source Row Number-[+-]?\d+$/.test(field.name)) {
      const value = Number(field.name.slice(base.length + 1));
      if (Number.isInteger(value) && value >= -(2 ** 31) && value < 2 ** 31) {
        count++;
        suffix = Math.max(suffix, value);
      }
    }
  }
  if (count === 1 && suffix === 0) return `${base}-1`;
  return count && suffix > 0 ? `${base}-${suffix + 1}` : base;
}
