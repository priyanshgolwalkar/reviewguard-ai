import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.1-flash-lite';

export interface GenAiClientLike {
  models: {
    generateContent: (params: GenerateContentParameters) => Promise<GenerateContentResponse>;
  };
}

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GenAiClientLike {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigurationError(
      'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

export class GeminiConfigurationError extends Error {
  statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'GeminiConfigurationError';
  }
}

export class GeminiUpstreamError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'GeminiUpstreamError';
    this.statusCode = statusCode;
  }
}

function extractStatusCode(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number') {
    return (err as { status: number }).status;
  }
  if (err instanceof Error) {
    if (err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) return 403;
    if (err.message.includes('400') || err.message.includes('API_KEY_INVALID')) return 400;
    if (err.message.includes('404') || err.message.includes('NOT_FOUND')) return 404;
    if (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED')) return 429;
  }
  return 502;
}

function parseDurationStringMs(raw: string): number | null {
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2].toLowerCase() === 'ms' ? Math.ceil(amount) : Math.ceil(amount * 1000);
}

export function parseRetryDelayMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;

  const MIN_DELAY_MS = 1000;
  const MAX_DELAY_MS = 65000;
  const clamp = (ms: number) => Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, Math.ceil(ms) + 250));

  const errObj = err as Record<string, unknown>;

  // 1. Check structured RetryInfo details (e.g. details[].retryDelay)
  const details = Array.isArray(errObj.details)
    ? errObj.details
    : errObj.error && typeof errObj.error === 'object' && Array.isArray((errObj.error as Record<string, unknown>).details)
      ? ((errObj.error as Record<string, unknown>).details as unknown[])
      : [];

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    const d = detail as Record<string, unknown>;
    if (typeof d.retryDelay === 'string') {
      const parsed = parseDurationStringMs(d.retryDelay);
      if (parsed !== null) return clamp(parsed);
    } else if (d.retryDelay && typeof d.retryDelay === 'object') {
      const rd = d.retryDelay as Record<string, unknown>;
      const secs = typeof rd.seconds === 'number' ? rd.seconds : 0;
      const nanos = typeof rd.nanos === 'number' ? rd.nanos : 0;
      const totalMs = secs * 1000 + nanos / 1_000_000;
      if (totalMs > 0) return clamp(totalMs);
    }
  }

  // 2. Check Retry-After header if attached
  const headers = (errObj.headers ?? (errObj.response as Record<string, unknown> | undefined)?.headers) as
    | { get?: (name: string) => string | null }
    | Record<string, unknown>
    | undefined;
  if (headers) {
    const rawHeader =
      typeof (headers as { get?: (name: string) => string | null }).get === 'function'
        ? (headers as { get: (name: string) => string | null }).get('retry-after')
        : ((headers as Record<string, unknown>)['retry-after'] ??
            (headers as Record<string, unknown>)['Retry-After']);
    if (typeof rawHeader === 'string') {
      const secs = Number(rawHeader.trim());
      if (Number.isFinite(secs) && secs > 0) {
        return clamp(secs * 1000);
      }
    }
  }

  // 3. Check embedded JSON or text in Error.message (common in @google/genai errors)
  const message = err instanceof Error ? err.message : '';
  if (message) {
    const jsonDelayMatch = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?(?:ms|s))"/i);
    if (jsonDelayMatch) {
      const parsed = parseDurationStringMs(jsonDelayMatch[1]);
      if (parsed !== null) return clamp(parsed);
    }
    const textDelayMatch = message.match(/retry(?:\s+again)?\s+in\s+(\d+(?:\.\d+)?)\s*(ms|seconds?|s)\b/i);
    if (textDelayMatch) {
      const unit = textDelayMatch[2].toLowerCase().startsWith('ms') ? 'ms' : 's';
      const parsed = parseDurationStringMs(`${textDelayMatch[1]}${unit}`);
      if (parsed !== null) return clamp(parsed);
    }
  }

  return null;
}

function isRetryableError(err: unknown): boolean {
  const status = extractStatusCode(err);
  if (status === 429) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('econnreset')
  );
}

const DEFAULT_MIN_LIVE_INTERVAL_MS = 0;
const clientQueues = new WeakMap<GenAiClientLike, Promise<void>>();
const clientLastFinishedAt = new WeakMap<GenAiClientLike, number>();

function runSequentially<T>(
  client: GenAiClientLike,
  minIntervalMs: number,
  sleepFn: (ms: number) => Promise<void>,
  task: () => Promise<T>
): Promise<T> {
  const prev = clientQueues.get(client) ?? Promise.resolve();
  const nextRun = prev
    .catch(() => undefined)
    .then(async () => {
      if (minIntervalMs > 0) {
        const lastAt = clientLastFinishedAt.get(client) ?? 0;
        const elapsed = Date.now() - lastAt;
        if (lastAt > 0 && elapsed < minIntervalMs) {
          await sleepFn(minIntervalMs - elapsed);
        }
      }
      try {
        return await task();
      } finally {
        clientLastFinishedAt.set(client, Date.now());
      }
    });

  clientQueues.set(
    client,
    nextRun.then(
      () => undefined,
      () => undefined
    )
  );
  return nextRun;
}

export interface RetryOptions {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
}

export async function generateWithRetry(
  client: GenAiClientLike,
  params: GenerateContentParameters,
  maxRetriesOrOptions: number | RetryOptions = 2
): Promise<GenerateContentResponse> {
  const opts: RetryOptions =
    typeof maxRetriesOrOptions === 'number'
      ? { maxRetries: maxRetriesOrOptions }
      : maxRetriesOrOptions;
  const maxRetries = opts.maxRetries ?? 2;
  const sleepFn = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const minIntervalMs =
    opts.minIntervalMs ?? (cachedClient && client === cachedClient ? DEFAULT_MIN_LIVE_INTERVAL_MS : 0);

  return runSequentially(client, minIntervalMs, sleepFn, async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await client.models.generateContent(params);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && isRetryableError(err)) {
          const isRateLimit = extractStatusCode(err) === 429;
          const serverDelayMs = isRateLimit ? parseRetryDelayMs(err) : null;
          const delayMs =
            serverDelayMs ?? (isRateLimit ? 4000 * Math.pow(2, attempt) : 350 * Math.pow(2, attempt));
          await sleepFn(delayMs);
          continue;
        }
        break;
      }
    }

    const statusCode = extractStatusCode(lastError);
    const rawMessage = lastError instanceof Error ? lastError.message : String(lastError);

    if (statusCode === 403 || statusCode === 400) {
      throw new GeminiUpstreamError(
        'Gemini API credentials appear invalid or unauthorized. Please check Settings > Secrets.',
        statusCode
      );
    }
    if (statusCode === 429) {
      throw new GeminiUpstreamError(
        'Gemini API rate limit reached. Please wait a moment and try again.',
        429
      );
    }
    throw new GeminiUpstreamError(`Gemini API request failed: ${rawMessage}`, statusCode);
  });
}
