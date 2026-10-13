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
export type SkillResource = {
  uri: string;
  digest: string;
  size: number;
};

/**
 * A skill manifest entry returned by `skills/list` and `skills/get`
 * (TODO: W-24166658). `uri` is `skill://<name>/SKILL.md`; `frontmatter` is the flat
 * key/value block parsed from the manifest; `resources` lists every file in the skill directory.
 */
export type SkillEntry = {
  uri: string; // skill://<name>/SKILL.md
  frontmatter: SkillFrontmatter;
  resources: SkillResource[];
};

/**
 * `skills/list` request. The `method` literal is what the SDK routes on.
 */
// TODO W-24225975: support `params.cursor` once pagination is implemented.
export const SkillsListRequestSchema = z.object({
  method: z.literal('skills/list'),
  params: z.object({}).passthrough().optional(),
});

export type SkillsListResult = {
  resultType: 'complete';
  skills: SkillEntry[];
};
