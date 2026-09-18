export class HttpError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export async function withRetry(fn, { retries = 3, baseDelayMs = 250, shouldRetry = (error) => Boolean(error?.retryable) } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const jitter = Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * (2 ** attempt) + jitter));
    }
  }
  throw lastError;
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) { error.retryable = true; throw error; }
  finally { clearTimeout(timer); }
}
