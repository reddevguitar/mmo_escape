// 절차적 맵 생성기. 같은 시드 → 같은 지형.

import { GameMap, T, F, TS } from "./map.js";
import { Rng } from "../core/rng.js";

const BORDER = 2;

export function generateMap(def) {
  const rng = new Rng(def.seed);
  const m = new GameMap(def.w, def.h);
  m.theme = def.theme;
  m.name = def.name;
  const ctx = {
    rng,
    m,
    def,
    reserved: new Uint8Array(def.w * def.h),
    roads: [],
    extractSpots: [],
  };

  baseTerrain(ctx);
  border(ctx);
  if (def.theme === "farm") farmRoads(ctx);
  else industrialRoads(ctx);
  placeBuildings(ctx);
  if (def.theme === "farm") farmOutdoor(ctx);
  else industrialOutdoor(ctx);
  outdoorLoot(ctx);
  ensureConnectivity(ctx);
  pruneContainers(ctx);
  lockRooms(ctx);
  finalizeExtracts(ctx);
  spawnPoints(ctx);
  m.roads = ctx.roads;
  return m;
}

// ── 기본 지형 ──────────────────────────────────────────

function valueNoise(rng, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / cell;
      const fy = y / cell;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = g[iy * gw + ix];
      const b = g[iy * gw + ix + 1];
      const c = g[(iy + 1) * gw + ix];
      const d = g[(iy + 1) * gw + ix + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function baseTerrain({ rng, m, def }) {
  const noise = valueNoise(rng, m.w, m.h, 9);
  for (let i = 0; i < m.w * m.h; i++) {
    m.shade[i] = rng.int(0, 255);
    const n = noise[i];
    if (def.theme === "farm") m.floor[i] = n > 0.72 ? F.DIRT : F.GRASS;
    else m.floor[i] = n > 0.55 ? F.CONCRETE : n < 0.22 ? F.DIRT : F.GRAVEL;
  }
}

function border({ rng, m, def }) {
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (x < BORDER || y < BORDER || x >= m.w - BORDER || y >= m.h - BORDER) {
        if (def.theme === "farm") m.set(x, y, rng.chance(0.15) ? T.ROCK : T.TREE);
        else m.set(x, y, T.WALL);
      }
    }
  }
  if (def.theme === "farm") {
    // 가장자리 숲을 들쭉날쭉하게
    for (let i = 0; i < 260; i++) {
      const side = rng.int(0, 3);
      const depth = rng.int(0, 2);
      let x;
      let y;
      if (side === 0) [x, y] = [rng.int(0, m.w - 1), BORDER + depth];
      else if (side === 1) [x, y] = [rng.int(0, m.w - 1), m.h - BORDER - 1 - depth];
      else if (side === 2) [x, y] = [BORDER + depth, rng.int(0, m.h - 1)];
      else [x, y] = [m.w - BORDER - 1 - depth, rng.int(0, m.h - 1)];
      m.set(x, y, T.TREE);
    }
  }
}

function paintRoad(ctx, x, y, w, h, floor, horizontal) {
  const { m, reserved } = ctx;
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!m.inBounds(tx, ty)) continue;
      m.set(tx, ty, T.NONE);
      m.setFloor(tx, ty, floor);
      reserved[m.idx(tx, ty)] = 1;
    }
  }
  ctx.roads.push({ x, y, w, h, horizontal, floor });
}

function addRoadExtract(ctx, road, end, name) {
  const { m } = ctx;
  let tx;
  let ty;
  if (road.horizontal) {
    tx = end === "start" ? BORDER + 1 : m.w - BORDER - 2;
    ty = road.y + Math.floor(road.h / 2);
  } else {
    tx = road.x + Math.floor(road.w / 2);
    ty = end === "start" ? BORDER + 1 : m.h - BORDER - 2;
  }
  ctx.extractSpots.push({ tx, ty, name });
}

function farmRoads(ctx) {
  const { rng, m } = ctx;
  const hy = Math.floor(m.h * rng.range(0.44, 0.54));
  const main = { x: 0, y: hy, w: m.w, h: 3 };
  paintRoad(ctx, main.x, main.y, main.w, main.h, F.ROAD, true);
  const v1x = Math.floor(m.w * rng.range(0.3, 0.38));
  paintRoad(ctx, v1x, 0, 2, hy, F.DIRT, false);
  const v2x = Math.floor(m.w * rng.range(0.64, 0.72));
  paintRoad(ctx, v2x, hy + 3, 2, m.h - hy - 3, F.DIRT, false);
  addRoadExtract(ctx, ctx.roads[0], "start", "서쪽 국도");
  addRoadExtract(ctx, ctx.roads[0], "end", "동쪽 국도");
  addRoadExtract(ctx, ctx.roads[1], "start", "북쪽 농로");
  addRoadExtract(ctx, ctx.roads[2], "end", "남쪽 농로");
  // 특수 탈출구: 숲 사이 개구멍
  const gx = Math.floor(m.w * rng.range(0.7, 0.85));
  for (let y = 0; y < BORDER + 3; y++) for (let x = gx; x < gx + 2; x++) m.set(x, y, T.NONE);
  ctx.extractSpots.push({ tx: gx, ty: BORDER + 1, name: "숲속 개구멍" });
}

function industrialRoads(ctx) {
  const { rng, m } = ctx;
  const hy = Math.floor(m.h * rng.range(0.46, 0.52));
  paintRoad(ctx, 0, hy, m.w, 4, F.ASPHALT, true);
  const v1x = Math.floor(m.w * rng.range(0.24, 0.3));
  paintRoad(ctx, v1x, 0, 4, m.h, F.ASPHALT, false);
  const v2x = Math.floor(m.w * rng.range(0.7, 0.76));
  paintRoad(ctx, v2x, 0, 4, m.h, F.ASPHALT, false);
  addRoadExtract(ctx, ctx.roads[0], "start", "서문 검문소");
  addRoadExtract(ctx, ctx.roads[0], "end", "동문 화물 출구");
  addRoadExtract(ctx, ctx.roads[1], "start", "북쪽 철도 건널목");
  addRoadExtract(ctx, ctx.roads[2], "end", "남쪽 하역장");
  ctx.extractSpots.push({ special: "manhole", name: "하수도 맨홀" });
}

