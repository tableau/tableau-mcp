import { z } from 'zod';

/**
 * A single file that belongs to a skill, as advertised in a skill's manifest entry.
 * `digest` is a lowercase hex SHA-256 prefixed with `sha256:`; `size` is the raw byte
 * length of the file.
 */
export const SkillResourceSchema = z.object({
  uri: z.string(),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});

/**
 * A skill manifest entry returned by `skills/list` and `skills/get`.
 * `uri` is `skill://<name>/SKILL.md`; `frontmatter` is the flat key/value block parsed
 * from the manifest; `resources` lists every file in the skill directory.
 */
export const SkillEntrySchema = z.object({
  uri: z.string(), // skill://<name>/SKILL.md
  frontmatter: z.record(z.unknown()),
  resources: z.array(SkillResourceSchema),
});

export type SkillResource = z.infer<typeof SkillResourceSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
