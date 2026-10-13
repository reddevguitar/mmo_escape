// 피해 계산 (방어구 관통/둔상/내구도)

import { ITEMS } from "../data/items.js";
import { clamp } from "../core/util.js";

/** 관통 확률. 방어 등급 * 10이 기준, 내구도가 떨어질수록 약해진다 */
export function penChance(pen, cls, durFrac) {
  const rating = cls * 10 * (0.4 + 0.6 * clamp(durFrac, 0, 1));
  return clamp((pen - rating + 12) / 24, 0, 1);
}

/**
 * 한 발의 피해 계산
 * @param ammo 탄약 정의
 * @param dmgMul 무기 피해 배율
 * @param protection 맞은 부위의 방어구 아이템 (없으면 null)
 * @param roll 0..1 난수
 */
export function computeHit(ammo, dmgMul, protection, roll) {
  const base = ammo.damage * dmgMul;
  const def = protection ? ITEMS[protection.id] : null;
  if (!def || !(protection.data?.dur > 0)) {
    return { damage: base, penetrated: true, durLoss: 0, armored: false };
  }
  const p = penChance(ammo.pen, def.cls, protection.data.dur / def.dur);
  if (roll < p) {
    return { damage: base * (1 - 0.05 * def.cls), penetrated: true, durLoss: base * 0.07, armored: true };
  }
  return { damage: base * 0.16, penetrated: false, durLoss: base * 0.12, armored: true };
}

/** 폭발 피해: 거리 감쇠 + 방탄복이 있으면 일부 경감 */
export function explosionDamage(baseDamage, radius, distance, armorItem) {
  if (distance >= radius) return 0;
  const falloff = Math.pow(1 - distance / radius, 0.7);
  let dmg = baseDamage * falloff;
  const def = armorItem ? ITEMS[armorItem.id] : null;
  if (def && armorItem.data?.dur > 0) dmg *= 1 - Math.min(0.45, def.cls * 0.08);
  return dmg;
}
