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
const emptyBoard = Array(size * size).fill(null);
let solo = { tiles: null, deadline: 0, score: 0, result: '', message: '' };
let room;
let session;
let events;
let online = false;
let pending = false;
let serverOffset = 0;
let shownResult;
const previews = new Map();

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
  lobby.hidden = Boolean(room);
  find('room-code').textContent = room ? '방 ' + room.code + ' · ' + room.players.length + '/5' : '혼자 연습';
  find('copy').hidden = find('leave').hidden = !room;
  if (room) {
    const host = room.host === player.id;
    const activeRound = room.players.some(member => member.tiles && !member.result);
    const ready = room.players.filter(member => member.connected).length >= 2;
    start.disabled = pending || !online || !host || !ready || activeRound;
    start.textContent = activeRound ? '게임 진행 중' :
      host ? (room.round ? '다시 시작' : '함께 시작') : '방장 대기';
    status.textContent = player.result || (active ? player.message || '빈칸을 골라 보세요.' :
      activeRound ? '다음 판에 참가할 수 있어요.' :
        ready ? '방장이 게임을 시작할 수 있어요.' : '두 명 이상 모이면 시작할 수 있어요.');
  } else {
    start.disabled = active;
    start.textContent = player.result ? '다시 시작' : '혼자 시작';
    status.textContent = player.result || player.message || '시작을 누르면 2분이 주어져요.';
  }
  renderOpponents();
  renderTime();
  if (player.result && shownResult !== player.tiles) {
    shownResult = player.tiles;
    find('result-title').textContent = player.result;
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

async function post(path, data) {
  const response = await fetch('./api/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

async function roomAction(path, data = {}) {
  if (pending) return;
  pending = true;
  try {
    await post(path, { code: room.code, token: session.token, ...data });
    return true;
  } catch (error) {
    connection.textContent = error.message;
    return false;
  } finally {
    pending = false;
  }
}

joinForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
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
  } catch (error) {
    connection.textContent = error.message;
  } finally {
    pending = false;
  }
});

find('leave').addEventListener('click', async () => {
  if (online && !(await roomAction('leave'))) return;
  events.close();
  online = false;
  room = session = undefined;
  connection.textContent = '';
  render();
});

find('copy').addEventListener('click', async () => {
  const code = room.code;
  try {
    await navigator.clipboard.writeText(code);
    connection.textContent = '방 코드를 복사했어요. 친구에게 보내 주세요.';
  } catch {
    connection.textContent = '친구에게 이 방 코드를 보내 주세요 · ' + code;
  }
});

start.addEventListener('click', async () => {
  if (room) {
    await roomAction('start');
    render();
    return;
  }
  solo = { tiles: makeBoard(), deadline: Date.now() + roundMs, score: 0, result: '', message: '빈칸을 골라 보세요.' };
  render();
});

function play(index) {
  const player = currentPlayer();
  if (!player.tiles || player.tiles[index] !== null || player.result) return;
  if (room) {
    if (online) void roomAction('play', { index, round: room.round });
    return;
  }
  if (Date.now() >= solo.deadline) return;
  const matched = matchesAt(solo.tiles, index);
  for (const cell of matched) solo.tiles[cell] = null;
  solo.score += matched.length;
  solo.message = matched.length ? '+' + matched.length + '점!' : '매칭 실패 · 10초 차감';
  if (!matched.length) solo.deadline -= 10_000;
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
