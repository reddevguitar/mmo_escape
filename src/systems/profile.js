// 플레이어 프로필: 창고, 장비, 돈, 경험치, 의뢰, 시설. localStorage에 저장.

import { ITEMS } from "../data/items.js";
import { UPGRADES } from "../data/hideout.js";
import { TRADER } from "../data/trader.js";
import { makeGrid, makeItem, makeStacks, addItem, placeAt, canPlace, findSpot } from "./inventory.js";
import { refreshQuests } from "./quests.js";

export const SAVE_KEY = "duckscape.profile.v1";
export const PROFILE_VERSION = 1;
export const MAX_LEVEL = 30;

export function xpForLevel(level) {
  return 250 * (level - 1) * (level + 2);
}

export function levelForXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export function newProfile(name = "신입 오리") {
  const profile = {
    v: PROFILE_VERSION,
    name,
    money: 30000,
    xp: 0,
    equip: {
      primary: null,
      secondary: makeItem("p9", 1, { mag: 12, ammoId: "9mm" }),
      helmet: null,
      armor: null,
      backpack: makeItem("bag_sling"),
    },
    pockets: makeGrid(4, 1, { only1x1: true, noNest: true, kind: "pockets" }),
    secure: makeGrid(2, 2, { noNest: true, kind: "secure" }),
    stash: makeGrid(10, UPGRADES.stash.levels[0].stashH, { kind: "stash" }),
    hideout: { stash: 0, secure: 0, gym: 0, bench: 0 },
    quests: {},
    stats: { raids: 0, extracts: 0, deaths: 0, kills: 0, killsByType: {}, bestLoot: 0, scavRaids: 0, unlocks: 0, crafted: 0 },
    settings: { volume: 0.7, damageNumbers: true, duckColor: "yellow", soundMarkers: true },
    seenTutorial: false,
    inRaid: null,
    lastResult: null,
    mail: [],
    scavReadyAt: 0,
  };

  addItem(profile.pockets, makeItem("bandage"));
  addItem(profile.pockets, makeItem("crackers"));
  addItem(profile.equip.backpack.data.grid, makeItem("9mm", 36));
  addItem(profile.equip.backpack.data.grid, makeItem("soda"));

  const starter = [
    ["9mm", 60], ["bandage", 2], ["stim", 1], ["water", 1], ["bread", 2],
    ["helmet_cap", 1], ["sg12", 1], ["12g", 20], ["frag", 1],
  ];
  for (const [id, n] of starter) {
    for (const item of makeStacks(id, n)) addItem(profile.stash, item);
  }
  const shotgun = profile.stash.items.find((i) => i.id === "sg12");
  if (shotgun) shotgun.data = { mag: 6, ammoId: "12g" };

  refreshQuests(profile);
  return profile;
}

export function playerLevel(profile) {
  return levelForXp(profile.xp);
}

export function maxHp(profile) {
  return UPGRADES.gym.levels[profile.hideout.gym].maxHp;
}

export function benchLevel(profile) {
  return UPGRADES.bench.levels[profile.hideout.bench ?? 0].bench;
}

export function traderTier(profile) {
  const level = playerLevel(profile);
  let tier = 0;
  TRADER.tiers.forEach((t, i) => {
    if (level >= t.minPlayerLevel) tier = i;
  });
  return tier;
}

export function carriedGrids(profile) {
  return loadoutGrids(pmcLoadout(profile));
}

/** 레이드에 들고 가는 장비 묶음. 일반 출격은 프로필의 장비를 그대로 참조한다 */
export function pmcLoadout(profile) {
  return { equip: profile.equip, pockets: profile.pockets, secure: profile.secure, scav: false };
}

export function loadoutGrids(loadout) {
  const grids = [loadout.pockets];
  if (loadout.equip.backpack) grids.push(loadout.equip.backpack.data.grid);
  if (loadout.secure) grids.push(loadout.secure);
  return grids;
}

/** 우편함: 창고에 자리가 없을 때 아이템을 보관. 받을 수 있는 만큼 창고로 옮긴다 */
export function sendToMail(profile, items) {
  profile.mail ??= [];
  for (const item of items) if (item && item.count > 0) profile.mail.push(item);
}

export function deliverMail(profile) {
  const left = [];
  let delivered = 0;
  for (const item of profile.mail ?? []) {
    if (addItem(profile.stash, item)) delivered += 1;
    else left.push(item);
  }
  profile.mail = left;
  return { delivered, left: left.length };
}

