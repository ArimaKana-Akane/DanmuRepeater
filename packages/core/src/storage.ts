// 存储层：KV 抽象 + 写穿缓存 + 跨标签变更订阅（L0 spec）
// 债还清：legacy 每秒 GM_getValue 轮询 checkConfigUpdate → 改为 value-change 监听驱动。

/** 后端 KV 抽象：由宿主注入 GM_getValue/GM_setValue/GM_addValueChangeListener */
export interface KVStorage {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /** 跨上下文变更监听（host 用 GM_addValueChangeListener 实现）；无则返回 noop */
  onChange?(key: string, cb: (newValue: unknown) => void): () => void;
}

/** 测试用内存后端 */
export function createMemoryKV(seed: Record<string, unknown> = {}): KVStorage & { dump(): Record<string, unknown> } {
  const map = new Map(Object.entries(seed));
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    get<T>(key: string, fallback: T): T {
      return map.has(key) ? (map.get(key) as T) : fallback;
    },
    set(key, value) {
      map.set(key, value);
      listeners.get(key)?.forEach((fn) => fn(value));
    },
    remove(key) {
      map.delete(key);
      listeners.get(key)?.forEach((fn) => fn(undefined));
    },
    onChange(key, cb) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
    dump() {
      return Object.fromEntries(map);
    },
  };
}

/**
 * 写穿缓存：get 只查缓存（内存读，不再每秒打后端）；
 * set 更新缓存并同步写穿后端。跨标签变更由 onChange 驱动缓存失效。
 */
export function createCachedKV(backend: KVStorage): KVStorage {
  const cache = new Map<string, unknown>();
  const loaded = new Set<string>();
  return {
    get<T>(key: string, fallback: T): T {
      if (!loaded.has(key)) {
        loaded.add(key);
        cache.set(key, backend.get(key, fallback));
      }
      return cache.has(key) ? (cache.get(key) as T) : fallback;
    },
    set(key, value) {
      cache.set(key, value);
      loaded.add(key);
      backend.set(key, value);
    },
    remove(key) {
      cache.delete(key);
      loaded.delete(key);
      backend.remove(key);
    },
    onChange(key, cb) {
      if (!backend.onChange) return () => {};
      return backend.onChange(key, (v) => {
        cache.delete(key);
        loaded.delete(key);
        cb(v);
      });
    },
  };
}
