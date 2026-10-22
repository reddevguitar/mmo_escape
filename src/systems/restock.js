// 빠른 보급: 장착한 총에 맞는 탄약(탄창 가득 + 예비 2탄창)과 붕대 하나를 가방에 채운다.
// 창고에 있는 것부터 꺼내고, 모자라면 상인에게서 산다.

import { ITEMS, buyPrice } from "../data/items.js";
import { TRADER } from "../data/trader.js";
import { traderTier } from "./profile.js";
import { addItem, countItem, takeItem, makeStacks, loadAmmo } from "./inventory.js";

const STANDARD_AMMO = { "9mm": "9mm", 556: "556", 762: "762", "12g": "12g" };
const SPARE_MAGS = 2;

function offeredIds(profile) {
  const tier = traderTier(profile);
  const ids = new Set();
  TRADER.tiers.slice(0, tier + 1).forEach((t) => t.offers.forEach(([id]) => ids.add(id)));
  return ids;
}

function carriedOf(p) {
  return [p.equip.backpack?.data.grid, p.pockets].filter(Boolean);
}

/** 무엇을 얼마나 채울지: [{ id, need, fromStash, buy, cost }] */
export function restockPlan(profile) {
  const offered = offeredIds(profile);
  const needs = new Map();
  const add = (id, n) => needs.set(id, (needs.get(id) ?? 0) + n);
  const weapons = ["primary", "secondary"].map((s) => profile.equip[s]).filter(Boolean);
  for (const w of weapons) {
    const def = ITEMS[w.id];
    // 장전된 탄이 있으면 그 탄종, 아니면 상점에서 살 수 있는 일반탄
    const ammoId = w.data.mag > 0 && w.data.ammoId ? w.data.ammoId : STANDARD_AMMO[def.caliber];
    add(ammoId, def.mag - w.data.mag + def.mag * SPARE_MAGS);
  }
  const lines = [];
  const carried = carriedOf(profile);
  for (const [id, want] of needs) {
    const need = Math.max(0, want - countItem(carried, id));
    if (need <= 0) continue;
    const inStash = countItem([profile.stash], id);
    const fromStash = Math.min(need, inStash);
    const buy = offered.has(id) ? need - fromStash : 0;
    if (fromStash + buy > 0) lines.push({ id, need, fromStash, buy, cost: buy > 0 ? buyPrice(id, buy) : 0 });
  }
  const hasBandage = carried.some((g) => countItem([g], "bandage") > 0 || countItem([g], "ifak") > 0 || countItem([g], "bigkit") > 0);
  if (!hasBandage) {
    const fromStash = countItem([profile.stash], "bandage") > 0 ? 1 : 0;
    lines.push({ id: "bandage", need: 1, fromStash, buy: 1 - fromStash, cost: fromStash ? 0 : buyPrice("bandage", 1) });
  }
  return { lines, total: lines.reduce((s, l) => s + l.cost, 0) };
}

/** 계획대로 채운다. 실패하면 아무것도 바꾸지 않는다 */
export function applyRestock(profile) {
  const plan = restockPlan(profile);
  if (!plan.lines.length) return { ok: false, msg: "이미 넉넉히 챙겼습니다" };
  if (profile.money < plan.total) return { ok: false, msg: "돈이 부족합니다" };
  // 사본에서 먼저 해 보고, 다 들어가면 반영
  const p = JSON.parse(JSON.stringify({ stash: profile.stash, pockets: profile.pockets, equip: profile.equip }));
  let moved = 0;
  for (const line of plan.lines) {
    const got = takeItem([p.stash], line.id, line.fromStash);
    const stacks = makeStacks(line.id, got + line.buy);
    // 빈 탄창부터 채운다
    for (const w of ["primary", "secondary"].map((s) => p.equip[s]).filter(Boolean)) {
      for (const s of stacks) loadAmmo(w, s);
    }
    for (const s of stacks) {
      if (s.count <= 0) continue;
      if (!carriedOf(p).some((g) => addItem(g, s))) return { ok: false, msg: "가방·주머니에 자리가 없습니다" };
    }
    moved += got + line.buy;
  }
  profile.stash = p.stash;
  profile.pockets = p.pockets;
  profile.equip = p.equip;
  profile.money -= plan.total;
  return { ok: true, cost: plan.total, moved, lines: plan.lines };
}