/** 시설 레벨에 맞게 창고/보안 컨테이너 크기를 맞춘다 (커지기만 함) */
export function applyHideoutDims(profile) {
  const stashH = UPGRADES.stash.levels[profile.hideout.stash].stashH;
  if (profile.stash.h < stashH) profile.stash.h = stashH;
  const sec = UPGRADES.secure.levels[profile.hideout.secure];
  if (profile.secure.w < sec.secureW) profile.secure.w = sec.secureW;
  if (profile.secure.h < sec.secureH) profile.secure.h = sec.secureH;
}

/** 저장 데이터 검증: 알 수 없는 아이템 제거, 겹친 아이템 재배치 */
function sanitizeGrid(grid) {
  if (!grid || !Array.isArray(grid.items)) return;
  const items = grid.items.filter((item) => item && ITEMS[item.id]);
  grid.items = [];
  for (const item of items) {
    item.count = Math.max(1, Math.min(item.count ?? 1, ITEMS[item.id].stack));
    item.data ??= {};
    if (ITEMS[item.id].type === "backpack") {
      const def = ITEMS[item.id];
      item.data.grid ??= makeGrid(def.gw, def.gh, { noNest: true, kind: "backpack" });
      sanitizeGrid(item.data.grid);
    }
    if (canPlace(grid, item, item.x, item.y, item.rot)) {
      placeAt(grid, item, item.x, item.y, item.rot);
    } else {
      const spot = findSpot(grid, item);
      if (spot) placeAt(grid, item, spot.x, spot.y, spot.rot);
    }
  }
}

export function migrateProfile(raw) {
  const base = newProfile(raw?.name);
  if (!raw || typeof raw !== "object") return base;
  const profile = { ...base, ...raw };
  profile.equip = { ...base.equip, ...raw.equip };
  for (const slot of Object.keys(profile.equip)) {
    const item = profile.equip[slot];
    if (item && !ITEMS[item.id]) profile.equip[slot] = null;
  }
  profile.hideout = { ...base.hideout, ...raw.hideout };
  profile.stats = { ...base.stats, ...raw.stats };
  profile.stats.killsByType = { ...(raw.stats?.killsByType ?? {}) };
  profile.settings = { ...base.settings, ...raw.settings };
  profile.quests = raw.quests ?? {};
  profile.mail = Array.isArray(raw.mail) ? raw.mail.filter((item) => item && ITEMS[item.id]) : [];
  for (const item of profile.mail) {
    item.count = Math.max(1, Math.min(item.count ?? 1, ITEMS[item.id].stack));
    item.data ??= {};
    if (ITEMS[item.id].type === "backpack") {
      const def = ITEMS[item.id];
      item.data.grid ??= makeGrid(def.gw, def.gh, { noNest: true, kind: "backpack" });
      sanitizeGrid(item.data.grid);
    }
  }
  profile.scavReadyAt = Number(raw.scavReadyAt) || 0;
  for (const key of ["pockets", "secure", "stash"]) {
    profile[key] = raw[key] && Array.isArray(raw[key].items) ? raw[key] : base[key];
  }
  profile.pockets.only1x1 = true;
  profile.pockets.noNest = true;
  profile.secure.noNest = true;
  applyHideoutDims(profile);
  sanitizeGrid(profile.stash);
  sanitizeGrid(profile.pockets);
  sanitizeGrid(profile.secure);
  if (profile.equip.backpack) {
    const def = ITEMS[profile.equip.backpack.id];
    profile.equip.backpack.data ??= {};
    profile.equip.backpack.data.grid ??= makeGrid(def.gw, def.gh, { noNest: true, kind: "backpack" });
    sanitizeGrid(profile.equip.backpack.data.grid);
  }
  profile.v = PROFILE_VERSION;
  refreshQuests(profile);
  return profile;
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadProfile() {
  const store = storage();
  if (!store) return null;
  try {
    const text = store.getItem(SAVE_KEY);
    if (!text) return null;
    return migrateProfile(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function wipeProfile() {
  const store = storage();
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // 저장소 접근 불가 시 무시
  }
}

/** 사망/실종 처리: 보안 컨테이너만 남기고 장비와 소지품을 잃는다 */
export function loseCarriedGear(profile) {
  for (const slot of Object.keys(profile.equip)) profile.equip[slot] = null;
  profile.pockets.items = [];
}
