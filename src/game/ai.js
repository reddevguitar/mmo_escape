// 적 AI: 순찰 → 의심 → 교전 → 수색 상태 기계

import { ITEMS } from "../data/items.js";
import { DEG, angleDiff, turnToward, dist } from "../core/util.js";

const PREF_DIST = { pistol: 260, smg: 280, shotgun: 170, rifle: 420, dmr: 600, lmg: 420 };

export function initAI(raid, e, mode = "patrol") {
  e.ai = {
    state: mode === "guard" ? "guard" : "idle",
    mode,
    home: { x: e.x, y: e.y },
    target: null,
    path: null,
    pathIdx: 0,
    repathT: 0,
    alert: 0,
    sees: false,
    seeT: 0,
    lostT: 99,
    lastSeen: null,
    reactT: 0,
    burstT: 0,
    pauseT: raid.rng.range(0.2, 0.6),
    strafeDir: raid.rng.chance(0.5) ? 1 : -1,
    strafeT: 0,
    waitT: raid.rng.range(0.5, 4),
    lookT: 0,
    lookAngle: e.angle,
    thinkT: raid.rng.range(0, 0.1),
    stuckT: 0,
    lastPos: { x: e.x, y: e.y },
    searchLeft: 0,
    healT: 0,
    grenades: e.type === "raider" && raid.rng.chance(0.45) ? 1 : 0,
    prevState: null,
  };
}

function weaponClass(e) {
  const w = e.equip[e.weaponSlot];
  return w ? ITEMS[w.id].wclass : "pistol";
}

function setState(raid, e, state) {
  const a = e.ai;
  if (a.state === state) return;
  a.prevState = a.state;
  a.state = state;
  a.path = null;
  a.pathIdx = 0;
  a.repathT = 0;
  a.stuckT = 0;
  if (state === "combat") {
    a.reactT = e.def.react * raid.rng.range(0.85, 1.3);
    a.burstT = 0;
    a.pauseT = raid.rng.range(0.05, 0.3);
  }
}

function goTo(raid, e, x, y) {
  const a = e.ai;
  a.target = { x, y };
  // 고양이는 문을 못 연다: 열린 문으로만 다닌다
  a.path = raid.pathfinder.find(e.x, e.y, x, y, 3500, !e.melee);
  a.pathIdx = 0;
  a.repathT = 0.9;
}

function followPath(raid, e, speedMul, dt, face = true) {
  const a = e.ai;
  if (!a.path || a.pathIdx >= a.path.length) return false;
  let node = a.path[a.pathIdx];
  while (node && dist(e.x, e.y, node.x, node.y) < 14) {
    a.pathIdx += 1;
    node = a.path[a.pathIdx];
  }
  if (!node) return false;
  // 닫힌 문은 열고 지나간다
  if (!e.melee && raid.map.isDoor(node.tx, node.ty) && raid.map.isSolid(node.tx, node.ty) && dist(e.x, e.y, node.x, node.y) < 60) {
    raid.openDoorBy(e, node.tx, node.ty);
  }
  const dx = node.x - e.x;
  const dy = node.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  raid.moveActor(e, dx / d, dy / d, e.def.speed * speedMul, dt);
  if (face) e.angle = turnToward(e.angle, Math.atan2(dy, dx), 6 * dt);
  return true;
}

function randomPointNear(raid, x, y, radius) {
  for (let i = 0; i < 12; i++) {
    const ang = raid.rng.range(-Math.PI, Math.PI);
    const r = raid.rng.range(radius * 0.3, radius);
    const p = raid.map.nearestOpen(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 2);
    if (p && raid.map.lineClear(x, y, p.x, p.y, "bullet")) return p;
    if (p && i > 6) return p;
  }
  return null;
}

/** 고양이가 직선으로 달려들 수 있는지 (몸이 걸리는 장애물 확인) */
function walkClear(map, x0, y0, x1, y1, r) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 18);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (map.circleBlocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r * 0.9)) return false;
  }
  return true;
}

