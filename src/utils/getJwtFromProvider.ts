import { z } from 'zod';

const jwtResponseSchema = z.object({
  jwt: z.string(),
});

export async function getJwtFromProvider(
  jwtProviderUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(jwtProviderUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  const result = jwtResponseSchema.safeParse(json);

  if (!result.success) {
    throw new Error('Invalid JWT response, expected: { "jwt": "..." }');
  }

  return result.data.jwt;
}
