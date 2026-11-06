'use strict';

const { size, roundMs, colors, makeBoard, matchesAt } = ColorTilesRules;
const find = id => document.getElementById(id);
const board = find('board');
const start = find('start');
const status = find('status');
const result = find('result');
const lobby = find('lobby');
const joinForm = find('join-form');
const connection = find('connection');
const waitingRoom = find('waiting-room');
const readyButton = find('ready');
const multiplayerStart = find('multiplayer-start');
const discordRetry = find('discord-retry');
const discordNotice = find('discord-connection');
const discordActivity = window.parent !== window && new URLSearchParams(location.search).has('instance_id');
document.body.classList.toggle('discord-activity', discordActivity);
if (discordActivity) find('multi-description').textContent = '같은 Discord 활동의 친구와 플레이';
const emptyBoard = Array(size * size).fill(null);
const volumeInput = find('volume');
const volumeKey = 'color-tiles-volume';
let mode = 'home';
let solo = { tiles: null, deadline: 0, score: 0, result: '', message: '' };
let room;
let session;
let events;
let online = false;
let pending = false;
let serverOffset = 0;
let shownResult;
let audio;
const previews = new Map();

try {
  const saved = localStorage.getItem(volumeKey);
  if (saved !== null && /^\d{1,3}$/.test(saved)) volumeInput.value = saved;
} catch {
  // Volume controls still work when Discord blocks browser storage.
}

function showVolume() {
  find('volume-value').textContent = volumeInput.value + '%';
}

showVolume();
volumeInput.addEventListener('input', () => {
  showVolume();
  try {
    localStorage.setItem(volumeKey, volumeInput.value);
  } catch {
    // Keep the setting for this page session.
  }
});

function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') return audio.resume().catch(() => {});
  } catch {
    // The game can still be played when audio is unavailable.
  }
}

function playTone(from, to, offset, duration, type = 'sine') {
  const level = volumeInput.valueAsNumber / 100;
  if (audio?.state !== 'running' || level === 0) return;
  const when = audio.currentTime + offset;
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  tone.type = type;
  tone.frequency.setValueAtTime(from, when);
  tone.frequency.exponentialRampToValueAtTime(to, when + duration * 0.8);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.17 * level, when + 0.009);
  gain.gain.linearRampToValueAtTime(0, when + duration);
  tone.connect(gain).connect(audio.destination);
  tone.start(when);
  tone.stop(when + duration);
}

function playPops(count) {
  for (let index = 0; index < count; index++) {
    playTone(720 + index * 45, 270, index * 0.055, 0.12);
  }
}

function playPenalty() {
  playTone(290, 220, 0, 0.13, 'triangle');
  playTone(205, 120, 0.12, 0.19, 'triangle');
}

const buttons = emptyBoard.map((_, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cell';
  button.addEventListener('click', () => play(index));
  board.append(button);
  return button;
});

function currentPlayer() {
  return room ? room.players.find(player => player.id === session.id) : solo;
}