// ── 건물 ──────────────────────────────────────────────

const BUILDING_TYPES = {
  house: { size: [[11, 15], [9, 12]], floor: F.WOOD, minRoom: 3, depth: 3, doors: [1, 2], label: "농가", windows: 0.6,
    loot: [["drawer", 4], ["fridge", 2], ["medcab", 1.5], ["jacket", 2], ["pc", 0.7], ["safe", 0.25]], perRoom: [1, 2],
    furniture: ["bed", "table", "couch", "shelf"] },
  barn: { size: [[13, 17], [10, 13]], floor: F.DIRT, minRoom: 5, depth: 1, doors: [1, 2], wide: true, label: "헛간", windows: 0.2,
    loot: [["crate", 4], ["toolcab", 2], ["duffle", 1.5], ["weaponbox", 0.6]], perRoom: [2, 4], furniture: ["hay"] },
  shed: { size: [[6, 8], [5, 7]], floor: F.WOOD, minRoom: 9, depth: 0, doors: [1, 1], label: "창고", windows: 0.4,
    loot: [["toolcab", 3], ["crate", 3], ["weaponbox", 0.8]], perRoom: [1, 2], furniture: [] },
  warehouse: { size: [[16, 22], [12, 16]], floor: F.CONCRETE, minRoom: 5, depth: 1, doors: [2, 3], wide: true, label: "창고동", windows: 0.15,
    loot: [["crate", 5], ["toolcab", 2.5], ["weaponbox", 1.4], ["duffle", 1.5], ["medcab", 0.6]], perRoom: [3, 5], furniture: ["crates", "machine", "shelf"] },
  office: { size: [[11, 15], [9, 12]], floor: F.TILE, minRoom: 3, depth: 3, doors: [1, 2], label: "사무동", windows: 0.7,
    loot: [["pc", 3], ["drawer", 3], ["safe", 0.9], ["medcab", 1.4], ["fridge", 0.6]], perRoom: [1, 2], furniture: ["desk", "shelf", "table"] },
  garage: { size: [[9, 12], [7, 9]], floor: F.CONCRETE, minRoom: 9, depth: 0, doors: [1, 1], wide: true, label: "정비소", windows: 0.3,
    loot: [["toolcab", 4], ["crate", 2], ["weaponbox", 0.8], ["duffle", 1]], perRoom: [2, 3], furniture: ["machine"] },
  boss: { size: [[22, 24], [15, 17]], floor: F.CONCRETE, minRoom: 6, depth: 1, doors: [3, 3], wide: true, label: "중앙 창고", windows: 0.1,
    loot: [["weaponbox", 3], ["crate", 3], ["safe", 1.2], ["medcab", 1], ["duffle", 1]], perRoom: [3, 5], furniture: ["crates", "machine"] },
};

function rectsOverlap(a, b, margin) {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

function placeBuildings(ctx) {
  const { rng, m, def } = ctx;
  const plan =
    def.theme === "farm"
      ? ["barn", "barn", "house", "house", "house", "shed", "shed", "shed", "house", "shed"]
      : ["boss", "warehouse", "warehouse", "warehouse", "office", "office", "garage", "garage", "warehouse", "office", "garage"];
  const count = Math.min(plan.length, def.buildings);
  const extractRects = ctx.extractSpots.filter((s) => !s.special).map((s) => ({ x: s.tx - 4, y: s.ty - 4, w: 9, h: 9 }));
  let warehouseNo = 0;

  for (let i = 0; i < count; i++) {
    const type = plan[i];
    const spec = BUILDING_TYPES[type];
    for (let attempt = 0; attempt < 500; attempt++) {
      const w = rng.int(spec.size[0][0], spec.size[0][1]);
      const h = rng.int(spec.size[1][0], spec.size[1][1]);
      let x;
      let y;
      if (type === "boss") {
        // 중앙 부근
        x = Math.floor(m.w / 2 - w / 2 + rng.int(-4, 4));
        y = Math.floor(m.h * 0.25 - h / 2 + rng.int(-2, 2));
      } else {
        x = rng.int(BORDER + 3, m.w - BORDER - 3 - w);
        y = rng.int(BORDER + 3, m.h - BORDER - 3 - h);
      }
      const rect = { x, y, w, h };
      if (x < BORDER + 2 || y < BORDER + 2 || x + w > m.w - BORDER - 2 || y + h > m.h - BORDER - 2) continue;
      if (ctx.roads.some((r) => rectsOverlap(rect, r, 2))) continue;
      if (m.buildings.some((b) => rectsOverlap(rect, b, 3))) continue;
      if (extractRects.some((r) => rectsOverlap(rect, r, 1))) continue;
      let label = spec.label;
      if (type === "warehouse") label = `${spec.label} ${String.fromCharCode(65 + warehouseNo++)}`;
      buildBuilding(ctx, rect, type, spec, label);
      break;
    }
  }
}

function buildBuilding(ctx, rect, type, spec, label) {
  const { rng, m, reserved } = ctx;
  const b = { ...rect, type, label, rooms: [] };
  m.buildings.push(b);
  for (let ty = rect.y - 1; ty < rect.y + rect.h + 1; ty++) {
    for (let tx = rect.x - 1; tx < rect.x + rect.w + 1; tx++) {
      if (m.inBounds(tx, ty)) reserved[m.idx(tx, ty)] = 2;
    }
  }
  for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
    for (let tx = rect.x; tx < rect.x + rect.w; tx++) {
      const edge = tx === rect.x || ty === rect.y || tx === rect.x + rect.w - 1 || ty === rect.y + rect.h - 1;
      m.set(tx, ty, edge ? T.WALL : T.NONE);
      m.setFloor(tx, ty, spec.floor);
    }
  }
  const interior = { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 };
  const rooms = [];

  if (type === "warehouse" || type === "boss") {
    // 큰 홀 + 구석 사무실
    const officeW = rng.int(4, 6);
    const officeH = rng.int(4, 5);
    const corner = rng.int(0, 3);
    const ox = corner % 2 === 0 ? interior.x : interior.x + interior.w - officeW;
    const oy = corner < 2 ? interior.y : interior.y + interior.h - officeH;
    const wallX = corner % 2 === 0 ? ox + officeW : ox - 1;
    const wallY = corner < 2 ? oy + officeH : oy - 1;
    for (let ty = oy; ty < oy + officeH; ty++) m.set(wallX, ty, T.WALL);
    for (let tx = Math.min(ox, wallX); tx <= Math.max(ox + officeW - 1, wallX); tx++) m.set(tx, wallY, T.WALL);
    for (let ty = oy; ty < oy + officeH; ty++) for (let tx = ox; tx < ox + officeW; tx++) m.setFloor(tx, ty, F.TILE);
    const dy = rng.int(oy + 1, oy + officeH - 2);
    m.set(wallX, dy, T.DOOR);
    m.doorOpen[m.idx(wallX, dy)] = rng.chance(0.5) ? 1 : 0;
    rooms.push({ x: ox, y: oy, w: officeW, h: officeH, office: true });
    rooms.push({ ...interior, hall: true });
  } else {
    splitRooms(ctx, interior, spec.depth, spec.minRoom, rooms);
  }
  b.rooms = rooms;

  // 외부 출입구
  const doorCount = rng.int(spec.doors[0], spec.doors[1]);
  const sides = rng.shuffle(["n", "s", "e", "w"]);
  // 도로를 향한 면을 우선
  sides.sort((a, c) => sideRoadDist(ctx, rect, a) - sideRoadDist(ctx, rect, c));
  let placed = 0;
  for (const side of sides) {
    if (placed >= doorCount) break;
    if (exteriorDoor(ctx, rect, side, spec.wide)) placed += 1;
  }
  if (placed === 0) exteriorDoor(ctx, rect, sides[0], false, true);

  // 창문
  addWindows(ctx, rect, spec.windows);

  // 가구와 컨테이너
  for (const room of rooms) {
    furnishRoom(ctx, room, spec, type);
    const n = rng.int(spec.perRoom[0], spec.perRoom[1]) + (room.hall ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const kind = room.office ? rng.weighted([["pc", 3], ["drawer", 2], ["safe", type === "boss" ? 2 : 0.4], ["medcab", 1]]) : rng.weighted(spec.loot);
      placeWallContainer(ctx, room, kind);
    }
  }

  if (type === "boss") b.boss = true;
}

