import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeGrid, makeItem, makeStacks, dims, canPlace, findSpot, addItem, moveItem, placeAt,
  splitStack, sortGrid, loadAmmo, unloadWeapon, countItem, takeItem, fitsRules, itemWeight,
} from "../src/systems/inventory.js";

test("아이템 크기와 회전", () => {
  const gun = makeItem("ak47");
  assert.deepEqual(dims(gun), [4, 2]);
  assert.deepEqual(dims(gun, true), [2, 4]);
});

test("canPlace: 경계와 겹침", () => {
  const g = makeGrid(5, 3);
  const gun = makeItem("ak47");
  assert.ok(canPlace(g, gun, 0, 0, false));
  assert.ok(!canPlace(g, gun, 2, 0, false), "오른쪽 경계 밖");
  assert.ok(!canPlace(g, gun, 0, 0, true), "회전하면 높이 4 > 3");
  placeAt(g, gun, 0, 0, false);
  const bandage = makeItem("bandage");
  assert.ok(!canPlace(g, bandage, 3, 1, false), "총과 겹침");
  assert.ok(canPlace(g, bandage, 4, 0, false));
});

test("findSpot은 필요하면 회전해서 자리를 찾는다", () => {
  const g = makeGrid(2, 5);
  const gun = makeItem("ak47");
  const spot = findSpot(g, gun);
  assert.deepEqual(spot, { x: 0, y: 0, rot: true });
});

test("addItem: 같은 탄약은 스택에 합쳐지고 넘치면 새 칸", () => {
  const g = makeGrid(3, 1);
  addItem(g, makeItem("9mm", 50));
  addItem(g, makeItem("9mm", 30));
  assert.equal(g.items.length, 2);
  assert.equal(countItem([g], "9mm"), 80);
  assert.equal(g.items[0].count, 60);
});

test("addItem: 공간이 없으면 false", () => {
  const g = makeGrid(1, 1);
  assert.ok(addItem(g, makeItem("bandage")));
  assert.ok(!addItem(g, makeItem("stim")));
});

test("moveItem: 그리드 간 이동", () => {
  const a = makeGrid(4, 4);
  const b = makeGrid(4, 4);
  const item = makeItem("watch");
  addItem(a, item);
  const r = moveItem(item, { type: "grid", grid: a }, { type: "grid", grid: b, x: 3, y: 3, rot: false });
  assert.ok(r.ok);
  assert.equal(a.items.length, 0);
  assert.equal(b.items[0], item);
  assert.equal(item.x, 3);
});

test("moveItem: 슬롯 장착과 교체", () => {
  const stash = makeGrid(10, 10);
  const equip = { primary: makeItem("p9"), secondary: null, helmet: null, armor: null, backpack: null };
  const ak = makeItem("ak47");
  addItem(stash, ak);
  const r = moveItem(ak, { type: "grid", grid: stash }, { type: "slot", equip, slot: "primary" });
  assert.ok(r.ok);
  assert.equal(equip.primary, ak);
  assert.equal(stash.items.length, 1);
  assert.equal(stash.items[0].id, "p9", "기존 무기는 창고로");
  const bad = moveItem(makeItem("bandage"), { type: "grid", grid: makeGrid(2, 2) }, { type: "slot", equip, slot: "helmet" });
  assert.ok(!bad.ok);
});

test("moveItem: 교체할 자리가 없으면 원상복구", () => {
  const tiny = makeGrid(2, 1);
  const equip = { primary: makeItem("ak47"), secondary: null, helmet: null, armor: null, backpack: null };
  const pistol = makeItem("p9");
  addItem(tiny, pistol);
  // 피스톨을 주무기 슬롯에 → AK는 2x1 그리드에 못 들어감 → 실패
  const r = moveItem(pistol, { type: "grid", grid: tiny }, { type: "slot", equip, slot: "primary" });
  assert.ok(!r.ok);
  assert.equal(equip.primary.id, "ak47");
  assert.equal(tiny.items[0], pistol);
});

test("moveItem: 스택 합치기", () => {
  const g = makeGrid(4, 1);
  const a = makeItem("9mm", 50);
  const b = makeItem("9mm", 20);
  placeAt(g, a, 0, 0, false);
  placeAt(g, b, 1, 0, false);
  const r = moveItem(b, { type: "grid", grid: g }, { type: "merge", grid: g, target: a });
  assert.ok(r.ok);
  assert.equal(a.count, 60);
  assert.equal(b.count, 10);
  assert.equal(g.items.length, 2);
});

