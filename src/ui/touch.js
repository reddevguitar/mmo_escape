// 모바일 터치 조작: 왼쪽 이동 스틱, 오른쪽 조준 스틱(바깥 원까지 밀면 사격), 행동 버튼.
// 스틱은 손가락을 댄 자리에 생긴다. 조준 스틱에는 약한 조준 보조가 있다.

import { ITEMS } from "../data/items.js";
import { h } from "../core/dom.js";
import { DEG, angleDiff, turnToward } from "../core/util.js";

const STICK_R = 54; // 스틱 손잡이가 움직이는 반경 (CSS px)
const FIRE_AT = 0.62; // 조준 스틱을 반경의 이만큼 밀면 사격
const SPRINT_AT = 1.3; // 이동 스틱을 반경의 이 배수 넘게 끌면 달리기
const ASSIST_DEG = 9; // 조준 보조: 스틱 방향에서 이 각도 안의 적에게 붙는다
const ASSIST_RANGE = 720;
const MOVE_ZONE = 0.42; // 화면 왼쪽 이 비율까지가 이동 스틱 영역

export class TouchControls {
  /** @param press(name) 버튼 입력을 앱에 전달 (reload, swap, grenade, crouch, interact, quick0~3 …) */
  constructor({ press, onInventory, onMap, onPause, isMapOpen }) {
    this.press = press;
    this.onInventory = onInventory;
    this.onMap = onMap;
    this.onPause = onPause;
    this.isMapOpen = isMapOpen;
    this.move = null; // { id, ox, oy, x, y }
    this.aim = null;
    this.ads = false;
    this.aimOff = { x: 200, y: 0 }; // 플레이어 기준 조준점 (월드 px)
    this.aimIdle = 9;
    this.wasFiring = false;
    this.repeatT = 0;
    this.lastFireT = 0;
    this.el = this.build();
  }