function perceive(raid, e, dt) {
  const a = e.ai;
  const p = raid.player;
  a.sees = false;
  if (!p.alive || e.friendly) return;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy);
  let view = e.def.view;
  if (raid.def.night && !e.def.nightVision && raid.time - p.lastShotT > 0.6) view *= 0.6;
  if (d > view) return;
  const ang = Math.atan2(dy, dx);
  const fovHalf = (e.def.fov / 2) * DEG;
  const inFov = Math.abs(angleDiff(e.angle, ang)) < fovHalf || d < 130;
  if (!inFov) return;
  if (!raid.map.lineClear(e.x, e.y, p.x, p.y, "sight")) return;
  a.sees = true;
  if (a.state !== "combat") {
    const stance = p.crouch ? 0.55 : 1;
    const urgency = a.state === "investigate" || a.state === "search" ? 2 : 1;
    const rate = (0.9 + 2.6 * (1 - d / view)) * stance * urgency;
    a.alert = Math.min(1.2, a.alert + rate * dt);
    if (a.alert >= 0.35 && a.state !== "investigate") {
      setState(raid, e, "investigate");
      a.target = { x: p.x, y: p.y };
      raid.say(e, "alert");
    }
    e.angle = turnToward(e.angle, ang, 3 * dt);
    if (a.alert >= 1) enterCombat(raid, e);
  }
  if (a.state === "combat") {
    a.lastSeen = { x: p.x, y: p.y, t: raid.time };
  }
  if (e.melee) a.directClear = d < 420 && walkClear(raid.map, e.x, e.y, p.x, p.y, e.r);
}

export function enterCombat(raid, e, shout = true) {
  const a = e.ai;
  const p = raid.player;
  a.alert = 1.2;
  a.lastSeen = { x: p.x, y: p.y, t: raid.time };
  if (a.state !== "combat") {
    setState(raid, e, "combat");
    if (shout) raid.say(e, "combat");
    // 근처 동료에게 알림
    for (const other of raid.enemies) {
      if (other === e || !other.alive || other.friendly || other.ai.state === "combat") continue;
      const near = dist(other.x, other.y, e.x, e.y) < 420;
      const sameGroup = (e.boss && other.leader === e) || (e.leader && (other === e.leader || other.leader === e.leader));
      if (near || sameGroup) {
        if (sameGroup || raid.rng.chance(0.7)) {
          other.ai.alert = Math.max(other.ai.alert, 0.6);
          setState(raid, other, "search");
          other.ai.lastSeen = { ...a.lastSeen };
          other.ai.searchStarted = true;
          other.ai.searchLeft = 2;
          goTo(raid, other, a.lastSeen.x, a.lastSeen.y);
        }
      }
    }
  }
}

export function aiHear(raid, e, x, y, loud) {
  const a = e.ai;
  if (!e.alive || e.friendly) return;
  if (a.state === "combat") {
    if (!a.sees && loud > 0.5) a.lastSeen = { x, y, t: raid.time };
    return;
  }
  a.alert = Math.max(a.alert, 0.3 + loud * 0.3);
  // 이미 같은 곳을 조사 중이면 경로를 다시 계산하지 않는다
  if (a.state === "investigate" && a.target && dist(a.target.x, a.target.y, x, y) < 140) {
    a.waitT = Math.max(a.waitT, 2);
    return;
  }
  if (a.state !== "investigate" && raid.rng.chance(0.5)) raid.say(e, "alert");
  setState(raid, e, "investigate");
  const jitter = (1 - loud) * 120 + 30;
  const tx = x + raid.rng.range(-jitter, jitter);
  const ty = y + raid.rng.range(-jitter, jitter);
  goTo(raid, e, tx, ty);
  a.waitT = raid.rng.range(2.5, 5);
  e.ai.lookAngle = Math.atan2(y - e.y, x - e.x);
}