function clock(deadline, now) {
  const seconds = Math.ceil(Math.max(0, deadline - now) / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function renderTime() {
  const player = currentPlayer();
  const now = Date.now() + (room ? serverOffset : 0);
  const time = find('time');
  time.textContent = player.result === '시간 종료' ? '0:00' :
    clock(player.deadline || now + roundMs, now);
  time.classList.toggle('urgent', Boolean(player.deadline && player.deadline - now <= 20_000));
  for (const { player: opponent, time: text } of previews.values()) {
    text.textContent = !opponent.connected ? '연결 끊김' : opponent.result ||
      (opponent.tiles ? clock(opponent.deadline, now) : '대기 중');
  }
}

function makePreview() {
  const card = document.createElement('article');
  card.className = 'panel opponent';
  card.innerHTML = '<p class="seat"></p><h3></h3><canvas width="160" height="160"></canvas>' +
    '<div class="opponent-stats"><strong></strong><span></span></div>';
  return {
    card, seat: card.querySelector('.seat'), name: card.querySelector('h3'),
    canvas: card.querySelector('canvas'), score: card.querySelector('strong'),
    time: card.querySelector('.opponent-stats span')
  };
}

function renderOpponents() {
  const players = room?.players ?? [];
  const ownSeat = players.findIndex(player => player.id === session?.id);
  const clockwise = [...players.slice(ownSeat + 1), ...players.slice(0, Math.max(0, ownSeat))];
  const rightCount = Math.ceil(clockwise.length / 2);
  for (const [id, preview] of previews) {
    if (!clockwise.some(player => player.id === id)) {
      preview.card.remove();
      previews.delete(id);
    }
  }
  clockwise.forEach((player, index) => {
    const preview = previews.get(player.id) ?? makePreview();
    preview.player = player;
    previews.set(player.id, preview);
    preview.seat.textContent = '↻ ' + (index + 1);
    preview.name.textContent = player.name + (room.host === player.id ? ' · 방장' : '');
    preview.score.textContent = player.score + '점';
    preview.canvas.setAttribute('aria-label', player.name + '의 실시간 게임판');
    const ctx = preview.canvas.getContext('2d');
    (player.tiles ?? emptyBoard).forEach((tile, cell) => {
      ctx.fillStyle = colors[tile]?.[0] ?? '#3b2f51';
      ctx.fillRect(cell % size * 8, Math.floor(cell / size) * 8, 7, 7);
    });
  });
  find('right').replaceChildren(...clockwise.slice(0, rightCount).map(player => previews.get(player.id).card));
  find('left').replaceChildren(...clockwise.slice(rightCount).reverse().map(player => previews.get(player.id).card));
}

function renderWaitingRoom(player, activeRound) {
  waitingRoom.hidden = mode !== 'multi' || activeRound || (!discordActivity && !room);
  if (waitingRoom.hidden) return;

  const members = room?.players ?? [];
  const everyoneReady = members.length >= 2 && members.every(member => member.connected && member.ready);
  find('waiting-mode').textContent = (discordActivity ? 'DISCORD ACTIVITY' : 'MULTIPLAYER') +
    ' · ' + members.length + '/5';
  const message = !room ? '같은 음성 채널에서 이 활동에 참가한 친구와 플레이해요.' :
    !online ? '연결을 확인하고 있어요.' :
      members.length < 2 ? '친구가 들어오면 함께 시작할 수 있어요.' :
        everyoneReady ? '모두 준비됐어요. 방장이 시작할 수 있어요!' : '모두 준비를 누르면 시작할 수 있어요.';
  const waitingStatus = find('waiting-status');
  if (waitingStatus.textContent !== message) waitingStatus.textContent = message;
  find('waiting-home').hidden = Boolean(room);
  find('waiting-home').disabled = pending;
  readyButton.hidden = !room;
  readyButton.disabled = pending || !online;
  readyButton.textContent = player.ready ? '준비 취소' : '준비';
  readyButton.setAttribute('aria-pressed', String(Boolean(player.ready)));
  multiplayerStart.hidden = !room || room.host !== player.id;
  multiplayerStart.disabled = pending || !online || !everyoneReady;

  const profiles = find('profiles');
  const signature = JSON.stringify(members.map(({ id, name, avatar, ready, connected }) =>
    [id, name, avatar, ready, connected, room.host]));
  if (profiles.dataset.members === signature) return;
  profiles.dataset.members = signature;
  profiles.replaceChildren(...members.map((member, index) => {
    const card = document.createElement('li');
    card.className = 'profile';
    card.style.setProperty('--float-delay', -index * 0.45 + 's');
    card.dataset.ready = String(member.connected && member.ready);
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = Array.from(member.name)[0];
    if (member.avatar) {
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = member.avatar;
      avatar.append(image);
    }
    const name = document.createElement('strong');
    name.textContent = member.name;
    const readiness = document.createElement('small');
    const role = member.id === room.host ? '방장 · ' : '';
    readiness.textContent = role + (!member.connected ? '연결 끊김' : member.ready ? '준비 완료' : '대기 중');
    card.append(avatar, name, readiness);
    return card;
  }));
}

function render() {
  const player = currentPlayer();
  const tiles = player.tiles ?? emptyBoard;
  const active = Boolean(player.tiles && !player.result);
  const canPlay = active && (!room || online);
  buttons.forEach((button, index) => {
    const color = colors[tiles[index]];
    button.disabled = !canPlay;
    button.tabIndex = color ? -1 : 0;
    button.classList.toggle('tile', Boolean(color));
    if (color) button.style.setProperty('--tile', color[0]);
    else button.style.removeProperty('--tile');
    button.setAttribute('aria-label', (Math.floor(index / size) + 1) + '행 ' +
      (index % size + 1) + '열, ' + (color ? color[1] + ' 타일' : '빈칸'));
  });
  find('player-name').textContent = room ? player.name + ' · 나' : '내 게임판';
  find('score').textContent = player.score;
  find('remaining').textContent = tiles.filter(tile => tile !== null).length;
  find('home').hidden = mode !== 'home';
  lobby.hidden = mode !== 'multi' || discordActivity || Boolean(room);
  const roomLabel = find('room-code');
  roomLabel.hidden = mode === 'home';
  roomLabel.textContent = mode === 'solo' ? '혼자 연습' : discordActivity ? 'Discord 활동' :
    room ? '방 ' + room.code + ' · ' + room.players.length + '/5' : '함께 하기';
  find('copy').hidden = !room || discordActivity;
  find('leave').hidden = mode === 'home';
  find('leave').disabled = pending;
  const activeRound = Boolean(room?.players.some(member => member.tiles && !member.result));
  find('arena').hidden = mode !== 'solo' && !activeRound;
  document.body.classList.toggle('playing', !find('arena').hidden);
  renderWaitingRoom(player, activeRound);
  start.hidden = mode !== 'solo' || !player.result;
  status.textContent = player.message || player.result || '빈칸을 골라 보세요.';
  status.classList.toggle('penalty', player.message === '매칭 실패 · 10초 차감');
  if (!find('arena').hidden) renderOpponents();
  renderTime();
  if (player.result && shownResult !== player.tiles) {
    shownResult = player.tiles;
    find('result-title').textContent = player.result;
    find('result-message').hidden = !status.classList.contains('penalty');
    find('result-message').textContent = '매칭 실패 · 10초 차감';
    find('result-score').textContent = player.score + '점';
    if (!result.open) result.showModal();
  }
}

function acceptState(next) {
  if (room?.round !== next.round) {
    shownResult = undefined;
    if (result.open) result.close();
  }
  room = next;
  serverOffset = next.now - Date.now();
  const player = currentPlayer();
  if (player.result && shownResult !== undefined) shownResult = player.tiles;
  render();
}

async function post(path, data, signal) {
  const response = await fetch('./api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function roomAction(path, data = {}) {
  if (pending) return;
  pending = true;
  try {
    return await post(path, { code: room.code, token: session.token, ...data });
  } catch (error) {
    connection.textContent = error.message;
    return false;
  } finally {
    pending = false;
  }
}

function openBrowserEvents() {
  const params = new URLSearchParams({ code: room.code, token: session.token });
  events = new EventSource('./api/events?' + params);
  events.onmessage = event => {
    online = true;
    connection.textContent = '● 실시간 연결 · ↻ 숫자는 내 자리 다음부터 시계 방향이에요.';
    acceptState(JSON.parse(event.data));
  };
  events.onerror = () => {
    online = false;
    connection.textContent = '연결이 끊겼어요. 다시 연결하는 중…';
    render();
  };
}

joinForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending || mode !== 'multi') return;
  if (location.protocol === 'file:') {
    connection.textContent = '멀티플레이는 게임 서버 주소(http://localhost:8080)에서 열어 주세요.';
    return;
  }
  const create = event.submitter?.value === 'create';
  const code = find('code').value.trim().toUpperCase();
  if (!create && !/^[0-9A-F]{6}$/.test(code)) {
    connection.textContent = '6자리 방 코드를 입력해 주세요.';
    return;
  }
  pending = true;
  try {
    session = await post('join', { name: find('nickname').value, code: create ? '' : code });
    solo = { tiles: null, deadline: 0, score: 0, result: '', message: '' };
    acceptState(session.state);
    openBrowserEvents();
  } catch (error) {
    connection.textContent = error.message;
  } finally {
    pending = false;
    render();
  }
});

