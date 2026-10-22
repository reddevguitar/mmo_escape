// 루팅 생성과 적 생성

import { ITEMS } from "../data/items.js";
import { CONTAINERS, LOOT_TABLES } from "../data/loot.js";
import { ENEMY_TYPES } from "../data/enemies.js";
import { makeGrid, makeItem, addItem } from "../systems/inventory.js";

/** 루팅 테이블에서 아이템 하나 생성. lootMul이 높을수록 희귀템 확률 증가 */
export function rollLoot(rng, tableId, lootMul = 1) {
  const table = LOOT_TABLES[tableId];
  const entries = table.map((entry) => {
    const rarity = ITEMS[entry[0]].rarity;
    return [entry, entry[1] * Math.pow(lootMul, rarity * 0.9)];
  });
  const [id, , range] = rng.weighted(entries);
  const def = ITEMS[id];
  let count = 1;
  if (range) count = rng.int(range[0], range[1]);
  const item = makeItem(id, count);
  randomizeCondition(rng, item, def);
  return item;
}

export function randomizeCondition(rng, item, def = ITEMS[item.id]) {
  if (def.type === "weapon") {
    const ammo = standardAmmo(def.caliber);
    item.data.ammoId = ammo;
    item.data.mag = rng.chance(0.5) ? rng.int(0, def.mag) : 0;
  } else if (def.type === "armor" || def.type === "helmet") {
    item.data.dur = Math.round(def.dur * rng.range(0.45, 1));
  } else if (def.pool) {
    item.data.uses = Math.round(def.uses * rng.range(0.5, 1));
  } else if (def.type === "key") {
    item.data.uses = rng.int(2, def.uses);
  }
}

export function standardAmmo(caliber) {
  return { "9mm": "9mm", 556: "556", 762: "762", "12g": "12g" }[caliber];
}

export function apAmmo(caliber) {
  return { "9mm": "9mm_ap", 556: "556_ap", 762: "762_ap", "12g": "12g_slug" }[caliber];
}

export function createContainer(spec, rng, lootMul) {
  const info = CONTAINERS[spec.kind];
  const c = {
    id: spec.id,
    kind: spec.kind,
    name: info.name,
    x: spec.x,
    y: spec.y,
    tx: spec.tx,
    ty: spec.ty,
    walkable: !!spec.walkable,
    onVehicle: !!spec.onVehicle,
    locked: !!spec.locked,
    grid: makeGrid(info.gw, info.gh, { kind: "loot" }),
    revealed: 0,
    searchT: 0,
    opened: false,
  };
  // 잠긴 방의 상자는 더 많이, 더 좋은 것이 들어 있다
  const mul = spec.locked ? lootMul * 1.8 : lootMul;
  let rolls = rng.int(info.rolls[0], info.rolls[1]) + (spec.locked ? 2 : 0);
  if (rng.chance(Math.max(0, mul - 1))) rolls += 1;
  for (let i = 0; i < rolls; i++) addItem(c.grid, rollLoot(rng, info.table, mul));
  sortForReveal(c.grid);
  return c;
}

/** 수색 시 위에서부터 차례로 공개되도록 정렬 */
export function sortForReveal(grid) {
  grid.items.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function searchTime(item) {
  const def = ITEMS[item.id];
  return 0.35 + 0.1 * def.w * def.h + 0.2 * def.rarity;
}

export function createEnemy(rng, type, x, y, opts = {}) {
  const def = ENEMY_TYPES[type];
  let weapon = null;
  if (def.weapons.length) {
    const weaponId = rng.weighted(def.weapons);
    weapon = makeItem(weaponId);
    const wdef = ITEMS[weaponId];
    const ap = rng.chance(def.apChance);
    weapon.data.ammoId = ap ? apAmmo(wdef.caliber) : standardAmmo(wdef.caliber);
    weapon.data.mag = wdef.mag;
  }
  const armorId = rng.weighted(def.armor);
  const helmetId = rng.weighted(def.helmet);
  const armor = armorId ? makeItem(armorId) : null;
  const helmet = helmetId ? makeItem(helmetId) : null;
  if (armor) armor.data.dur = Math.round(ITEMS[armorId].dur * rng.range(0.6, 1));
  if (helmet) helmet.data.dur = Math.round(ITEMS[helmetId].dur * rng.range(0.6, 1));
  const hpMul = opts.hpMul ?? 1;
  return {
    kind: "enemy",
    type,
    def,
    name: def.name,
    x,
    y,
    r: def.radius,
    angle: rng.range(-Math.PI, Math.PI),
    vx: 0,
    vy: 0,
    hp: Math.round(def.hp * hpMul),
    maxHp: Math.round(def.hp * hpMul),
    alive: true,
    team: "enemy",
    equip: { primary: weapon, secondary: null, armor, helmet, backpack: null },
    weaponSlot: "primary",
    fireCd: 0,
    reload: null,
    bloom: 0,
    walkPhase: rng.range(0, 6),
    hurtT: 0,
    speech: null,
    speechT: 0,
    healed: false,
    boss: !!def.boss,
    melee: !!def.melee,
    guard: !!opts.guard,
    leader: opts.leader ?? null,
    ai: null,
  };
}

/** 적 시체 컨테이너: 장비 + 탄약 + 잡동사니 */
export function createCorpse(rng, enemy, lootMul, id) {
  const c = {
    id,
    kind: "corpse",
    name: `${enemy.def.name}의 시체`,
    x: enemy.x,
    y: enemy.y,
    walkable: true,
    grid: makeGrid(6, 6, { kind: "loot" }),
    revealed: 0,
    searchT: 0,
    opened: false,
    corpse: { type: enemy.type, angle: enemy.angle, colors: enemy.def.colors, r: enemy.r, boss: enemy.boss, cat: !!enemy.melee, armor: enemy.equip.armor?.id, helmet: enemy.equip.helmet?.id },
  };
  const weapon = enemy.equip.primary;
  if (weapon) addItem(c.grid, weapon);
  if (enemy.equip.armor) addItem(c.grid, enemy.equip.armor);
  if (enemy.equip.helmet) addItem(c.grid, enemy.equip.helmet);
  if (weapon) {
    const wdef = ITEMS[weapon.id];
    const ammoId = weapon.data.ammoId ?? standardAmmo(wdef.caliber);
    const n = Math.round(wdef.mag * rng.range(0.3, 1.2));
    if (n > 0) addItem(c.grid, makeItem(ammoId, Math.min(n, ITEMS[ammoId].stack)));
  }
  for (const id2 of enemy.def.guaranteed ?? []) addItem(c.grid, makeItem(id2));
  const rolls = rng.int(enemy.def.lootRolls[0], enemy.def.lootRolls[1]);
  for (let i = 0; i < rolls; i++) addItem(c.grid, rollLoot(rng, enemy.def.lootTable, lootMul));
  sortForReveal(c.grid);
  return c;
}
