// 레이드(출격) 시뮬레이션: 플레이어, 무기, 탄도, 적, 루팅, 탈출

import { ITEMS } from "../data/items.js";
import { MAPS } from "../data/maps.js";
import { ENEMY_TYPES } from "../data/enemies.js";
import { CONTAINERS } from "../data/loot.js";
import { Rng } from "../core/rng.js";
import { DEG, clamp, dist, angleDiff } from "../core/util.js";
import { generateMap } from "../world/mapgen.js";
import { TS } from "../world/map.js";
import { Pathfinder } from "../world/pathfind.js";
import { computeHit, explosionDamage } from "../systems/combat.js";
import { makeGrid, addItem, addToGrids, takeItem, countItem, forEachItemDeep, gridWeight, itemWeight, removeItem, makeStacks } from "../systems/inventory.js";
import { maxHp, pmcLoadout, loadoutGrids } from "../systems/profile.js";
import { loadoutUids } from "../systems/scav.js";
import { createContainer, createEnemy, createCorpse, searchTime } from "./spawn.js";
import { initAI, updateAI, aiHear, aiHit, enterCombat } from "./ai.js";
import { audio } from "./audio.js";

const PLAYER_SPEED = 172;
const ENEMY_DAMAGE_MUL = 0.75;
const INTERACT_RANGE = 66;
export const SOUND_LIFE = { shot: 1.4, step: 0.7, boom: 2, door: 1.2, voice: 1.2 };

function keyNameFor(lock) {
  const def = Object.values(ITEMS).find((d) => d.type === "key" && d.lock === lock);
  return def ? def.name : "열쇠";
}

export class Raid {
  constructor(profile, mapId, { seed = Date.now(), onEnd = () => {}, onMessage = () => {}, loadout = null } = {}) {
    this.profile = profile;
    // 레이드에 들고 온 장비. 일반 출격은 프로필 장비 그대로, 떠돌이 출격은 무작위 지급품
    this.loadout = loadout ?? pmcLoadout(profile);
    this.scavMode = !!this.loadout.scav;
    this.def = MAPS[mapId];
    this.mapId = mapId;
    this.rng = new Rng(seed);
    this.map = generateMap(this.def);
    this.pathfinder = new Pathfinder(this.map);
    this.onEnd = onEnd;
    this.onMessage = onMessage;
    this.time = 0;
    this.timeLeft = this.def.raidTime;
    this.ended = false;
    this.result = null;

    this.bullets = [];
    this.grenades = [];
    this.particles = [];
    this.decals = [];
    this.floaters = [];
    this.feed = [];
    this.enemies = [];
    this.shake = 0;
    this.hurtFlash = 0;
    this.hitMarker = null;
    this.invDirty = true;
    this.lootTarget = null;
    this.interaction = null;
    this.extractT = 0;
    this.extractZone = null;
    this.kills = [];
    this.searched = 0;
    this.damageDealt = 0;
    this.unlocks = 0;
    this.sounds = [];
    this.scavHostile = false;
    this.nextContainerId = 0;
    this.reinforceT = this.rng.range(this.def.reinforce.every[0], this.def.reinforce.every[1]);

    this.containers = this.map.containers.map((spec) => {
      const c = createContainer(spec, this.rng, this.def.lootMul);
      c.grid.seen = new Set();
      c.grid.owner = c;
      return c;
    });

    this.setupPlayer();
    this.setupExtracts();
    this.setupEnemies();
    this.startValue = this.carriedValue();
    this.startUids = loadoutUids(this.loadout);
  }

  /** 레이드 중 들고 다니는 그리드 (주머니, 가방, 보안 컨테이너) */
  carried() {
    return loadoutGrids(this.loadout);
  }

  // ── 초기화 ──────────────────────────────────────────

  setupPlayer() {
    const spawn = this.rng.pick(this.map.playerSpawns);
    const p = this.profile;
    this.player = {
      kind: "player",
      team: "player",
      name: p.name,
      x: spawn.x,
      y: spawn.y,
      r: 14,
      angle: Math.atan2(this.map.h * TS * 0.5 - spawn.y, this.map.w * TS * 0.5 - spawn.x),
      vx: 0,
      vy: 0,
      hp: maxHp(p),
      maxHp: maxHp(p),
      alive: true,
      equip: this.loadout.equip,
      weaponSlot: this.loadout.equip.primary ? "primary" : "secondary",
      fireCd: 0,
      reload: null,
      bloom: 0,
      stamina: 100,
      exhausted: false,
      sprintCd: 0,
      energy: 100,
      water: 100,
      bleeding: false,
      stamBuffT: 0,
      crouch: false,
      sprinting: false,
      ads: false,
      using: null,
      peckCd: 0,
      pecking: 0,
      walkPhase: 0,
      stepT: 0,
      lastShotT: -10,
      triggerHeld: false,
      hurtT: 0,
      killer: null,
    };
    this.map.markExplored(spawn.x, spawn.y, 8);
  }

  setupExtracts() {
    const p = this.player;
    const all = [...this.map.extracts];
    const sorted = all.filter((x) => !x.special).sort((a, b) => dist(b.x, b.y, p.x, p.y) - dist(a.x, a.y, p.x, p.y));
    const chosen = sorted.slice(0, Math.min(3, sorted.length));
    const special = all.find((x) => x.special);
    if (special && this.rng.chance(0.6)) chosen.push(special);
    this.extracts = chosen;
  }

  setupEnemies() {
    const p = this.player;
    const spawns = this.rng.shuffle([...this.map.enemySpawns]).filter((s) => dist(s.x, s.y, p.x, p.y) > 900 && !s.boss);
    let si = 0;
    for (const [type, count] of Object.entries(this.def.enemies)) {
      for (let i = 0; i < count && si < spawns.length; i++) {
        const s = spawns[si++];
        this.addEnemy(type, s.x, s.y);
      }
    }
    if (this.def.boss && this.map.bossSpawn) {
      const b = this.map.bossSpawn;
      const boss = this.addEnemy(this.def.boss.type, b.x, b.y, { mode: "guard" });
      for (let i = 0; i < this.def.boss.guards; i++) {
        const gp = this.map.nearestOpen(b.x + this.rng.range(-90, 90), b.y + this.rng.range(-90, 90), 3) ?? b;
        this.addEnemy("raider", gp.x, gp.y, { mode: "guard", guard: true, leader: boss });
      }
    }
  }

  addEnemy(type, x, y, opts = {}) {
    const e = createEnemy(this.rng, type, x, y, opts);
    // 떠돌이 출격이면 떠돌이 오리들은 같은 편 (먼저 쏘기 전까지)
    if (this.scavMode && type === "scav" && !this.scavHostile) e.friendly = true;
    if (e.melee) e.healed = true;
    initAI(this, e, opts.mode ?? "patrol");
    this.enemies.push(e);
    return e;
  }

  // ── 메인 업데이트 ─────────────────────────────────────

  update(dt, cmd) {
    if (this.ended) return;
    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.end("mia", "시간 초과");
      return;
    }

