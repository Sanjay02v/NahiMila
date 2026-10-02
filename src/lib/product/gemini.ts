// Retry a transient capacity error once, using the same model and overall timeout.
// This performs no product writes and never logs request bodies or credentials.
export async function geminiFetch(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (response.status !== 503 || init.signal?.aborted) return response;
  await response.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (init.signal?.aborted) throw new Error("AI_UNAVAILABLE");
  return fetch(url, init);
}
