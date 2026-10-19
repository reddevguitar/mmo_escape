import { test } from "node:test";
import assert from "node:assert/strict";
import { newProfile, migrateProfile, saveProfile, loadProfile, levelForXp, xpForLevel, loseCarriedGear, SAVE_KEY } from "../src/systems/profile.js";
import { canPlace, makeItem, addItem } from "../src/systems/inventory.js";
import { refreshQuests, questEvent, handover, claimQuest, isQuestComplete, questState } from "../src/systems/quests.js";
import { applyRaidResult, resolveAbandonedRaid, cancelInterruptedRaid, resolveRaidOnBoot } from "../src/systems/raidResult.js";
import { deliverMail } from "../src/systems/profile.js";
import { countItem } from "../src/systems/inventory.js";
import { craft, recipeStatus, RECIPES } from "../src/systems/crafting.js";
import { makeScavLoadout } from "../src/systems/scav.js";
import { Rng } from "../src/core/rng.js";
import { RECIPE_MAP } from "../src/data/recipes.js";
import { penChance, computeHit } from "../src/systems/combat.js";
import { ITEMS, sellPrice, buyPrice } from "../src/data/items.js";
import { QUESTS } from "../src/data/quests.js";
import { LOOT_TABLES } from "../src/data/loot.js";
import { TRADER } from "../src/data/trader.js";
import { UPGRADES } from "../src/data/hideout.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test("데이터 무결성: 모든 참조 아이템이 존재", () => {
  for (const table of Object.values(LOOT_TABLES)) for (const [id] of table) assert.ok(ITEMS[id], `loot ${id}`);
  for (const q of QUESTS) {
    for (const [id] of q.reward.items ?? []) assert.ok(ITEMS[id], `quest reward ${id}`);
    for (const g of q.goals) if (g.item) assert.ok(ITEMS[g.item], `quest goal ${g.item}`);
    for (const r of q.req) assert.ok(QUESTS.some((x) => x.id === r), `quest req ${r}`);
  }
  for (const t of TRADER.tiers) for (const [id] of t.offers) assert.ok(ITEMS[id], `trader ${id}`);
  for (const up of Object.values(UPGRADES)) for (const l of up.levels) for (const [id] of l.items ?? []) assert.ok(ITEMS[id], `upgrade ${id}`);
  for (const r of Object.values(RECIPE_MAP)) {
    assert.ok(ITEMS[r.out[0]], `recipe out ${r.id}`);
    for (const [id] of r.input) assert.ok(ITEMS[id], `recipe input ${r.id}:${id}`);
    for (const id of r.tools ?? []) assert.ok(ITEMS[id], `recipe tool ${r.id}:${id}`);
  }
  for (const def of Object.values(ITEMS)) assert.ok(def.w >= 1 && def.h >= 1 && def.value > 0, def.id);
});

test("상인 구매가는 판매가보다 비싸다 (무한 차익 방지)", () => {
  for (const t of TRADER.tiers) {
    for (const [id, n] of t.offers) {
      const item = makeItem(id, n);
      assert.ok(buyPrice(id, n) > sellPrice(item), id);
    }
  }
});

test("새 프로필: 아이템이 겹치지 않고 의뢰가 열려 있다", () => {
  const p = newProfile("테스트");
  for (const grid of [p.stash, p.pockets, p.secure, p.equip.backpack.data.grid]) {
    for (const item of grid.items) assert.ok(canPlace(grid, item, item.x, item.y, item.rot), item.id);
  }
  assert.equal(questState(p, "q_first"), "active");
  assert.equal(questState(p, "q_scav"), "locked");
});

test("저장/불러오기 왕복", () => {
  globalThis.localStorage = memoryStorage();
  const p = newProfile("저장오리");
  p.money = 12345;
  addItem(p.stash, makeItem("gpu"));
  assert.ok(saveProfile(p));
  const loaded = loadProfile();
  assert.equal(loaded.name, "저장오리");
  assert.equal(loaded.money, 12345);
  assert.ok(loaded.stash.items.some((i) => i.id === "gpu"));
  delete globalThis.localStorage;
});

test("손상된 저장 데이터도 복구된다", () => {
  globalThis.localStorage = memoryStorage();
  globalThis.localStorage.setItem(SAVE_KEY, "{not json");
  assert.equal(loadProfile(), null);
  const fixed = migrateProfile({ name: "x", money: 5, stash: { w: 10, h: 12, items: [{ uid: "a", id: "no_such_item", x: 0, y: 0 }, { uid: "b", id: "watch", x: 0, y: 0, count: 1 }, { uid: "c", id: "ring", x: 0, y: 0, count: 1 }] } });
  assert.equal(fixed.stash.items.length, 2, "알 수 없는 아이템 제거");
  const [a, b] = fixed.stash.items;
  assert.ok(!(a.x === b.x && a.y === b.y), "겹친 아이템 재배치");
  delete globalThis.localStorage;
});