test("주머니는 1칸짜리만, 내용물 있는 가방은 중첩 금지", () => {
  const pockets = makeGrid(4, 1, { only1x1: true, noNest: true });
  assert.ok(!fitsRules(pockets, makeItem("water")));
  assert.ok(fitsRules(pockets, makeItem("bandage")));
  const bag = makeItem("bag_scav");
  const carried = makeGrid(6, 6, { noNest: true });
  assert.ok(fitsRules(carried, bag), "빈 가방은 넣을 수 있다");
  addItem(bag.data.grid, makeItem("bandage"));
  assert.ok(!fitsRules(carried, bag), "내용물이 있으면 금지");
  assert.ok(!fitsRules(bag.data.grid, bag), "자기 자신 안에는 금지");
});

test("splitStack과 sortGrid", () => {
  const g = makeGrid(4, 4);
  const ammo = makeItem("762", 40);
  addItem(g, ammo);
  assert.ok(splitStack(g, ammo));
  assert.equal(countItem([g], "762"), 40);
  assert.equal(g.items.length, 2);
  addItem(g, makeItem("toolbox"));
  assert.ok(sortGrid(g));
  assert.equal(g.items[0].id, "toolbox", "큰 아이템이 먼저 배치");
  assert.equal(countItem([g], "762"), 40, "정렬 후에도 개수 유지");
});

test("탄약 장전과 탄 빼기", () => {
  const ak = makeItem("ak47");
  const ammo = makeItem("762", 45);
  assert.equal(loadAmmo(ak, ammo), 30);
  assert.equal(ak.data.mag, 30);
  assert.equal(ammo.count, 15);
  assert.equal(loadAmmo(ak, makeItem("9mm", 10)), 0, "구경이 다르면 장전 불가");
  const out = unloadWeapon(ak);
  assert.equal(out.reduce((s, i) => s + i.count, 0), 30);
  assert.equal(ak.data.mag, 0);
});

test("takeItem은 가방 속까지 찾아서 꺼낸다", () => {
  const stash = makeGrid(10, 10);
  const bag = makeItem("bag_scav");
  addItem(bag.data.grid, makeItem("bolts"));
  addItem(stash, bag);
  addItem(stash, makeItem("bolts"));
  assert.equal(countItem([stash], "bolts"), 2);
  assert.equal(takeItem([stash], "bolts", 2), 2);
  assert.equal(countItem([stash], "bolts"), 0);
});

test("무게: 장전된 탄과 가방 내용물 포함", () => {
  const ak = makeItem("ak47", 1, { mag: 30, ammoId: "762" });
  assert.ok(itemWeight(ak) > 3.6);
  const bag = makeItem("bag_sling");
  addItem(bag.data.grid, makeItem("toolbox"));
  assert.ok(itemWeight(bag) >= 3.4);
  assert.equal(makeStacks("9mm", 130).length, 3);
});

test("장비 교체 시 밀려난 아이템을 반환한다", () => {
  const loot = makeGrid(6, 6);
  loot.seen = new Set();
  const newBag = makeItem("bag_scav");
  addItem(loot, newBag);
  loot.seen.add(newBag.uid);
  const equip = { primary: null, secondary: null, helmet: null, armor: null, backpack: makeItem("bag_sling") };
  const old = equip.backpack;
  const r = moveItem(newBag, { type: "grid", grid: loot }, { type: "slot", equip, slot: "backpack" });
  assert.ok(r.ok);
  assert.equal(r.displaced, old);
  assert.ok(loot.items.includes(old));
});

test("수색 전(미확인) 스택에는 합치지 않는다", () => {
  const loot = makeGrid(4, 4);
  loot.seen = new Set();
  const hidden = makeItem("9mm", 10);
  addItem(loot, hidden);
  const mine = makeItem("9mm", 30);
  assert.ok(addItem(loot, mine));
  assert.equal(hidden.count, 10, "숨은 스택은 그대로");
  assert.equal(loot.items.length, 2);
  loot.seen.add(hidden.uid);
  assert.ok(addItem(loot, makeItem("9mm", 5)));
  assert.equal(hidden.count + mine.count, 45);
});

test("루팅 그리드에서 나눈 조각은 확인된 상태", () => {
  const loot = makeGrid(4, 4);
  loot.seen = new Set();
  const ammo = makeItem("762", 40);
  addItem(loot, ammo);
  loot.seen.add(ammo.uid);
  const piece = splitStack(loot, ammo);
  assert.ok(piece && loot.seen.has(piece.uid));
});
