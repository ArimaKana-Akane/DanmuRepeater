// B站弹幕 wss 包解析 —— 真机验证的协议结构（docs/B站协议采集-全量测试.md）
// 下行结构：op5(protover 0/2) → (zlib 解压后) 串联内层帧(16B 头 + JSON) → cmd JSON。
import type { DanmuMessage } from '@lgj/core';

export interface Frame {
  total: number;
  headerLen: number;
  protover: number;
  op: number;
  body: Uint8Array;
}

/** 解析单帧头（不足 16B 返回 null） */
export function parseFrameHead(buf: Uint8Array, offset = 0): Frame | null {
  if (buf.length - offset < 16) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset + offset, 16);
  const total = dv.getUint32(0);
  const headerLen = dv.getUint16(4);
  const protover = dv.getUint16(6);
  const op = dv.getUint32(8);
  return { total, headerLen, protover, op, body: buf.slice(offset + headerLen, offset + total) };
}

export type Inflate = (buf: Uint8Array) => Promise<Uint8Array>;

/** 逐内层帧拆解：对 op5 压缩包解压后的字节流，切成 JSON 文本段 */
export function* splitInnerFrames(data: Uint8Array): Generator<Uint8Array> {
  let off = 0;
  while (off + 16 <= data.length) {
    const dv = new DataView(data.buffer, data.byteOffset + off, data.length - off);
    const total = dv.getUint32(0);
    if (total < 16 || off + total > data.length) break;
    const hlen = dv.getUint16(4);
    yield data.slice(off + hlen, off + total);
    off += total;
  }
}

export interface RawCommand {
  cmd: string;
  info?: unknown[];
  [k: string]: unknown;
}

export function tryParseJson(text: Uint8Array): RawCommand[] | null {
  const t = new TextDecoder().decode(text).trim();
  if (t && (t.charCodeAt(0) === 123 || t.charCodeAt(0) === 91)) {
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? (p as RawCommand[]) : [p as RawCommand];
    } catch (_) {
      return null;
    }
  }
  return null;
}

/** 将 DANMU_MSG cmd 转成 core 的 DanmuMessage；非弹幕返回 null */
export function commandToDanmu(platform: 'bilibili', roomId: number | string, c: RawCommand, ts: number): DanmuMessage | null {
  const cmd = String(c.cmd || '').split(':')[0];
  if (cmd !== 'DANMU_MSG') return null;
  const info = Array.isArray(c.info) ? c.info : [];
  const text = info[1] as string | undefined;
  if (!text) return null;
  const user = Array.isArray(info[2]) ? (info[2] as unknown[]) : [];
  const uid = typeof user[0] === 'number' ? user[0] : null;
  const nick = typeof user[1] === 'string' ? user[1] : '?';
  // info[0] = [mode, fontsize, color, timestamp(秒), ...]
  const meta = Array.isArray(info[0]) ? (info[0] as unknown[]) : [];
  const tsMs = typeof meta[3] === 'number' ? meta[3] * 1000 : ts;
  return { id: `bl_${roomId}_${tsMs}_${uid}_${text.length}`, platform, roomId, type: 'danmaku', uid, nick, text, raw: c, ts: tsMs };
}

/** 认证书（op7）构造 */
export function buildAuthPacket(roomId: number, token: string, buvid: string, protover = 2): Uint8Array {
  const body = new TextEncoder().encode(
    JSON.stringify({ uid: 0, roomid: roomId, protover, platform: 'web', type: 2, key: token, buvid }),
  );
  return buildPacket(7, 1, body);
}

export function buildHeartbeatPacket(): Uint8Array {
  return buildPacket(2, 1, new Uint8Array(0));
}

function buildPacket(op: number, protover: number, body: Uint8Array): Uint8Array {
  const buf = new Uint8Array(16 + body.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 16 + body.length);
  v.setUint16(4, 16);
  v.setUint16(6, protover);
  v.setUint32(8, op);
  v.setUint32(12, 1);
  buf.set(body, 16);
  return buf;
}
