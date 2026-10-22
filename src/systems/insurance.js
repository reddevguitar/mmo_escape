// 보험: 출격 전에 장비에 보험을 들면, 죽어서 잃은 장비가 일정 확률로 몇 분 뒤 우편함으로 돌아온다.
// 보험은 그 출격 한 번에만 유효하다. 돌아온 총은 탄이 비어 있고 가방은 내용물 없이 온다.

import { ITEMS } from "../data/items.js";
import { forEachItemDeep } from "./inventory.js";

export const INSURANCE_RATE = 0.12;
export const INSURANCE_RETURN_CHANCE = 0.7;
export const INSURANCE_RETURN_MS = 6 * 60 * 1000;
export const INSURABLE_SLOTS = ["primary", "secondary", "helmet", "armor", "backpack"];

export function insuranceCost(item) {
  return Math.max(100, Math.round((ITEMS[item.id].value * INSURANCE_RATE) / 100) * 100);
}

/** 보험을 들 수 있는 아이템: 지금 장착한 장비 */
export function insurableItems(profile) {
  return INSURABLE_SLOTS.map((slot) => profile.equip[slot]).filter(Boolean);
}

/**
 * 사망 시 보험 처리: 몸에 남아 있던 보험 아이템마다 확률적으로 돌려받는다.
 * @returns { insured, found, returned: 돌려받을 아이템 복사본(data.returnAt 설정) }
 */
export function insuranceClaims(loadout, uids, { rand = Math.random, now = Date.now() } = {}) {
  const want = new Set(uids ?? []);
  const found = [];
  const visit = (item) => {
    if (want.has(item.uid) && !found.includes(item)) found.push(item);
  };
  for (const item of Object.values(loadout.equip)) {
    if (!item) continue;
    visit(item);
    if (item.data?.grid) forEachItemDeep(item.data.grid, visit);
  }
  forEachItemDeep(loadout.pockets, visit);
  const returned = [];
  for (const item of found) {
    if (rand() >= INSURANCE_RETURN_CHANCE) continue;
    const copy = JSON.parse(JSON.stringify(item));
    const def = ITEMS[copy.id];
    copy.data ??= {};
    if (def.type === "weapon") copy.data.mag = 0;
    if (def.type === "backpack" && copy.data.grid) copy.data.grid.items = [];
    copy.rot = false;
    copy.data.returnAt = now + INSURANCE_RETURN_MS;
    returned.push(copy);
  }
  return { insured: want.size, found: found.length, returned };
}
