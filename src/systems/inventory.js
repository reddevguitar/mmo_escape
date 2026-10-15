// 타르코브식 그리드 인벤토리 로직 (DOM과 무관한 순수 로직)
//
// grid  = { w, h, items: [item], only1x1?, noNest?, kind? }
// item  = { uid, id, count, x, y, rot, data }
// 위치(location):
//   { type: "grid", grid, x?, y?, rot? }
//   { type: "slot", equip, slot }
//   { type: "merge", grid, target }   같은 아이템 스택에 합치기

import { ITEMS } from "../data/items.js";
import { uid } from "../core/util.js";

export const SLOT_TYPES = {
  primary: "weapon",
  secondary: "weapon",
  helmet: "helmet",
  armor: "armor",
  backpack: "backpack",
};

export const SLOT_NAMES = {
  primary: "주무기",
  secondary: "보조무기",
  helmet: "헬멧",
  armor: "방탄복",
  backpack: "가방",
};

export function makeGrid(w, h, flags = {}) {
  return { w, h, items: [], ...flags };
}

export function makeItem(id, count = 1, data = {}) {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item ${id}`);
  const item = { uid: uid(), id, count: Math.max(1, Math.min(count, def.stack)), x: 0, y: 0, rot: false, data: {} };
  if (def.type === "weapon") item.data = { mag: 0, ammoId: null };
  if (def.type === "armor" || def.type === "helmet") item.data = { dur: def.dur };
  if (def.type === "med" && def.pool) item.data = { uses: def.uses };
  if (def.type === "backpack") item.data = { grid: makeGrid(def.gw, def.gh, { noNest: true, kind: "backpack" }) };
  Object.assign(item.data, data);
  return item;
}

/** count가 스택 한도를 넘으면 여러 스택으로 쪼개서 반환 */
export function makeStacks(id, total) {
  const def = ITEMS[id];
  const out = [];
  let left = Math.max(1, total);
  while (left > 0) {
    const n = Math.min(def.stack, left);
    out.push(makeItem(id, n));
    left -= n;
  }
  return out;
}

export function dims(item, rot = item.rot) {
  const def = ITEMS[item.id];
  return rot ? [def.h, def.w] : [def.w, def.h];
}

/** 크기와 무관한 규칙 (주머니 1x1 제한, 가방 중첩 금지 등) */
export function fitsRules(grid, item) {
  const def = ITEMS[item.id];
  if (grid.only1x1 && (def.w !== 1 || def.h !== 1)) return false;
  if (def.type === "backpack") {
    if (item.data?.grid === grid) return false;
    if (grid.noNest && item.data?.grid?.items.length > 0) return false;
  }
  return true;
}

export function canPlace(grid, item, x, y, rot, ignoreUid = item.uid) {
  if (!fitsRules(grid, item)) return false;
  const [w, h] = dims(item, rot);
  if (x < 0 || y < 0 || x + w > grid.w || y + h > grid.h) return false;
  for (const other of grid.items) {
    if (other.uid === ignoreUid) continue;
    const [ow, oh] = dims(other);
    if (x < other.x + ow && x + w > other.x && y < other.y + oh && y + h > other.y) return false;
  }
  return true;
}

export function occupantAt(grid, cx, cy) {
  for (const item of grid.items) {
    const [w, h] = dims(item);
    if (cx >= item.x && cx < item.x + w && cy >= item.y && cy < item.y + h) return item;
  }
  return null;
}

export function placeAt(grid, item, x, y, rot) {
  item.x = x;
  item.y = y;
  item.rot = rot;
  if (!grid.items.includes(item)) grid.items.push(item);
}

export function removeItem(grid, item) {
  const i = grid.items.indexOf(item);
  if (i >= 0) grid.items.splice(i, 1);
  return i >= 0;
}

export function findSpot(grid, item) {
  if (!fitsRules(grid, item)) return null;
  const def = ITEMS[item.id];
  const rots = def.w === def.h ? [false] : [false, true];
  for (const rot of rots) {
    const [w, h] = dims(item, rot);
    for (let y = 0; y <= grid.h - h; y++) {
      for (let x = 0; x <= grid.w - w; x++) {
        if (canPlace(grid, item, x, y, rot)) return { x, y, rot };
      }
    }
  }
  return null;
}

/** 같은 아이템 스택에 최대한 합치고 남은 수량을 반환 */
export function stackInto(grid, item) {
  const def = ITEMS[item.id];
  if (def.stack <= 1) return item.count;
  for (const other of grid.items) {
    if (other === item || other.id !== item.id || other.count >= def.stack) continue;
    if (grid.seen && !grid.seen.has(other.uid)) continue; // 아직 수색 안 된 스택
    const move = Math.min(def.stack - other.count, item.count);
    other.count += move;
    item.count -= move;
    if (item.count <= 0) return 0;
  }
  return item.count;
}

/** 그리드에 아이템 추가. 완전히 들어가면 true. (일부만 스택된 경우 item.count가 줄어든 채 false) */
export function addItem(grid, item, { stack = true } = {}) {
  if (stack && stackInto(grid, item) <= 0) return true;
  const spot = findSpot(grid, item);
  if (!spot) return false;
  placeAt(grid, item, spot.x, spot.y, spot.rot);
  return true;
}

/** 여러 그리드에 순서대로 시도 */
export function addToGrids(grids, item) {
  for (const grid of grids) {
    if (!grid) continue;
    if (addItem(grid, item)) return true;
  }
  return false;
}

export function forEachItemDeep(grid, fn) {
  for (const item of [...grid.items]) {
    fn(item, grid);
    if (ITEMS[item.id].type === "backpack" && item.data?.grid) forEachItemDeep(item.data.grid, fn);
  }
}

export function countItem(grids, id) {
  let total = 0;
  for (const grid of grids) {
    if (!grid) continue;
    forEachItemDeep(grid, (item) => {
      if (item.id === id) total += item.count;
    });
  }
  return total;
}

/** 그리드들에서 id 아이템을 n개 꺼내 제거. 실제로 꺼낸 개수를 반환 */
export function takeItem(grids, id, n) {
  let need = n;
  for (const grid of grids) {
    if (!grid || need <= 0) continue;
    forEachItemDeep(grid, (item, owner) => {
      if (need <= 0 || item.id !== id) return;
      const take = Math.min(item.count, need);
      item.count -= take;
      need -= take;
      if (item.count <= 0) removeItem(owner, item);
    });
  }
  return n - need;
}

export function slotAccepts(slot, item) {
  return ITEMS[item.id]?.type === SLOT_TYPES[slot];
}

function detach(item, from) {
  if (from.type === "grid") removeItem(from.grid, item);
  else if (from.type === "slot") from.equip[from.slot] = null;
}

function reattach(item, from, pos) {
  if (from.type === "grid") placeAt(from.grid, item, pos.x, pos.y, pos.rot);
  else if (from.type === "slot") from.equip[from.slot] = item;
}

const ok = { ok: true };
const fail = (msg) => ({ ok: false, msg });

export function moveItem(item, from, to) {
  const orig = { x: item.x, y: item.y, rot: item.rot };
  const def = ITEMS[item.id];

  if (to.type === "merge") {
    const target = to.target;
    if (target === item || target.id !== item.id || def.stack <= 1) return fail("합칠 수 없습니다");
    const space = def.stack - target.count;
    if (space <= 0) return fail("스택이 가득 찼습니다");
    const n = Math.min(space, item.count);
    target.count += n;
    item.count -= n;
    if (item.count <= 0) detach(item, from);
    return ok;
  }

  if (to.type === "grid") {
    if (!fitsRules(to.grid, item)) {
      if (to.grid.only1x1) return fail("주머니에는 1칸짜리만 들어갑니다");
      return fail("내용물이 든 가방은 넣을 수 없습니다");
    }
    if (!canPlace(to.grid, item, to.x, to.y, to.rot)) return fail("공간이 부족합니다");
    detach(item, from);
    placeAt(to.grid, item, to.x, to.y, to.rot);
    return ok;
  }

  if (to.type === "slot") {
    if (!slotAccepts(to.slot, item)) return fail("이 슬롯에는 장착할 수 없습니다");
    const existing = to.equip[to.slot];
    if (existing === item) return ok;
    detach(item, from);
    to.equip[to.slot] = item;
    if (!existing) return ok;

    // 교체: 기존 장비를 원래 자리로 보낸다
    if (from.type === "slot") {
      if (slotAccepts(from.slot, existing)) {
        from.equip[from.slot] = existing;
        return { ok: true, displaced: existing };
      }
    } else if (from.type === "grid" && fitsRules(from.grid, existing)) {
      const tries = [
        [orig.x, orig.y, false],
        [orig.x, orig.y, true],
      ];
      for (const [x, y, rot] of tries) {
        if (canPlace(from.grid, existing, x, y, rot)) {
          placeAt(from.grid, existing, x, y, rot);
          return { ok: true, displaced: existing };
        }
      }
      const spot = findSpot(from.grid, existing);
      if (spot) {
        placeAt(from.grid, existing, spot.x, spot.y, spot.rot);
        return { ok: true, displaced: existing };
      }
    }
    to.equip[to.slot] = existing;
    reattach(item, from, orig);
    return fail("교체할 공간이 부족합니다");
  }

  return fail("이동할 수 없습니다");
}

/** 스택 나누기: 절반을 같은 그리드의 빈 자리에 새 스택으로. 새 조각을 반환 (실패 시 null) */
export function splitStack(grid, item) {
  if (item.count < 2) return null;
  const half = Math.floor(item.count / 2);
  const piece = makeItem(item.id, half);
  const spot = findSpot(grid, piece);
  if (!spot) return null;
  item.count -= half;
  placeAt(grid, piece, spot.x, spot.y, spot.rot);
  grid.seen?.add(piece.uid);
  return piece;
}

/** 큰 아이템부터 다시 채워 넣어 정리. 실패하면 원상복구 */
export function sortGrid(grid) {
  const backup = grid.items.map((item) => ({ item, x: item.x, y: item.y, rot: item.rot, count: item.count }));
  const items = [...grid.items].sort((a, b) => {
    const da = ITEMS[a.id];
    const db = ITEMS[b.id];
    return db.w * db.h - da.w * da.h || da.type.localeCompare(db.type) || a.id.localeCompare(b.id);
  });
  grid.items = [];
  for (const item of items) {
    item.rot = false;
    if (!addItem(grid, item)) {
      grid.items = [];
      for (const b of backup) {
        b.item.x = b.x;
        b.item.y = b.y;
        b.item.rot = b.rot;
        b.item.count = b.count;
        grid.items.push(b.item);
      }
      return false;
    }
  }
  grid.items = grid.items.filter((item) => item.count > 0);
  return true;
}

export function itemWeight(item) {
  const def = ITEMS[item.id];
  let w = def.weight * item.count;
  if (def.type === "weapon" && item.data?.mag && item.data.ammoId) w += ITEMS[item.data.ammoId].weight * item.data.mag;
  if (def.type === "backpack" && item.data?.grid) w += gridWeight(item.data.grid);
  return w;
}

export function gridWeight(grid) {
  let w = 0;
  for (const item of grid.items) w += itemWeight(item);
  return w;
}

export function gridValue(grid, priceFn) {
  let v = 0;
  forEachItemDeep(grid, (item) => {
    v += priceFn(item);
  });
  return v;
}

/** 탄약 스택을 무기에 장전. 장전한 수를 반환. 다른 탄종이 들어있으면 0 */
export function loadAmmo(weapon, ammo) {
  const wdef = ITEMS[weapon.id];
  const adef = ITEMS[ammo.id];
  if (wdef.type !== "weapon" || adef.type !== "ammo" || adef.caliber !== wdef.caliber) return 0;
  if (weapon.data.mag > 0 && weapon.data.ammoId !== ammo.id) return 0;
  const n = Math.min(wdef.mag - weapon.data.mag, ammo.count);
  if (n <= 0) return 0;
  weapon.data.mag += n;
  weapon.data.ammoId = ammo.id;
  ammo.count -= n;
  return n;
}

/** 무기에서 탄을 빼서 탄약 아이템 배열로 반환 */
export function unloadWeapon(weapon) {
  if (!weapon.data?.mag || !weapon.data.ammoId) return [];
  const stacks = makeStacks(weapon.data.ammoId, weapon.data.mag);
  weapon.data.mag = 0;
  return stacks;
}

export function cloneGrid(grid) {
  return JSON.parse(JSON.stringify(grid));
}
