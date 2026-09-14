// Convex asks for a fresh sign-in token every few minutes, and gives up on the session after a single failed request.
// A dropped connection or a busy server would then sign the person out, so failures that can pass are retried first.
// A refusal (401 or 403) means the session really ended and is returned at once.

type TokenResult = { data?: { token?: string | null } | null; error?: { status?: number } | null };
type TokenFetcher<Options> = (options?: Options) => Promise<TokenResult>;

export const TOKEN_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export function isRetryable(result: TokenResult): boolean {
  if (result.data?.token) return false;
  const status = result.error?.status;
  if (status === undefined) return !!result.error;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function withTokenRetries<Options>(
  fetchToken: TokenFetcher<Options>,
  delays: readonly number[] = TOKEN_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = wait,
): TokenFetcher<Options> {
  return async (options) => {
    let result: TokenResult;
    try {
      result = await fetchToken(options);
    } catch {
      result = { error: {} };
    }
    for (const delay of delays) {
      if (!isRetryable(result)) return result;
      await sleep(delay);
      try {
        result = await fetchToken(options);
      } catch {
        result = { error: {} };
      }
    }
    return result;
  };
}
