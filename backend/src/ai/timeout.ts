import { TranscriptionError, type ProviderName } from './provider.js';

export async function withAiTimeout<T>(
  provider: ProviderName,
  stage: string,
  timeoutMs: number,
  operation: Promise<T>,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TranscriptionError(provider, `${stage} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
