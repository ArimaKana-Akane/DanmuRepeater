// 平台无关常量 —— 与 legacy(1.1.20) TIMING/MODE/DEFAULT_CONFIG/DEFAULT_THEME 逐值一致
// 冻结基线：任何改动都必须是 1.2.0+ 的显式行为变更（走 ADR），不得静默偏离。

export const TIMING = {
  DANMU_CACHE_MAX: 500,
  UI_UPDATE_INTERVAL: 1000,
  CONTAINER_POLL_INTERVAL: 1000,
  CONTAINER_POLL_MAX: 45,
  DPM_WINDOW_MS: 60000,
  MAX_TIMESTAMPS: 500,
  MAX_TS_AGE_MS: 120000,
  TS_CLEANUP_INTERVAL: 5000,
  RETRY_MAX_ATTEMPTS: 3,
  MIN_SEND_INTERVAL_MS: 2000,
  RETRY_DELAY_MS: 3000,
  SELECTOR_REPROBE_INTERVAL: 300000,
  CANDIDATE_REFRESH_INTERVAL: 10000,
  MAX_CANDIDATES: 50,
  FREQ_WINDOW_MS: 120000, // 频次统计窗口（2 分钟）
} as const;

export const MODE = {
  OFF: '关闭',
  CRAZY: '疯狂',
  NORMAL: '正常',
  ZEN: '佛系',
} as const;
export type ModeKey = keyof typeof MODE;
export type ModeValue = (typeof MODE)[ModeKey];

export interface ThemeConfig {
  bgColor: string;
  textColor: string;
  accentColor: string;
  borderColor: string;
  opacity: number;
  fontSize: string;
  borderRadius: string;
}

export interface FilterRule {
  type: 'length' | 'contains' | 'not_contains' | 'regex';
  op?: '>' | '<' | '>=' | '<=' | '==';
  value: string | number;
  flags?: string;
}

export interface BotConfig {
  minMsgLength: number;
  lengthThreshold: number;
  lengthBonus: number;
  trendingThreshold: number;
  priorityEnabled: boolean;
  priorityWeight: number;
  crazyModeDPM: number;
  normalModeDPM: number;
  crazyInterval: number;
  normalIntervalMin: number;
  normalIntervalMax: number;
  zenInterval: number;
  dedupWindowSec: number;
  dedupHistorySize: number;
  filterRules: FilterRule[];
  theme: ThemeConfig;
}

export const DEFAULT_THEME: ThemeConfig = {
  bgColor: '#1a1a2e',
  textColor: '#e0e0e0',
  accentColor: '#ff9800',
  borderColor: 'rgba(255,255,255,0.06)',
  opacity: 0.95,
  fontSize: '12px',
  borderRadius: '10px',
};

export const DEFAULT_CONFIG: BotConfig = {
  minMsgLength: 4,
  lengthThreshold: 15,
  lengthBonus: 2.5,
  trendingThreshold: 5,
  priorityEnabled: true,
  priorityWeight: 3.0,
  crazyModeDPM: 180,
  normalModeDPM: 80,
  crazyInterval: 4,
  normalIntervalMin: 6,
  normalIntervalMax: 8,
  zenInterval: 10,
  dedupWindowSec: 120,
  dedupHistorySize: 25,
  filterRules: [],
  theme: { ...DEFAULT_THEME },
};

/** 存储键：legacy 以 `${PLATFORM}_config_v5` 形式存放；v2 保留键名以无缝迁移旧配置 */
export function storageKey(platform: string, kind: 'config' | 'blocklist' | 'priority' | 'panel' | 'filterRules' | 'theme' | 'configVersion'): string {
  const map = {
    config: 'config_v5',
    blocklist: 'blocklist_v5',
    priority: 'priority_v5',
    panel: 'panel_v5',
    filterRules: 'filter_rules_v5',
    theme: 'theme_v5',
    configVersion: 'config_version_v5',
  } as const;
  return `${platform}_${map[kind]}`;
}