function sideRoadDist(ctx, rect, side) {
  const cx = side === "e" ? rect.x + rect.w : side === "w" ? rect.x : rect.x + rect.w / 2;
  const cy = side === "s" ? rect.y + rect.h : side === "n" ? rect.y : rect.y + rect.h / 2;
  let best = Infinity;
  for (const r of ctx.roads) {
    const dx = Math.max(r.x - cx, 0, cx - (r.x + r.w));
    const dy = Math.max(r.y - cy, 0, cy - (r.y + r.h));
    best = Math.min(best, dx + dy);
  }
  return best;
}

function splitRooms(ctx, room, depth, minSize, rooms) {
  const { rng, m } = ctx;
  const canV = room.w >= minSize * 2 + 1;
  const canH = room.h >= minSize * 2 + 1;
  if (depth <= 0 || (!canV && !canH)) {
    rooms.push(room);
    return;
  }
  const vertical = canV && (!canH || room.w > room.h || (room.w === room.h && rng.chance(0.5)));
  for (let attempt = 0; attempt < 8; attempt++) {
    if (vertical) {
      const p = rng.int(room.x + minSize, room.x + room.w - minSize - 1);
      if (m.tile(p, room.y - 1) !== T.WALL || m.tile(p, room.y + room.h) !== T.WALL) continue;
      for (let ty = room.y; ty < room.y + room.h; ty++) m.set(p, ty, T.WALL);
      const d = rng.int(room.y + (room.h > 2 ? 1 : 0), room.y + room.h - (room.h > 2 ? 2 : 1));
      m.set(p, d, rng.chance(0.7) ? T.DOOR : T.NONE);
      if (m.tile(p, d) === T.DOOR) m.doorOpen[m.idx(p, d)] = rng.chance(0.5) ? 1 : 0;
      splitRooms(ctx, { x: room.x, y: room.y, w: p - room.x, h: room.h }, depth - 1, minSize, rooms);
      splitRooms(ctx, { x: p + 1, y: room.y, w: room.x + room.w - p - 1, h: room.h }, depth - 1, minSize, rooms);
      return;
    }
    const p = rng.int(room.y + minSize, room.y + room.h - minSize - 1);
    if (m.tile(room.x - 1, p) !== T.WALL || m.tile(room.x + room.w, p) !== T.WALL) continue;
    for (let tx = room.x; tx < room.x + room.w; tx++) m.set(tx, p, T.WALL);
    const d = rng.int(room.x + (room.w > 2 ? 1 : 0), room.x + room.w - (room.w > 2 ? 2 : 1));
    m.set(d, p, rng.chance(0.7) ? T.DOOR : T.NONE);
    if (m.tile(d, p) === T.DOOR) m.doorOpen[m.idx(d, p)] = rng.chance(0.5) ? 1 : 0;
    splitRooms(ctx, { x: room.x, y: room.y, w: room.w, h: p - room.y }, depth - 1, minSize, rooms);
    splitRooms(ctx, { x: room.x, y: p + 1, w: room.w, h: room.y + room.h - p - 1 }, depth - 1, minSize, rooms);
    return;
  }
  rooms.push(room);
}

