'use strict';

const { createServer } = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { size, roundMs, makeBoard, matchesAt } = require('./rules');
const { clientId, verifyParticipant } = require('./discord-server');

const rooms = new Map();
const activityRooms = new Map();
const activityTimeout = 12_000;
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/fonts/LevelUp-Regular.woff2', ['fonts/LevelUp-Regular.woff2', 'font/woff2']],
  ['/fonts/LevelUp-Bold.woff2', ['fonts/LevelUp-Bold.woff2', 'font/woff2']],
  ['/rules.js', ['rules.js', 'text/javascript']],
  ['/app.js', ['app.js', 'text/javascript']]
].map(([path, [file, type]]) => [path, [readFileSync(join(__dirname, file)), type]]));

if (clientId) {
  assets.set('/discord-client.js', [readFileSync(join(__dirname, 'dist/discord-client.js')), 'text/javascript']);
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function state(room) {
  return {
    code: room.code, activity: Boolean(room.instanceId), host: room.players[0].id,
    round: room.round, now: Date.now(),
    players: room.players.map(({ id, name, avatar, ready, tiles, score, deadline, result, connected, message }) => ({
      id, name, avatar, ready, tiles, score, deadline, result, connected, message
    }))
  };
}

function broadcast(room) {
  const event = 'data: ' + JSON.stringify(state(room)) + '\n\n';
  for (const stream of room.streams.values()) {
    if (stream.writableLength > 64_000) stream.destroy();
    else stream.write(event);
  }
}

function expire(room, now) {
  let changed = false;
  for (const player of room.players) {
    if (player.tiles && !player.result && player.deadline <= now) {
      player.result = '시간 종료';
      changed = true;
    }
  }
  if (changed) broadcast(room);
}

function addPlayer(room, profile) {
  const player = {
    id: randomUUID(), token: randomUUID(), ...profile, ready: false,
    tiles: null, score: 0, deadline: 0, result: '', connected: false, message: '',
    disconnectedAt: Date.now()
  };
  room.players.push(player);
  broadcast(room);
  return player;
}

function createRoom(instanceId) {
  let code;
  do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
  const room = { code, instanceId, players: [], streams: new Map(), round: 0 };
  rooms.set(code, room);
  if (instanceId) activityRooms.set(instanceId, room);
  return room;
}

function deleteRoom(room) {
  rooms.delete(room.code);
  if (room.instanceId) activityRooms.delete(room.instanceId);
}

function inRound(room) {
  return room.players.some(player => player.tiles && !player.result);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request too large');
  }
  return JSON.parse(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const asset = assets.get(url.pathname);
  if (req.method === 'GET' && url.pathname === '/api/discord/config') {
    return send(res, 200, { clientId });
  }
  if (req.method === 'GET' && asset) {
    const type = asset[1].startsWith('text/') ? asset[1] + '; charset=utf-8' : asset[1];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    return res.end(asset[0]);
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const room = rooms.get(url.searchParams.get('code'));
    const player = room?.players.find(p => p.token === url.searchParams.get('token'));
    if (!player || room.instanceId) return send(res, 404, { error: '방을 다시 만들어 주세요.' });
    room.streams.get(player.id)?.end();
    room.streams.set(player.id, res);
    player.connected = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    });
    res.on('close', () => {
      if (room.streams.get(player.id) !== res) return;
      room.streams.delete(player.id);
      player.connected = false;
      player.ready = false;
      player.disconnectedAt = Date.now();
      broadcast(room);
    });
    broadcast(room);
    return;
  }
  if (req.method !== 'POST' || ![
    '/api/join', '/api/discord/join', '/api/state', '/api/ready', '/api/start', '/api/play', '/api/leave'
  ].includes(url.pathname)) {
    return send(res, 404, { error: '요청을 찾을 수 없어요.' });
  }

  let data;
  try {
    data = await readBody(req);
    if (!data || typeof data !== 'object') throw new Error('Invalid body');
  } catch {
    return send(res, 400, { error: '요청을 읽을 수 없어요.' });
  }

  let room = rooms.get(data.code);
  if (url.pathname === '/api/join' || url.pathname === '/api/discord/join') {
    const activity = url.pathname === '/api/discord/join';
    let profile;
    if (activity) {
      if (!clientId) return send(res, 503, { error: 'Discord 활동 연결이 아직 설정되지 않았어요.' });
      if (typeof data.instanceId !== 'string' || !/^[\w-]{1,150}$/.test(data.instanceId) ||
          typeof data.authorizationCode !== 'string' || !data.authorizationCode) {
        return send(res, 400, { error: 'Discord 활동에서 다시 참가해 주세요.' });
      }
      try {
        profile = await verifyParticipant(data.instanceId, data.authorizationCode);
      } catch (error) {
        console.error('Discord participant verification:', error.message);
      }
      if (!profile) return send(res, 403, { error: 'Discord 참가를 확인하지 못했어요. 활동에서 다시 참가해 주세요.' });
      room = activityRooms.get(data.instanceId);
    } else {
      const name = typeof data.name === 'string' && data.name.trim().slice(0, 16);
      if (!name) return send(res, 400, { error: '닉네임을 입력해 주세요.' });
      if (data.code && (!room || room.instanceId)) return send(res, 404, { error: '방 코드를 확인해 주세요.' });
      profile = { name };
    }
    if (!room) {
      if (rooms.size >= 200) return send(res, 503, { error: '잠시 후 방을 만들어 주세요.' });
      room = createRoom(activity ? data.instanceId : undefined);
    }
    expire(room, Date.now());
    const existing = activity && room.players.find(member => member.discordId === profile.discordId);
    if (existing) {
      Object.assign(existing, profile, { token: randomUUID(), ready: false, connected: true, lastSeen: Date.now() });
      return send(res, 200, { id: existing.id, token: existing.token, state: state(room) });
    }
    if (room.players.length >= 5) return send(res, 409, { error: '이 방은 최대 5명까지 들어갈 수 있어요.' });
    if (inRound(room)) return send(res, 409, { error: '진행 중인 판이 끝나면 입장할 수 있어요.' });
    const player = addPlayer(room, profile);
    if (activity) Object.assign(player, { connected: true, lastSeen: Date.now() });
    return send(res, 200, { id: player.id, token: player.token, state: state(room) });
  }

  const player = room?.players.find(p => p.token === data.token);
  if (!player) return send(res, 404, { error: '방에 다시 입장해 주세요.' });
  const now = Date.now();
  expire(room, now);

  if (url.pathname === '/api/state' && room.instanceId) {
    Object.assign(player, { connected: true, lastSeen: now });
    return send(res, 200, state(room));
  }

  if (url.pathname === '/api/leave') {
    const stream = room.streams.get(player.id);
    room.streams.delete(player.id);
    stream?.end();
    room.players.splice(room.players.indexOf(player), 1);
    if (!room.players.length) deleteRoom(room);
    else broadcast(room);
    return send(res, 200, {});
  }

  if (url.pathname === '/api/ready') {
    if (!player.connected || inRound(room)) return send(res, 409, { error: '대기실에서 준비할 수 있어요.' });
    if (typeof data.ready !== 'boolean') return send(res, 400, { error: '준비 상태를 확인해 주세요.' });
    player.ready = data.ready;
  } else if (url.pathname === '/api/start') {
    if (room.players[0] !== player) return send(res, 403, { error: '방장만 시작할 수 있어요.' });
    if (inRound(room)) return send(res, 409, { error: '이미 게임이 진행 중이에요.' });
    if (room.players.length < 2 || !room.players.every(member => member.connected && member.ready)) {
      return send(res, 409, { error: '두 명 이상 모이고 모두 준비해야 시작할 수 있어요.' });
    }
    const tiles = makeBoard();
    const deadline = Date.now() + roundMs;
    room.round++;
    for (const member of room.players) {
      Object.assign(member, {
        tiles: tiles.slice(), deadline,
        score: 0, result: '', message: '', ready: false
      });
    }
  } else if (url.pathname === '/api/play') {
    const index = data.index;
    if (data.round !== room.round || !player.tiles || player.result) {
      return send(res, 409, { error: '현재 판에서 플레이할 수 없어요.' });
    }
    if (!Number.isInteger(index) || index < 0 || index >= size * size || player.tiles[index] !== null) {
      return send(res, 400, { error: '빈칸을 눌러 주세요.' });
    }
    const matched = matchesAt(player.tiles, index);
    for (const cell of matched) player.tiles[cell] = null;
    player.score += matched.length;
    if (matched.length) {
      player.message = '+' + matched.length + '점!';
      if (player.tiles.every(tile => tile === null)) player.result = '클리어!';
    } else {
      player.deadline -= 10_000;
      player.message = '매칭 실패 · 10초 차감';
      if (player.deadline <= now) player.result = '시간 종료';
    }
    broadcast(room);
    return send(res, 200, { matched: matched.length, penalty: matched.length === 0 });
  } else {
    return send(res, 404, { error: '요청을 찾을 수 없어요.' });
  }
  broadcast(room);
  send(res, 200, {});
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    expire(room, now);
    if (room.instanceId) {
      for (const player of room.players) {
        if (player.connected && now - player.lastSeen >= activityTimeout) {
          Object.assign(player, { connected: false, ready: false, disconnectedAt: now });
        }
      }
    }
    if (inRound(room)) continue;
    const present = room.players.filter(player =>
      player.connected || (!room.instanceId && now - player.disconnectedAt < 45_000));
    if (!present.length) deleteRoom(room);
    else if (present.length !== room.players.length) {
      room.players = present;
      broadcast(room);
    }
  }
}, 250).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    for (const stream of room.streams.values()) stream.write(': keepalive\n\n');
  }
}, 15_000).unref();

server.listen(Number(process.env.PORT || 8080), () => {
  console.log('Color Tiles: http://localhost:' + server.address().port);
});
