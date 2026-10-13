// 앱 진입점: 화면 전환과 게임 루프

import { MAPS } from "./data/maps.js";
import { h, $ } from "./core/dom.js";
import { loadProfile, saveProfile, newProfile, wipeProfile, maxHp } from "./systems/profile.js";
import { applyRaidResult, resolveAbandonedRaid } from "./systems/raidResult.js";
import { Raid } from "./game/raid.js";
import { Renderer } from "./game/render.js";
import { Input } from "./game/input.js";
import { audio } from "./game/audio.js";
import { Hideout } from "./ui/hideout.js";
import { RaidUI } from "./ui/raidui.js";
import { titleScreen, deployModal, resultsScreen, pauseModal, tutorialModal } from "./ui/screens.js";

class App {
  constructor() {
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

    window.addEventListener("resize", () => this.renderer.resize());
    window.addEventListener("beforeunload", (e) => {
      if (this.state === "raid") {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    window.addEventListener("pointerdown", () => audio.init(), { once: false });
    window.addEventListener("keydown", () => audio.init());

    // 레이드 도중 종료된 기록이 있으면 실종 처리
    if (this.profile?.inRaid) {
      const abandoned = resolveAbandonedRaid(this.profile);
      this.save();
      if (abandoned) this.pendingNotice = "지난 레이드 도중 게임이 종료되어 실종 처리되었습니다. 장비를 잃었습니다.";
    }
    if (this.profile) audio.setVolume(this.profile.settings.volume);

    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  save() {
    if (this.profile) saveProfile(this.profile);
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

  showHideout() {
    this.state = "hideout";
    document.body.dataset.state = "hideout";
    this.setModal(null);
    this.hideout?.destroy();
    this.hideout = new Hideout(this);
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
        onDeploy: (mapId) => {
          this.setModal(null);
          this.startRaid(mapId);
        },
      }),
    );
  }

  startRaid(mapId) {
    audio.init();
    this.hideout?.destroy();
    this.hideout = null;
    this.profile.inRaid = { mapId, at: Date.now() };
    this.save();
    this.pendingEnd = null;
    this.raid = new Raid(this.profile, mapId, {
      onEnd: (result) => {
        this.pendingEnd = result;
      },
    });
    this.raid.player.hp = maxHp(this.profile);
    this.raidUI = new RaidUI(this, this.raid);
    this.screen.replaceChildren(this.raidUI.root);
    this.state = "raid";
    document.body.dataset.state = "raid";
    this.paused = false;
    this.showMap = false;
    this.renderer.resize();
    this.renderer.attach(this.raid);
    audio.startAmbient(MAPS[mapId].night);
    const banner = h("div", { class: "raid-banner" }, h("b", { text: MAPS[mapId].name }), h("span", { text: `탈출 지점: ${this.raid.extracts.map((x) => x.name).join(" · ")}` }));
    this.screen.append(banner);
    setTimeout(() => banner.classList.add("out"), 3500);
    setTimeout(() => banner.remove(), 4300);
  }

  finishRaid(result) {
    audio.stopAmbient();
    this.raidUI?.destroy();
    const summary = applyRaidResult(this.profile, result);
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
    if (this.paused) {
      this.setModal(
        pauseModal({
          profile: this.profile,
          onResume: () => this.togglePause(false),
          onAbandon: () => {
            this.togglePause(false);
            this.raid.end("mia", "레이드 포기");
          },
          onVolume: (v) => {
            this.profile.settings.volume = v;
            audio.setVolume(v);
            this.save();
          },
          onToggleNumbers: (on) => {
            this.profile.settings.damageNumbers = on;
            this.save();
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

    if (!this.paused) {
      if (input.wasPressed("Tab") && raid.player.alive) ui.toggleInventory();
      if (input.wasPressed("KeyM")) this.showMap = !this.showMap;

      const aim = this.renderer.screenToWorld(input.mouse.x, input.mouse.y);
      let mx = 0;
      let my = 0;
      if (input.down("KeyW") || input.down("ArrowUp")) my -= 1;
      if (input.down("KeyS") || input.down("ArrowDown")) my += 1;
      if (input.down("KeyA") || input.down("ArrowLeft")) mx -= 1;
      if (input.down("KeyD") || input.down("ArrowRight")) mx += 1;
      const ml = Math.hypot(mx, my) || 1;
      const blockMouse = ui.invOpen || this.showMap;
      const cmd = {
        moveX: mx / ml,
        moveY: my / ml,
        aimX: aim.x,
        aimY: aim.y,
        fire: input.mouse.left && !blockMouse,
        firePressed: input.mouse.leftPressed && !blockMouse,
        ads: input.mouse.right && !blockMouse,
        sprint: input.down("ShiftLeft") || input.down("ShiftRight"),
        crouchPressed: input.wasPressed("KeyC") || input.wasPressed("ControlLeft"),
        reloadPressed: input.wasPressed("KeyR") && !ui.inv.drag,
        interactPressed: input.wasPressed("KeyF"),
        grenadePressed: input.wasPressed("KeyG"),
        slot1Pressed: input.wasPressed("Digit1"),
        slot2Pressed: input.wasPressed("Digit2"),
        swapPressed: input.mouse.wheel !== 0 && !ui.invOpen,
        quick: [input.wasPressed("Digit3"), input.wasPressed("Digit4"), input.wasPressed("Digit5"), input.wasPressed("Digit6")],
        inventoryOpen: ui.invOpen,
      };
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

    this.renderer.mouse = input.mouse;
    this.renderer.render(raid, this.paused ? 0 : dt, { showMap: this.showMap, hideCursor: ui.invOpen || this.paused || this.showMap });
    document.body.classList.toggle("cursor-hidden", !ui.invOpen && !this.paused && !this.showMap && raid.player.alive);
    ui.updateHud(dt);
    ui.hud.el.classList.toggle("map-open", this.showMap);

    if (this.pendingEnd) {
      const result = this.pendingEnd;
      this.pendingEnd = null;
      this.finishRaid(result);
    }
  }
}

window.duckscape = new App();