function sideTiles(rect, side) {
  const out = [];
  if (side === "n" || side === "s") {
    const y = side === "n" ? rect.y : rect.y + rect.h - 1;
    const iy = side === "n" ? y + 1 : y - 1;
    const oy = side === "n" ? y - 1 : y + 1;
    for (let x = rect.x + 2; x <= rect.x + rect.w - 3; x++) out.push({ x, y, ix: x, iy, ox: x, oy, along: "x" });
  } else {
    const x = side === "w" ? rect.x : rect.x + rect.w - 1;
    const ix = side === "w" ? x + 1 : x - 1;
    const ox = side === "w" ? x - 1 : x + 1;
    for (let y = rect.y + 2; y <= rect.y + rect.h - 3; y++) out.push({ x, y, ix, iy: y, ox, oy: y, along: "y" });
  }
  return out;
}

function exteriorDoor(ctx, rect, side, wide, force = false) {
  const { rng, m, reserved } = ctx;
  const width = wide ? 3 : 1;
  const tiles = sideTiles(rect, side);
  const candidates = [];
  for (let i = 0; i + width <= tiles.length; i++) {
    const group = tiles.slice(i, i + width);
    const okGroup = group.every(
      (t) => m.tile(t.x, t.y) === T.WALL && m.tile(t.ix, t.iy) === T.NONE && m.inBounds(t.ox, t.oy) && t.ox >= BORDER && t.oy >= BORDER && t.ox < m.w - BORDER && t.oy < m.h - BORDER,
    );
    if (okGroup || force) candidates.push(group);
  }
  if (!candidates.length) return false;
  const group = rng.pick(candidates);
  for (const t of group) {
    if (wide) {
      m.set(t.x, t.y, T.NONE);
    } else {
      m.set(t.x, t.y, T.DOOR);
      m.doorOpen[m.idx(t.x, t.y)] = rng.chance(0.4) ? 1 : 0;
    }
    if (m.tile(t.ix, t.iy) !== T.NONE) m.set(t.ix, t.iy, T.NONE);
    // 문 앞 두 칸은 비워둔다
    for (let k = 1; k <= 2; k++) {
      const ox = t.x + (t.ox - t.x) * k;
      const oy = t.y + (t.oy - t.y) * k;
      if (m.inBounds(ox, oy)) {
        reserved[m.idx(ox, oy)] = 3;
        if (m.tile(ox, oy) !== T.NONE && ox >= BORDER && oy >= BORDER && ox < m.w - BORDER && oy < m.h - BORDER) m.set(ox, oy, T.NONE);
      }
    }
  }
  return true;
}

function addWindows(ctx, rect, chance) {
  const { rng, m } = ctx;
  for (const side of ["n", "s", "e", "w"]) {
    const tiles = sideTiles(rect, side);
    for (let i = 1; i + 2 < tiles.length; i += 3) {
      if (!rng.chance(chance * 0.5)) continue;
      const pair = [tiles[i], tiles[i + 1]];
      const neighborsOk = [tiles[i - 1], tiles[i + 2]].every((t) => m.tile(t.x, t.y) === T.WALL);
      if (!neighborsOk) continue;
      if (pair.every((t) => m.tile(t.x, t.y) === T.WALL && m.tile(t.ix, t.iy) === T.NONE)) {
        for (const t of pair) m.set(t.x, t.y, T.WINDOW);
      }
    }
  }
}

function nearDoor(m, tx, ty) {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const t = m.tile(tx + ox, ty + oy);
      if (t === T.DOOR) return true;
      // 문 없는 개구부(벽 사이 빈칸)도 피한다
      if ((ox === 0) !== (oy === 0) && t === T.NONE) {
        const ax = tx + ox * 2;
        const ay = ty + oy * 2;
        if (m.tile(tx + ox + (oy !== 0 ? 1 : 0), ty + oy + (ox !== 0 ? 1 : 0)) === T.WALL &&
          m.tile(tx + ox - (oy !== 0 ? 1 : 0), ty + oy - (ox !== 0 ? 1 : 0)) === T.WALL && m.tile(ax, ay) === T.NONE) {
          return true;
        }
      }
    }
  }
  return false;
}

function propNeighbor(m, tx, ty) {
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const t = m.tile(tx + ox, ty + oy);
      if (t === T.PROP || t === T.CRATES || t === T.HAY) return true;
    }
  }
  return false;
}

function wallAdjacentTiles(m, room) {
  const out = [];
  for (let ty = room.y; ty < room.y + room.h; ty++) {
    for (let tx = room.x; tx < room.x + room.w; tx++) {
      if (m.tile(tx, ty) !== T.NONE) continue;
      const walls = [m.tile(tx - 1, ty), m.tile(tx + 1, ty), m.tile(tx, ty - 1), m.tile(tx, ty + 1)].filter((t) => t === T.WALL || t === T.WINDOW).length;
      if (walls >= 1) out.push({ tx, ty });
    }
  }
  return out;
}

function placeWallContainer(ctx, room, kind) {
  const { rng, m } = ctx;
  const walkable = kind === "jacket" || kind === "duffle";
  const candidates = rng.shuffle(wallAdjacentTiles(m, room));
  for (const { tx, ty } of candidates) {
    if (nearDoor(m, tx, ty) || propNeighbor(m, tx, ty)) continue;
    if (m.containers.some((c) => Math.abs(c.tx - tx) + Math.abs(c.ty - ty) < 2)) continue;
    if (!walkable) m.set(tx, ty, T.PROP);
    m.containers.push({ kind, tx, ty, x: tx * TS + TS / 2, y: ty * TS + TS / 2, walkable });
    return true;
  }
  return false;
}

