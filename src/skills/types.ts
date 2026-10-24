import { z } from 'zod';

/**
 * The flat key/value frontmatter block parsed from a skill's `SKILL.md`. `name` and
 * `description` are required; `.passthrough()` keeps any additional keys.
 */
export const SkillFrontmatterSchema = z
  .object({
    name: z.string(),
    description: z.string(),
  })
  .passthrough();

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

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

export type SkillResource = z.infer<typeof SkillResourceSchema>;

/**
 * A skill manifest entry returned by `skills/list` and `skills/get`. `uri` is `skill://<name>/SKILL.md`; `frontmatter` is the flat
 * key/value block parsed from the manifest; `resources` lists every file in the skill directory.
 */
export const SkillEntrySchema = z.object({
  uri: z.string(), // skill://<name>/SKILL.md
  frontmatter: SkillFrontmatterSchema,
  resources: z.array(SkillResourceSchema),
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;

/**
 * `skills/list` request. The `method` literal is what the SDK routes on.
 */
// TODO W-24225975: support `params.cursor` once pagination is implemented.
export const SkillsListRequestSchema = z.object({
  method: z.literal('skills/list'),
  params: z.object({}).passthrough().optional(),
});

export const SkillsListResultSchema = z.object({
  resultType: z.literal('complete'),
  skills: z.array(SkillEntrySchema),
});

export type SkillsListResult = z.infer<typeof SkillsListResultSchema>;

/** `skills/get` looks up a skill by its catalog SKILL.md URI. */
export const SkillsGetRequestSchema = z.object({
  method: z.literal('skills/get'),
  params: z.object({ uri: z.string() }).passthrough(),
});

// Defer params validation to the handler so invalid params return -32602 instead of -32603.
export const SkillsGetHandlerRequestSchema = SkillsGetRequestSchema.omit({
  params: true,
}).passthrough();

export const SkillsGetResultSchema = z.object({
  resultType: z.literal('complete'),
  skill: SkillEntrySchema,
});

export type SkillsGetResult = z.infer<typeof SkillsGetResultSchema>;