async function pollDiscord(activeSession) {
  if (session !== activeSession) return;
  try {
    const next = await post('state', { code: room.code, token: activeSession.token }, AbortSignal.timeout(5000));
    if (session !== activeSession) return;
    online = true;
    connection.textContent = '';
    acceptState(next);
  } catch (error) {
    if (session !== activeSession) return;
    online = false;
    connection.textContent = '연결이 끊겼어요. 다시 연결하는 중…';
    if (error.status === 404) {
      room = session = undefined;
      discordRetry.hidden = false;
      connection.textContent = '';
      showDiscordNotice(error.message, true);
    }
    render();
  }
  if (session === activeSession) setTimeout(() => pollDiscord(activeSession), online ? 450 : 1500);
}

function showDiscordNotice(message, error = false) {
  discordNotice.textContent = message;
  discordNotice.hidden = !message;
  discordNotice.classList.toggle('error', error);
}

async function joinDiscord() {
  if (pending || mode !== 'multi') return;
  pending = true;
  discordRetry.hidden = true;
  showDiscordNotice('Discord 활동에 연결하는 중…');
  render();
  try {
    const response = await fetch('./api/discord/config', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Discord 연결 설정을 불러오지 못했어요.');
    const { clientId } = await response.json();
    if (!clientId) {
      showDiscordNotice('서버에 Discord 연결 설정이 빠져 있어요. 지금은 메인 화면에서 혼자 할 수 있어요.', true);
      return;
    }
    const { connectDiscord } = await import('./discord-client.js?v=3');
    session = await connectDiscord(clientId, data => post('discord/join', data, AbortSignal.timeout(20_000)));
    online = true;
    showDiscordNotice('');
    acceptState(session.state);
    void pollDiscord(session);
  } catch (error) {
    discordRetry.hidden = false;
    showDiscordNotice(error.message || 'Discord에 연결하지 못했어요. 다시 시도해 주세요.', true);
  } finally {
    pending = false;
    render();
  }
}

discordRetry.addEventListener('click', joinDiscord);

async function goHome() {
  if (pending) return;
  if (room && online && !(await roomAction('leave'))) return;
  events?.close();
  online = false;
  room = session = undefined;
  mode = 'home';
  solo = { tiles: null, deadline: 0, score: 0, result: '', message: '' };
  shownResult = undefined;
  if (result.open) result.close();
  connection.textContent = '';
  showDiscordNotice('');
  discordRetry.hidden = true;
  render();
}

find('leave').addEventListener('click', goHome);
find('waiting-home').addEventListener('click', goHome);

find('copy').addEventListener('click', async () => {
  const code = room.code;
  try {
    await navigator.clipboard.writeText(code);
    connection.textContent = '방 코드를 복사했어요. 친구에게 보내 주세요.';
  } catch {
    connection.textContent = '친구에게 이 방 코드를 보내 주세요 · ' + code;
  }
});

readyButton.addEventListener('click', async () => {
  unlockAudio();
  await roomAction('ready', { ready: !currentPlayer().ready });
  render();
});

multiplayerStart.addEventListener('click', async () => {
  unlockAudio();
  await roomAction('start');
  render();
});

function startSolo() {
  unlockAudio();
  mode = 'solo';
  solo = { tiles: makeBoard(), deadline: Date.now() + roundMs, score: 0, result: '', message: '빈칸을 골라 보세요.' };
  render();
}

start.addEventListener('click', startSolo);
find('solo-mode').addEventListener('click', startSolo);
find('multi-mode').addEventListener('click', () => {
  mode = 'multi';
  render();
  if (discordActivity) void joinDiscord();
});
find('open-settings').addEventListener('click', () => find('settings').showModal());
find('sound-preview').addEventListener('click', async () => {
  await unlockAudio();
  playPops(1);
});

async function play(index) {
  const player = currentPlayer();
  if (!player.tiles || player.tiles[index] !== null || player.result) return;
  unlockAudio();
  if (room) {
    if (online) {
      const reply = await roomAction('play', { index, round: room.round });
      if (reply?.matched) playPops(reply.matched);
      else if (reply?.penalty) playPenalty();
    }
    return;
  }
  if (Date.now() >= solo.deadline) return;
  const matched = matchesAt(solo.tiles, index);
  playPops(matched.length);
  for (const cell of matched) solo.tiles[cell] = null;
  solo.score += matched.length;
  solo.message = matched.length ? '+' + matched.length + '점!' : '매칭 실패 · 10초 차감';
  if (!matched.length) {
    solo.deadline -= 10_000;
    playPenalty();
  }
  if (solo.deadline <= Date.now()) solo.result = '시간 종료';
  else if (solo.tiles.every(tile => tile === null)) solo.result = '클리어!';
  render();
}

setInterval(() => {
  if (!room && solo.tiles && !solo.result && solo.deadline <= Date.now()) {
    solo.result = '시간 종료';
    render();
  } else {
    renderTime();
  }
}, 100);
render();
