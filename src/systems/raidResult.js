// 레이드 결과를 프로필에 반영

import { questEvent } from "./quests.js";
import { loseCarriedGear, levelForXp } from "./profile.js";

export function applyRaidResult(profile, result) {
  const levelBefore = levelForXp(profile.xp);
  const progressed = new Set();
  const stats = profile.stats;
  stats.raids += 1;

  for (const kill of result.kills) {
    stats.kills += 1;
    stats.killsByType[kill.type] = (stats.killsByType[kill.type] ?? 0) + 1;
    for (const name of questEvent(profile, { type: "kill", enemy: kill.type, map: result.mapId })) progressed.add(name);
  }
  if (result.searched > 0) {
    for (const name of questEvent(profile, { type: "search", count: result.searched })) progressed.add(name);
  }

  if (result.status === "extracted") {
    stats.extracts += 1;
    for (const name of questEvent(profile, { type: "extract", map: result.mapId })) progressed.add(name);
    stats.bestLoot = Math.max(stats.bestLoot ?? 0, result.endValue - result.startValue);
  } else {
    stats.deaths += 1;
    loseCarriedGear(profile);
  }

  profile.xp += result.xp.total;
  profile.inRaid = null;
  const levelAfter = levelForXp(profile.xp);
  profile.lastResult = { status: result.status, mapId: result.mapId, time: result.time };
  return { progressed: [...progressed], levelBefore, levelAfter };
}

/** 레이드 도중 새로고침/종료한 경우: 실종 처리 */
export function resolveAbandonedRaid(profile) {
  if (!profile.inRaid) return null;
  const mapId = profile.inRaid.mapId;
  const result = {
    status: "mia",
    cause: "레이드 중 연결 끊김",
    mapId,
    kills: [],
    searched: 0,
    xp: { kills: 0, search: 0, survival: 0, total: 0 },
    startValue: 0,
    endValue: 0,
    time: 0,
  };
  const summary = applyRaidResult(profile, result);
  return { result, summary };
}
