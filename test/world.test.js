import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap } from "../src/world/mapgen.js";
import { T, TS } from "../src/world/map.js";
import { Pathfinder } from "../src/world/pathfind.js";
import { MAPS } from "../src/data/maps.js";
import { Raid } from "../src/game/raid.js";
import { newProfile } from "../src/systems/profile.js";
import { makeItem } from "../src/systems/inventory.js";

function reachableFrom(m, sx, sy) {
  const seen = new Uint8Array(m.w * m.h);
  const q = [sy * m.w + sx];
  seen[q[0]] = 1;
  for (let i = 0; i < q.length; i++) {
    const x = q[i] % m.w;
    const y = Math.floor(q[i] / m.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!m.inBounds(nx, ny)) continue;
      const ni = ny * m.w + nx;
      if (!seen[ni] && m.isWalkableForAI(nx, ny)) {
        seen[ni] = 1;
        q.push(ni);
      }
    }
  }
  return seen;
}

for (const id of Object.keys(MAPS)) {
  test(`맵 생성: ${id}`, () => {
    const t0 = performance.now();
    const m = generateMap(MAPS[id]);
    assert.ok(performance.now() - t0 < 2000, "생성 시간");
    const again = generateMap(MAPS[id]);
    assert.deepEqual(Buffer.from(again.tiles), Buffer.from(m.tiles), "같은 시드는 같은 지형");

    assert.ok(m.extracts.length >= 4, "탈출구 4개 이상");
    assert.ok(m.playerSpawns.length >= 4, "플레이어 스폰 4개 이상");
    assert.ok(m.enemySpawns.length >= 20, "적 스폰 충분");
    assert.ok(m.containers.length >= 40, "컨테이너 충분");

    const s = m.playerSpawns[0];
    const seen = reachableFrom(m, Math.floor(s.x / TS), Math.floor(s.y / TS));
    for (const x of m.extracts) assert.ok(seen[m.idx(Math.floor(x.x / TS), Math.floor(x.y / TS))], `탈출구 도달 가능: ${x.name}`);
    for (const p of m.playerSpawns) assert.ok(seen[m.idx(Math.floor(p.x / TS), Math.floor(p.y / TS))], "스폰 도달 가능");
    for (const c of m.containers) {
      let ok = false;
      for (let oy = -1; oy <= 1 && !ok; oy++) for (let ox = -1; ox <= 1 && !ok; ox++) if (m.inBounds(c.tx + ox, c.ty + oy) && seen[m.idx(c.tx + ox, c.ty + oy)]) ok = true;
      assert.ok(ok, `컨테이너 접근 가능 ${c.kind}@${c.tx},${c.ty}`);
    }
    if (MAPS[id].boss) assert.ok(m.bossSpawn, "보스 스폰");
  });
}

test("A* 경로는 벽을 통과하지 않는다", () => {
  const m = generateMap(MAPS.farm);
  const pf = new Pathfinder(m);
  const a = m.playerSpawns[0];
  const b = m.extracts[0];
  const path = pf.find(a.x, a.y, b.x, b.y, 20000);
  assert.ok(path && path.length > 5);
  for (const n of path) assert.ok(m.isWalkableForAI(n.tx, n.ty));
  const last = path[path.length - 1];
  assert.ok(Math.hypot(last.x - b.x, last.y - b.y) < TS * 2, "목적지 도착");
});

test("레이캐스트: 벽은 시야를 막고 창문은 통과", () => {
  const m = generateMap(MAPS.farm);
  // 창문 하나를 찾아 그 양쪽에서 시야 확인
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.tiles[i] !== T.WINDOW) continue;
    const x = i % m.w;
    const y = Math.floor(i / m.w);
    const horiz = m.tile(x - 1, y) === T.WALL || m.tile(x + 1, y) === T.WALL || m.tile(x - 1, y) === T.WINDOW;
    const [ax, ay, bx, by] = horiz ? [x, y - 1, x, y + 1] : [x - 1, y, x + 1, y];
    if (m.isSolid(ax, ay) || m.isSolid(bx, by)) continue;
    assert.ok(m.lineClear(ax * TS + 20, ay * TS + 20, bx * TS + 20, by * TS + 20, "sight"));
    assert.ok(m.lineClear(ax * TS + 20, ay * TS + 20, bx * TS + 20, by * TS + 20, "bullet"));
    return;
  }
  assert.fail("창문 없음");
});

for (const id of Object.keys(MAPS)) {
  test(`헤드리스 레이드 30초: ${id}`, () => {
    const profile = newProfile();
    profile.equip.primary = makeItem("ak47", 1, { mag: 30, ammoId: "762" });
    let ended = null;
    const raid = new Raid(profile, id, { seed: 99, onEnd: (r) => (ended = r) });
    for (let i = 0; i < 60 * 30 && !raid.ended; i++) {
      const p = raid.player;
      const e = raid.enemies.find((x) => x.alive && x.visible);
      raid.update(1 / 60, {
        moveX: Math.cos(i / 90),
        moveY: Math.sin(i / 120),
        aimX: e ? e.x : p.x + 100,
        aimY: e ? e.y : p.y,
        fire: !!e,
        firePressed: !!e && i % 6 === 0,
        reloadPressed: i % 400 === 0,
        quick: [i === 300, false, false, false],
      });
    }
    assert.ok(raid.time > 0);
    // 탈출 구역에 서 있으면 7초 뒤 탈출
    if (!raid.ended && raid.player.alive) {
      const x = raid.extracts[0];
      raid.enemies.forEach((e) => (e.alive = false));
      raid.player.x = x.x;
      raid.player.y = x.y;
      for (let i = 0; i < 60 * 8 && !raid.ended; i++) raid.update(1 / 60, { moveX: 0, moveY: 0, aimX: x.x + 50, aimY: x.y, quick: [] });
      assert.equal(ended?.status, "extracted");
      assert.ok(ended.xp.survival >= 600);
    }
  });
}

test("재장전 중 다른 총으로 바꾸면 장전이 취소된다", () => {
  const profile = newProfile();
  profile.equip.primary = makeItem("ak47", 1, { mag: 0, ammoId: "762" });
  profile.equip.backpack.data.grid.items = [];
  const ammo = makeItem("762", 60);
  profile.equip.backpack.data.grid.items.push(ammo);
  const raid = new Raid(profile, "farm", { seed: 3 });
  raid.enemies = [];
  const idle = { moveX: 0, moveY: 0, aimX: raid.player.x + 50, aimY: raid.player.y, quick: [] };
  raid.update(1 / 60, { ...idle, reloadPressed: true });
  assert.ok(raid.player.reload, "장전 시작");
  // 인벤토리에서 주무기 슬롯에 권총을 넣는다 (기존 AK는 창고로 간 셈)
  const pistol = makeItem("p9", 1, { mag: 3, ammoId: "9mm" });
  profile.equip.primary = pistol;
  for (let i = 0; i < 60 * 4; i++) raid.update(1 / 60, idle);
  assert.equal(pistol.data.ammoId, "9mm");
  assert.equal(pistol.data.mag, 3);
  assert.equal(ammo.count, 60, "7.62 탄은 소모되지 않음");
});
