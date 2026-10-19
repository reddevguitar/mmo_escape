// 앱 진입점: 화면 전환과 게임 루프

import { MAPS } from "./data/maps.js";
import { h, $ } from "./core/dom.js";
import { loadProfile, saveProfile, newProfile, wipeProfile, maxHp } from "./systems/profile.js";
import { applyRaidResult, resolveRaidOnBoot } from "./systems/raidResult.js";
import { makeScavLoadout, SCAV_COOLDOWN_MS } from "./systems/scav.js";
import { Rng } from "./core/rng.js";
import { Raid } from "./game/raid.js";
import { Renderer } from "./game/render.js";
import { Input } from "./game/input.js";
import { audio } from "./game/audio.js";
import { Hideout } from "./ui/hideout.js";
import { RaidUI } from "./ui/raidui.js";
import { TouchControls } from "./ui/touch.js";
import { titleScreen, deployModal, resultsScreen, pauseModal, tutorialModal } from "./ui/screens.js";

class App {
  /** @param boot 게임 페이지가 업데이트로 교체되기 직전의 상태 (snapshot()이 만든 것) */
  constructor(boot = {}) {
    this.canvas = $("#game");
    this.screen = $("#screen");
    this.modalRoot = $("#modal");
    this.toasts = $("#toasts");
    this.profile = loadProfile();
    this.state = "title";
    this.raid = null;
    this.raidUI = null;
    this.hideout = null;
    this.paused = false;
    this.showMap = false;
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.last = performance.now();
    // 화면 버튼(터치 버튼·퀵슬롯·상호작용 안내)으로 들어온 입력. 다음 프레임에 한 번 쓰인다
    this.uiPresses = new Set();
    this.touch = false;
    this.touchControls = new TouchControls({
      press: (name) => this.uiPresses.add(name),
      onInventory: () => this.raid?.player.alive && this.raidUI?.toggleInventory(),
      onMap: () => {
        this.showMap = !this.showMap;
      },
      onPause: () => this.togglePause(true),
      isMapOpen: () => this.showMap,
    });
    this.detectTouch();

    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.touchControls.layoutMinimap(this.renderer.minimapSize());
      if (this.raidUI?.invOpen) this.raidUI.renderInventory();
    });
    const release = () => this.touchControls.reset();
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    window.addEventListener("beforeunload", (e) => {
      if (this.state === "raid" && !this.swapping) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    window.addEventListener("pointerdown", () => audio.init(), { once: false });
    window.addEventListener("keydown", () => audio.init());
    // iOS는 touchend에서만 소리를 깨울 수 있다
    window.addEventListener("touchend", () => audio.init(), { passive: true });

    // 레이드 도중 끊긴 기록 처리. 게임 업데이트로 페이지가 바뀐 경우는 벌칙 없이 출격 전으로 되돌린다
    // (레이드 중에는 저장하지 않으므로 저장본이 곧 출격 전 상태)
    const leftover = this.profile ? resolveRaidOnBoot(this.profile, { swapped: !!boot.raid }) : null;
    if (leftover) {
      this.save();
      this.pendingNotice = {
        cancelled: "게임이 업데이트되어 진행 중이던 레이드를 취소했습니다. 장비는 출격 전 그대로입니다.",
        scav: "지난 떠돌이 출격이 도중에 끊겼습니다. 잃은 것은 없습니다.",
        mia: "지난 레이드 도중 게임이 종료되어 실종 처리되었습니다. 장비를 잃었습니다.",
      }[leftover.kind];
    }
    if (this.profile) audio.setVolume(this.profile.settings.volume);

    // 업데이트 전에 은신처에 있었다면 타이틀을 건너뛰고 같은 탭으로
    if (this.profile && boot.screen && boot.screen !== "title") this.showHideout(boot.tab);
    else this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** 게임 페이지가 새 버전으로 교체되기 직전에 불린다. 직렬화 가능한 값만 담는다 */
  snapshot() {
    this.swapping = true;
    return {
      screen: this.state,
      tab: this.hideout?.tab ?? null,
      raid: this.state === "raid" ? { mapId: this.raid?.mapId ?? null } : null,
    };
  }

  save() {
    if (this.profile) saveProfile(this.profile);
  }

  /** 마지막으로 쓴 입력 장치에 맞춰 터치 조작 화면을 켜고 끈다 */
  detectTouch() {
    const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches && !globalThis.matchMedia?.("(any-pointer: fine)").matches;
    this.setTouch(!!coarse);
    window.addEventListener("pointerdown", (e) => this.setTouch(e.pointerType !== "mouse"), { capture: true });
    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "mouse" && Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.setTouch(false);
      },
      { passive: true },
    );
  }

  setTouch(on) {
    if (this.touch === on) return;
    this.touch = on;
    document.body.classList.toggle("touch", on);
    this.renderer.touch = on;
    this.renderer.resize();
    this.touchControls.layoutMinimap(this.renderer.minimapSize());
    this.touchControls.reset();
  }

  toast(text, kind = "info") {
    const el = h("div", { class: `toast ${kind}`, text });
    this.toasts.append(el);
    setTimeout(() => el.classList.add("out"), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  setModal(el) {
    this.modalRoot.replaceChildren(...(el ? [el] : []));
  }

  // ── 화면 ───────────────────────────────────────────

  showTitle() {
    this.state = "title";
    document.body.dataset.state = "title";
    this.screen.replaceChildren(
      titleScreen({
        profile: this.profile,
        onContinue: () => {
          audio.init();
          this.showHideout();
        },
        onNew: (name) => {
          audio.init();
          wipeProfile();
          this.profile = newProfile((name || "신입 오리").trim().slice(0, 14) || "신입 오리");
          this.save();
          this.showHideout();
        },
      }),
    );
  }

  showHideout(tab) {
    this.state = "hideout";
    document.body.dataset.state = "hideout";
    this.setModal(null);
    this.hideout?.destroy();
    this.hideout = new Hideout(this);
    if (tab) this.hideout.tab = tab;
    this.hideout.show(this.screen);
    if (this.pendingNotice) {
      this.toast(this.pendingNotice, "warn");
      this.pendingNotice = null;
    }
    if (!this.profile.seenTutorial) {
      this.setModal(
        tutorialModal({
          onClose: () => {
            this.profile.seenTutorial = true;
            this.save();
            this.setModal(null);
          },
        }),
      );
    }
  }

  openDeploy() {
    audio.ui();
    this.setModal(
      deployModal({
        profile: this.profile,
        onClose: () => this.setModal(null),
        onDeploy: (mapId, mode) => {
          this.setModal(null);
          this.startRaid(mapId, { scav: mode === "scav" });
        },
      }),
    );
  }

  startRaid(mapId, { scav = false } = {}) {
    audio.init();
    this.hideout?.destroy();
    this.hideout = null;
    const now = Date.now();
    this.profile.inRaid = { mapId, at: now, scav, prevScavReadyAt: this.profile.scavReadyAt ?? 0 };
    if (scav) this.profile.scavReadyAt = now + SCAV_COOLDOWN_MS;
    this.save();
    this.pendingEnd = null;
    this.raid = new Raid(this.profile, mapId, {
      loadout: scav ? makeScavLoadout(new Rng(now >>> 0)) : null,
      onEnd: (result) => {
        this.pendingEnd = result;
      },
    });
    this.raid.player.hp = maxHp(this.profile);
    this.raidUI = new RaidUI(this, this.raid);
    this.touchControls.reset();
    this.touchControls.layoutMinimap(this.renderer.minimapSize());
    this.raidUI.root.prepend(this.touchControls.el);
    this.uiPresses.clear();
    this.screen.replaceChildren(this.raidUI.root);
    this.state = "raid";
    document.body.dataset.state = "raid";
    this.paused = false;
    this.showMap = false;
    this.renderer.resize();
    this.renderer.attach(this.raid);
    audio.startAmbient(MAPS[mapId].night);
    const banner = h(
      "div",
      { class: "raid-banner" },
      h("b", { text: scav ? `${MAPS[mapId].name} · 떠돌이` : MAPS[mapId].name }),
      h("span", { text: `탈출 지점: ${this.raid.extracts.map((x) => x.name).join(" · ")}` }),
      scav ? h("span", { text: "떠돌이 오리들은 같은 편입니다 — 먼저 쏘지 마세요" }) : null,
    );
    this.screen.append(banner);
    setTimeout(() => banner.classList.add("out"), 3500);
    setTimeout(() => banner.remove(), 4300);
  }

  finishRaid(result) {
    audio.stopAmbient();
    this.raidUI?.destroy();
    const summary = applyRaidResult(this.profile, result, { loadout: this.raid?.loadout });
    this.save();
    this.raid = null;
    this.raidUI = null;
    this.state = "results";
    document.body.dataset.state = "results";
    this.setModal(null);
    this.screen.replaceChildren(resultsScreen({ result, summary, onContinue: () => this.showHideout() }));
  }

  togglePause(force) {
    this.paused = force ?? !this.paused;
    this.touchControls.reset();
    if (this.paused) {
      this.setModal(
        pauseModal({
          profile: this.profile,
          scav: !!this.raid?.scavMode,
          onResume: () => this.togglePause(false),
          onAbandon: () => {
            this.togglePause(false);
            this.raid.end("mia", "레이드 포기");
          },
          // 레이드 중에는 저장하지 않는다(저장본은 출격 전 상태로 유지). 설정은 레이드가 끝날 때 함께 저장된다
          onVolume: (v) => {
            this.profile.settings.volume = v;
            audio.setVolume(v);
          },
          onToggleNumbers: (on) => {
            this.profile.settings.damageNumbers = on;
          },
          onToggleSoundMarkers: (on) => {
            this.profile.settings.soundMarkers = on;
          },
        }),
      );
    } else {
      this.setModal(null);
    }
  }

  // ── 루프 ───────────────────────────────────────────

  frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.input.enabled = this.state === "raid";
    if (this.state === "raid" && this.raid) this.raidFrame(dt);
    this.input.endFrame();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  raidFrame(dt) {
    const input = this.input;
    const raid = this.raid;
    const ui = this.raidUI;

    if (input.wasPressed("Escape")) {
      if (ui.invOpen) ui.toggleInventory(false);
      else if (this.showMap) this.showMap = false;
      else this.togglePause();
    }

    let touch = null;
    if (!this.paused) {
      if (input.wasPressed("Tab") && raid.player.alive) ui.toggleInventory();
      if (input.wasPressed("KeyM")) this.showMap = !this.showMap;

      let aim = this.renderer.screenToWorld(input.mouse.x, input.mouse.y);
      let mx = 0;
      let my = 0;
      if (input.down("KeyW") || input.down("ArrowUp")) my -= 1;
      if (input.down("KeyS") || input.down("ArrowDown")) my += 1;
      if (input.down("KeyA") || input.down("ArrowLeft")) mx -= 1;
      if (input.down("KeyD") || input.down("ArrowRight")) mx += 1;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const blockMouse = ui.invOpen || this.showMap || this.touch;
      const ui1 = this.uiPresses;
      if (this.touch && !ui.invOpen) {
        touch = this.touchControls.read(raid, dt);
        aim = { x: touch.aimX, y: touch.aimY };
        if (touch.moveX || touch.moveY) {
          mx = touch.moveX;
          my = touch.moveY;
        }
      }
      const cmd = {
        moveX: mx,
        moveY: my,
        aimX: aim.x,
        aimY: aim.y,
        fire: (input.mouse.left && !blockMouse) || !!touch?.fire,
        firePressed: (input.mouse.leftPressed && !blockMouse) || !!touch?.firePressed,
        ads: (input.mouse.right && !blockMouse) || !!touch?.ads,
        sprint: input.down("ShiftLeft") || input.down("ShiftRight") || !!touch?.sprint,
        crouchPressed: input.wasPressed("KeyC") || input.wasPressed("ControlLeft") || ui1.has("crouch"),
        reloadPressed: (input.wasPressed("KeyR") && !ui.inv.drag) || ui1.has("reload"),
        interactPressed: input.wasPressed("KeyF") || ui1.has("interact"),
        grenadePressed: input.wasPressed("KeyG") || ui1.has("grenade"),
        slot1Pressed: input.wasPressed("Digit1"),
        slot2Pressed: input.wasPressed("Digit2"),
        swapPressed: (input.mouse.wheel !== 0 && !ui.invOpen) || ui1.has("swap"),
        quick: [0, 1, 2, 3].map((i) => input.wasPressed(`Digit${i + 3}`) || ui1.has(`quick${i}`)),
        inventoryOpen: ui.invOpen,
      };
      ui1.clear();
      raid.update(dt, cmd);
      if (raid.wantInventory) {
        raid.wantInventory = false;
        if (!ui.invOpen) {
          const target = raid.lootTarget;
          ui.toggleInventory(true);
          raid.lootTarget = target;
        }
      }
      if (!raid.player.alive && ui.invOpen) ui.toggleInventory(false);
      if (ui.invOpen && raid.invDirty) {
        raid.invDirty = false;
        ui.renderInventory();
      }
      this.renderer.updateCamera(raid, dt, aim);
    }

    // 터치일 때 조준선은 조준 스틱이 가리키는 곳에
    this.renderer.mouse = this.touch ? this.renderer.worldToScreen(raid.player.x + this.touchControls.aimOff.x, raid.player.y + this.touchControls.aimOff.y) : input.mouse;
    const hideCursor = ui.invOpen || this.paused || this.showMap || (this.touch && !touch?.aiming);
    this.renderer.render(raid, this.paused ? 0 : dt, { showMap: this.showMap, hideCursor });
    document.body.classList.toggle("cursor-hidden", !ui.invOpen && !this.paused && !this.showMap && raid.player.alive);
    ui.updateHud(dt);
    ui.hud.el.classList.toggle("map-open", this.showMap);
    ui.root.classList.toggle("map-open", this.showMap);

    if (this.pendingEnd) {
      const result = this.pendingEnd;
      this.pendingEnd = null;
      this.finishRaid(result);
    }
  }
}

// 게임 페이지가 열린 채로 새 버전이 배포되면 뷰어가 페이지를 교체한다.
// 교체 직전 상태를 넘겨받아, 레이드 중이었다면 벌칙 없이 취소한다.
const hot = window.claude?.hot;
hot?.snapshot?.(() => window.duckscape?.snapshot() ?? {});
const start = (data) => {
  window.duckscape = new App(data ?? {});
};
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