function furnishRoom(ctx, room, spec, type) {
  const { rng, m } = ctx;
  m.furniture ??= [];
  if (!spec.furniture.length) return;
  if (room.hall && (type === "warehouse" || type === "boss")) {
    // 상자 더미와 기계를 열 지어 배치 (통로 확보)
    for (let row = room.y + 2; row < room.y + room.h - 3; row += 4) {
      for (let col = room.x + 2; col < room.x + room.w - 3; col += 5) {
        if (!rng.chance(0.55)) continue;
        const kind = rng.pick(spec.furniture);
        const w = kind === "shelf" ? 3 : 2;
        const h = kind === "shelf" ? 1 : 2;
        if (!areaFree(m, col, row, w, h, 1)) continue;
        if (kind === "crates") {
          for (let ty = row; ty < row + h; ty++) for (let tx = col; tx < col + w; tx++) m.set(tx, ty, T.CRATES);
        } else {
          for (let ty = row; ty < row + h; ty++) for (let tx = col; tx < col + w; tx++) m.set(tx, ty, T.PROP);
          m.furniture.push({ kind, tx: col, ty: row, w, h });
        }
      }
    }
    return;
  }
  if (type === "barn") {
    for (let i = 0; i < 4; i++) {
      const tx = rng.int(room.x + 1, room.x + room.w - 3);
      const ty = rng.int(room.y + 1, room.y + room.h - 3);
      if (areaFree(m, tx, ty, 2, 1, 1)) {
        m.set(tx, ty, T.HAY);
        m.set(tx + 1, ty, T.HAY);
      }
    }
    return;
  }
  const n = room.w * room.h > 30 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(spec.furniture);
    const [w, h] = kind === "bed" ? [2, 3] : kind === "table" ? [2, 2] : kind === "couch" ? [3, 1] : kind === "desk" ? [2, 1] : [3, 1];
    const rw = rng.chance(0.5) ? w : h;
    const rh = rw === w ? h : w;
    for (let attempt = 0; attempt < 20; attempt++) {
      const tx = rng.int(room.x, room.x + room.w - rw);
      const ty = rng.int(room.y, room.y + room.h - rh);
      // 방 가운데를 막지 않도록 벽에 붙이거나 여유를 둔다
      if (!areaFree(m, tx, ty, rw, rh, 1, true)) continue;
      if (room.w - rw < 2 || room.h - rh < 2) continue;
      for (let y = ty; y < ty + rh; y++) for (let x = tx; x < tx + rw; x++) m.set(x, y, T.PROP);
      m.furniture.push({ kind, tx, ty, w: rw, h: rh });
      break;
    }
  }
}

function areaFree(m, x, y, w, h, margin, allowWall = false) {
  for (let ty = y - margin; ty < y + h + margin; ty++) {
    for (let tx = x - margin; tx < x + w + margin; tx++) {
      const inner = tx >= x && tx < x + w && ty >= y && ty < y + h;
      const t = m.tile(tx, ty);
      if (inner) {
        if (t !== T.NONE) return false;
        if (nearDoor(m, tx, ty)) return false;
      } else if (t !== T.NONE && !(allowWall && (t === T.WALL || t === T.WINDOW))) {
        return false;
      }
    }
  }
  return true;
}

// ── 야외 ──────────────────────────────────────────────

function isFree(ctx, tx, ty) {
  const { m, reserved } = ctx;
  return m.inBounds(tx, ty) && tx >= BORDER && ty >= BORDER && tx < m.w - BORDER && ty < m.h - BORDER && m.tile(tx, ty) === T.NONE && !reserved[m.idx(tx, ty)];
}

function randomFree(ctx, margin = 0) {
  const { rng, m } = ctx;
  for (let i = 0; i < 200; i++) {
    const tx = rng.int(BORDER + 1, m.w - BORDER - 2);
    const ty = rng.int(BORDER + 1, m.h - BORDER - 2);
    let ok = true;
    for (let oy = -margin; oy <= margin && ok; oy++) for (let ox = -margin; ox <= margin && ok; ox++) if (!isFree(ctx, tx + ox, ty + oy)) ok = false;
    if (ok) return { tx, ty };
  }
  return null;
}

function blob(ctx, tile, steps, start) {
  const { rng, m } = ctx;
  let { tx, ty } = start;
  for (let i = 0; i < steps; i++) {
    if (isFree(ctx, tx, ty)) m.set(tx, ty, tile);
    const dir = rng.int(0, 3);
    tx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
    ty += dir === 2 ? 1 : dir === 3 ? -1 : 0;
  }
}

function pond(ctx) {
  const { rng, m } = ctx;
  const spot = randomFree(ctx, 4);
  if (!spot) return;
  const rx = rng.range(2.5, 5);
  const ry = rng.range(2, 3.5);
  for (let oy = -6; oy <= 6; oy++) {
    for (let ox = -7; ox <= 7; ox++) {
      const tx = spot.tx + ox;
      const ty = spot.ty + oy;
      const d = (ox / rx) ** 2 + (oy / ry) ** 2;
      if (d <= 1 && isFree(ctx, tx, ty)) {
        m.set(tx, ty, T.WATER);
        m.setFloor(tx, ty, F.DIRT);
      } else if (d <= 1.9 && m.inBounds(tx, ty) && m.tile(tx, ty) === T.NONE && !ctx.reserved[m.idx(tx, ty)]) {
        m.setFloor(tx, ty, F.DIRT);
      }
    }
  }
}

function fenceLine(ctx, tile = T.FENCE) {
  const { rng, m } = ctx;
  const spot = randomFree(ctx, 1);
  if (!spot) return;
  const horizontal = rng.chance(0.5);
  const len = rng.int(6, 14);
  const gap = rng.int(2, len - 3);
  for (let i = 0; i < len; i++) {
    if (i === gap || i === gap + 1) continue;
    const tx = spot.tx + (horizontal ? i : 0);
    const ty = spot.ty + (horizontal ? 0 : i);
    if (isFree(ctx, tx, ty)) m.set(tx, ty, tile);
  }
}

