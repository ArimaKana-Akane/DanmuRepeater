// store / 存储 / 配置 单测
import { describe, expect, it, vi } from 'vitest';
import { EventBus, TypedStore } from '../src/state/store.js';
import { createCachedKV, createMemoryKV } from '../src/storage.js';
import { loadConfig, saveConfig, saveTheme } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/constants.js';

describe('TypedStore', () => {
  it('patch 变更广播 prev/next；未变更不广播', () => {
    const store = new TypedStore({ a: 1, b: 'x' });
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ a: 2 })).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    const [prev, next] = fn.mock.calls[0] as [typeof prev, typeof next];
    expect((prev as { a: number }).a).toBe(1);
    expect((next as { a: number }).a).toBe(2);
    expect(store.set({ a: 2 })).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('函数式 patch 与退订', () => {
    const store = new TypedStore({ n: 0 });
    const off = store.subscribe(() => {});
    store.set((cur) => ({ n: (cur as { n: number }).n + 1 }));
    expect((store.get() as { n: number }).n).toBe(1);
    off();
    expect(store.set({ n: 2 })).toBe(true);
  });
});

describe('EventBus', () => {
  it('on/emit/once/off', () => {
    const bus = new EventBus<{ msg: string; n: number }>();
    const seen: string[] = [];
    const off = bus.on('msg', (m) => seen.push(m));
    bus.emit('msg', 'a');
    bus.once('msg', (m) => seen.push('once:' + m));
    bus.emit('msg', 'b');
    off();
    bus.emit('msg', 'c');
    expect(seen).toEqual(['a', 'b', 'once:b']);
  });
});

describe('createCachedKV（写穿缓存）', () => {
  it('get 首次 miss 读后端一次，之后不再打后端；set 写穿', () => {
    const backend = createMemoryKV({ k: 'v0' });
    const spy = vi.spyOn(backend, 'get');
    const cached = createCachedKV(backend);
    expect(cached.get('k', 'fb')).toBe('v0');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cached.get('k', 'fb')).toBe('v0');
    expect(spy).toHaveBeenCalledTimes(1); // 命中缓存不再读后端
    cached.set('k', 'v1');
    expect(backend.dump().k).toBe('v1');
    expect(cached.get('k', 'fb')).toBe('v1');
  });
  it('onChange 使缓存失效并回调', () => {
    const backend = createMemoryKV({ k: 'old' });
    const cached = createCachedKV(backend);
    expect(cached.get('k', '')).toBe('old');
    const seen: unknown[] = [];
    cached.onChange?.('k', (v) => seen.push(v));
    backend.set('k', 'new'); // 模拟另一标签页 GM_addValueChangeListener 触发
    expect(seen).toEqual(['new']);
    expect(cached.get('k', '')).toBe('new'); // 缓存已失效 → 重新读后端
  });
});

describe('config（legacy 键/合并语义）', () => {
  it('空存储 → 返回 DEFAULT（含深拷 theme）', () => {
    const kv = createMemoryKV({});
    const loaded = loadConfig('bilibili', kv);
    expect(loaded.config.minMsgLength).toBe(DEFAULT_CONFIG.minMsgLength);
    // theme 深拷：改动不回写常量
    loaded.config.theme.opacity = 0.3;
    expect(DEFAULT_CONFIG.theme.opacity).toBe(0.95);
  });
  it('旧键无缝迁移：只存部分字段 → 缺失补默认', () => {
    const kv = createMemoryKV({});
    kv.set('bilibili_config_v5', { crazyInterval: 9 });
    const loaded = loadConfig('bilibili', kv);
    expect(loaded.config.crazyInterval).toBe(9);
    expect(loaded.config.zenInterval).toBe(DEFAULT_CONFIG.zenInterval);
    expect(loaded.version).toBe(0);
  });
  it('saveConfig/saveTheme bump version 且 load 可读回', () => {
    const kv = createMemoryKV({});
    const cfg = loadConfig('douyu', kv).config;
    cfg.crazyInterval = 7;
    saveConfig('douyu', kv, cfg);
    const after = loadConfig('douyu', kv);
    expect(after.config.crazyInterval).toBe(7);
    expect(after.version).toBe(1);
    saveTheme('douyu', kv, { opacity: 0.5 });
    const after2 = loadConfig('douyu', kv);
    expect(after2.config.theme.opacity).toBe(0.5);
    expect(after2.version).toBe(2);
  });
});