export function aiHit(raid, e, attacker) {
  if (!e.alive) return;
  const a = e.ai;
  if (attacker && attacker.kind === "player") {
    enterCombat(raid, e, false);
    a.reactT = Math.min(a.reactT, 0.3);
    e.angle = turnToward(e.angle, Math.atan2(attacker.y - e.y, attacker.x - e.x), 1.2);
  }
  raid.say(e, "hurt", 0.5);
}

export function updateAI(raid, e, dt) {
  const a = e.ai;
  a.thinkT -= dt;
  if (a.thinkT <= 0) {
    a.thinkT = 0.1;
    perceive(raid, e, 0.1);
    if (!a.sees && a.state !== "combat") a.alert = Math.max(0, a.alert - 0.08 * 0.1);
  }

  // 막힘 감지
  a.stuckT += dt;
  if (a.stuckT > 1.2) {
    const moved = dist(e.x, e.y, a.lastPos.x, a.lastPos.y);
    if (moved < 8 && a.path && a.pathIdx < a.path.length) {
      a.path = null;
      if (a.state === "patrol" || a.state === "idle" || a.state === "guard") a.waitT = 0;
    }
    a.lastPos = { x: e.x, y: e.y };
    a.stuckT = 0;
  }

  switch (a.state) {
    case "idle":
    case "guard":
      idle(raid, e, dt);
      break;
    case "patrol":
      if (!followPath(raid, e, 0.5, dt)) {
        setState(raid, e, a.mode === "guard" ? "guard" : "idle");
        a.waitT = raid.rng.range(2, 6);
      }
      break;
    case "investigate":
      investigate(raid, e, dt);
      break;
    case "search":
      search(raid, e, dt);
      break;
    case "combat":
      if (e.melee) meleeCombat(raid, e, dt);
      else combat(raid, e, dt);
      break;
    case "heal":
      a.healT -= dt;
      if (a.sees) {
        enterCombat(raid, e, false);
        a.state = "combat";
      } else if (a.healT <= 0) {
        e.hp = Math.min(e.maxHp, e.hp + 45);
        setState(raid, e, "search");
      }
      break;
    default:
      break;
  }
}

function idle(raid, e, dt) {
  const a = e.ai;
  a.waitT -= dt;
  a.lookT -= dt;
  if (a.lookT <= 0) {
    a.lookAngle = e.angle + raid.rng.range(-1.6, 1.6);
    a.lookT = raid.rng.range(1, 3);
  }
  e.angle = turnToward(e.angle, a.lookAngle, 1.5 * dt);
  if (a.waitT <= 0) {
    let center = a.home;
    let radius = 420;
    if (e.leader && e.leader.alive) {
      center = e.leader;
      radius = 140;
    } else if (a.mode === "guard") {
      radius = 220;
    }
    const p = randomPointNear(raid, center.x, center.y, radius);
    if (p) {
      setState(raid, e, "patrol");
      goTo(raid, e, p.x, p.y);
    } else {
      a.waitT = 2;
    }
  }
}

function investigate(raid, e, dt) {
  const a = e.ai;
  if (!a.path && a.target) goTo(raid, e, a.target.x, a.target.y);
  if (!followPath(raid, e, 0.75, dt)) {
    a.waitT -= dt;
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.lookAngle = e.angle + raid.rng.range(-2.2, 2.2);
      a.lookT = raid.rng.range(0.7, 1.6);
    }
    e.angle = turnToward(e.angle, a.lookAngle, 2.5 * dt);
    if (a.waitT <= 0) {
      a.alert = Math.min(a.alert, 0.3);
      setState(raid, e, a.mode === "guard" ? "guard" : "idle");
      a.waitT = raid.rng.range(1, 3);
    }
  }
}

