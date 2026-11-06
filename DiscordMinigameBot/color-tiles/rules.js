'use strict';

const ColorTilesRules = (() => {
  const size = 20;
  const targetPairs = 160;
  const roundMs = 120_000;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const colors = [
    ['#ff5577', '분홍'],
    ['#ff9c4d', '주황'],
    ['#fbef7d', '노랑'],
    ['#83e6a1', '초록'],
    ['#7adcf3', '하늘'],
    ['#a69bff', '보라'],
    ['#f4c8ed', '연분홍']
  ];

  function scan(cells, origin, [dr, dc]) {
    let row = Math.floor(origin / size) + dr;
    let col = origin % size + dc;
    let lastEmpty = null;
    while (row >= 0 && row < size && col >= 0 && col < size) {
      const index = row * size + col;
      if (cells[index] !== null) return { nearest: index, lastEmpty };
      lastEmpty = index;
      row += dr;
      col += dc;
    }
    return { nearest: null, lastEmpty };
  }

  function matchesAt(cells, origin) {
    if (cells[origin] !== null) return [];
    const nearest = directions.map(direction => scan(cells, origin, direction).nearest)
      .filter(index => index !== null);
    return nearest.filter(index => nearest.some(
      other => other !== index && cells[other] === cells[index]
    ));
  }

  function choose(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function makeBoard() {
    const cells = Array(size * size).fill(null);
    const colorIds = colors.map((_, index) => index);
    // Place removable pairs in reverse order so each new board has a solution.
    for (let pair = 0; pair < targetPairs; pair++) {
      const placements = [];
      const start = Math.floor(Math.random() * cells.length);
      for (let offset = 0; offset < cells.length && placements.length === 0; offset++) {
        const origin = (start + offset) % cells.length;
        if (cells[origin] !== null) continue;
        const rays = directions.map(direction => scan(cells, origin, direction));
        for (const [index, first] of rays.entries()) {
          if (first.lastEmpty === null) continue;
          for (const second of rays.slice(index + 1)) {
            if (second.lastEmpty === null) continue;
            const visible = rays.filter(ray => ray !== first && ray !== second && ray.nearest !== null)
              .map(ray => cells[ray.nearest]);
            if (new Set(visible).size !== visible.length) continue;
            const palette = colorIds.filter(color => !visible.includes(color));
            placements.push({ first: first.lastEmpty, second: second.lastEmpty, palette });
          }
        }
      }
      if (placements.length === 0) break;
      const { first, second, palette } = choose(placements);
      const color = choose(palette);
      cells[first] = cells[second] = color;
    }
    return cells;
  }

  return { size, roundMs, colors, makeBoard, matchesAt };
})();

if (typeof module !== 'undefined') module.exports = ColorTilesRules;