    this.updatePlayer(dt, cmd);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.moving = false;
      updateAI(this, e, dt);
      this.updateWeaponState(e, dt);
      if (e.speechT > 0) e.speechT -= dt;
      if (e.hurtT > 0) e.hurtT -= dt;
      if (e.pecking > 0) e.pecking -= dt;
    }
    this.separateActors();
    this.updateVisibility(dt);
    this.updateBullets(dt);
    this.updateGrenades(dt);
    this.updateEffects(dt);
    this.updateReinforcements(dt);
    if (this.player.alive) this.updateExtraction(dt);
    if (this.sounds.length) this.sounds = this.sounds.filter((s) => this.time - s.t < (SOUND_LIFE[s.kind] ?? 1));
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    if (this.hitMarker) {
      this.hitMarker.t -= dt;
      if (this.hitMarker.t <= 0) this.hitMarker = null;
    }
    this.feed = this.feed.filter((f) => this.time - f.t < 7);
  }

  playerVision() {
    const p = this.player;
    const night = this.def.night;
    const ads = p.ads;
    return {
      viewDist: (night ? 560 : 1000) * (ads ? 1.2 : 1),
      fov: (ads ? 72 : 112) * DEG,
      near: night ? 150 : 185,
    };
  }

  canPlayerSee(x, y, r = 0) {
    const p = this.player;
    const v = this.playerVision();
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > v.viewDist + r) return false;
    if (d > v.near + r) {
      const a = Math.atan2(dy, dx);
      const slack = d > 0 ? Math.atan(r / d) : 0;
      if (Math.abs(angleDiff(p.angle, a)) > v.fov / 2 + slack) return false;
    }
    return this.map.lineClear(p.x, p.y, x, y, "sight");
  }

  updateVisibility(dt) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.visible = this.player.alive ? this.canPlayerSee(e.x, e.y, e.r * 0.8) : true;
      e.seenAlpha = clamp((e.seenAlpha ?? 0) + (e.visible ? dt * 8 : -dt * 4), 0, 1);
    }
  }

  // ── 플레이어 ─────────────────────────────────────────

  currentWeapon(actor) {
    return actor.equip[actor.weaponSlot] ?? null;
  }

  carriedWeight() {
    let w = 0;
    for (const slot of Object.keys(this.loadout.equip)) {
      const item = this.loadout.equip[slot];
      if (item) w += itemWeight(item);
    }
    w += gridWeight(this.loadout.pockets) + (this.loadout.secure ? gridWeight(this.loadout.secure) : 0);
    return w;
  }

  speedMultiplier() {
    const p = this.player;
    const weight = this.carriedWeight();
    let mul = 1;
    if (weight > 22) mul -= Math.min(0.45, (weight - 22) * 0.013);
    const armor = p.equip.armor ? ITEMS[p.equip.armor.id] : null;
    if (armor) mul -= armor.slow;
    const w = this.currentWeapon(p);
    if (w) mul *= ITEMS[w.id].moveMul ?? 1;
    return mul;
  }

  updatePlayer(dt, cmd) {
    const p = this.player;
    if (!p.alive) return;
    const map = this.map;

    // 상태 효과
    p.energy = Math.max(0, p.energy - dt / 9.5);
    p.water = Math.max(0, p.water - (dt / 7) * (p.sprinting ? 1.6 : 1));
    if (p.energy <= 0) this.damagePlayerRaw(0.35 * dt, "굶주림");
    if (p.water <= 0) this.damagePlayerRaw(0.5 * dt, "탈수");
    if (p.bleeding) this.damagePlayerRaw(1.0 * dt, "출혈");
    if (!p.alive) return;
    if (p.stamBuffT > 0) p.stamBuffT -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.hp < p.maxHp * 0.3) audio.heartbeat();

    // 자세
    if (cmd.crouchPressed) p.crouch = !p.crouch;
    p.ads = !!cmd.ads && !cmd.inventoryOpen;
    const moving = Math.hypot(cmd.moveX, cmd.moveY) > 0.1;
    const wantSprint = cmd.sprint && moving && !p.ads && !p.using && !cmd.fire;
    if (p.stamina <= 0) p.exhausted = true;
    if (p.exhausted && p.stamina > 30) p.exhausted = false;
    p.sprinting = wantSprint && !p.exhausted;
    if (p.sprinting) {
      p.crouch = false;
      p.stamina = Math.max(0, p.stamina - 17 * dt);
      p.sprintCd = 0.8;
    } else {
      p.sprintCd -= dt;
      if (p.sprintCd <= 0) p.stamina = Math.min(100, p.stamina + 13 * dt * (p.stamBuffT > 0 ? 2 : 1));
    }

    // 이동
    let speed = PLAYER_SPEED * this.speedMultiplier();
    if (p.sprinting) speed *= 1.6;
    else if (p.crouch) speed *= 0.55;
    if (p.ads) speed *= 0.65;
    if (p.using) speed *= 0.5;
    const tvx = cmd.moveX * speed;
    const tvy = cmd.moveY * speed;
    const accel = Math.min(1, dt * 14);
    p.vx += (tvx - p.vx) * accel;
    p.vy += (tvy - p.vy) * accel;
    this.integrate(p, dt);
    const spd = Math.hypot(p.vx, p.vy);
    if (spd > 20) p.walkPhase += dt * spd * 0.06;

    // 발소리
    p.stepT -= dt * (spd / 170);
    if (spd > 30 && p.stepT <= 0) {
      p.stepT = p.sprinting ? 0.3 : 0.42;
      const radius = p.sprinting ? 400 : p.crouch ? 70 : 210;
      this.noise(p.x, p.y, radius, 0.25, p);
      audio.footstep(0, 0, p.crouch);
      if (p.sprinting && this.rng.chance(0.5)) this.spawnParticle("dust", p.x, p.y, { life: 0.5 });
    }

    // 조준
    p.angle = Math.atan2(cmd.aimY - p.y, cmd.aimX - p.x);
    p.aimDist = Math.hypot(cmd.aimY - p.y, cmd.aimX - p.x);

    // 무기 교체 (인벤토리에서 들고 있던 총을 뺐으면 다른 슬롯으로)
    if (!p.equip[p.weaponSlot]) {
      const other = p.weaponSlot === "primary" ? "secondary" : "primary";
      if (p.equip[other]) this.switchWeapon(p, other);
    }
    if (cmd.slot1Pressed) this.switchWeapon(p, "primary");
    if (cmd.slot2Pressed) this.switchWeapon(p, "secondary");
    if (cmd.swapPressed) this.switchWeapon(p, p.weaponSlot === "primary" ? "secondary" : "primary");

    this.updateWeaponState(p, dt);
    this.updateUse(dt);
    if (p.peckCd > 0) p.peckCd -= dt;
    if (p.pecking > 0) p.pecking -= dt;

    if (cmd.reloadPressed && !cmd.inventoryOpen) this.startReload(p);

    // 사격
    if (!cmd.inventoryOpen && !p.using) {
      const w = this.currentWeapon(p);
      if (w) {
        const def = ITEMS[w.id];
        const trigger = def.auto ? cmd.fire : cmd.firePressed;
        if (trigger) {
          if (w.data.mag <= 0 && !p.reload) {
            if (cmd.firePressed) {
              audio.dryFire();
              this.startReload(p);
            }
          } else if (!p.sprinting || cmd.firePressed) {
            p.sprinting = false;
            this.fireWeapon(p, p.angle);
          }
        }
      } else if (cmd.firePressed) {
        this.peck(p);
      }
    }

    if (cmd.grenadePressed && !cmd.inventoryOpen) this.playerThrowGrenade(cmd.aimX, cmd.aimY);

    // 퀵슬롯 (주머니 1~4)
    cmd.quick?.forEach((pressed, i) => {
      if (!pressed) return;
      const item = this.loadout.pockets.items.find((it) => it.x === i && it.y === 0);
      if (item) this.useItem(item, this.loadout.pockets);
    });

    // 상호작용
    this.findInteraction();
    if (cmd.interactPressed && this.interaction) this.interact(this.interaction);

    // 루팅 대상과 멀어지면 닫기
    if (this.lootTarget && !this.inRange(this.lootTarget, 30)) {
      this.lootTarget = null;
      this.invDirty = true;
    }
    if (this.lootTarget && cmd.inventoryOpen) this.updateSearch(dt, this.lootTarget);

    map.markExplored(p.x, p.y, 7);
  }

  integrate(actor, dt) {
    const map = this.map;
    actor.x += actor.vx * dt;
    let res = map.resolveCircle(actor.x, actor.y, actor.r);
    actor.x = res.x;
    actor.y = res.y;
    actor.y += actor.vy * dt;
    res = map.resolveCircle(actor.x, actor.y, actor.r);
    actor.x = res.x;
    actor.y = res.y;
  }

  /** AI가 사용하는 이동 (속도 직접 지정) */
  moveActor(actor, dx, dy, speed, dt) {
    actor.vx = dx * speed;
    actor.vy = dy * speed;
    this.integrate(actor, dt);
    actor.walkPhase += dt * speed * 0.06;
    actor.moving = true;
    // 오리의 발소리 (고양이는 소리 없이 다가온다)
    if (actor.kind === "enemy" && !actor.melee) {
      actor.stepT = (actor.stepT ?? Math.random() * 0.4) - dt * (speed / 170);
      if (actor.stepT <= 0) {
        actor.stepT = 0.42;
        const p = this.player;
        const d = dist(actor.x, actor.y, p.x, p.y);
        if (d < 520) {
          audio.footstep(d, clamp((actor.x - p.x) / 700, -1, 1), false);
          if (!actor.visible) this.addSound(actor.x, actor.y, "step");
        }
      }
    }
  }

  /** 시야 밖의 소리를 화면에 방향 표시로 남긴다 */
  addSound(x, y, kind) {
    const p = this.player;
    if (dist(x, y, p.x, p.y) > 1700) return;
    this.sounds.push({ x, y, kind, t: this.time });
    if (this.sounds.length > 48) this.sounds.shift();
  }

  separateActors() {
    const actors = [this.player, ...this.enemies].filter((a) => a.alive);
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i];
        const b = actors[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
        for (const c of [a, b]) {
          const r = this.map.resolveCircle(c.x, c.y, c.r);
          c.x = r.x;
          c.y = r.y;
        }
      }
    }
  }

  switchWeapon(actor, slot) {
    if (actor.weaponSlot === slot) return;
    if (!actor.equip[slot] && actor.equip[actor.weaponSlot]) return;
    actor.weaponSlot = slot;
    actor.reload = null;
    actor.fireCd = Math.max(actor.fireCd, 0.35);
    if (actor === this.player) {
      actor.using = null;
      audio.reload(0);
    }
  }

  // ── 무기 ───────────────────────────────────────────

  updateWeaponState(actor, dt) {
    if (actor.fireCd > 0) actor.fireCd -= dt;
    const w = this.currentWeapon(actor);
    if (w) {
      const def = ITEMS[w.id];
      actor.bloom = Math.max(0, actor.bloom - def.recover * dt);
    }
    if (actor.reload) this.updateReload(actor, dt);
  }

  findReloadAmmo(weapon) {
    const def = ITEMS[weapon.id];
    const grids = this.carried();
    if (weapon.data.ammoId && countItem(grids, weapon.data.ammoId) > 0) return weapon.data.ammoId;
    let best = null;
    let bestCount = 0;
    for (const grid of grids) {
      forEachItemDeep(grid, (item) => {
        const adef = ITEMS[item.id];
        if (adef.type !== "ammo" || adef.caliber !== def.caliber) return;
        const n = countItem(grids, item.id);
        if (n > bestCount) {
          best = item.id;
          bestCount = n;
        }
      });
    }
    return best;
  }

  reserveAmmo(weapon) {
    if (!weapon) return 0;
    const def = ITEMS[weapon.id];
    const grids = this.carried();
    let n = 0;
    for (const grid of grids) {
      forEachItemDeep(grid, (item) => {
        const adef = ITEMS[item.id];
        if (adef.type === "ammo" && adef.caliber === def.caliber) n += item.count;
      });
    }
    return n;
  }

  startReload(actor) {
    const w = this.currentWeapon(actor);
    if (!w || actor.reload) return false;
    const def = ITEMS[w.id];
    if (actor.kind === "enemy") {
      if (w.data.mag >= def.mag) return false;
      actor.reload = { t: 0, dur: def.reloadType === "single" ? def.reload * Math.min(def.mag, 4) : def.reload * 1.1, ammoId: w.data.ammoId, weapon: w };
      return true;
    }
    const ammoId = this.findReloadAmmo(w);
    if (!ammoId) {
      this.message("탄약이 없습니다", "#ff8a7a");
      return false;
    }
    if (w.data.mag >= def.mag && w.data.ammoId === ammoId) return false;
    actor.using = null;
    actor.reload = { t: 0, dur: def.reload, ammoId, single: def.reloadType === "single", weapon: w };
    audio.reload(0);
    this.noise(actor.x, actor.y, 140, 0.2, actor);
    return true;
  }

  updateReload(actor, dt) {
    const r = actor.reload;
    const w = this.currentWeapon(actor);
    // 장전 도중 손에 든 총이 바뀌었으면(인벤토리에서 교체 등) 취소
    if (!w || w !== r.weapon) {
      actor.reload = null;
      return;
    }
    const def = ITEMS[w.id];
    r.t += dt;
    if (r.t < r.dur) return;
    if (actor.kind === "enemy") {
      w.data.mag = def.mag;
      actor.reload = null;
      return;
    }
    const grids = this.carried();
    if (w.data.mag > 0 && w.data.ammoId !== r.ammoId) {
      // 다른 탄종이 들어 있으면 빼서 인벤토리로
      for (const stack of makeStacks(w.data.ammoId, w.data.mag)) {
        if (!addToGrids(grids, stack)) this.dropToGround(stack);
      }
      w.data.mag = 0;
    }
    if (r.single) {
      const got = takeItem(grids, r.ammoId, 1);
      if (got > 0) {
        w.data.mag += 1;
        w.data.ammoId = r.ammoId;
        audio.reload(1);
      }
      if (got > 0 && w.data.mag < def.mag && countItem(grids, r.ammoId) > 0) {
        r.t = 0;
      } else {
        actor.reload = null;
      }
    } else {
      const got = takeItem(grids, r.ammoId, def.mag - w.data.mag);
      w.data.mag += got;
      w.data.ammoId = r.ammoId;
      audio.reload(1);
      actor.reload = null;
    }
    this.invDirty = true;
  }

  fireWeapon(actor, angle) {
    const w = this.currentWeapon(actor);
    if (!w || actor.fireCd > 0) return false;
    const def = ITEMS[w.id];
    if (actor.reload) {
      // 산탄총은 한 발씩 장전 중 사격으로 끊을 수 있다
      if (actor.reload.single && w.data.mag > 0) actor.reload = null;
      else return false;
    }
    if (w.data.mag <= 0 || !w.data.ammoId) return false;
    w.data.mag -= 1;
    // 적은 사람처럼 방아쇠를 당기므로 최대 연사력보다 느리게 쏜다
    actor.fireCd = (60 / def.rpm) * (actor.kind === "enemy" ? (def.auto ? 1.2 : 1.7) : 1);
    const ammo = ITEMS[w.data.ammoId];
    const isPlayer = actor.kind === "player";

    let spread = def.spread;
    if (isPlayer) {
      const moving = Math.hypot(actor.vx, actor.vy) > 40;
      if (moving) spread *= 1.5;
      if (actor.ads) spread *= 0.5;
      if (actor.crouch) spread *= 0.75;
      spread += actor.bloom;
    } else {
      spread = spread * 0.6 + actor.bloom * 0.5;
    }
    const pellets = ammo.pellets ?? 1;
    const muzzleDist = actor.r + 14;
    const mx = actor.x + Math.cos(angle) * muzzleDist;
    const my = actor.y + Math.sin(angle) * muzzleDist;
    const blocked = !this.map.shotClear(actor.x, actor.y, mx, my);
    for (let i = 0; i < pellets; i++) {
      let a = angle + ((this.rng.next() + this.rng.next() - 1) * spread * DEG) / 2;
      if (pellets > 1) a += ((this.rng.next() - 0.5) * def.spread * DEG) * 1.1;
      if (blocked) {
        this.spawnParticle("spark", mx, my, { angle: a + Math.PI });
        continue;
      }
      const speed = def.speed * (pellets > 1 ? this.rng.range(0.9, 1.05) : 1);
      this.bullets.push({
        x: mx,
        y: my,
        px: mx,
        py: my,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        traveled: 0,
        range: def.range,
        maxDist: def.range * 1.6,
        ammo,
        dmgMul: def.dmg,
        owner: actor,
        ox: actor.x,
        oy: actor.y,
        team: actor.team,
        color: ammo.tracer,
        alive: true,
      });
    }
    actor.bloom = Math.min(def.spread * 3 + 5, actor.bloom + def.recoil);
    this.spawnParticle("flash", mx, my, { angle, life: 0.06, size: def.wclass === "shotgun" ? 1.4 : 1 });
    this.spawnParticle("shell", actor.x + Math.cos(angle + 1.6) * 8, actor.y + Math.sin(angle + 1.6) * 8, { angle: angle + 1.6 + this.rng.range(-0.4, 0.4) });

    const p = this.player;
    const d = dist(actor.x, actor.y, p.x, p.y);
    audio.gunshot(def.wclass, isPlayer ? 0 : d, isPlayer ? 0 : clamp((actor.x - p.x) / 700, -1, 1));
    if (isPlayer) {
      actor.lastShotT = this.time;
      this.shake = Math.min(14, this.shake + (def.wclass === "shotgun" || def.wclass === "dmr" ? 7 : 2.5));
      this.noise(actor.x, actor.y, def.noise, 1, actor);
      this.invDirty = true;
    } else {
      // 적의 총성은 다른 적들도 듣는다
      this.noise(actor.x, actor.y, def.noise * 0.6, 0.5, actor);
      if (!actor.visible) this.addSound(actor.x, actor.y, "shot");
    }
    return true;
  }

  /** 근접 공격 (들고양이의 할퀴기). 방탄복이 있으면 덜 아프다 */
  meleeAttack(attacker, target, damage) {
    attacker.pecking = 0.2;
    let dmg = damage;
    if (target.equip.armor && target.equip.armor.data.dur > 0) dmg *= 0.65;
    const angle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    const p = this.player;
    audio.scratch(dist(attacker.x, attacker.y, p.x, p.y), clamp((attacker.x - p.x) / 700, -1, 1));
    this.applyDamage(target, { damage: dmg, pen: 0, pellets: 1 }, 1, attacker, { melee: true, angle, cause: `${attacker.name}의 발톱` });
  }

  peck(actor) {
    if (actor.peckCd > 0) return;
    actor.peckCd = 0.5;
    actor.pecking = 0.18;
    const reach = actor.r + 28;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist(actor.x, actor.y, e.x, e.y);
      if (d > reach + e.r) continue;
      const a = Math.atan2(e.y - actor.y, e.x - actor.x);
      if (Math.abs(angleDiff(actor.angle, a)) > 0.9) continue;
      this.applyDamage(e, { damage: 18, pen: 0, pellets: 1 }, 1, actor, { melee: true, angle: a });
      break;
    }
    audio.click(0, 0.3);
    this.noise(actor.x, actor.y, 120, 0.2, actor);
  }

  // ── 탄도 ───────────────────────────────────────────

  updateBullets(dt) {
    const hitOut = { tx: -1, ty: -1 };
    for (const b of this.bullets) {
      if (!b.alive) continue;
      const speed = Math.hypot(b.vx, b.vy);
      const step = speed * dt;
      const dx = b.vx / speed;
      const dy = b.vy / speed;
      const wallDist = this.map.bulletCast(b.x, b.y, dx, dy, step, b.ox, b.oy, hitOut);
      let hitActor = null;
      let hitT = wallDist;
      const targets = b.team === "player" ? this.enemies : [this.player];
      for (const t of targets) {
        if (!t.alive) continue;
        const ox = t.x - b.x;
        const oy = t.y - b.y;
        const proj = ox * dx + oy * dy;
        if (proj < -t.r || proj > hitT + t.r) continue;
        const perp2 = ox * ox + oy * oy - proj * proj;
        if (perp2 > t.r * t.r) continue;
        const along = proj - Math.sqrt(Math.max(0, t.r * t.r - perp2));
        if (along < hitT) {
          hitT = Math.max(0, along);
          hitActor = t;
        }
      }
      b.px = b.x;
      b.py = b.y;
      if (hitActor) {
        b.x += dx * hitT;
        b.y += dy * hitT;
        b.traveled += hitT;
        b.alive = false;
        this.tracerTail(b);
        const falloff = b.traveled > b.range ? Math.max(0.45, 1 - (b.traveled - b.range) / b.range) : 1;
        this.applyDamage(hitActor, b.ammo, b.dmgMul * falloff, b.owner, { angle: Math.atan2(dy, dx) });
        continue;
      }
      if (wallDist < step) {
        b.x += dx * wallDist;
        b.y += dy * wallDist;
        b.alive = false;
        this.tracerTail(b);
        this.spawnParticle("spark", b.x, b.y, { angle: Math.atan2(-dy, -dx) });
        this.spawnParticle("dust", b.x, b.y, { life: 0.4 });
        const pd = dist(b.x, b.y, this.player.x, this.player.y);
        if (pd < 900) audio.impact(pd, clamp((b.x - this.player.x) / 700, -1, 1));
        continue;
      }
      b.x += dx * step;
      b.y += dy * step;
      b.traveled += step;
      if (b.traveled > b.maxDist) b.alive = false;
      // 적 근처를 스치면 알아챈다
      if (b.team === "player") {
        for (const e of this.enemies) {
          if (!e.alive || e.ai.state === "combat") continue;
          if (dist(e.x, e.y, b.x, b.y) < 70) aiHear(this, e, b.owner.x, b.owner.y, 0.9);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  /** 총알이 사라진 프레임에도 마지막 궤적이 보이도록 */
  tracerTail(b) {
    this.particles.push({ type: "tracer", x: b.px, y: b.py, x2: b.x, y2: b.y, t: 0, life: 0.05, color: b.color, vx: 0, vy: 0, rot: 0, vr: 0 });
  }

  applyDamage(target, ammo, dmgMul, attacker, { angle = 0, melee = false, cause = null } = {}) {
    if (!target.alive) return;
    if (target.friendly && attacker?.kind === "player") this.betrayScavs(target);
    const isPlayerTarget = target.kind === "player";
    let headChance = isPlayerTarget ? 0.08 : 0.1;
    if (attacker?.kind === "player" && attacker.ads) headChance += 0.08;
    const head = !melee && this.rng.chance(headChance);
    const prot = melee ? null : head ? target.equip.helmet : target.equip.armor;
    const res = computeHit(ammo, dmgMul, prot, this.rng.next());
    if (prot && res.durLoss) prot.data.dur = Math.max(0, Math.round((prot.data.dur - res.durLoss) * 10) / 10);
    let dmg = res.damage * (head ? 1.8 : 1);
    if (target.boss && attacker?.kind === "player") dmg *= 0.9;
    if (isPlayerTarget && attacker?.kind === "enemy") dmg *= ENEMY_DAMAGE_MUL;
    target.hp -= dmg;
    target.hurtT = 0.15;

    const pan = clamp((target.x - this.player.x) / 700, -1, 1);
    if (res.armored && !res.penetrated) {
      audio.hitArmor(pan);
      this.spawnParticle("spark", target.x, target.y, { angle: angle + Math.PI });
    } else {
      audio.hitFlesh(pan);
      for (let i = 0; i < (head ? 6 : 3); i++) this.spawnParticle("feather", target.x, target.y, { angle, color: target.kind === "player" ? "#fff3c4" : target.def.colors.body });
      if (this.rng.chance(0.5)) this.addDecal("blood", target.x + Math.cos(angle) * 14, target.y + Math.sin(angle) * 14);
    }

    if (isPlayerTarget) {
      this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + dmg / 80);
      this.shake = Math.min(16, this.shake + 5);
      audio.hurt();
      if (res.penetrated && dmg > 8 && this.rng.chance(0.2) && !target.bleeding) {
        target.bleeding = true;
        this.message("출혈이 시작됐다! 붕대를 사용하세요", "#ff6b6b");
      }
      if (target.using) target.using = null;
      if (target.hp <= 0) this.killPlayer(cause ?? (attacker ? `${attacker.name}의 ${this.weaponName(attacker)}` : "알 수 없음"));
    } else {
      this.damageDealt += dmg;
      if (attacker?.kind === "player") {
        this.hitMarker = { t: 0.18, kill: false, head, armor: res.armored && !res.penetrated };
        audio.hitmarker();
        if (this.profile.settings.damageNumbers) {
          this.floaters.push({
            x: target.x + this.rng.range(-8, 8),
            y: target.y - target.r - 6,
            text: `${Math.round(dmg)}${head ? "!" : ""}`,
            color: head ? "#ffd84a" : res.armored && !res.penetrated ? "#9fc6ff" : "#ffffff",
            t: 0,
            life: 0.8,
          });
        }
      }
      aiHit(this, target, attacker);
      if (target.hp <= 0) this.killEnemy(target, attacker);
    }
  }

  /** 떠돌이 출격 중 같은 편을 공격하면, 맞은 오리와 근처 떠돌이들이 적으로 돌아선다 */
  betrayScavs(victim) {
    this.scavHostile = true;
    for (const e of this.enemies) {
      if (!e.alive || !e.friendly) continue;
      if (e === victim || dist(e.x, e.y, victim.x, victim.y) < 650) {
        e.friendly = false;
        if (e !== victim) aiHear(this, e, this.player.x, this.player.y, 0.9);
      }
    }
    this.message("떠돌이 오리들이 적으로 돌아섰다!", "#ff8a7a");
  }

  weaponName(actor) {
    const w = this.currentWeapon(actor);
    return w ? ITEMS[w.id].name : "부리";
  }

  damagePlayerRaw(amount, cause) {
    const p = this.player;
    p.hp -= amount;
    if (p.hp <= 0) this.killPlayer(cause);
  }

  killEnemy(e, attacker) {
    e.alive = false;
    e.hp = 0;
    this.say(e, "die", 1, true);
    for (let i = 0; i < 12; i++) this.spawnParticle("feather", e.x, e.y, { angle: this.rng.range(-3.14, 3.14), color: e.def.colors.body });
    this.addDecal("blood", e.x, e.y, 1.6);
    const corpse = createCorpse(this.rng, e, this.def.lootMul, `k${this.nextContainerId++}`);
    corpse.grid.seen = new Set();
    corpse.grid.owner = corpse;
    this.containers.push(corpse);
    if (attacker?.kind === "player") {
      this.kills.push({ type: e.type, name: e.def.name, xp: e.def.xp, boss: e.boss });
      if (this.hitMarker) this.hitMarker.kill = true;
      this.message(`${e.def.name} 처치 (+${e.def.xp} XP)`, e.boss ? "#ffd84a" : "#e8f0ff");
    }
    if (e.boss) {
      // 보스가 죽으면 호위병이 흥분한다
      for (const g of this.enemies) if (g.alive && g.leader === e) enterCombat(this, g);
    }
  }

  killPlayer(cause) {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.killer = cause;
    for (let i = 0; i < 16; i++) this.spawnParticle("feather", p.x, p.y, { angle: this.rng.range(-3.14, 3.14), color: "#fff3c4" });
    this.addDecal("blood", p.x, p.y, 1.6);
    this.message("사망했습니다…", "#ff6b6b");
    this.deathT = 0;
    setTimeout(() => this.end("dead", cause), 1800);
  }

  // ── 수류탄 ──────────────────────────────────────────

  playerThrowGrenade(tx, ty) {
    const grids = this.carried();
    if (countItem(grids, "frag") <= 0) {
      this.message("수류탄이 없습니다", "#ff8a7a");
      return;
    }
    if (this.player.fireCd > 0.2) return;
    takeItem(grids, "frag", 1);
    this.player.fireCd = 0.6;
    this.throwGrenade(this.player, tx, ty);
    this.invDirty = true;
  }

  throwGrenade(actor, tx, ty) {
    const d = Math.min(480, dist(actor.x, actor.y, tx, ty));
    const a = Math.atan2(ty - actor.y, tx - actor.x);
    const friction = 2.4;
    const v0 = d * friction;
    this.grenades.push({
      x: actor.x + Math.cos(a) * 18,
      y: actor.y + Math.sin(a) * 18,
      vx: Math.cos(a) * v0,
      vy: Math.sin(a) * v0,
      friction,
      fuse: ITEMS.frag.fuse,
      t: 0,
      z: 0,
      owner: actor,
      spin: this.rng.range(-10, 10),
      rot: 0,
    });
    audio.click(0, 0.3);
  }

  updateGrenades(dt) {
    for (const g of this.grenades) {
      g.t += dt;
      g.rot += g.spin * dt;
      const decay = Math.exp(-g.friction * dt);
      const nx = g.x + g.vx * dt;
      if (this.map.solidAtWorld(nx, g.y) && this.map.blocksBullet(Math.floor(nx / TS), Math.floor(g.y / TS))) {
        g.vx *= -0.45;
      } else {
        g.x = nx;
      }
      const ny = g.y + g.vy * dt;
      if (this.map.solidAtWorld(g.x, ny) && this.map.blocksBullet(Math.floor(g.x / TS), Math.floor(ny / TS))) {
        g.vy *= -0.45;
      } else {
        g.y = ny;
      }
      g.vx *= decay;
      g.vy *= decay;
      g.z = g.t < 0.7 ? Math.sin((g.t / 0.7) * Math.PI) * 26 : 0;
      if (g.t >= g.fuse) {
        g.done = true;
        this.explode(g);
      }
    }
    this.grenades = this.grenades.filter((g) => !g.done);
  }

  explode(g) {
    const def = ITEMS.frag;
    const p = this.player;
    const pd = dist(g.x, g.y, p.x, p.y);
    audio.explosion(pd, clamp((g.x - p.x) / 700, -1, 1));
    this.shake = Math.min(26, this.shake + Math.max(0, 22 - pd / 40));
    this.spawnParticle("blast", g.x, g.y, { life: 0.45, size: def.radius });
    for (let i = 0; i < 14; i++) this.spawnParticle("smoke", g.x + this.rng.range(-30, 30), g.y + this.rng.range(-30, 30), { life: this.rng.range(1, 2) });
    for (let i = 0; i < 16; i++) this.spawnParticle("spark", g.x, g.y, { angle: this.rng.range(-3.14, 3.14), speed: 500 });
    this.addDecal("scorch", g.x, g.y, 1.4);
    this.noise(g.x, g.y, 1500, 1, g.owner);
    if (!this.canPlayerSee(g.x, g.y)) this.addSound(g.x, g.y, "boom");
    for (const target of [p, ...this.enemies]) {
      if (!target.alive) continue;
      const d = dist(g.x, g.y, target.x, target.y);
      if (d > def.radius + target.r) continue;
      if (!this.map.lineClear(g.x, g.y, target.x, target.y, "bullet")) continue;
      const dmg = explosionDamage(def.damage, def.radius + target.r, d, target.equip.armor);
      if (dmg <= 0) continue;
      const cause = g.owner === p ? "자신의 수류탄" : `${g.owner?.name ?? "누군가"}의 수류탄`;
      this.applyDamage(target, { damage: dmg, pen: 100, pellets: 1 }, 1, g.owner, { angle: Math.atan2(target.y - g.y, target.x - g.x), melee: true, cause });
      if (target === p && target.alive && this.rng.chance(0.5)) target.bleeding = true;
    }
  }

  // ── 소음 / 대사 ─────────────────────────────────────

  noise(x, y, radius, loud, source) {
    for (const e of this.enemies) {
      if (!e.alive || e === source) continue;
      const d = dist(e.x, e.y, x, y);
      let r = radius;
      if (!this.map.lineClear(e.x, e.y, x, y, "sight")) r *= 0.6;
      if (d < r) {
        // 적끼리의 총성은 '사수 위치'가 아니라 그 방향의 플레이어를 찾아가게
        if (source && source.kind === "enemy") {
          if (e.ai.state !== "combat" && source.ai?.lastSeen) aiHear(this, e, source.ai.lastSeen.x, source.ai.lastSeen.y, 0.4);
        } else {
          aiHear(this, e, x, y, loud * (1 - d / r) + 0.2);
        }
      }
    }
  }

  say(e, category, chance = 1, force = false) {
    if (!force && this.rng.next() > chance) return;
    if (!force && e.speechT > 0.4) return;
    let lines = e.def.quotes[category];
    if (category === "grenade") lines = ["수류탄!", "받아라 꽥!"];
    if (!lines?.length) return;
    e.speech = this.rng.pick(lines);
    e.speechT = 1.8;
    const p = this.player;
    const d = dist(e.x, e.y, p.x, p.y);
    const pan = clamp((e.x - p.x) / 700, -1, 1);
    if (e.type === "goose") audio.honk(d, pan);
    else if (e.melee) {
      if (category === "combat" || category === "hurt") audio.hiss(d, pan);
      else audio.meow(d, pan);
    } else audio.quack(d, pan, e.type === "raider" ? 0.85 : 1, category === "combat" ? 2 : 1);
    if (e.alive && !e.visible) this.addSound(e.x, e.y, "voice");
  }

  message(text, color = "#e8f0ff") {
    this.feed.push({ text, color, t: this.time });
    if (this.feed.length > 6) this.feed.shift();
    this.onMessage(text, color);
  }

  // ── 상호작용 ────────────────────────────────────────

  inRange(c, extra = 0) {
    const p = this.player;
    const range = (c.walkable ? 50 : INTERACT_RANGE) + extra;
    return dist(p.x, p.y, c.x, c.y) <= range;
  }

  findInteraction() {
    const p = this.player;
    let best = null;
    let bestD = Infinity;
    for (const c of this.containers) {
      if (!this.inRange(c)) continue;
      const d = dist(p.x, p.y, c.x, c.y) - (Math.abs(angleDiff(p.angle, Math.atan2(c.y - p.y, c.x - p.x))) < 0.8 ? 25 : 0);
      if (d < bestD) {
        bestD = d;
        best = { type: "container", target: c };
      }
    }
    // 문
    const ptx = Math.floor(p.x / TS);
    const pty = Math.floor(p.y / TS);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = ptx + ox;
        const ty = pty + oy;
        if (!this.map.isDoor(tx, ty)) continue;
        const cx = tx * TS + TS / 2;
        const cy = ty * TS + TS / 2;
        const d = dist(p.x, p.y, cx, cy);
        if (d > 62) continue;
        const facing = Math.abs(angleDiff(p.angle, Math.atan2(cy - p.y, cx - p.x))) < 1.1;
        const score = d - (facing ? 30 : 0) + 8;
        if (score < bestD) {
          bestD = score;
          const locked = this.map.isLocked(tx, ty);
          best = { type: "door", tx, ty, open: !this.map.isSolid(tx, ty), locked, hasKey: locked && !!this.findKey() };
        }
      }
    }
    this.interaction = best;
  }

  interact(it) {
    if (it.type === "door") {
      const { tx, ty } = it;
      if (this.map.isLocked(tx, ty)) {
        this.unlockDoor(tx, ty);
        return;
      }
      if (!this.map.isSolid(tx, ty)) {
        // 닫으려면 문 위에 아무도 없어야 한다
        const cx = tx * TS + TS / 2;
        const cy = ty * TS + TS / 2;
        const blocked = [this.player, ...this.enemies].some((a) => a.alive && Math.abs(a.x - cx) < TS / 2 + a.r && Math.abs(a.y - cy) < TS / 2 + a.r);
        if (blocked) return;
      }
      this.map.toggleDoor(tx, ty);
      audio.door(0, 0);
      this.noise(tx * TS, ty * TS, 220, 0.3, this.player);
    } else if (it.type === "container") {
      this.openLoot(it.target);
    }
  }

  openDoorBy(actor, tx, ty) {
    if (this.map.openDoor(tx, ty)) {
      const p = this.player;
      const d = dist(actor.x, actor.y, p.x, p.y);
      audio.door(clamp((actor.x - p.x) / 700, -1, 1), d);
      if (!actor.visible) this.addSound(tx * TS + TS / 2, ty * TS + TS / 2, "door");
    }
  }

  /** 이 지역의 잠긴 문에 맞는 열쇠를 들고 있나 */
  findKey() {
    let found = null;
    for (const grid of this.carried()) {
      forEachItemDeep(grid, (item, owner) => {
        const def = ITEMS[item.id];
        if (!found && def.type === "key" && def.lock === this.def.lock && item.data.uses > 0) found = { item, grid: owner };
      });
      if (found) break;
    }
    return found;
  }

  unlockDoor(tx, ty) {
    const key = this.findKey();
    if (!key) {
      this.message(`잠겨 있다 — ${keyNameFor(this.def.lock)} 필요`, "#ffb54a");
      audio.locked();
      return false;
    }
    key.item.data.uses -= 1;
    const left = key.item.data.uses;
    if (left <= 0) removeItem(key.grid, key.item);
    this.map.unlock(tx, ty);
    this.map.openDoor(tx, ty);
    this.unlocks += 1;
    audio.unlock();
    this.message(`🔑 ${ITEMS[key.item.id].name}(으)로 문을 열었다${left > 0 ? ` (남은 사용 ${left}회)` : " (열쇠가 닳아 없어졌다)"}`, "#ffd84a");
    this.invDirty = true;
    return true;
  }

  openLoot(c) {
    this.lootTarget = c;
    c.opened = true;
    c.searchT = 0;
    this.invDirty = true;
    this.wantInventory = true;
  }

  nextHidden(c) {
    return c.grid.items.find((item) => !c.grid.seen.has(item.uid)) ?? null;
  }

  updateSearch(dt, c) {
    const hidden = this.nextHidden(c);
    if (!hidden) {
      if (!c.counted) {
        c.counted = true;
        if (c.kind !== "ground") {
          this.searched += 1;
        }
      }
      return;
    }
    c.searchT += dt;
    audio.searchTick();
    if (c.searchT >= searchTime(hidden) * (c.kind === "corpse" ? 0.6 : 1)) {
      c.searchT = 0;
      c.grid.seen.add(hidden.uid);
      audio.reveal(ITEMS[hidden.id].rarity);
      this.invDirty = true;
    }
  }

  /** 레이드 중 아이템 버리기: 발밑 '바닥' 더미에 놓는다 */
  dropToGround(item) {
    const p = this.player;
    let pile = this.containers.find((c) => c.kind === "ground" && dist(c.x, c.y, p.x, p.y) < 40 && addItem(c.grid, item));
    if (!pile) {
      const info = CONTAINERS.ground;
      pile = {
        id: `g${this.nextContainerId++}`,
        kind: "ground",
        name: "바닥",
        x: p.x,
        y: p.y,
        walkable: true,
        grid: makeGrid(info.gw, info.gh, { kind: "loot" }),
        revealed: 0,
        searchT: 0,
        opened: true,
        counted: true,
      };
      pile.grid.seen = new Set();
      pile.grid.owner = pile;
      this.containers.push(pile);
      if (!addItem(pile.grid, item)) {
        pile.grid.w = Math.max(pile.grid.w, ITEMS[item.id].w);
        pile.grid.h += ITEMS[item.id].h;
        addItem(pile.grid, item);
      }
    }
    pile.grid.seen.add(item.uid);
    this.invDirty = true;
    return pile;
  }

  // ── 아이템 사용 ─────────────────────────────────────

  useItem(item, grid) {
    const p = this.player;
    const def = ITEMS[item.id];
    if (!p.alive || p.using) return false;
    if (def.type === "grenade") {
      this.message("수류탄은 G키(터치: 💣 버튼)로 던집니다", "#ffd84a");
      return false;
    }
    if (def.type !== "med" && def.type !== "food") return false;
    if (def.type === "med") {
      const canHeal = (def.heal ?? 0) > 0 && p.hp < p.maxHp;
      const canStop = def.stopsBleed && p.bleeding;
      if (!canHeal && !canStop) {
        this.message("지금은 필요 없습니다", "#c8d0da");
        return false;
      }
    }
    p.reload = null;
    p.using = { item, grid, t: 0, dur: def.useTime };
    return true;
  }

  updateUse(dt) {
    const p = this.player;
    const u = p.using;
    if (!u) return;
    if (p.sprinting) {
      p.using = null;
      return;
    }
    if (!u.grid.items.includes(u.item)) {
      p.using = null;
      return;
    }
    u.t += dt;
    if (u.t < u.dur) return;
    const def = ITEMS[u.item.id];
    if (def.type === "med") {
      const missing = p.maxHp - p.hp;
      let heal = Math.min(def.heal ?? 0, missing);
      if (def.pool) heal = Math.min(heal, u.item.data.uses);
      p.hp += heal;
      if (def.stopsBleed && p.bleeding) p.bleeding = false;
      if (def.pool) {
        u.item.data.uses -= Math.max(heal, def.stopsBleed ? 10 : 1);
        if (u.item.data.uses <= 0) removeItem(u.grid, u.item);
      } else {
        this.consume(u.item, u.grid);
      }
      audio.heal();
      this.message(`${def.name} 사용${heal > 0 ? ` (+${Math.round(heal)})` : ""}`, "#8fe39b");
    } else {
      if (def.energy) p.energy = clamp(p.energy + def.energy, 0, 100);
      if (def.water) p.water = clamp(p.water + def.water, 0, 100);
      if (def.heal) p.hp = Math.min(p.maxHp, p.hp + def.heal);
      if (def.stamBuff) p.stamBuffT = def.stamBuff;
      this.consume(u.item, u.grid);
      audio.eat();
      this.message(`${def.name} 섭취`, "#8fe39b");
    }
    p.using = null;
    this.invDirty = true;
  }

  consume(item, grid) {
    item.count -= 1;
    if (item.count <= 0) removeItem(grid, item);
  }

  // ── 탈출 ───────────────────────────────────────────

  updateExtraction(dt) {
    const p = this.player;
    const zone = this.extracts.find((x) => dist(p.x, p.y, x.x, x.y) < x.r);
    if (zone) {
      if (this.extractZone !== zone) {
        this.extractZone = zone;
        this.extractT = 0;
        this.lastBeep = 0;
      }
      this.extractT += dt;
      const sec = Math.floor(this.extractT);
      if (sec > (this.lastBeep ?? 0)) {
        this.lastBeep = sec;
        audio.beep(sec >= 6);
      }
      if (this.extractT >= 7) this.end("extracted", zone.name);
    } else {
      this.extractZone = null;
      this.extractT = 0;
      this.lastBeep = 0;
    }
  }

  updateReinforcements(dt) {
    this.reinforceT -= dt;
    if (this.reinforceT > 0) return;
    const rf = this.def.reinforce;
    this.reinforceT = this.rng.range(rf.every[0], rf.every[1]);
    const alive = this.enemies.filter((e) => e.alive).length;
    if (alive >= rf.max) return;
    const p = this.player;
    const spots = this.map.enemySpawns.filter((s) => !s.boss && dist(s.x, s.y, p.x, p.y) > 1000 && !this.canPlayerSee(s.x, s.y));
    if (!spots.length) return;
    const n = this.rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const s = this.rng.pick(spots);
      const e = this.addEnemy(this.rng.weighted(rf.types), s.x, s.y);
      // 지원 병력은 플레이어 쪽으로 이동해 온다
      const target = this.map.nearestOpen(p.x + this.rng.range(-400, 400), p.y + this.rng.range(-400, 400), 4);
      if (target) aiHear(this, e, target.x, target.y, 0.1);
    }
  }

  // ── 이펙트 ─────────────────────────────────────────

  spawnParticle(type, x, y, opts = {}) {
    if (this.particles.length > 600) this.particles.shift();
    const r = this.rng;
    const a = opts.angle ?? r.range(-Math.PI, Math.PI);
    const part = { type, x, y, t: 0, life: opts.life ?? 0.5, angle: a, size: opts.size ?? 1, color: opts.color, vx: 0, vy: 0, rot: r.range(0, 6.28), vr: 0, z: 0, vz: 0 };
    if (type === "spark") {
      const s = (opts.speed ?? 260) * r.range(0.4, 1);
      const aa = a + r.range(-0.7, 0.7);
      part.vx = Math.cos(aa) * s;
      part.vy = Math.sin(aa) * s;
      part.life = r.range(0.12, 0.3);
    } else if (type === "feather") {
      const s = r.range(40, 160);
      const aa = a + r.range(-1, 1);
      part.vx = Math.cos(aa) * s;
      part.vy = Math.sin(aa) * s;
      part.vr = r.range(-6, 6);
      part.life = r.range(0.9, 1.8);
    } else if (type === "shell") {
      const s = r.range(80, 140);
      part.vx = Math.cos(a) * s;
      part.vy = Math.sin(a) * s;
      part.vr = r.range(-20, 20);
      part.life = 0.6;
    } else if (type === "smoke") {
      part.vx = r.range(-15, 15);
      part.vy = r.range(-15, 15);
      part.size = r.range(30, 60);
    } else if (type === "dust") {
      part.vx = r.range(-20, 20);
      part.vy = r.range(-20, 20);
      part.size = r.range(6, 12);
    }
    this.particles.push(part);
  }

  addDecal(type, x, y, scale = 1) {
    this.decals.push({ type, x, y, scale: scale * this.rng.range(0.7, 1.2), rot: this.rng.range(0, 6.28), seed: this.rng.int(0, 9999) });
    if (this.decals.length > 220) this.decals.shift();
  }

  updateEffects(dt) {
    for (const part of this.particles) {
      part.t += dt;
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.rot += part.vr * dt;
      const drag = part.type === "feather" ? 3 : part.type === "shell" ? 5 : 2;
      part.vx *= Math.exp(-drag * dt);
      part.vy *= Math.exp(-drag * dt);
    }
    this.particles = this.particles.filter((part) => part.t < part.life);
    for (const f of this.floaters) {
      f.t += dt;
      f.y -= 30 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.t < f.life);
  }

  // ── 종료 ───────────────────────────────────────────

  carriedValue(priceFn = (item) => ITEMS[item.id].value * item.count) {
    let v = 0;
    const visit = (item) => {
      v += priceFn(item);
      if (ITEMS[item.id].type === "backpack" && item.data?.grid) forEachItemDeep(item.data.grid, (inner) => (v += priceFn(inner)));
    };
    for (const item of Object.values(this.loadout.equip)) if (item) visit(item);
    for (const grid of [this.loadout.pockets, this.loadout.secure]) if (grid) forEachItemDeep(grid, (item) => (v += priceFn(item)));
    return v;
  }

  /** 이번 레이드에서 새로 얻어 들고 나온 아이템 (가치 높은 순) */
  newItems() {
    const counts = new Map();
    const visit = (item) => {
      if (this.startUids.has(item.uid)) return;
      counts.set(item.id, (counts.get(item.id) ?? 0) + item.count);
    };
    for (const item of Object.values(this.loadout.equip)) {
      if (!item) continue;
      visit(item);
      if (ITEMS[item.id].type === "backpack" && item.data?.grid) forEachItemDeep(item.data.grid, visit);
    }
    for (const grid of [this.loadout.pockets, this.loadout.secure]) if (grid) forEachItemDeep(grid, visit);
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => ITEMS[b.id].value * b.count - ITEMS[a.id].value * a.count);
  }

  end(status, cause) {
    if (this.ended) return;
    this.ended = true;
    const survived = status === "extracted";
    const killXp = this.kills.reduce((s, k) => s + k.xp, 0);
    const searchXp = this.searched * 25;
    const survivalXp = survived ? 600 + Math.floor(this.time / 60) * 25 : 0;
    this.result = {
      status,
      cause,
      scav: this.scavMode,
      mapId: this.mapId,
      mapName: this.def.name,
      time: this.time,
      kills: this.kills,
      searched: this.searched,
      unlocks: this.unlocks,
      newItems: survived ? this.newItems() : [],
      xp: { kills: killXp, search: searchXp, survival: survivalXp, total: killXp + searchXp + survivalXp },
      startValue: this.startValue,
      endValue: survived ? this.carriedValue() : 0,
      damageDealt: Math.round(this.damageDealt),
    };
    this.lootTarget = null;
    this.onEnd(this.result);
  }
}