function search(raid, e, dt) {
  const a = e.ai;
  if (a.sees) {
    enterCombat(raid, e);
    return;
  }
  if (!a.path) {
    if (a.searchLeft <= 0 && a.lastSeen && dist(e.x, e.y, a.lastSeen.x, a.lastSeen.y) > 40 && !a.searchStarted) {
      a.searchStarted = true;
      a.searchLeft = raid.rng.int(2, 3);
      goTo(raid, e, a.lastSeen.x, a.lastSeen.y);
    } else if (a.searchLeft > 0) {
      a.searchLeft -= 1;
      const base = a.lastSeen ?? e;
      const p = randomPointNear(raid, base.x, base.y, 260);
      if (p) goTo(raid, e, p.x, p.y);
    } else {
      a.searchStarted = false;
      a.alert = 0.4;
      setState(raid, e, a.mode === "guard" ? "guard" : "idle");
      a.waitT = raid.rng.range(2, 4);
      return;
    }
  }
  if (!followPath(raid, e, 0.85, dt)) {
    a.path = null;
  }
  // 수색 중엔 두리번
  a.lookT -= dt;
  if (a.lookT <= 0) {
    a.lookT = raid.rng.range(0.6, 1.4);
    e.angle += raid.rng.range(-0.8, 0.8);
  }
}

