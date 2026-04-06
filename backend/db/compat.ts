const COMPAT_WRAPPED = Symbol.for('shamel.db.compat.wrapped');

const isObjectLike = (value: any) => value !== null && (typeof value === 'object' || typeof value === 'function');
const isPromiseLike = (value: any) =>
  isObjectLike(value) && typeof value.then === 'function' && typeof value.execute !== 'function';

const executeQuery = async (query: any) => {
  if (!query) return query;
  if (typeof query.execute === 'function') return query.execute();
  return await query;
};

const coerceRows = (value: any) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (value === undefined || value === null) return [];
  return [value];
};

const runAsGet = async (query: any) => {
  const limited = typeof query?.limit === 'function' ? query.limit(1) : query;
  const rows = coerceRows(await executeQuery(limited));
  return rows[0];
};

const runAsAll = async (query: any) => coerceRows(await executeQuery(query));
const runAsExecute = async (query: any) => await executeQuery(query);

const scheduleUnhandled = (promise: Promise<any>) => {
  promise.catch((error) => {
    setTimeout(() => {
      if (error?.name === 'AppError' || Number.isFinite(error?.statusCode)) {
        return;
      }
      throw error;
    }, 0);
  });
};

const createCompatTransaction = (dbLike: any, callback: (tx: any) => any) => {
  let started = false;
  let promise: Promise<any> | null = null;

  const execute = () => {
    if (!started) {
      started = true;
      promise = Promise.resolve(
        dbLike.transaction(async (tx: any) => await callback(wrapCompatDb(tx))),
      );
    }
    return promise!;
  };

  const callable: any = () => execute();
  callable.then = (...args: any[]) => execute().then(...args);
  callable.catch = (...args: any[]) => execute().catch(...args);
  callable.finally = (...args: any[]) => execute().finally(...args);
  callable[Symbol.toStringTag] = 'Promise';

  queueMicrotask(() => {
    if (!started) scheduleUnhandled(execute());
  });

  return callable;
};

export const wrapCompatDb = <T>(value: T): T => {
  if (!isObjectLike(value) || isPromiseLike(value)) return value;
  if ((value as any)[COMPAT_WRAPPED]) return value;

  const proxy = new Proxy(value as any, {
    get(target, prop, receiver) {
      if (prop === COMPAT_WRAPPED) return true;
      if (prop === 'get') return () => runAsGet(target);
      if (prop === 'all') return () => runAsAll(target);
      if (prop === 'run') return () => runAsExecute(target);

      const actual = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof actual === 'function') {
        return (callback: (tx: any) => any) => createCompatTransaction(target, callback);
      }

      if (typeof actual === 'function') {
        return (...args: any[]) => {
          const result = actual.apply(target, args);
          return wrapCompatDb(result);
        };
      }

      return wrapCompatDb(actual);
    },
  });

  return proxy as T;
};
