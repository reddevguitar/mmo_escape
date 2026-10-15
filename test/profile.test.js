import { test } from "node:test";
import assert from "node:assert/strict";
import { newProfile, migrateProfile, saveProfile, loadProfile, levelForXp, xpForLevel, loseCarriedGear, SAVE_KEY } from "../src/systems/profile.js";
import { canPlace, makeItem, addItem } from "../src/systems/inventory.js";
import { refreshQuests, questEvent, handover, claimQuest, isQuestComplete, questState } from "../src/systems/quests.js";
import { applyRaidResult, resolveAbandonedRaid } from "../src/systems/raidResult.js";
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

test("의뢰 보상은 창고가 가득 차면 받을 수 없다", () => {
  const p = newProfile();
  questEvent(p, { type: "extract", map: "farm" });
  p.stash.items = [];
  p.stash.w = 1;
  p.stash.h = 1;
  addItem(p.stash, makeItem("watch"));
  const r = claimQuest(p, "q_first");
  assert.ok(!r.ok);
  assert.equal(p.quests.q_first.state, "active");
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
  p.inRaid = { mapId: "farm", at: 1 };
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
