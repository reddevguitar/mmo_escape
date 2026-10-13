// 타일 맵: 충돌, 시야/탄도 레이캐스트

export const TS = 40; // 타일 크기 (월드 단위)

// 블록 타입
export const T = {
  NONE: 0,
  WALL: 1,
  TREE: 2,
  ROCK: 3,
  COVER: 4, // 모래주머니/낮은 벽: 이동·총알 차단, 시야 통과
  FENCE: 5, // 철망: 이동 차단, 시야·총알 통과
  WINDOW: 6, // 창문: 이동 차단, 시야·총알 통과
  WATER: 7, // 물: 이동 차단, 시야·총알 통과
  DOOR: 8, // 문: 닫히면 전부 차단
  PROP: 9, // 컨테이너/가구: 이동·총알 차단, 시야 통과
  CRATES: 10, // 쌓인 상자 (COVER와 동일 규칙, 그림만 다름)
  CONTAINER: 11, // 선적 컨테이너 (WALL과 동일 규칙)
  HAY: 12, // 건초더미 (COVER 규칙)
};

// 바닥 타입
export const F = {
  GRASS: 0,
  DIRT: 1,
  ROAD: 2,
  CONCRETE: 3,
  WOOD: 4,
  TILE: 5,
  GRAVEL: 6,
  ASPHALT: 7,
};

const SOLID = new Uint8Array(16);
const OPAQUE = new Uint8Array(16);
const BULLET = new Uint8Array(16);
for (const t of [T.WALL, T.TREE, T.ROCK, T.COVER, T.FENCE, T.WINDOW, T.WATER, T.PROP, T.CRATES, T.CONTAINER, T.HAY]) SOLID[t] = 1;
for (const t of [T.WALL, T.TREE, T.ROCK, T.CONTAINER]) OPAQUE[t] = 1;
for (const t of [T.WALL, T.TREE, T.ROCK, T.COVER, T.PROP, T.CRATES, T.CONTAINER, T.HAY]) BULLET[t] = 1;
// 낮은 엄폐물: 붙어 있는 사수는 넘겨 쏠 수 있다
const LOW = new Uint8Array(16);
for (const t of [T.COVER, T.PROP, T.HAY]) LOW[t] = 1;
const LOW_REACH = 34;