test("레벨 곡선", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(xpForLevel(2)), 2);
  assert.equal(levelForXp(xpForLevel(5) - 1), 4);
  for (let l = 2; l < 30; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
});

test("의뢰: 진행, 제출, 보상", () => {
  const p = newProfile();
  assert.deepEqual(questEvent(p, { type: "extract", map: "farm" }), ["첫 출격"]);
  assert.ok(isQuestComplete(p, "q_first"));
  const money = p.money;
  assert.ok(claimQuest(p, "q_first").ok);
  assert.equal(p.money, money + 12000);
  assert.equal(questState(p, "q_ducks"), "active", "후속 의뢰 해금");
  addItem(p.stash, makeItem("rubber_duck"));
  addItem(p.stash, makeItem("rubber_duck"));
  assert.ok(handover(p, "q_ducks", 0).ok);
  assert.equal(p.quests.q_ducks.progress[0], 2);
  assert.ok(!isQuestComplete(p, "q_ducks"));
  refreshQuests(p);
});

test("창고가 가득 차면 의뢰 보상은 우편함으로 간다", () => {
  const p = newProfile();
  questEvent(p, { type: "extract", map: "farm" });
  p.stash.items = [];
  p.stash.w = 1;
  p.stash.h = 1;
  addItem(p.stash, makeItem("watch"));
  const r = claimQuest(p, "q_first");
  assert.ok(r.ok);
  assert.equal(p.quests.q_first.state, "done");
  assert.ok(r.mailed > 0 && p.mail.length === r.mailed);
  // 창고를 넓히면 우편함에서 받을 수 있다
  p.stash.w = 10;
  p.stash.h = 12;
  const d = deliverMail(p);
  assert.equal(d.left, 0);
  assert.equal(p.mail.length, 0);
  assert.equal(countItem([p.stash], "9mm"), 60);
});

test("작업대 제작: 재료 소모, 레벨 제한, 도구는 남는다", () => {
  const p = newProfile();
  p.stash.items = [];
  addItem(p.stash, makeItem("bolts"));
  addItem(p.stash, makeItem("scrap"));
  const money = p.money;
  const r = craft(p, "r_9mm");
  assert.ok(r.ok, r.msg);
  assert.equal(countItem([p.stash], "9mm"), 40);
  assert.equal(countItem([p.stash], "bolts"), 0);
  assert.equal(p.money, money - 400);
  assert.ok(!craft(p, "r_9mm").ok, "재료가 없으면 실패");
  // 채굴: GPU는 도구라 소모되지 않는다. 작업대 3레벨 필요
  addItem(p.stash, makeItem("gpu"));
  for (let i = 0; i < 3; i++) addItem(p.stash, makeItem("battery"));
  assert.ok(!craft(p, "r_mining").ok, "작업대 레벨 부족");
  p.hideout.bench = 2;
  assert.ok(craft(p, "r_mining").ok);
  assert.equal(countItem([p.stash], "gpu"), 1);
  assert.equal(countItem([p.stash], "duckcoin"), 1);
  // 내용물이 든 가방은 재료로 쓰지 않는다
  const bag = makeItem("bag_scav");
  addItem(bag.data.grid, makeItem("ring"));
  addItem(p.stash, bag);
  addItem(p.stash, makeItem("tape"));
  addItem(p.stash, makeItem("tape"));
  addItem(p.stash, makeItem("wires"));
  assert.equal(recipeStatus(p, RECIPES.find((r2) => r2.id === "r_bag")).enough, false);
});

test("떠돌이 출격: 무작위 장비, 탈출하면 우편함/창고로, 죽어도 은신처 장비는 그대로", () => {
  const p = newProfile();
  const before = p.equip.secondary;
  const kit = makeScavLoadout(new Rng(5));
  assert.ok(kit.equip.primary && kit.equip.primary.data.mag > 0);
  assert.equal(kit.secure, null);
  const extracted = { status: "extracted", scav: true, cause: "x", mapId: "farm", kills: [], searched: 0, unlocks: 0, xp: { total: 300 }, startValue: 0, endValue: 0, time: 60 };
  const stashBefore = p.stash.items.length;
  applyRaidResult(p, extracted, { loadout: kit });
  assert.ok(p.stash.items.length + p.mail.length > stashBefore, "떠돌이 장비가 들어왔다");
  assert.equal(p.equip.secondary, before);
  const dead = { ...extracted, status: "dead" };
  applyRaidResult(p, dead, { loadout: makeScavLoadout(new Rng(6)) });
  assert.equal(p.equip.secondary, before, "죽어도 은신처 장비 유지");
  assert.equal(p.stats.scavRaids, 2);
  p.inRaid = { mapId: "farm", scav: true };
  resolveAbandonedRaid(p);
  assert.equal(p.equip.secondary, before, "떠돌이 출격 중 끊겨도 손실 없음");
});

