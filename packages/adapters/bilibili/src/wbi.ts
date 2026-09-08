// B站 wbi 签名与 danmuInfo 获取 —— 真机验证链路（docs/B站协议采集-全量测试.md）
// 注意：wbi keys 约每日轮换；失败(code -352)应重取 keys 后重试一次。

export const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
  37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52,
] as const;

export interface WbiKeys {
  imgKey: string;
  subKey: string;
}

export function mixinKey(orig: string): string {
  let out = '';
  for (const i of MIXIN_KEY_ENC_TAB) out += orig[i];
  return out.slice(0, 32);
}

export function md5Hex(input: string): string {
  // MD5 需同步实现：浏览器 SubtleCrypto 不支持 MD5 → 宿主注入 globalThis.__lgjMd5
  const g = globalThis as { __lgjMd5?: (s: string) => string };
  if (!g.__lgjMd5) throw new Error('md5 不可用：请在宿主注入 globalThis.__lgjMd5');
  return g.__lgjMd5(input);
}

/** 对业务参数做 wbi 签名，返回完整 query（含 wts/w_rid） */
export function wbiSignQuery(params: Record<string, string | number>, keys: WbiKeys): string {
  const mixin = mixinKey(keys.imgKey + keys.subKey);
  const ts = Math.floor(Date.now() / 1000);
  const all: Record<string, string | number> = { ...params, wts: ts };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(all[k]!)}`)
    .join('&');
  return query + '&w_rid=' + md5Hex(query + mixin);
}

export interface HttpLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; credentials?: string }): Promise<{
    json(): Promise<unknown>;
  }>;
}

/** 从 nav 取 wbi keys（匿名也返回；code -101 = 未登录不影响 keys） */
export async function fetchWbiKeys(fetchImpl: HttpLike): Promise<WbiKeys> {
  const r = await fetchImpl('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
  const j = (await r.json()) as {
    data?: { wbi_img?: { img_url?: string; sub_url?: string } };
  };
  const img = j.data?.wbi_img?.img_url;
  const sub = j.data?.wbi_img?.sub_url;
  if (!img || !sub) throw new Error('nav 未返回 wbi_img');
  const keyOf = (url: string) => url.split('/').pop()!.split('.')[0]!;
  return { imgKey: keyOf(img), subKey: keyOf(sub) };
}

export interface DanmuServer {
  token: string;
  host: string; // 取 host_list[0].host（wss_port 2245）
  wssPort: number;
}

/** getDanmuInfo（带 wbi）；id 须为真实房间号 */
export async function fetchDanmuServer(roomId: number, fetchImpl: HttpLike, keys?: WbiKeys): Promise<DanmuServer> {
  const k = keys ?? (await fetchWbiKeys(fetchImpl));
  const query = wbiSignQuery({ id: roomId, type: 0 }, k);
  const r = await fetchImpl(
    `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${query}`,
    { credentials: 'include' },
  );
  const j = (await r.json()) as {
    code: number;
    data?: { token?: string; host_list?: { host?: string; wss_port?: number }[] };
  };
  if (j.code !== 0 || !j.data?.token) {
    if (j.code === -352) {
      // keys 过期 → 重取一次
      const k2 = await fetchWbiKeys(fetchImpl);
      return fetchDanmuServer(roomId, fetchImpl, k2);
    }
    throw new Error(`getDanmuInfo code=${j.code}`);
  }
  const host = j.data.host_list?.[0];
  if (!host?.host) throw new Error('getDanmuInfo 无 host');
  return { token: j.data.token, host: host.host, wssPort: host.wss_port || 2245 };
}