export class GameMap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.floor = new Uint8Array(w * h);
    this.doorOpen = new Uint8Array(w * h);
    this.shade = new Uint8Array(w * h);
    this.explored = new Uint8Array(w * h);
    this.buildings = [];
    this.extracts = [];
    this.containers = [];
    this.playerSpawns = [];
    this.enemySpawns = [];
    this.bossSpawn = null;
    this.labels = [];
    this.furniture = [];
    this.vehicles = [];
    this.shipping = [];
    this.version = 0; // 문 상태가 바뀌면 증가
  }

  idx(tx, ty) {
    return ty * this.w + tx;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  tile(tx, ty) {
    if (!this.inBounds(tx, ty)) return T.WALL;
    return this.tiles[ty * this.w + tx];
  }

  set(tx, ty, t) {
    if (this.inBounds(tx, ty)) this.tiles[ty * this.w + tx] = t;
  }

  setFloor(tx, ty, f) {
    if (this.inBounds(tx, ty)) this.floor[ty * this.w + tx] = f;
  }

  isSolid(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.w + tx;
    const t = this.tiles[i];
    if (t === T.DOOR) return this.doorOpen[i] === 0;
    return SOLID[t] === 1;
  }

  isOpaque(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.w + tx;
    const t = this.tiles[i];
    if (t === T.DOOR) return this.doorOpen[i] === 0;
    return OPAQUE[t] === 1;
  }

  blocksBullet(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.w + tx;
    const t = this.tiles[i];
    if (t === T.DOOR) return this.doorOpen[i] === 0;
    return BULLET[t] === 1;
  }

  /** AI 경로용: 닫힌 문은 열고 지나갈 수 있으므로 통과 가능 */
  isWalkableForAI(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const t = this.tiles[ty * this.w + tx];
    if (t === T.DOOR) return true;
    return SOLID[t] === 0;
  }

  isDoor(tx, ty) {
    return this.tile(tx, ty) === T.DOOR;
  }

  toggleDoor(tx, ty) {
    if (!this.isDoor(tx, ty)) return false;
    const i = this.idx(tx, ty);
    this.doorOpen[i] = this.doorOpen[i] ? 0 : 1;
    this.version += 1;
    return true;
  }

  openDoor(tx, ty) {
    if (!this.isDoor(tx, ty)) return false;
    const i = this.idx(tx, ty);
    if (this.doorOpen[i]) return false;
    this.doorOpen[i] = 1;
    this.version += 1;
    return true;
  }

  solidAtWorld(x, y) {
    return this.isSolid(Math.floor(x / TS), Math.floor(y / TS));
  }

  /** 원(x,y,r)을 벽 밖으로 밀어낸다. 보정된 좌표 반환 */
  resolveCircle(x, y, r) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const minX = Math.floor((x - r) / TS);
      const maxX = Math.floor((x + r) / TS);
      const minY = Math.floor((y - r) / TS);
      const maxY = Math.floor((y + r) / TS);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (!this.isSolid(tx, ty)) continue;
          const rx = tx * TS;
          const ry = ty * TS;
          const cx = Math.max(rx, Math.min(x, rx + TS));
          const cy = Math.max(ry, Math.min(y, ry + TS));
          let dx = x - cx;
          let dy = y - cy;
          let d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 < 1e-6) {
            // 중심이 타일 안: 가장 가까운 면으로 밀어냄
            // 비어 있는 이웃 방향 중 가장 가까운 면으로 밀어낸다
            const faces = [
              [x - rx, tx - 1, ty, () => (x = rx - r)],
              [rx + TS - x, tx + 1, ty, () => (x = rx + TS + r)],
              [y - ry, tx, ty - 1, () => (y = ry - r)],
              [ry + TS - y, tx, ty + 1, () => (y = ry + TS + r)],
            ];
            const open = faces.filter((f) => !this.isSolid(f[1], f[2]));
            const pool = open.length ? open : faces;
            pool.sort((a, b) => a[0] - b[0]);
            pool[0][3]();
          } else {
            const d = Math.sqrt(d2);
            const push = r - d;
            x += (dx / d) * push;
            y += (dy / d) * push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, y };
  }

  circleBlocked(x, y, r) {
    const minX = Math.floor((x - r) / TS);
    const maxX = Math.floor((x + r) / TS);
    const minY = Math.floor((y - r) / TS);
    const maxY = Math.floor((y + r) / TS);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!this.isSolid(tx, ty)) continue;
        const cx = Math.max(tx * TS, Math.min(x, tx * TS + TS));
        const cy = Math.max(ty * TS, Math.min(y, ty * TS + TS));
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  /**
   * DDA 레이캐스트. mode: "sight" | "bullet"
   * 반환: 막히기까지의 거리 (maxDist 이하), 그리고 막은 타일 좌표
   */
  raycast(x0, y0, dx, dy, maxDist, mode = "sight", out = null) {
    const blocks = mode === "bullet" ? this.blocksBullet : this.isOpaque;
    let tx = Math.floor(x0 / TS);
    let ty = Math.floor(y0 / TS);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const invDx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const invDy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TS - x0) * invDx : dx < 0 ? (x0 - tx * TS) * invDx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TS - y0) * invDy : dy < 0 ? (y0 - ty * TS) * invDy : Infinity;
    const tDeltaX = TS * invDx;
    const tDeltaY = TS * invDy;
    let t = 0;
    while (t <= maxDist) {
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        ty += stepY;
      }
      if (t > maxDist) break;
      if (blocks.call(this, tx, ty)) {
        if (out) {
          out.tx = tx;
          out.ty = ty;
        }
        return t;
      }
    }
    if (out) {
      out.tx = -1;
      out.ty = -1;
    }
    return maxDist;
  }

  /**
   * 총알 레이캐스트. 낮은 엄폐물(모래주머니/차량/가구/건초)은
   * 사수(ox, oy)가 바로 붙어 있으면 넘겨 쏠 수 있다.
   */
  bulletCast(x0, y0, dx, dy, maxDist, ox, oy, out = null) {
    let tx = Math.floor(x0 / TS);
    let ty = Math.floor(y0 / TS);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const invDx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const invDy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tMaxX = dx > 0 ? ((tx + 1) * TS - x0) * invDx : dx < 0 ? (x0 - tx * TS) * invDx : Infinity;
    let tMaxY = dy > 0 ? ((ty + 1) * TS - y0) * invDy : dy < 0 ? (y0 - ty * TS) * invDy : Infinity;
    const tDeltaX = TS * invDx;
    const tDeltaY = TS * invDy;
    let t = 0;
    while (t <= maxDist) {
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        ty += stepY;
      }
      if (t > maxDist) break;
      if (!this.blocksBullet(tx, ty)) continue;
      if (LOW[this.tile(tx, ty)]) {
        const cx = Math.max(tx * TS, Math.min(ox, tx * TS + TS));
        const cy = Math.max(ty * TS, Math.min(oy, ty * TS + TS));
        if ((cx - ox) ** 2 + (cy - oy) ** 2 < LOW_REACH * LOW_REACH) continue;
      }
      if (out) {
        out.tx = tx;
        out.ty = ty;
      }
      return t;
    }
    if (out) {
      out.tx = -1;
      out.ty = -1;
    }
    return maxDist;
  }

  /** (x0,y0)에서 쏜 총알이 (x1,y1)까지 막힘 없이 가는가 */
  shotClear(x0, y0, x1, y1, margin = 0) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    return this.bulletCast(x0, y0, dx / d, dy / d, d, x0, y0) >= d - margin - 0.5;
  }

  lineClear(x0, y0, x1, y1, mode = "sight") {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 1) return true;
    // 시작 타일이 막혀 있으면(문 위 등) 무시하고 진행
    return this.raycast(x0, y0, dx / d, dy / d, d, mode) >= d - 0.5;
  }

  /** 근처의 걸을 수 있는 타일 중심 좌표 */
  nearestOpen(x, y, maxRadius = 6) {
    const cx = Math.floor(x / TS);
    const cy = Math.floor(y / TS);
    for (let r = 0; r <= maxRadius; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const tx = cx + ox;
          const ty = cy + oy;
          if (this.inBounds(tx, ty) && !this.isSolid(tx, ty) && this.tile(tx, ty) !== T.DOOR) {
            return { x: tx * TS + TS / 2, y: ty * TS + TS / 2 };
          }
        }
      }
    }
    return null;
  }

  markExplored(x, y, radiusTiles) {
    const cx = Math.floor(x / TS);
    const cy = Math.floor(y / TS);
    const r = radiusTiles;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (!this.inBounds(tx, ty)) continue;
        if ((tx - cx) ** 2 + (ty - cy) ** 2 > r * r) continue;
        this.explored[ty * this.w + tx] = 1;
      }
    }
  }
}
