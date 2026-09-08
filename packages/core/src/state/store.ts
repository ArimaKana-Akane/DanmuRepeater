// typed store + 事件总线 —— 替代 legacy 全局 state（L0 spec）
// 原则：state 变更即广播（prev→next），副作用订阅者按需监听，不再"每秒全量轮询刷状态"。

/** 轻量不可变 patch 型 store */
export class TypedStore<S extends object> {
  private value: S;
  private listeners = new Set<(prev: S, next: S) => void>();

  constructor(init: S) {
    this.value = init;
  }

  get(): Readonly<S> {
    return this.value;
  }

  /** patch 或 (cur)=>patch；返回是否发生变更 */
  set(patch: Partial<S> | ((cur: Readonly<S>) => Partial<S>)): boolean {
    const p = typeof patch === 'function' ? patch(this.value) : patch;
    let changed = false;
    for (const k of Object.keys(p) as (keyof S)[]) {
      if (this.value[k] !== p[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    const prev = this.value;
    const next = { ...prev, ...p } as S;
    this.value = next;
    for (const fn of [...this.listeners]) fn(prev, next);
    return true;
  }

  /** 订阅变更；返回退订函数 */
  subscribe(fn: (prev: Readonly<S>, next: Readonly<S>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 取当前值后订阅（合并 get+subscribe，避免遗漏窗口期变更） */
  getAndSubscribe(fn: (cur: Readonly<S>) => void): () => void {
    fn(this.value);
    return this.subscribe((_prev, next) => fn(next));
  }
}

/** 通用事件总线（采集消息 / 发送事件 / 引擎信号） */
export type BusEventMap = Record<string, unknown>;
export type BusHandler<E> = (payload: E) => void;

export class EventBus<M extends BusEventMap> {
  private handlers = new Map<keyof M, Set<(payload: unknown) => void>>();

  on<K extends keyof M>(type: K, fn: BusHandler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (payload: unknown) => void);
    return () => set!.delete(fn as (payload: unknown) => void);
  }

  once<K extends keyof M>(type: K, fn: BusHandler<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p as M[K]);
    });
    return off;
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  listenerCount(type: keyof M): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}