function vehicle(ctx, onRoad) {
  const { rng, m, reserved } = ctx;
  m.vehicles ??= [];
  const colors = ["#a33b32", "#3c6e9e", "#6b7d4a", "#c9b46a", "#555b63", "#e0e0d8"];
  for (let attempt = 0; attempt < 60; attempt++) {
    const horizontal = rng.chance(0.5);
    const w = horizontal ? 4 : 2;
    const h = horizontal ? 2 : 4;
    let tx;
    let ty;
    if (onRoad) {
      const road = rng.pick(ctx.roads);
      if (road.horizontal !== horizontal) continue;
      tx = rng.int(road.x + 4, road.x + road.w - w - 4);
      ty = rng.int(road.y, road.y + road.h - h);
      if (!road.horizontal) tx = rng.int(road.x, road.x + road.w - w);
      if (road.horizontal && road.h - h < 1) continue;
      if (!road.horizontal && road.w - w < 1) continue;
    } else {
      const spot = randomFree(ctx, 1);
      if (!spot) return;
      ({ tx, ty } = spot);
    }
    let ok = true;
    for (let y = ty - 1; y < ty + h + 1 && ok; y++) {
      for (let x = tx - 1; x < tx + w + 1 && ok; x++) {
        if (!m.inBounds(x, y) || m.tile(x, y) !== T.NONE) ok = false;
        else if (!onRoad && reserved[m.idx(x, y)]) ok = false;
        else if (reserved[m.idx(x, y)] === 4) ok = false;
      }
    }
    if (!ok) continue;
    if (ctx.extractSpots.some((s) => !s.special && Math.abs(s.tx - tx) < 9 && Math.abs(s.ty - ty) < 9)) continue;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) m.set(x, y, T.COVER);
    m.vehicles.push({ tx, ty, w, h, horizontal, color: rng.pick(colors), flip: rng.chance(0.5) });
    // 트렁크
    const rearX = horizontal ? (rng.chance(0.5) ? tx : tx + w - 1) : tx + rng.int(0, 1);
    const rearY = horizontal ? ty + rng.int(0, 1) : rng.chance(0.5) ? ty : ty + h - 1;
    if (rng.chance(0.6)) m.containers.push({ kind: "trunk", tx: rearX, ty: rearY, x: rearX * TS + TS / 2, y: rearY * TS + TS / 2, walkable: false, onVehicle: true });
    return;
  }
}

function crateCluster(ctx) {
  const { rng, m } = ctx;
  const spot = randomFree(ctx, 2);
  if (!spot) return;
  const w = rng.int(1, 3);
  const h = rng.int(1, 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isFree(ctx, spot.tx + x, spot.ty + y)) m.set(spot.tx + x, spot.ty + y, T.CRATES);
  // 옆에 열 수 있는 상자
  const cx = spot.tx + w;
  const cy = spot.ty;
  if (rng.chance(0.6) && isFree(ctx, cx, cy) && !propNeighbor(m, cx + 1, cy)) {
    m.set(cx, cy, T.PROP);
    m.containers.push({ kind: rng.chance(0.85) ? "crate" : "weaponbox", tx: cx, ty: cy, x: cx * TS + TS / 2, y: cy * TS + TS / 2, walkable: false });
  }
}

function shippingContainer(ctx) {
  const { rng, m } = ctx;
  m.shipping ??= [];
  const colors = ["#b5452f", "#2f6f9e", "#3d7a46", "#c28a2c", "#6d4f8c", "#8a8f96"];
  for (let attempt = 0; attempt < 40; attempt++) {
    const horizontal = rng.chance(0.5);
    const w = horizontal ? 5 : 2;
    const h = horizontal ? 2 : 5;
    const spot = randomFree(ctx, 0);
    if (!spot) return;
    let ok = true;
    for (let y = spot.ty - 1; y < spot.ty + h + 1 && ok; y++) for (let x = spot.tx - 1; x < spot.tx + w + 1 && ok; x++) if (!isFree(ctx, x, y)) ok = false;
    if (!ok) continue;
    for (let y = spot.ty; y < spot.ty + h; y++) for (let x = spot.tx; x < spot.tx + w; x++) m.set(x, y, T.CONTAINER);
    m.shipping.push({ tx: spot.tx, ty: spot.ty, w, h, horizontal, color: rng.pick(colors) });
    return;
  }
}

function farmOutdoor(ctx) {
  const { rng } = ctx;
  for (let i = 0; i < 3; i++) pond(ctx);
  for (let i = 0; i < 26; i++) {
    const spot = randomFree(ctx, 1);
    if (spot) blob(ctx, rng.chance(0.85) ? T.TREE : T.ROCK, rng.int(4, 16), spot);
  }
  for (let i = 0; i < 40; i++) {
    const spot = randomFree(ctx, 1);
    if (spot) ctx.m.set(spot.tx, spot.ty, rng.chance(0.75) ? T.TREE : T.ROCK);
  }
  for (let i = 0; i < 9; i++) fenceLine(ctx);
  for (let i = 0; i < 10; i++) {
    const spot = randomFree(ctx, 1);
    if (spot) {
      ctx.m.set(spot.tx, spot.ty, T.HAY);
      if (rng.chance(0.5) && isFree(ctx, spot.tx + 1, spot.ty)) ctx.m.set(spot.tx + 1, spot.ty, T.HAY);
    }
  }
  for (let i = 0; i < 6; i++) crateCluster(ctx);
  for (let i = 0; i < 4; i++) vehicle(ctx, true);
  for (let i = 0; i < 3; i++) vehicle(ctx, false);
}

function industrialOutdoor(ctx) {
  const { rng } = ctx;
  for (let i = 0; i < 22; i++) shippingContainer(ctx);
  for (let i = 0; i < 14; i++) crateCluster(ctx);
  for (let i = 0; i < 10; i++) fenceLine(ctx, rng.chance(0.5) ? T.FENCE : T.COVER);
  for (let i = 0; i < 6; i++) vehicle(ctx, true);
  for (let i = 0; i < 4; i++) vehicle(ctx, false);
  for (let i = 0; i < 12; i++) {
    const spot = randomFree(ctx, 1);
    if (spot) blob(ctx, T.TREE, rng.int(2, 6), spot);
  }
}

