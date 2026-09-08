// B站 ProtocolSource —— 真机验证链路落地为 DanmuSource 实现
// 自连路（对照 docs/协议接收-四平台对照.md：B站=自连 comet:2245）
import type { DanmuMessage, DanmuSource, DanmuSourceContext } from '@lgj/core';
import { fetchDanmuServer, fetchWbiKeys, type HttpLike } from './wbi.js';
import {
  buildAuthPacket,
  buildHeartbeatPacket,
  commandToDanmu,
  parseFrameHead,
  splitInnerFrames,
  tryParseJson,
  type Inflate,
} from './packet.js';

interface BiliSourceOptions {
  /** 注入测试替身；缺省用页面/全局 fetch 与 WebSocket */
  fetchImpl?: HttpLike;
  wsFactory?: (url: string) => WebSocketLike;
  inflate?: Inflate;
  heartbeatMs?: number;
}

interface WebSocketLike {
  binaryType: string;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export class BiliProtocolSource implements DanmuSource {
  readonly kind = 'protocol' as const;
  static supports(platform: string): boolean {
    return platform === 'bilibili';
  }

  private ctx!: DanmuSourceContext;
  private opts: Required<Pick<BiliSourceOptions, 'heartbeatMs'>> & BiliSourceOptions;
  private ws: WebSocketLike | null = null;
  private hbTimer: ReturnType<typeof setInterval> | null = null;
  private epochAtStart = 0;
  private stopped = false;
  private decoder: TextDecoder = new TextDecoder();

  constructor(opts: BiliSourceOptions = {}) {
    this.opts = { heartbeatMs: 30000, ...opts };
  }

  async start(ctx: DanmuSourceContext): Promise<void> {
    this.ctx = ctx;
    this.epochAtStart = ctx.epoch;
    this.stopped = false;
    const fetchImpl = this.opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a)) as unknown as HttpLike;

    // 1) wbi keys + getDanmuInfo（真实房间号）
    const keys = await fetchWbiKeys(fetchImpl);
    const server = await fetchDanmuServer(Number(ctx.roomId), fetchImpl, keys);

    // 2) 建立 wss
    const url = `wss://${server.host}:${server.wssPort}/sub`;
    const ws = this.opts.wsFactory ? this.opts.wsFactory(url) : new WebSocket(url) as unknown as WebSocketLike;
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('bilibili-ws-open-timeout')), 8000);
      ws.onopen = () => {
        clearTimeout(to);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(to);
        reject(new Error('bilibili-ws-error'));
      };
    });
    if (this.stopped) {
      try { ws.close(); } catch (_) { /* 忽略 */ }
      return;
    }

    // 3) 认证 + 心跳 + 收流
    ws.onerror = null;
    ws.onclose = () => this.handleClose();
    ws.onmessage = (ev) => void this.handleMessage(ev.data);
    const buvid = this.readBuvid();
    ws.send(buildAuthPacket(Number(ctx.roomId), server.token, buvid));
    this.hbTimer = setInterval(() => {
      if (!this.stopped) try { ws.send(buildHeartbeatPacket()); } catch (_) { /* 忽略 */ }
    }, this.opts.heartbeatMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch (_) { /* 忽略 */ }
      this.ws = null;
    }
  }

  private handleClose(): void {
    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
    this.ws = null;
  }

  private readBuvid(): string {
    try {
      const m = document.cookie.match(/buvid3=([^;]+)/);
      return m && m[1] ? m[1] : '';
    } catch (_) {
      return '';
    }
  }

  private async handleMessage(data: ArrayBuffer): Promise<void> {
    if (this.stopped || this.ctx.epoch !== this.epochAtStart) return; // 旧实例消息丢弃
    try {
      const raw = new Uint8Array(data);
      const head = parseFrameHead(raw);
      if (!head) return;
      if (head.op === 8) return; // 认证回执
      if (head.op !== 5) return;
      const msgs = await decodePayload(head.body, head.protover, this.ctx.roomId, this.opts.inflate);
      for (const m of msgs) this.ctx.onMessage(m);
    } catch (_) { /* 单帧解析失败忽略，不影响后续 */ }
  }
}

/** 页面环境 zlib 解压 */
async function browserInflate(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 解码 op5 载荷 → DanmuMessage[]。protover0=直接 JSON；protover2=zlib(内层帧流) */
export async function decodePayload(
  body: Uint8Array,
  protover: number,
  roomId: number | string,
  inflate?: Inflate,
  now = Date.now(),
): Promise<DanmuMessage[]> {
  const out: DanmuMessage[] = [];
  const consume = (payload: Uint8Array, isInnerFramed: boolean) => {
    if (isInnerFramed) {
      for (const seg of splitInnerFrames(payload)) {
        const cmds = tryParseJson(seg);
        if (!cmds) continue;
        for (const c of cmds) {
          const m = commandToDanmu('bilibili', roomId, c, now);
          if (m) out.push(m);
        }
      }
    } else {
      const cmds = tryParseJson(payload);
      if (!cmds) return;
      for (const c of cmds) {
        const m = commandToDanmu('bilibili', roomId, c, now);
        if (m) out.push(m);
      }
    }
  };
  if (protover === 0) {
    consume(body, false);
  } else if (protover === 2) {
    const inflated = inflate ? await inflate(body) : await browserInflate(body);
    consume(inflated, true);
  }
  // protover 3(brotli) 预留：真机样本未见，先忽略
  return out;
}

/** 便捷入口：喂完整 ws 帧 → DanmuMessage[]（供测试/日志） */
export async function decodeFrameToDanmu(
  platform: 'bilibili',
  roomId: number | string,
  data: ArrayBuffer,
  inflate: Inflate,
  now = Date.now(),
): Promise<DanmuMessage[]> {
  const raw = new Uint8Array(data);
  const head = parseFrameHead(raw);
  if (!head || head.op !== 5) return [];
  return decodePayload(head.body, head.protover, roomId, inflate, now);
}