/** 들고양이: 엎드려 노리다 지그재그로 달려들어 할퀸다 */
function meleeCombat(raid, e, dt) {
  const a = e.ai;
  const p = raid.player;
  if (!p.alive || e.friendly) {
    setState(raid, e, "idle");
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  a.biteCd = (a.biteCd ?? 0) - dt;
  if (a.sees) {
    a.lostT = 0;
    a.lastSeen = { x: p.x, y: p.y, t: raid.time };
  } else {
    a.lostT += dt;
    if (a.lostT > 2.5) {
      setState(raid, e, "search");
      a.searchStarted = false;
      a.searchLeft = 0;
      return;
    }
  }
  e.angle = turnToward(e.angle, Math.atan2(dy, dx), 9 * dt);
  if (a.reactT > 0) {
    a.reactT -= dt;
    return;
  }
  const bite = e.def.bite;
  if (d <= e.r + p.r + bite.reach) {
    if (a.biteCd <= 0) {
      a.biteCd = bite.cooldown * raid.rng.range(0.85, 1.15);
      raid.meleeAttack(e, p, bite.damage);
    }
    // 할퀸 뒤 옆으로 살짝 돈다
    raid.moveActor(e, (-dy / d) * a.strafeDir, (dx / d) * a.strafeDir, e.def.speed * 0.35, dt);
    return;
  }
  if (a.sees && a.directClear) {
    const zig = Math.sin(raid.time * 9 + e.walkPhase) * 0.35;
    const ax = dx / d;
    const ay = dy / d;
    const mx = ax - ay * zig;
    const my = ay + ax * zig;
    const ml = Math.hypot(mx, my) || 1;
    raid.moveActor(e, mx / ml, my / ml, e.def.speed, dt);
    a.path = null;
    a.repathT = 0; // 시야가 끊기면 바로 길을 찾는다
    return;
  }
  // 경로 탐색은 시간 간격으로만. 닫힌 문 너머처럼 갈 수 없는 곳이면 더 드물게
  a.repathT -= dt;
  if (a.repathT <= 0) {
    const tgt = a.lastSeen ?? p;
    goTo(raid, e, tgt.x, tgt.y);
    a.repathT = a.path?.length ? 0.5 : 1.5;
  }
  if (!followPath(raid, e, 1, dt, true)) {
    // 더 갈 수 없으면 그 자리에서 서성인다 (창문 너머의 오리를 노려보며)
    raid.moveActor(e, (-dy / d) * a.strafeDir, (dx / d) * a.strafeDir, e.def.speed * 0.15, dt);
  }
}

function combat(raid, e, dt) {
  const a = e.ai;
  const p = raid.player;
  if (!p.alive) {
    setState(raid, e, "idle");
    return;
  }
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy);
  const angTo = Math.atan2(dy, dx);
  const w = e.equip[e.weaponSlot];
  const pref = PREF_DIST[weaponClass(e)] ?? 300;

  // 치료
  if (!e.healed && e.hp < e.maxHp * 0.35 && !a.sees && a.lostT > 0.6) {
    e.healed = true;
    a.state = "heal";
    a.healT = 3;
    raid.say(e, "hurt");
    return;
  }

  if (a.sees) {
    if (a.lostT > 1.5) a.reactT = e.def.react * raid.rng.range(0.6, 1.0);
    a.lostT = 0;
    a.seeT += dt;
    e.angle = turnToward(e.angle, angTo, 7 * dt);

    // 엄폐물 때문에 사선이 막혔으면 쏘지 않고 돌아 들어간다
    const clearShot = raid.map.shotClear(e.x, e.y, p.x, p.y, p.r);
    if (w && !e.reload && clearShot) {
      if (w.data.mag <= 0) {
        raid.startReload(e);
      } else if (a.reactT > 0) {
        a.reactT -= dt;
      } else if (a.burstT > 0) {
        a.burstT -= dt;
        if (Math.abs(angleDiff(e.angle, angTo)) < 0.3) {
          const settle = Math.max(0.6, 1 - a.seeT * 0.12);
          const pm = Math.hypot(p.vx, p.vy) > 60 ? 1.25 : 1;
          const err = raid.rng.gauss() * e.def.aimErr * DEG * (1 + d / 700) * settle * pm;
          raid.fireWeapon(e, e.angle + err);
        }
      } else {
        a.pauseT -= dt;
        if (a.pauseT <= 0) {
          a.burstT = raid.rng.range(e.def.burst[0], e.def.burst[1]);
          a.pauseT = raid.rng.range(e.def.pause[0], e.def.pause[1]);
        }
      }
    }

    // 이동: 선호 거리 유지 + 좌우 이동
    a.strafeT -= dt;
    if (a.strafeT <= 0) {
      a.strafeT = raid.rng.range(0.7, 1.8);
      a.strafeDir = raid.rng.chance(0.5) ? 1 : -1;
    }
    let mx = 0;
    let my = 0;
    let spd = e.def.speed;
    if (d > pref * 1.25 || !clearShot) {
      a.repathT -= dt;
      if (!a.path || a.repathT <= 0) goTo(raid, e, p.x, p.y);
      if (followPath(raid, e, 0.85, dt, false)) return;
    } else if (d < pref * 0.55) {
      mx = -dx / d;
      my = -dy / d;
      spd *= 0.65;
    } else {
      mx = (-dy / d) * a.strafeDir;
      my = (dx / d) * a.strafeDir;
      spd *= 0.45;
    }
    if (mx || my) {
      const before = { x: e.x, y: e.y };
      raid.moveActor(e, mx, my, spd, dt);
      if (dist(before.x, before.y, e.x, e.y) < spd * dt * 0.3) a.strafeDir *= -1;
    }
    return;
  }

  // 시야를 잃음
  a.lostT += dt;
  a.seeT = 0;
  if (w && !e.reload && w.data.mag < ITEMS[w.id].mag * 0.5) raid.startReload(e);
  if (a.grenades > 0 && a.lastSeen && a.lostT > 1.2 && a.lostT < 5) {
    const gd = dist(e.x, e.y, a.lastSeen.x, a.lastSeen.y);
    if (gd > 170 && gd < 480 && raid.rng.chance(dt * 0.8)) {
      a.grenades -= 1;
      raid.throwGrenade(e, a.lastSeen.x, a.lastSeen.y);
      raid.say(e, "grenade");
    }
  }
  if (a.lastSeen) e.angle = turnToward(e.angle, Math.atan2(a.lastSeen.y - e.y, a.lastSeen.x - e.x), 4 * dt);
  if (a.lostT > 1.2) {
    setState(raid, e, "search");
    a.searchStarted = false;
    a.searchLeft = 0;
  }
}