function outdoorLoot(ctx) {
  const { rng, m } = ctx;
  const n = ctx.def.theme === "farm" ? 10 : 12;
  for (let i = 0; i < n; i++) {
    const spot = randomFree(ctx, 1);
    if (!spot) continue;
    const kind = rng.weighted([["jacket", 3], ["duffle", 2], ["crate", 2]]);
    const walkable = kind !== "crate";
    if (!walkable) m.set(spot.tx, spot.ty, T.PROP);
    m.containers.push({ kind, tx: spot.tx, ty: spot.ty, x: spot.tx * TS + TS / 2, y: spot.ty * TS + TS / 2, walkable });
  }
}

// ── 연결성 ────────────────────────────────────────────

function passable(m, tx, ty) {
  return m.isWalkableForAI(tx, ty);
}

function flood(m, sx, sy, list = null) {
  const seen = new Uint8Array(m.w * m.h);
  const queue = [sy * m.w + sx];
  seen[queue[0]] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = i % m.w;
    const y = (i - x) / m.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!m.inBounds(nx, ny)) continue;
      const ni = ny * m.w + nx;
      if (seen[ni] || !passable(m, nx, ny)) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  if (list) list.push(...queue);
  return seen;
}

function ensureConnectivity(ctx) {
  const { m } = ctx;
  const road = ctx.roads[0];
  const sx = Math.floor(road.x + road.w / 2);
  const sy = Math.floor(road.y + road.h / 2);
  for (let pass = 0; pass < 150; pass++) {
    const seen = flood(m, sx, sy);
    // 도달 불가능한 통행 가능 칸 찾기
    let target = -1;
    for (let i = 0; i < m.w * m.h; i++) {
      const x = i % m.w;
      const y = (i - x) / m.w;
      if (x < BORDER || y < BORDER || x >= m.w - BORDER || y >= m.h - BORDER) continue;
      if (!seen[i] && passable(m, x, y)) {
        target = i;
        break;
      }
    }
    if (target < 0) break;
    const region = [];
    flood(m, target % m.w, Math.floor(target / m.w), region);
    const hasContainer = m.containers.some((c) => {
      for (const i of region) {
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        if (Math.abs(c.tx - x) <= 1 && Math.abs(c.ty - y) <= 1) return true;
      }
      return false;
    });
    if (region.length < 6 && !hasContainer) {
      // 작은 고립 공간은 주변 장애물로 메운다
      for (const i of region) {
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        let fill = m.theme === "farm" ? T.TREE : T.CRATES;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = m.tile(x + dx, y + dy);
          if (t !== T.NONE && t !== T.DOOR && t !== T.PROP) {
            fill = t;
            break;
          }
        }
        m.tiles[i] = fill;
      }
      continue;
    }
    carvePath(ctx, target, seen);
  }
  ctx.reachable = flood(m, sx, sy);
}

function carvePath(ctx, start, seen) {
  const { m } = ctx;
  const prev = new Int32Array(m.w * m.h).fill(-1);
  const visited = new Uint8Array(m.w * m.h);
  const queue = [start];
  visited[start] = 1;
  let found = -1;
  for (let qi = 0; qi < queue.length && found < 0; qi++) {
    const i = queue[qi];
    const x = i % m.w;
    const y = (i - x) / m.w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < BORDER || ny < BORDER || nx >= m.w - BORDER || ny >= m.h - BORDER) continue;
      const ni = ny * m.w + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      prev[ni] = i;
      if (seen[ni]) {
        found = ni;
        break;
      }
      queue.push(ni);
    }
  }
  if (found < 0) {
    // 연결 불가: 해당 칸을 막는다
    m.tiles[start] = T.TREE;
    return;
  }
  let i = prev[found];
  while (i >= 0 && i !== start) {
    clearForPath(ctx, i);
    i = prev[i];
  }
  clearForPath(ctx, start);
}

function clearForPath(ctx, i) {
  const { m } = ctx;
  const t = m.tiles[i];
  if (passable(m, i % m.w, Math.floor(i / m.w))) return;
  if (t === T.WALL || t === T.WINDOW) {
    m.tiles[i] = T.DOOR;
    m.doorOpen[i] = 1;
  } else {
    m.tiles[i] = T.NONE;
  }
  const tx = i % m.w;
  const ty = Math.floor(i / m.w);
  m.containers = m.containers.filter((c) => !(c.tx === tx && c.ty === ty));
  if (m.furniture) m.furniture = m.furniture.filter((f) => !(tx >= f.tx && tx < f.tx + f.w && ty >= f.ty && ty < f.ty + f.h));
}

function pruneContainers(ctx) {
  const { m, reachable } = ctx;
  m.containers = m.containers.filter((c) => {
    if (c.walkable) return reachable[m.idx(c.tx, c.ty)];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = c.tx + ox;
        const ty = c.ty + oy;
        if (m.inBounds(tx, ty) && reachable[m.idx(tx, ty)]) return true;
      }
    }
    // 접근 불가 상자는 바닥으로 되돌림
    if (m.tile(c.tx, c.ty) === T.PROP) m.set(c.tx, c.ty, T.NONE);
    return false;
  });
  // 가구에 깔린 상자 PROP 타일이 고립되어 남지 않도록 정리
  m.containers.forEach((c, i) => {
    c.id = `c${i}`;
  });
}

// ── 잠긴 방 ────────────────────────────────────────────

