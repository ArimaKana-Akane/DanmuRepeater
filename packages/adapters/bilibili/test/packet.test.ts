// B站包解析与解码单测：合成帧驱动（与真机结构一致：docs/B站协议采集-全量测试.md）
import { describe, expect, it, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  buildAuthPacket,
  buildHeartbeatPacket,
  commandToDanmu,
  parseFrameHead,
  splitInnerFrames,
} from '../src/packet.js';
import { decodeFrameToDanmu } from '../src/source.js';
import { wbiSignQuery } from '../src/wbi.js';

beforeEach(() => {
  const g = globalThis as { __lgjMd5?: (s: string) => string };
  g.__lgjMd5 = (s) => createHash('md5').update(s).digest('hex');
});

const enc = new TextEncoder();
function packet(op: number, protover: number, body: Uint8Array): Uint8Array {
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

describe('B站 wss 包结构', () => {
  it('心跳包 16B / op2', () => {
    const hb = buildHeartbeatPacket();
    expect(hb.length).toBe(16);
    const head = parseFrameHead(hb)!;
    expect(head.op).toBe(2);
  });
  it('认证包含 JSON body', () => {
    const auth = buildAuthPacket(12345, 'tok', 'buv', 2);
    const head = parseFrameHead(auth)!;
    expect(head.op).toBe(7);
    const body = new TextDecoder().decode(head.body);
    expect(body).toContain('"roomid":12345');
    expect(body).toContain('"key":"tok"');
  });
  it('多内层帧串联可逐段拆出', () => {
    const a = packet(5, 0, enc.encode('{"cmd":"A"}'));
    const b = packet(5, 0, enc.encode('{"cmd":"B"}'));
    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);
    const segs = [...splitInnerFrames(joined)];
    expect(segs).toHaveLength(2);
    expect(new TextDecoder().decode(segs[0])).toBe('{"cmd":"A"}');
  });
});

describe('DANMU_MSG 解码', () => {
  it('protover0 明文帧 → DanmuMessage（文本/昵称/uid/ts）', async () => {
    const json = JSON.stringify({
      cmd: 'DANMU_MSG',
      info: [
        [0, 1, 25, 1678432100],
        '这个操作太秀了',
        [777, '测试昵称', 0, 0, 0, 10000, 1, ''],
        [],
        [],
      ],
    });
    const frame = packet(5, 0, enc.encode(json));
    const inflate = async (b: Uint8Array) => b;
    const msgs = await decodeFrameToDanmu('bilibili', 42, frame.buffer as ArrayBuffer, inflate, 1000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ text: '这个操作太秀了', nick: '测试昵称', uid: 777, platform: 'bilibili', roomId: 42 });
    expect(msgs[0]!.ts).toBe(1678432100 * 1000);
  });
  it('protover2 = zlib(内层帧) → 解码', async () => {
    const json = enc.encode(JSON.stringify({ cmd: 'DANMU_MSG', info: [[0, 1, 25, 1678432101], 'zlib测试', [9, '昵称2']] }));
    const inner = packet(5, 0, json);
    const outer = packet(5, 2, new Uint8Array(deflateSync(inner)));
    const inflateReal = async (b: Uint8Array) => new Uint8Array(inflateSync(b));
    const msgs = await decodeFrameToDanmu('bilibili', 42, outer.buffer as ArrayBuffer, inflateReal);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('zlib测试');
    expect(msgs[0]!.nick).toBe('昵称2');
  });
  it('非 DANMU_MSG（如 INTERACT_WORD_V2）不解出消息', async () => {
    const json = JSON.stringify({ cmd: 'INTERACT_WORD_V2', data: {} });
    const frame = packet(5, 0, enc.encode(json));
    const inflate = async (b: Uint8Array) => b;
    const msgs = await decodeFrameToDanmu('bilibili', 42, frame.buffer as ArrayBuffer, inflate);
    expect(msgs).toHaveLength(0);
  });
  it('commandToDanmu 对无文本/未知 cmd 返回 null', () => {
    expect(commandToDanmu('bilibili', 1, { cmd: 'DANMU_MSG' }, 0)).toBeNull();
    expect(commandToDanmu('bilibili', 1, { cmd: 'DANMU_MSG', info: [[], 'x'] }, 0)).not.toBeNull();
  });
});

describe('wbi 签名', () => {
  it('query 含 wts/w_rid 且参数排序', () => {
    const q = wbiSignQuery({ id: 123, type: 0 }, { imgKey: 'a'.repeat(32), subKey: 'b'.repeat(32) });
    expect(q).toContain('&wts=');
    expect(q).toContain('&w_rid=');
    expect(q.indexOf('id=123')).toBeLessThan(q.indexOf('type=0'));
  });
});