  build() {
    const layer = h("div", { class: "touch-layer" });
    this.moveStick = this.stickEl("move", "이동");
    this.aimStick = this.stickEl("aim", "조준 · 사격");
    layer.append(this.moveStick.el, this.aimStick.el);
    layer.addEventListener("pointerdown", (e) => this.down(e));
    layer.addEventListener("pointermove", (e) => this.drag(e));
    layer.addEventListener("pointerup", (e) => this.up(e));
    layer.addEventListener("pointercancel", (e) => this.up(e));
    layer.addEventListener("contextmenu", (e) => e.preventDefault());

    const btn = (cls, icon, title, fn) => {
      const b = h("button", { class: `tbtn ${cls}`, "aria-label": title }, h("span", { class: "ti", text: icon }), h("small", { text: title }));
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      return b;
    };
    this.btn = {
      ads: btn("ads", "🎯", "조준", () => {
        this.ads = !this.ads;
      }),
      reload: btn("reload", "↻", "장전", () => this.press("reload")),
      swap: btn("swap", "⇄", "교체", () => this.press("swap")),
      grenade: btn("grenade", "💣", "투척", () => this.press("grenade")),
      crouch: btn("crouch", "🦆", "숙이기", () => this.press("crouch")),
      inv: btn("inv", "🎒", "가방", () => this.onInventory()),
    };
    const pause = btn("pause", "⏸", "메뉴", () => this.onPause());
    // 미니맵을 누르면 큰 지도
    const mapBtn = h("button", { class: "tbtn-map", "aria-label": "지도" });
    mapBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onMap();
    });
    this.mapBtn = mapBtn;
    const b = this.btn;
    layer.append(h("div", { class: "tbtns" }, b.inv, b.crouch, b.grenade, b.ads, b.swap, b.reload), pause, mapBtn);
    return layer;
  }

  stickEl(kind, label) {
    const knob = h("i");
    const el = h("div", { class: `stick ${kind} idle` }, knob, h("small", { text: label }));
    return { el, knob };
  }

  /** 미니맵 위치에 지도 버튼을 맞춘다 (렌더러가 그리는 크기와 같게) */
  layoutMinimap(size) {
    this.mapBtn.style.width = `${size}px`;
    this.mapBtn.style.height = `${size}px`;
  }

  // ── 포인터 ─────────────────────────────────────────

  down(e) {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    const left = e.clientX < innerWidth * MOVE_ZONE;
    const s = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now() };
    if (left && !this.move) this.move = s;
    else if (!left && !this.aim) this.aim = s;
    else return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 일부 브라우저는 캡처를 거부한다. 없어도 동작한다
    }
    this.drawSticks();
  }

  drag(e) {
    const s = this.move?.id === e.pointerId ? this.move : this.aim?.id === e.pointerId ? this.aim : null;
    if (!s) return;
    s.x = e.clientX;
    s.y = e.clientY;
    // 이동 스틱은 손가락을 따라온다 (반경의 2배 넘게 끌면 받침이 따라감)
    if (s === this.move) {
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const max = STICK_R * 2;
      if (d > max) {
        s.ox = s.x - (dx / d) * max;
        s.oy = s.y - (dy / d) * max;
      }
    }
    this.drawSticks();
  }

  up(e) {
    const s = this.move?.id === e.pointerId ? this.move : this.aim?.id === e.pointerId ? this.aim : null;
    if (!s) return;
    // 지도가 열려 있을 때 짧게 톡 치면 지도를 닫는다
    if (this.isMapOpen() && performance.now() - s.t < 260 && Math.hypot(s.x - s.ox, s.y - s.oy) < 12) this.onMap();
    if (s === this.move) this.move = null;
    else this.aim = null;
    this.drawSticks();
  }

  /** 인벤토리·일시정지로 화면이 가려질 때: 누르고 있던 스틱을 놓는다 */
  reset() {
    this.move = null;
    this.aim = null;
    this.wasFiring = false;
    this.drawSticks();
  }

  drawSticks() {
    for (const [s, ui] of [
      [this.move, this.moveStick],
      [this.aim, this.aimStick],
    ]) {
      ui.el.classList.toggle("idle", !s);
      if (!s) {
        ui.el.style.left = "";
        ui.el.style.top = "";
        ui.knob.style.transform = "";
        ui.el.classList.remove("fire", "sprint");
        continue;
      }
      ui.el.style.left = `${s.ox}px`;
      ui.el.style.top = `${s.oy}px`;
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      ui.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      ui.el.classList.toggle("fire", s === this.aim && d / STICK_R >= FIRE_AT);
      ui.el.classList.toggle("sprint", s === this.move && d > STICK_R * SPRINT_AT);
    }
  }

  // ── 매 프레임 ───────────────────────────────────────

  /** 이번 프레임의 조작 명령 (raid.update의 cmd 일부) */
  read(raid, dt) {
    const p = raid.player;
    let moveX = 0;
    let moveY = 0;
    let sprint = false;
    if (this.move) {
      const dx = this.move.x - this.move.ox;
      const dy = this.move.y - this.move.oy;
      const d = Math.hypot(dx, dy);
      if (d > 6) {
        // 살짝 밀면 천천히(조용히) 걷는다
        const mag = Math.min(1, Math.max(0.3, d / STICK_R));
        moveX = (dx / d) * mag;
        moveY = (dy / d) * mag;
      }
      sprint = d > STICK_R * SPRINT_AT;
    }

    let firing = false;
    if (this.aim) {
      const dx = this.aim.x - this.aim.ox;
      const dy = this.aim.y - this.aim.oy;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        const mag = Math.min(1, d / STICK_R);
        const ang = Math.atan2(dy, dx);
        const dist = 150 + mag * 330;
        const target = assistTarget(raid, ang);
        this.aimOff = target ? { x: target.x - p.x, y: target.y - p.y } : { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
        firing = mag >= FIRE_AT;
        this.aimIdle = 0;
      }
    } else {
      this.aimIdle += dt;
      // 조준하지 않고 걸으면 가는 방향을 본다
      if (this.aimIdle > 0.7 && (moveX || moveY)) {
        const cur = Math.atan2(this.aimOff.y, this.aimOff.x);
        const a = turnToward(cur, Math.atan2(moveY, moveX), dt * 7);
        this.aimOff = { x: Math.cos(a) * 200, y: Math.sin(a) * 200 };
      }
    }

    // 반자동 총은 누르고 있는 동안 쏠 수 있을 때마다 방아쇠를 다시 당긴다
    let firePressed = false;
    this.repeatT -= dt;
    if (firing) {
      const w = raid.currentWeapon(p);
      if (!this.wasFiring) firePressed = true;
      else if (!w) firePressed = p.peckCd <= 0;
      else if (!p.reload && p.fireCd <= 0) {
        if (w.data.mag > 0) firePressed = !ITEMS[w.id].auto;
        else if (this.repeatT <= 0) firePressed = true; // 빈 총: 재장전 시도
      }
      if (firePressed && w && w.data.mag <= 0) this.repeatT = 0.6;
      this.lastFireT = 0;
    } else {
      this.lastFireT += dt;
    }
    this.wasFiring = firing;

    this.btn.ads.classList.toggle("on", this.ads);
    this.btn.crouch.classList.toggle("on", !!p.crouch);
    return {
      moveX,
      moveY,
      sprint,
      aimX: p.x + this.aimOff.x,
      aimY: p.y + this.aimOff.y,
      fire: firing,
      firePressed,
      ads: this.ads,
      aiming: !!this.aim || this.lastFireT < 0.8,
    };
  }
}

/** 조준 보조: 스틱 방향 가까이에 보이는 적이 있으면 그 적을 겨눈다 */
function assistTarget(raid, ang) {
  const p = raid.player;
  let best = null;
  let bestDiff = Infinity;
  for (const e of raid.enemies) {
    if (!e.alive || !e.visible || e.friendly) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > ASSIST_RANGE || d < 1) continue;
    const diff = Math.abs(angleDiff(ang, Math.atan2(e.y - p.y, e.x - p.x)));
    const allow = ASSIST_DEG * DEG + Math.atan(e.r / d);
    if (diff <= allow && diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
}
