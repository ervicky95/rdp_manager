import { AsyncLocalStorage } from 'node:async_hooks';

type RuntimeEnv = Record<string, unknown>;

const storage = new AsyncLocalStorage<RuntimeEnv>();

export function withRequestEnv<T>(
  env: RuntimeEnv,
  callback: () => T
): T {
  return storage.run(env, callback);
}

export function getRequestEnv(): RuntimeEnv {
  const env = storage.getStore();

  if (!env) {
    throw new Error('Request environment is not available');
  }

  return env;
}