/** 문이 하나뿐인 방을 골라 잠그고, 좋은 상자를 넣는다. 별도 시드라 기존 지형은 그대로다 */
function lockRooms(ctx) {
  const { m, def } = ctx;
  const want = def.lockedRooms ?? 0;
  if (!want || !def.lock) return;
  const rng = new Rng((def.seed ^ 0x5eed1234) >>> 0);
  const lctx = { ...ctx, rng };
  const candidates = [];
  for (const b of m.buildings) {
    for (const room of b.rooms) {
      if (room.hall) continue;
      const area = room.w * room.h;
      if (area < 9 || area > 70) continue;
      const openings = [];
      const check = (x, y) => {
        const t = m.tile(x, y);
        if (t === T.NONE || t === T.DOOR) openings.push({ tx: x, ty: y, t });
      };
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        check(x, room.y - 1);
        check(x, room.y + room.h);
      }
      for (let y = room.y; y < room.y + room.h; y++) {
        check(room.x - 1, y);
        check(room.x + room.w, y);
      }
      if (openings.length === 1 && openings[0].t === T.DOOR) candidates.push({ b, room, door: openings[0] });
    }
  }
  rng.shuffle(candidates);
  const picked = [];
  // 가능하면 서로 다른 건물에서
  for (const c of candidates) if (picked.length < want && !picked.some((p) => p.b === c.b)) picked.push(c);
  for (const c of candidates) if (picked.length < want && !picked.includes(c)) picked.push(c);

  for (const { b, room, door } of picked) {
    const i = m.idx(door.tx, door.ty);
    m.locked[i] = 1;
    m.doorOpen[i] = 0;
    room.locked = true;
    m.lockedRooms.push({ x: room.x, y: room.y, w: room.w, h: room.h, door: { tx: door.tx, ty: door.ty }, label: b.label });
    const inside = (c) => c.tx >= room.x && c.tx < room.x + room.w && c.ty >= room.y && c.ty < room.y + room.h;
    let n = m.containers.filter(inside).length;
    for (let k = 0; n < 2 && k < 6; k++) {
      if (placeWallContainer(lctx, room, rng.pick(["safe", "weaponbox", "medcab"]))) n += 1;
    }
    for (const c of m.containers) if (inside(c)) c.locked = true;
  }
  m.containers.forEach((c, idx) => {
    c.id = `c${idx}`;
  });
}

function inLockedRoom(m, tx, ty) {
  return m.lockedRooms.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
}

function finalizeExtracts(ctx) {
  const { m, rng, reachable } = ctx;
  for (const spot of ctx.extractSpots) {
    let tx = spot.tx;
    let ty = spot.ty;
    if (spot.special === "manhole") {
      // 도달 가능한 야외 칸 중 하나
      for (let i = 0; i < 500; i++) {
        const x = rng.int(BORDER + 6, m.w - BORDER - 7);
        const y = rng.int(Math.floor(m.h * 0.55), m.h - BORDER - 6);
        if (reachable[m.idx(x, y)] && m.tile(x, y) === T.NONE && !m.buildings.some((b) => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h)) {
          tx = x;
          ty = y;
          break;
        }
      }
    }
    const open = m.nearestOpen(tx * TS + TS / 2, ty * TS + TS / 2, 5);
    if (!open) continue;
    m.extracts.push({ id: `x${m.extracts.length}`, name: spot.name, x: open.x, y: open.y, r: 75, special: spot.special ?? null });
  }
}

function spawnPoints(ctx) {
  const { m, rng, reachable } = ctx;
  const inBuilding = (tx, ty) => m.buildings.some((b) => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h);
  const openTile = (tx, ty) => m.inBounds(tx, ty) && reachable[m.idx(tx, ty)] && m.tile(tx, ty) === T.NONE && !inLockedRoom(m, tx, ty);

  // 플레이어 스폰: 가장자리 근처 야외
  const edgeCandidates = [];
  for (let i = 0; i < 4000 && edgeCandidates.length < 40; i++) {
    const side = rng.int(0, 3);
    const depth = rng.int(BORDER + 2, BORDER + 7);
    const tx = side === 2 ? depth : side === 3 ? m.w - 1 - depth : rng.int(BORDER + 2, m.w - BORDER - 3);
    const ty = side === 0 ? depth : side === 1 ? m.h - 1 - depth : rng.int(BORDER + 2, m.h - BORDER - 3);
    if (!openTile(tx, ty) || inBuilding(tx, ty)) continue;
    if (m.extracts.some((x) => Math.hypot(x.x - tx * TS, x.y - ty * TS) < 600)) continue;
    if (edgeCandidates.some((c) => Math.hypot(c.x - tx * TS, c.y - ty * TS) < 500)) continue;
    edgeCandidates.push({ x: tx * TS + TS / 2, y: ty * TS + TS / 2 });
  }
  m.playerSpawns = edgeCandidates;

  // 적 스폰: 건물 방 중심 + 야외 랜덤
  const enemy = [];
  for (const b of m.buildings) {
    for (const room of b.rooms) {
      if (room.locked) continue;
      const cx = Math.floor(room.x + room.w / 2);
      const cy = Math.floor(room.y + room.h / 2);
      const p = m.nearestOpen(cx * TS + TS / 2, cy * TS + TS / 2, 3);
      if (p && reachable[m.idx(Math.floor(p.x / TS), Math.floor(p.y / TS))] && !inLockedRoom(m, Math.floor(p.x / TS), Math.floor(p.y / TS))) {
        enemy.push({ ...p, building: b.label, boss: !!b.boss });
      }
    }
  }
  for (let i = 0; i < 3000 && enemy.length < 70; i++) {
    const tx = rng.int(BORDER + 3, m.w - BORDER - 4);
    const ty = rng.int(BORDER + 3, m.h - BORDER - 4);
    if (!openTile(tx, ty)) continue;
    if (enemy.some((e) => Math.hypot(e.x - tx * TS, e.y - ty * TS) < 260)) continue;
    enemy.push({ x: tx * TS + TS / 2, y: ty * TS + TS / 2 });
  }
  m.enemySpawns = enemy;

  const bossB = m.buildings.find((b) => b.boss);
  if (bossB) {
    const hall = bossB.rooms.find((r) => r.hall) ?? bossB.rooms[0];
    m.bossSpawn = m.nearestOpen((hall.x + hall.w / 2) * TS, (hall.y + hall.h / 2) * TS, 5);
    m.bossRect = { x: bossB.x * TS, y: bossB.y * TS, w: bossB.w * TS, h: bossB.h * TS };
  }

  m.labels = m.buildings.map((b) => ({ text: b.label, x: (b.x + b.w / 2) * TS, y: (b.y + b.h / 2) * TS }));
}
