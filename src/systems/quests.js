// 의뢰 진행 로직
// profile.quests[id] = { state: "active" | "done", progress: [n per goal] }
// 잠긴 의뢰는 기록이 없다. 목표가 모두 채워지면 보상 수령 가능.

import { QUESTS, QUEST_MAP } from "../data/quests.js";
import { makeStacks, addItem, countItem, takeItem } from "./inventory.js";

export function questState(profile, id) {
  return profile.quests[id]?.state ?? "locked";
}

export function isQuestComplete(profile, id) {
  const quest = QUEST_MAP[id];
  const rec = profile.quests[id];
  if (!quest || !rec || rec.state !== "active") return false;
  return quest.goals.every((goal, i) => (rec.progress[i] ?? 0) >= goal.count);
}

/** 선행 의뢰가 끝난 의뢰를 활성화 */
export function refreshQuests(profile) {
  for (const quest of QUESTS) {
    if (profile.quests[quest.id]) continue;
    const unlocked = quest.req.every((r) => profile.quests[r]?.state === "done");
    if (unlocked) profile.quests[quest.id] = { state: "active", progress: quest.goals.map(() => 0) };
  }
}

/** 레이드 이벤트 반영. 반환: 진행된 의뢰 이름 목록 */
export function questEvent(profile, event) {
  const touched = [];
  for (const quest of QUESTS) {
    const rec = profile.quests[quest.id];
    if (!rec || rec.state !== "active") continue;
    quest.goals.forEach((goal, i) => {
      if ((rec.progress[i] ?? 0) >= goal.count) return;
      let match = false;
      if (goal.type === "kill" && event.type === "kill") {
        match = (goal.enemy === "any" || goal.enemy === event.enemy) && (!goal.map || goal.map === event.map);
      } else if (goal.type === "extract" && event.type === "extract") {
        match = goal.map === "any" || goal.map === event.map;
      } else if (goal.type === "search" && event.type === "search") {
        match = true;
      } else if (goal.type === "unlock" && event.type === "unlock") {
        match = true;
      }
      if (match) {
        rec.progress[i] = Math.min(goal.count, (rec.progress[i] ?? 0) + (event.count ?? 1));
        if (!touched.includes(quest.name)) touched.push(quest.name);
      }
    });
  }
  return touched;
}

/** 창고에서 아이템 제출 */
export function handover(profile, questId, goalIndex) {
  const quest = QUEST_MAP[questId];
  const rec = profile.quests[questId];
  if (!quest || !rec || rec.state !== "active") return { ok: false, msg: "진행 중인 의뢰가 아닙니다" };
  const goal = quest.goals[goalIndex];
  if (goal?.type !== "handover") return { ok: false, msg: "제출 목표가 아닙니다" };
  const need = goal.count - (rec.progress[goalIndex] ?? 0);
  if (need <= 0) return { ok: false, msg: "이미 완료했습니다" };
  const have = countItem([profile.stash], goal.item);
  if (have <= 0) return { ok: false, msg: "창고에 해당 아이템이 없습니다" };
  const taken = takeItem([profile.stash], goal.item, Math.min(need, have));
  rec.progress[goalIndex] = (rec.progress[goalIndex] ?? 0) + taken;
  return { ok: true, taken };
}

/** 보상 수령. 창고에 자리가 없는 보상은 우편함으로 간다 */
export function claimQuest(profile, questId) {
  const quest = QUEST_MAP[questId];
  if (!isQuestComplete(profile, questId)) return { ok: false, msg: "아직 목표를 달성하지 못했습니다" };
  const items = [];
  for (const [id, n] of quest.reward.items ?? []) items.push(...makeStacks(id, n));
  let mailed = 0;
  for (const item of items) {
    if (!addItem(profile.stash, item)) {
      profile.mail ??= [];
      profile.mail.push(item);
      mailed += 1;
    }
  }
  profile.money += quest.reward.money ?? 0;
  profile.xp += quest.reward.xp ?? 0;
  profile.quests[questId].state = "done";
  refreshQuests(profile);
  return { ok: true, mailed };
}

export function readyQuestCount(profile) {
  return QUESTS.filter((q) => isQuestComplete(profile, q.id)).length;
}
