// 配置仓库：读取/保存/迁移 —— legacy loadConfig/saveConfigValue/saveTheme 语义迁移
// 键名沿用 legacy（storageKey: <platform>_config_v5 等）→ 旧油猴存储无缝迁移。
import { DEFAULT_CONFIG, DEFAULT_THEME, storageKey, type BotConfig, type FilterRule, type ThemeConfig } from './constants.js';
import type { KVStorage } from './storage.js';

export interface LoadedConfig {
  config: BotConfig;
  blocklist: string[];
  priorityWords: string[];
  filterRules: FilterRule[];
  version: number;
}

function clone<T>(v: T): T {
  return typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
}

/** legacy 合并语义：{ ...DEFAULT_CONFIG, ...saved }，theme 独立键深补 */
export function loadConfig(platform: string, kv: KVStorage): LoadedConfig {
  try {
    const saved = kv.get<Partial<BotConfig>>(storageKey(platform, 'config'), {});
    const config: BotConfig = { ...DEFAULT_CONFIG, ...clone(saved) } as BotConfig;
    // theme 独立键优先；无独立键（异常/旧格式）时回退 saved.theme 深拷，绝不共享常量引用
    const theme = kv.get<ThemeConfig | null>(storageKey(platform, 'theme'), null);
    config.theme = theme
      ? { ...DEFAULT_THEME, ...theme }
      : { ...DEFAULT_THEME, ...(config.theme || {}) };
    const version = kv.get<number>(storageKey(platform, 'configVersion'), 0);
    const blocklist = safeGet<string[]>(kv, storageKey(platform, 'blocklist'), []);
    const priorityWords = safeGet<string[]>(kv, storageKey(platform, 'priority'), []);
    const filterRules = safeGet<FilterRule[]>(kv, storageKey(platform, 'filterRules'), []);
    config.filterRules = filterRules;
    return { config, blocklist, priorityWords, filterRules, version };
  } catch (_) {
    return {
      config: { ...DEFAULT_CONFIG, theme: { ...DEFAULT_THEME } },
      blocklist: [],
      priorityWords: [],
      filterRules: [],
      version: 0,
    };
  }
}

/** 保存配置（config 全量 + filterRules 独立键），并 bump 版本号 */
export function saveConfig(platform: string, kv: KVStorage, config: BotConfig): void {
  const { theme, filterRules, ...rest } = config;
  kv.set(storageKey(platform, 'config'), rest);
  kv.set(storageKey(platform, 'filterRules'), filterRules);
  kv.set(storageKey(platform, 'theme'), theme);
  bumpVersion(platform, kv);
}

export function saveTheme(platform: string, kv: KVStorage, themePartial: Partial<ThemeConfig>): void {
  const cur = loadConfig(platform, kv);
  const nextTheme = { ...cur.config.theme, ...themePartial };
  kv.set(storageKey(platform, 'theme'), nextTheme);
  bumpVersion(platform, kv);
}

export function saveLists(platform: string, kv: KVStorage, blocklist: string[], priorityWords: string[]): void {
  kv.set(storageKey(platform, 'blocklist'), blocklist);
  kv.set(storageKey(platform, 'priority'), priorityWords);
}

export function bumpVersion(platform: string, kv: KVStorage): void {
  const cur = kv.get<number>(storageKey(platform, 'configVersion'), 0);
  kv.set(storageKey(platform, 'configVersion'), (cur || 0) + 1);
}

function safeGet<T>(kv: KVStorage, key: string, fallback: T): T {
  try {
    return kv.get(key, fallback);
  } catch (_) {
    return fallback;
  }
}
