// 레이드 결과를 프로필에 반영

import { questEvent } from "./quests.js";
import { loseCarriedGear, levelForXp, sendToMail, deliverMail } from "./profile.js";
import { loadoutItems } from "./scav.js";

/**
 * @param result Raid.end()가 만든 결과
 * @param opts.loadout 떠돌이 출격이면 그 장비 묶음 (탈출 시 우편함으로 보낸다)
 */
export function applyRaidResult(profile, result, { loadout = null } = {}) {
  const scav = !!result.scav;
  const levelBefore = levelForXp(profile.xp);
  const progressed = new Set();
  const stats = profile.stats;
  stats.raids += 1;
  if (scav) stats.scavRaids = (stats.scavRaids ?? 0) + 1;

  for (const kill of result.kills) {
    stats.kills += 1;
    stats.killsByType[kill.type] = (stats.killsByType[kill.type] ?? 0) + 1;
    for (const name of questEvent(profile, { type: "kill", enemy: kill.type, map: result.mapId })) progressed.add(name);
  }
  if (result.searched > 0) {
    for (const name of questEvent(profile, { type: "search", count: result.searched })) progressed.add(name);
  }
  if (result.unlocks > 0) {
    stats.unlocks = (stats.unlocks ?? 0) + result.unlocks;
    for (const name of questEvent(profile, { type: "unlock", count: result.unlocks })) progressed.add(name);
  }

  let mailed = 0;
  if (result.status === "extracted") {
    stats.extracts += 1;
    for (const name of questEvent(profile, { type: "extract", map: result.mapId })) progressed.add(name);
    stats.bestLoot = Math.max(stats.bestLoot ?? 0, result.endValue - result.startValue);
    if (scav && loadout) {
      // 떠돌이가 들고 나온 것은 모두 내 것
      sendToMail(profile, loadoutItems(loadout));
      const r = deliverMail(profile);
      mailed = r.left;
    }
  } else {
    stats.deaths += 1;
    if (!scav) loseCarriedGear(profile);
  }

  profile.xp += result.xp.total;
  profile.inRaid = null;
  const levelAfter = levelForXp(profile.xp);
  profile.lastResult = { status: result.status, mapId: result.mapId, time: result.time, scav };
  return { progressed: [...progressed], levelBefore, levelAfter, mailed };
}

/** 레이드 도중 새로고침/종료한 경우: 일반 출격은 실종 처리, 떠돌이 출격은 손실 없음 */
export function resolveAbandonedRaid(profile) {
  if (!profile.inRaid) return null;
  const { mapId, scav = false } = profile.inRaid;
  const result = {
    status: "mia",
    cause: "레이드 중 연결 끊김",
    mapId,
    scav,
    kills: [],
    searched: 0,
    unlocks: 0,
    xp: { kills: 0, search: 0, survival: 0, total: 0 },
    startValue: 0,
    endValue: 0,
    time: 0,
  };
  const summary = applyRaidResult(profile, result);
  return { result, summary };
}

/**
 * 게임 업데이트(페이지 교체)로 레이드가 끊긴 경우: 벌칙 없이 출격 전 상태로 되돌린다.
 * 레이드 중에는 프로필을 저장하지 않으므로 저장본이 곧 출격 전 상태다.
 */
/**
 * 앱 시작 시 남아 있는 레이드 기록 처리.
 * @param swapped 게임 페이지가 새 버전으로 교체되어 끊겼는가
 * @returns null | { kind: "cancelled" } | { kind: "mia" | "scav", result, summary }
 */
export function resolveRaidOnBoot(profile, { swapped = false } = {}) {
  if (!profile.inRaid) return null;
  // 업데이트 전 버전이 남긴 기록(scav 필드가 없음)도 업데이트로 끊긴 것으로 본다
  if (swapped || !("scav" in profile.inRaid)) {
    cancelInterruptedRaid(profile);
    return { kind: "cancelled" };
  }
  const r = resolveAbandonedRaid(profile);
  return { kind: r.result.scav ? "scav" : "mia", ...r };
}

export function cancelInterruptedRaid(profile) {
  if (!profile.inRaid) return false;
  // 떠돌이 출격 대기 시간도 되돌린다
  if (profile.inRaid.scav) profile.scavReadyAt = profile.inRaid.prevScavReadyAt ?? 0;
  profile.inRaid = null;
  return true;
}
