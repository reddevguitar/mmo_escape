// 떠돌이 출격: 무작위 장비를 받아 위험 부담 없이 나가는 출격.
// 떠돌이 오리들과 같은 편이라 먼저 쏘지 않으면 공격받지 않는다.
// 탈출하면 들고 나온 것은 전부 우편함으로, 죽어도 은신처 장비는 그대로다.

import { ITEMS } from "../data/items.js";
import { makeGrid, makeItem, makeStacks, addItem, forEachItemDeep } from "./inventory.js";

export const SCAV_COOLDOWN_MS = 8 * 60 * 1000;

const STANDARD_AMMO = { "9mm": "9mm", 556: "556", 762: "762", "12g": "12g" };

export function scavCooldownLeft(profile, now = Date.now()) {
  return Math.max(0, (profile.scavReadyAt ?? 0) - now);
}

export function makeScavLoadout(rng) {
  const equip = { primary: null, secondary: null, helmet: null, armor: null, backpack: null };
  const weaponId = rng.weighted([["p9", 4], ["uzi", 3], ["sg12", 3], ["mp5", 1.2], ["ak47", 1]]);
  const wdef = ITEMS[weaponId];
  const ammoId = STANDARD_AMMO[wdef.caliber];
  equip.primary = makeItem(weaponId, 1, { mag: wdef.mag, ammoId });
  if (rng.chance(0.35)) {
    const id = rng.chance(0.75) ? "vest_police" : "vest_plate";
    equip.armor = makeItem(id, 1, { dur: Math.round(ITEMS[id].dur * rng.range(0.5, 0.9)) });
  }
  if (rng.chance(0.45)) {
    const id = rng.chance(0.8) ? "helmet_cap" : "helmet_6b";
    equip.helmet = makeItem(id, 1, { dur: Math.round(ITEMS[id].dur * rng.range(0.5, 1)) });
  }
  const bagId = rng.weighted([["bag_sling", 5], ["bag_scav", 4], [null, 1]]);
  if (bagId) equip.backpack = makeItem(bagId);

  const pockets = makeGrid(4, 1, { only1x1: true, noNest: true, kind: "pockets" });
  addItem(pockets, makeItem("bandage"));
  addItem(pockets, makeItem(rng.pick(["crackers", "bread", "soda"])));
  if (rng.chance(0.4)) addItem(pockets, makeItem("stim"));

  const spare = makeStacks(ammoId, Math.round(wdef.mag * rng.range(1, 2)));
  const extras = [...spare];
  if (rng.chance(0.25)) extras.push(makeItem("frag"));
  for (const item of extras) {
    const bag = equip.backpack?.data.grid;
    if (!(bag && addItem(bag, item))) addItem(pockets, item);
  }
  return { equip, pockets, secure: null, scav: true };
}

/** 장비 묶음의 모든 아이템(가방은 내용물째)을 꺼내 목록으로 */
export function loadoutItems(loadout) {
  const out = [];
  for (const slot of Object.keys(loadout.equip)) {
    const item = loadout.equip[slot];
    if (item) out.push(item);
  }
  for (const item of loadout.pockets.items) out.push(item);
  return out;
}

/** 장비 묶음의 모든 아이템 uid (가방 속 포함) */
export function loadoutUids(loadout) {
  const uids = new Set();
  const visit = (item) => {
    uids.add(item.uid);
    if (ITEMS[item.id].type === "backpack" && item.data?.grid) forEachItemDeep(item.data.grid, (inner) => uids.add(inner.uid));
  };
  for (const item of Object.values(loadout.equip)) if (item) visit(item);
  for (const grid of [loadout.pockets, loadout.secure]) if (grid) forEachItemDeep(grid, (item) => uids.add(item.uid));
  return uids;
}
