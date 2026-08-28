export async function readApiJson<T = Record<string, unknown>>(
  response: Response
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      response.ok
        ? "The server returned an empty response."
        : `Server error (${response.status}). Please try again.`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `The server returned a non-JSON response (${response.status}).`
    );
  }
}