test("게임 업데이트로 끊긴 레이드는 벌칙 없이 취소 (떠돌이 대기 시간도 환불)", () => {
  const p = newProfile();
  const gear = p.equip.secondary;
  p.inRaid = { mapId: "farm", at: 1, scav: false };
  assert.ok(cancelInterruptedRaid(p));
  assert.equal(p.inRaid, null);
  assert.equal(p.equip.secondary, gear, "장비 유지");
  assert.equal(p.stats.deaths, 0);
  p.scavReadyAt = 5_000_000;
  p.inRaid = { mapId: "farm", at: 1, scav: true, prevScavReadyAt: 42 };
  cancelInterruptedRaid(p);
  assert.equal(p.scavReadyAt, 42);
  assert.equal(cancelInterruptedRaid(p), false, "레이드 기록이 없으면 아무 일도 없다");
});

test("시작 시 남은 레이드 기록: 교체면 취소, 이전 버전 기록도 취소, 그 외는 실종", () => {
  const p = newProfile();
  assert.equal(resolveRaidOnBoot(p), null);
  p.inRaid = { mapId: "farm", at: 1, scav: false };
  assert.equal(resolveRaidOnBoot(p, { swapped: true }).kind, "cancelled");
  assert.ok(p.equip.secondary);
  p.inRaid = { mapId: "farm", at: 1 }; // 업데이트 전 버전이 남긴 기록
  assert.equal(resolveRaidOnBoot(p).kind, "cancelled");
  assert.ok(p.equip.secondary);
  p.inRaid = { mapId: "farm", at: 1, scav: true };
  assert.equal(resolveRaidOnBoot(p).kind, "scav");
  assert.ok(p.equip.secondary, "떠돌이는 손실 없음");
  p.inRaid = { mapId: "farm", at: 1, scav: false };
  assert.equal(resolveRaidOnBoot(p).kind, "mia");
  assert.equal(p.equip.secondary, null, "일반 출격 중 종료는 실종");
});

test("사망하면 보안 컨테이너만 남는다", () => {
  const p = newProfile();
  addItem(p.secure, makeItem("duckcoin"));
  const result = { status: "dead", cause: "test", mapId: "farm", kills: [{ type: "scav", name: "떠돌이 오리", xp: 120 }], searched: 3, xp: { total: 195 }, startValue: 0, endValue: 0, time: 10 };
  const summary = applyRaidResult(p, result);
  assert.equal(p.equip.secondary, null);
  assert.equal(p.equip.backpack, null);
  assert.equal(p.pockets.items.length, 0);
  assert.equal(p.secure.items[0].id, "duckcoin");
  assert.equal(p.stats.deaths, 1);
  assert.equal(p.quests.q_first.progress[0], 0, "탈출 의뢰는 진행 안 됨");
  assert.equal(p.xp, 195);
  assert.ok(summary.levelAfter >= summary.levelBefore);
});

test("레이드 중 종료 기록은 실종 처리", () => {
  const p = newProfile();
  p.inRaid = { mapId: "farm", at: 1, scav: false };
  const r = resolveAbandonedRaid(p);
  assert.equal(r.result.status, "mia");
  assert.equal(p.inRaid, null);
  assert.equal(p.equip.secondary, null);
  loseCarriedGear(p);
});

test("관통 확률과 피해 계산", () => {
  assert.equal(penChance(100, 2, 1), 1);
  assert.equal(penChance(0, 5, 1), 0);
  assert.ok(penChance(30, 3, 1) > penChance(30, 4, 1));
  assert.ok(penChance(30, 4, 0.2) > penChance(30, 4, 1), "닳은 방탄복은 더 잘 뚫린다");
  const naked = computeHit(ITEMS["762"], 1, null, 0.5);
  assert.equal(naked.damage, 46);
  const vest = makeItem("vest_heavy");
  const blocked = computeHit(ITEMS["9mm"], 1, vest, 0.99);
  assert.ok(!blocked.penetrated && blocked.damage < 10 && blocked.durLoss > 0);
});
