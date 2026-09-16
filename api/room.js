import { getCache } from '@vercel/functions';
import crypto from 'node:crypto';

const TTL = 36000;
const NS = 'tanks-hulit-live-v1';
const SHARDS = 24;
const OPTION_COUNT = { 1: 4, 2: 7 };

const cache = () => getCache(undefined, NS);
const roomKey = (code) => `r:${code}`;
const activityId = (room) => `s${room.activeStage}`;
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const newCode = () => String(crypto.randomInt(100000, 1000000));

function hash(value) {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

const voterKey = (room, voterId) => `v:${room.code}:${activityId(room)}:${hash(voterId) % SHARDS}`;
const shardKey = (room, index) => `v:${room.code}:${activityId(room)}:${index}`;

function sameToken(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { return {}; }
}

function publicRoom(room) {
  return {
    code: room.code,
    className: room.className,
    activeStage: room.activeStage,
    status: room.status,
    resultsVisible: room.resultsVisible,
    version: room.version
  };
}

async function getRoom(code) { return cache().get(roomKey(code)); }
async function saveRoom(room) { await cache().set(roomKey(room.code), room, { ttl: TTL }); }

function validateAnswer(room, answer) {
  const count = OPTION_COUNT[room.activeStage];
  if (!count) return null;
  const n = Number(answer);
  return Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

async function myVote(room, voterId) {
  if (!voterId || !OPTION_COUNT[room.activeStage]) return null;
  const bucket = await cache().get(voterKey(room, voterId)) || {};
  return Object.prototype.hasOwnProperty.call(bucket, voterId) ? bucket[voterId] : null;
}

async function aggregate(room) {
  const count = OPTION_COUNT[room.activeStage] || 0;
  if (!count) return { counts: [], total: 0 };
  const buckets = await Promise.all(Array.from({ length: SHARDS }, (_, i) => cache().get(shardKey(room, i))));
  const counts = Array(count).fill(0);
  let total = 0;
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const answer of Object.values(bucket)) {
      if (Number.isInteger(answer) && answer >= 0 && answer < count) {
        counts[answer] += 1;
        total += 1;
      }
    }
  }
  return { counts, total };
}

async function resetVotes(room) {
  if (!OPTION_COUNT[room.activeStage]) return;
  await Promise.all(Array.from({ length: SHARDS }, (_, i) => cache().delete(shardKey(room, i))));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const code = clean(req.query?.code, 10);
      const voterId = clean(req.query?.voterId);
      const teacherToken = clean(req.query?.teacherToken);
      if (!code) return res.status(400).json({ error: 'missing_code' });
      const room = await getRoom(code);
      if (!room) return res.status(404).json({ error: 'room_not_found' });
      const teacher = sameToken(teacherToken, room.teacherToken);
      const vote = await myVote(room, voterId);
      const results = teacher || room.resultsVisible ? await aggregate(room) : null;
      return res.json({ ...publicRoom(room), myVote: vote, results, teacher });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const body = await readBody(req);
    const action = clean(body.action, 30);

    if (action === 'create') {
      let code = '';
      for (let i = 0; i < 8; i += 1) {
        const candidate = newCode();
        if (!await getRoom(candidate)) { code = candidate; break; }
      }
      if (!code) return res.status(503).json({ error: 'code' });
      const now = Date.now();
      const room = {
        code,
        teacherToken: crypto.randomBytes(24).toString('hex'),
        className: clean(body.className, 60),
        activeStage: 1,
        status: 'closed',
        resultsVisible: false,
        version: 1,
        createdAt: now,
        updatedAt: now
      };
      await saveRoom(room);
      return res.status(201).json({
        ...publicRoom(room),
        teacherToken: room.teacherToken,
        results: { counts: Array(4).fill(0), total: 0 }
      });
    }

    const code = clean(body.code, 10);
    const room = await getRoom(code);
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    if (action === 'vote') {
      if (room.status !== 'open' || !OPTION_COUNT[room.activeStage]) {
        return res.status(409).json({ error: 'poll_closed' });
      }
      const voterId = clean(body.voterId);
      const answer = validateAnswer(room, body.answer);
      if (!voterId || answer === null) return res.status(400).json({ error: 'bad_vote' });
      const key = voterKey(room, voterId);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await cache().get(key) || {};
        await cache().set(key, { ...current, [voterId]: answer }, { ttl: TTL });
        const verify = await cache().get(key) || {};
        if (verify[voterId] === answer) return res.json({ ok: true, myVote: answer });
        await new Promise((resolve) => setTimeout(resolve, 30 + attempt * 20));
      }
      return res.status(409).json({ error: 'vote_retry' });
    }

    if (!sameToken(clean(body.teacherToken), room.teacherToken)) {
      return res.status(403).json({ error: 'teacher_auth_failed' });
    }

    const touch = () => {
      room.version += 1;
      room.updatedAt = Date.now();
    };

    if (action === 'setStage') {
      const nextStage = Number(body.stage);
      if (!Number.isInteger(nextStage) || nextStage < 1 || nextStage > 3) {
        return res.status(400).json({ error: 'bad_stage' });
      }
      room.activeStage = nextStage;
      room.status = nextStage === 3 ? 'closed' : 'open';
      room.resultsVisible = false;
    } else if (action === 'setStatus') {
      if (room.activeStage === 3) room.status = 'closed';
      else room.status = body.status === 'open' ? 'open' : 'closed';
    } else if (action === 'setVisibility') {
      room.resultsVisible = Boolean(body.resultsVisible);
    } else if (action === 'reset') {
      await resetVotes(room);
    } else {
      return res.status(400).json({ error: 'action' });
    }

    touch();
    await saveRoom(room);
    return res.json({ ...publicRoom(room), results: await aggregate(room), teacher: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'server_error' });
  }
}
