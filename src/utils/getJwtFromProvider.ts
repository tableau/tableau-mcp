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

  const { jwt } = await response.json();
  return jwt;
}
