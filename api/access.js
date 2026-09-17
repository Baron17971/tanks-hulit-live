import { getCache } from '@vercel/functions';
import crypto from 'node:crypto';

const ROOM_TTL = 2592000;
const LOCK_TTL = 300;
const NS = 'tanks-hulit-live-v1';
const SHARDS = 24;
const cache = () => getCache(undefined, NS);
const roomKey = (code) => `r:${code}`;
const failKey = (code) => `access-fail:${code}`;
const voteKey = (code, stage, index) => `v:${code}:s${stage}:${index}`;
const clean = (v, max = 160) => typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const newCode = () => String(crypto.randomInt(100000, 1000000));

function sameToken(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function validPin(pin) { return /^\d{4,6}$/.test(pin); }
function makePin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return { salt, hash };
}
function verifyPin(pin, room) {
  if (!room.pinSalt || !room.pinHash) return false;
  const actual = crypto.scryptSync(pin, room.pinSalt, 32);
  const expected = Buffer.from(room.pinHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; }
}
async function saveRoom(room) {
  await cache().set(roomKey(room.code), room, { ttl: ROOM_TTL });
}
async function refreshVotes(code) {
  for (let stage = 1; stage <= 2; stage += 1) {
    const rows = await Promise.all(Array.from({ length: SHARDS }, (_, i) => cache().get(voteKey(code, stage, i))));
    await Promise.all(rows.map((value, i) => value ? cache().set(voteKey(code, stage, i), value, { ttl: ROOM_TTL }) : Promise.resolve()));
  }
}
function publicRoom(room) {
  return {
    code: room.code,
    className: room.className || '',
    activeStage: room.activeStage,
    status: room.status,
    resultsVisible: room.resultsVisible,
    version: room.version,
    lastActiveAt: room.lastActiveAt || room.updatedAt || room.createdAt
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const body = await readBody(req);
    const action = clean(body.action, 30);

    if (action === 'create') {
      const pin = clean(body.pin, 12);
      if (!validPin(pin)) return res.status(400).json({ error: 'bad_pin' });
      let code = '';
      for (let i = 0; i < 10; i += 1) {
        const candidate = newCode();
        if (!await cache().get(roomKey(candidate))) { code = candidate; break; }
      }
      if (!code) return res.status(503).json({ error: 'code' });
      const now = Date.now();
      const p = makePin(pin);
      const room = {
        code,
        teacherToken: crypto.randomBytes(24).toString('hex'),
        className: clean(body.className, 60),
        activeStage: 1,
        status: 'closed',
        resultsVisible: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
        pinSalt: p.salt,
        pinHash: p.hash,
        pinVersion: 1
      };
      await saveRoom(room);
      return res.status(201).json({ ...publicRoom(room), teacherToken: room.teacherToken });
    }

    const code = clean(body.code, 10);
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'bad_code' });
    const room = await cache().get(roomKey(code));
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    if (action === 'resume') {
      const pin = clean(body.pin, 12);
      if (!validPin(pin)) return res.status(400).json({ error: 'bad_pin' });
      if (!room.pinHash) return res.status(409).json({ error: 'pin_not_set' });
      const failed = await cache().get(failKey(code)) || { count: 0 };
      if ((failed.count || 0) >= 8) return res.status(429).json({ error: 'too_many_attempts' });
      if (!verifyPin(pin, room)) {
        await cache().set(failKey(code), { count: (failed.count || 0) + 1, updatedAt: Date.now() }, { ttl: LOCK_TTL });
        return res.status(403).json({ error: 'invalid_credentials' });
      }
      await cache().delete(failKey(code));
      room.lastActiveAt = Date.now();
      room.updatedAt = room.lastActiveAt;
      await Promise.all([saveRoom(room), refreshVotes(code)]);
      return res.json({ ...publicRoom(room), teacherToken: room.teacherToken });
    }

    if (action === 'setPin') {
      if (!sameToken(clean(body.teacherToken, 120), room.teacherToken)) return res.status(403).json({ error: 'teacher_auth_failed' });
      const pin = clean(body.pin, 12);
      if (!validPin(pin)) return res.status(400).json({ error: 'bad_pin' });
      const p = makePin(pin);
      room.pinSalt = p.salt;
      room.pinHash = p.hash;
      room.pinVersion = (room.pinVersion || 0) + 1;
      room.lastActiveAt = Date.now();
      room.updatedAt = room.lastActiveAt;
      await Promise.all([saveRoom(room), refreshVotes(code)]);
      return res.json({ ok: true, pinConfigured: true, lastActiveAt: room.lastActiveAt });
    }

    if (action === 'touch') {
      if (!sameToken(clean(body.teacherToken, 120), room.teacherToken)) return res.status(403).json({ error: 'teacher_auth_failed' });
      room.lastActiveAt = Date.now();
      room.updatedAt = room.lastActiveAt;
      await Promise.all([saveRoom(room), refreshVotes(code)]);
      return res.json({ ok: true, lastActiveAt: room.lastActiveAt });
    }

    return res.status(400).json({ error: 'action' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'server_error' });
  }
}
