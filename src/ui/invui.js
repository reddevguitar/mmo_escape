// 그리드 인벤토리 UI: 드래그 앤 드롭, 회전(R), 스택 합치기, 탄약 장전, 툴팁, 우클릭 메뉴.
// 터치: 탭하면 정보+메뉴, 길게 누르면 끌기(끄는 동안 ↻ 버튼으로 회전), 그냥 밀면 스크롤.

import { ITEMS, RARITY, TYPE_NAMES, CALIBERS, WEAPON_CLASS_NAMES, sellPrice } from "../data/items.js";
import { h } from "../core/dom.js";
import { formatMoney, formatWeight } from "../core/util.js";
import { dims, canPlace, occupantAt, moveItem, slotAccepts, loadAmmo, removeItem, itemWeight, SLOT_NAMES } from "../systems/inventory.js";
import { itemIcon } from "./icons.js";
import { audio } from "../game/audio.js";

const tooltip = h("div", { class: "tooltip hidden" });
const menu = h("div", { class: "ctx-menu hidden" });
document.body.append(tooltip, menu);
document.addEventListener("pointerdown", (e) => {
  if (!menu.contains(e.target)) hideMenu();
});

export function hideMenu() {
  menu.classList.add("hidden");
}

const LONG_PRESS_MS = 280;
const TOUCH_GHOST_LIFT = 44; // 손가락에 가리지 않게 끄는 아이템을 위로 띄운다

export function hideTooltip() {
  tooltip.classList.add("hidden");
}

export class InventoryUI {
  /**
   * ctx: {
   *   cell, mode,
   *   isHidden(item, grid), searching(grid) -> item|null,
   *   quickMove(item, from), quickLabel(item, from) -> 터치 메뉴에 보일 빠른 이동 이름|null,
   *   menuItems(item, from) -> [{label, action}],
   *   onDropZone(zone, item, from), canDropZone(zone, item),
   *   afterMove(item, from, to), changed()
   * }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.cell = ctx.cell ?? 44;
    this.drag = null;
    this.pending = null;
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onCancel = (e) => this.pointerCancel(e);
    this.onKey = (e) => {
      if (this.drag && e.code === "KeyR") {
        e.preventDefault();
        this.rotateDrag();
      }
    };
    // 터치로 끄는 중에는 화면이 스크롤되지 않게 (passive가 아니어야 막을 수 있다)
    this.onTouchMove = (e) => {
      if (this.drag?.touch && e.cancelable) e.preventDefault();
    };
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("touchmove", this.onTouchMove, { passive: false });
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("touchmove", this.onTouchMove);
    this.clearPending();
    this.cancelDrag();
  }

  // ── 뷰 생성 ─────────────────────────────────────────

  gridView(grid, opts = {}) {
    const cell = opts.cell ?? this.cell;
    const el = h("div", {
      class: `grid ${opts.class ?? ""}`,
      style: { width: `${grid.w * cell}px`, height: `${grid.h * cell}px`, "--cell": `${cell}px` },
    });
    el.dataset.drop = "grid";
    el._drop = { type: "grid", grid, cell };
    const searching = this.ctx.searching?.(grid) ?? null;
    for (const item of grid.items) {
      el.append(this.itemEl(item, { type: "grid", grid }, cell, { hidden: this.ctx.isHidden?.(item, grid), searching: item === searching, quickIndex: opts.quickKeys ? item.x : null }));
    }
    if (opts.quickKeys) {
      for (let i = 0; i < grid.w; i++) {
        el.append(h("span", { class: "quick-key", style: { left: `${i * cell + 3}px` }, text: String(i + 3) }));
      }
    }
    return el;
  }

  slotView(equip, slot, opts = {}) {
    const item = equip[slot];
    const el = h("div", { class: `slot slot-${slot} ${item ? "filled" : ""}` });
    el.dataset.drop = "slot";
    el._drop = { type: "slot", equip, slot };
    el.append(h("span", { class: "slot-label", text: SLOT_NAMES[slot] }));
    if (item) {
      const itemEl = this.itemEl(item, { type: "slot", equip, slot }, null, { fit: true });
      el.append(itemEl);
    }
    if (opts.active) el.classList.add("active");
    return el;
  }

  zoneView(zone, label, cls = "") {
    const el = h("div", { class: `drop-zone ${cls}`, text: label });
    el.dataset.drop = "zone";
    el._drop = { type: "zone", zone };
    return el;
  }

  itemEl(item, from, cell, { hidden = false, searching = false, fit = false } = {}) {
    const def = ITEMS[item.id];
    const [w, h2] = dims(item);
    const el = h("div", { class: `item rarity-${def.rarity} ${hidden ? "hidden-item" : ""} ${fit ? "fit" : ""}` });
    if (!fit) {
      Object.assign(el.style, { left: `${item.x * cell}px`, top: `${item.y * cell}px`, width: `${w * cell}px`, height: `${h2 * cell}px` });
    }
    if (hidden) {
      el.append(h("span", { class: "unknown", text: searching ? "" : "?" }));
      if (searching) el.append(h("span", { class: "spinner" }));
      return el;
    }
    const img = h("img", { src: itemIcon(item.id), draggable: false, alt: def.name });
    if (fit) {
      img.className = "fit-img";
    } else if (item.rot) {
      img.className = "rot";
      Object.assign(img.style, { width: `${def.w * cell}px`, height: `${def.h * cell}px` });
    } else {
      img.style.width = "100%";
      img.style.height = "100%";
    }
    el.append(img);
    el.append(h("span", { class: "short", text: def.short }));
    if (def.stack > 1) el.append(h("span", { class: "count", text: String(item.count) }));
    if (def.type === "weapon") {
      el.append(h("span", { class: "count ammo", text: `${item.data.mag ?? 0}/${def.mag}` }));
    }
    if (def.pool) el.append(h("span", { class: "count", text: `${Math.round(item.data.uses)}/${def.uses}` }));
    if ((def.type === "armor" || def.type === "helmet") && item.data) {
      el.append(h("span", { class: "count", text: `${Math.round(item.data.dur)}/${def.dur}` }));
    }
    if (def.type === "backpack" && item.data?.grid?.items.length) el.append(h("span", { class: "badge", text: `${item.data.grid.items.length}` }));

    el.addEventListener("pointerdown", (e) => this.pointerDown(e, item, from));
    el.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && this.showTooltip(e, item));
    el.addEventListener("pointermove", (e) => e.pointerType === "mouse" && this.moveTooltip(e));
    el.addEventListener("pointerleave", hideTooltip);
    el.addEventListener("dblclick", () => {
      const items = this.ctx.menuItems?.(item, from) ?? [];
      const primary = items.find((m) => m.primary);
      if (primary) {
        primary.action();
        this.ctx.changed();
      }
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // 안드로이드는 길게 누르면 contextmenu도 보낸다. 터치는 탭 메뉴/길게 끌기로 처리한다
      if (performance.now() - (this.lastTouch ?? -1e9) < 1500) return;
      this.openMenu(e, item, from);
    });
    return el;
  }

  // ── 툴팁 / 메뉴 ────────────────────────────────────

  showTooltip(e, item) {
    if (this.drag) return;
    const lines = this.infoLines(item);
    const hint = this.ctx.mode === "raid" ? "우클릭: 메뉴 · Shift+클릭: 빠른 이동 · 드래그 중 R: 회전" : this.ctx.mode === "trader" ? "Shift+클릭: 판매 · 우클릭: 메뉴 · 드래그 중 R: 회전" : "우클릭: 메뉴 · Shift+클릭: 빠른 이동 · 드래그 중 R: 회전";
    lines.push(h("div", { class: "tt-hint", text: hint }));
    tooltip.replaceChildren(...lines);
    tooltip.classList.remove("hidden");
    this.moveTooltip(e);
  }

  infoLines(item) {
    const def = ITEMS[item.id];
    const lines = [];
    lines.push(h("div", { class: "tt-name", style: { color: RARITY[def.rarity].color }, text: def.name }));
    lines.push(h("div", { class: "tt-type", text: `${RARITY[def.rarity].name} · ${TYPE_NAMES[def.type]}${def.wclass ? ` · ${WEAPON_CLASS_NAMES[def.wclass]}` : ""}` }));
    const stats = [];
    if (def.type === "weapon") {
      stats.push(["구경", CALIBERS[def.caliber]], ["장탄수", `${item.data.mag}/${def.mag}`], ["연사력", `${def.rpm} RPM ${def.auto ? "(자동)" : "(반자동)"}`], ["사거리", `${def.range}`], ["재장전", `${def.reload}s${def.reloadType === "single" ? " /발" : ""}`]);
      if (item.data.ammoId && item.data.mag > 0) stats.push(["장전 탄", ITEMS[item.data.ammoId].name]);
    } else if (def.type === "ammo") {
      stats.push(["구경", CALIBERS[def.caliber]], ["피해", def.pellets > 1 ? `${def.damage} x ${def.pellets}` : `${def.damage}`], ["관통력", `${def.pen}`]);
    } else if (def.type === "armor" || def.type === "helmet") {
      stats.push(["방호 등급", `${def.cls}등급`], ["내구도", `${Math.round(item.data.dur)}/${def.dur}`]);
      if (def.slow) stats.push(["이동 속도", `-${Math.round(def.slow * 100)}%`]);
    } else if (def.type === "backpack") {
      stats.push(["수납", `${def.gw} x ${def.gh}`]);
    } else if (def.type === "med") {
      if (def.heal) stats.push(["회복", def.pool ? `${def.heal}/회 (남은 ${Math.round(item.data.uses)})` : `${def.heal}`]);
      if (def.stopsBleed) stats.push(["출혈", "멈춤"]);
      stats.push(["사용 시간", `${def.useTime}s`]);
    } else if (def.type === "food") {
      if (def.energy) stats.push(["에너지", `${def.energy > 0 ? "+" : ""}${def.energy}`]);
      if (def.water) stats.push(["수분", `${def.water > 0 ? "+" : ""}${def.water}`]);
    }
    stats.push(["무게", formatWeight(itemWeight(item))], ["판매가", formatMoney(sellPrice(item))]);
    lines.push(h("div", { class: "tt-stats" }, stats.map(([k, v]) => h("div", {}, h("span", { text: k }), h("b", { text: v })))));
    if (def.desc) lines.push(h("div", { class: "tt-desc", text: def.desc }));
    return lines;
  }

  moveTooltip(e) {
    if (tooltip.classList.contains("hidden")) return;
    const pad = 16;
    const r = tooltip.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${Math.max(8, y)}px`;
  }

  /** @param info 터치: 툴팁 대신 메뉴 위에 아이템 정보를 함께 보여준다 */
  openMenu(e, item, from, { info = false } = {}) {
    hideTooltip();
    const items = [...(this.ctx.menuItems?.(item, from) ?? [])];
    const quick = info ? this.ctx.quickLabel?.(item, from) : null;
    if (quick) items.unshift({ label: quick, action: () => this.ctx.quickMove?.(item, from) });
    if (!items.length && !info) return;
    menu.classList.toggle("with-info", info);
    menu.replaceChildren(
      info ? h("div", { class: "menu-info" }, this.infoLines(item)) : h("div", { class: "menu-title", text: ITEMS[item.id].name }),
      ...items.map((m) =>
        h("button", {
          class: m.danger ? "danger" : "",
          text: m.label,
          disabled: !!m.disabled,
          onclick: () => {
            hideMenu();
            m.action();
            this.ctx.changed();
          },
        }),
      ),
    );
    menu.classList.remove("hidden");
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - r.height - 8))}px`;
  }

  // ── 드래그 ─────────────────────────────────────────

  pointerDown(e, item, from) {
    if (e.button !== 0 || this.pending || this.drag) return;
    const touch = e.pointerType !== "mouse";
    // 터치는 기본 동작(스크롤)을 막지 않는다. 길게 눌러야 끌기가 시작된다
    if (!touch) e.preventDefault();
    hideMenu();
    if (!touch && (e.shiftKey || e.ctrlKey)) {
      this.ctx.quickMove?.(item, from);
      this.ctx.changed();
      return;
    }
    this.pending = { item, from, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, el: e.currentTarget, id: e.pointerId, touch, t: performance.now() };
    if (touch) {
      this.lastTouch = performance.now();
      this.pending.timer = setTimeout(() => {
        const p = this.pending;
        if (!p || this.drag) return;
        navigator.vibrate?.(12);
        this.startDrag({ clientX: p.cx, clientY: p.cy });
      }, LONG_PRESS_MS);
    }
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
  }

  clearPending() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
  }

  startDrag(e) {
    const { item, from, el, touch, id } = this.pending;
    hideTooltip();
    hideMenu();
    const def = ITEMS[item.id];
    const ghost = h("div", { class: `drag-ghost item rarity-${def.rarity}` });
    ghost.append(h("img", { src: itemIcon(item.id), draggable: false }));
    document.body.append(ghost);
    const highlight = h("div", { class: "drop-highlight hidden" });
    this.drag = { item, from, rot: item.rot, ghost, highlight, srcEl: el, target: null, touch, id };
    el.classList.add("dragging");
    if (touch) {
      // 다른 손가락으로 누르는 회전 버튼
      const rotate = h("button", { class: "drag-rotate", text: "↻ 회전" });
      rotate.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.rotateDrag();
      });
      if (def.w !== def.h) document.body.append(rotate);
      this.drag.rotateBtn = rotate;
    }
    this.layoutGhost();
    this.pointerMove({ clientX: e.clientX, clientY: e.clientY, pointerId: id });
    if (touch) this.autoScroll();
  }

  /** 터치로 끌면서 화면 가장자리에 가면 그쪽으로 스크롤 */
  autoScroll() {
    const d = this.drag;
    if (!d) return;
    const { clientX: x, clientY: y } = this.lastPointer;
    const edge = 56;
    // 안쪽 스크롤 영역부터
    for (const el of [...document.querySelectorAll(".stash-scroll, .hideout-content, .inv-wrap, .raid-inv")].reverse()) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || el.scrollHeight <= el.clientHeight + 1) continue;
      const dy = y < r.top + edge ? -1 : y > r.bottom - edge ? 1 : 0;
      if (dy) {
        el.scrollTop += dy * 9;
        d.target = this.computeTarget(x, y - TOUCH_GHOST_LIFT);
        this.showHighlight(d.target);
        break;
      }
    }
    d.scrollRaf = requestAnimationFrame(() => this.autoScroll());
  }

  layoutGhost() {
    const d = this.drag;
    const def = ITEMS[d.item.id];
    const cell = this.cell;
    const [w, hh] = d.rot ? [def.h, def.w] : [def.w, def.h];
    Object.assign(d.ghost.style, { width: `${w * cell}px`, height: `${hh * cell}px` });
    const img = d.ghost.querySelector("img");
    if (d.rot) {
      img.className = "rot";
      Object.assign(img.style, { width: `${def.w * cell}px`, height: `${def.h * cell}px` });
    } else {
      img.className = "";
      Object.assign(img.style, { width: "100%", height: "100%" });
    }
  }

  rotateDrag() {
    const d = this.drag;
    const def = ITEMS[d.item.id];
    if (def.w === def.h) return;
    d.rot = !d.rot;
    this.layoutGhost();
    if (this.lastPointer) this.pointerMove(this.lastPointer);
  }

  pointerMove(e) {
    const id = this.drag?.id ?? this.pending?.id;
    if (id !== undefined && e.pointerId !== undefined && e.pointerId !== id) return;
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (this.pending && !this.drag) {
      const p = this.pending;
      p.cx = e.clientX;
      p.cy = e.clientY;
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.touch) {
        // 길게 누르기 전에 손가락이 움직이면 스크롤로 본다
        if (moved > 10) this.clearPending();
        return;
      }
      if (moved < 5) return;
      this.startDrag(e);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const lift = d.touch ? TOUCH_GHOST_LIFT : 0;
    const gw = parseFloat(d.ghost.style.width);
    const gh = parseFloat(d.ghost.style.height);
    d.ghost.style.left = `${e.clientX - gw / 2}px`;
    d.ghost.style.top = `${e.clientY - lift - gh / 2}px`;
    d.target = this.computeTarget(e.clientX, e.clientY - lift);
    this.showHighlight(d.target);
  }

  pointerCancel(e) {
    const id = this.drag?.id ?? this.pending?.id;
    if (e.pointerId !== id) return;
    this.clearPending();
    if (this.drag) {
      this.cancelDrag();
      this.ctx.changed();
    }
  }

  computeTarget(x, y) {
    const d = this.drag;
    const under = document.elementFromPoint(x, y);
    const dropEl = under?.closest?.("[data-drop]");
    if (!dropEl || !dropEl._drop) return null;
    const drop = dropEl._drop;
    const item = d.item;
    const def = ITEMS[item.id];
    if (drop.type === "slot") {
      const occupant = drop.equip[drop.slot];
      if (occupant && def.type === "ammo" && ITEMS[occupant.id].type === "weapon" && ITEMS[occupant.id].caliber === def.caliber) {
        return { type: "load", weapon: occupant, el: dropEl, valid: true };
      }
      return { type: "slot", equip: drop.equip, slot: drop.slot, el: dropEl, valid: slotAccepts(drop.slot, item) };
    }
    if (drop.type === "zone") {
      return { type: "zone", zone: drop.zone, el: dropEl, valid: this.ctx.canDropZone?.(drop.zone, item) ?? false };
    }
    if (drop.type === "grid") {
      const rect = dropEl.getBoundingClientRect();
      const cell = drop.cell;
      const cx = Math.floor((x - rect.left) / cell);
      const cy = Math.floor((y - rect.top) / cell);
      const occupant = occupantAt(drop.grid, cx, cy);
      if (occupant && occupant !== item && !this.ctx.isHidden?.(occupant, drop.grid)) {
        if (occupant.id === item.id && def.stack > 1) {
          return { type: "merge", grid: drop.grid, target: occupant, el: dropEl, cell, valid: occupant.count < def.stack, rect: occupant };
        }
        if (def.type === "ammo" && ITEMS[occupant.id].type === "weapon" && ITEMS[occupant.id].caliber === def.caliber) {
          return { type: "load", weapon: occupant, el: dropEl, cell, valid: true, rect: occupant };
        }
      }
      const place = (rot) => {
        const [w, hh] = rot ? [def.h, def.w] : [def.w, def.h];
        const gx = Math.round((x - rect.left) / cell - w / 2);
        const gy = Math.round((y - rect.top) / cell - hh / 2);
        return { type: "grid", grid: drop.grid, x: gx, y: gy, rot, el: dropEl, cell, w, h: hh, valid: canPlace(drop.grid, item, gx, gy, rot) };
      };
      const t = place(d.rot);
      // 터치: 지금 방향으로 안 들어가면 돌려서라도 넣는다
      if (!t.valid && d.touch && def.w !== def.h) {
        const t2 = place(!d.rot);
        if (t2.valid) return t2;
      }
      return t;
    }
    return null;
  }

  showHighlight(t) {
    const hl = this.drag.highlight;
    document.querySelectorAll(".slot.drop-ok, .slot.drop-bad, .drop-zone.drop-ok, .drop-zone.drop-bad").forEach((el) => el.classList.remove("drop-ok", "drop-bad"));
    if (!t) {
      hl.classList.add("hidden");
      return;
    }
    if (t.type === "slot" || t.type === "zone" || (t.type === "load" && !t.cell)) {
      hl.classList.add("hidden");
      t.el.classList.add(t.valid ? "drop-ok" : "drop-bad");
      return;
    }
    if (hl.parentElement !== t.el) t.el.append(hl);
    hl.classList.remove("hidden", "ok", "bad", "merge");
    hl.classList.add(t.valid ? (t.type === "grid" ? "ok" : "merge") : "bad");
    const r = t.rect ? { x: t.rect.x, y: t.rect.y, w: dims(t.rect)[0], h: dims(t.rect)[1] } : { x: t.x, y: t.y, w: t.w, h: t.h };
    Object.assign(hl.style, { left: `${r.x * t.cell}px`, top: `${r.y * t.cell}px`, width: `${r.w * t.cell}px`, height: `${r.h * t.cell}px` });
  }

  pointerUp(e) {
    const id = this.drag?.id ?? this.pending?.id;
    if (e && e.pointerId !== undefined && id !== undefined && e.pointerId !== id) return;
    const d = this.drag;
    const pending = this.pending;
    this.clearPending();
    if (!d) {
      // 터치 탭: 정보와 메뉴
      if (pending?.touch && performance.now() - pending.t < LONG_PRESS_MS + 40) this.openMenu({ clientX: pending.x, clientY: pending.y }, pending.item, pending.from, { info: true });
      return;
    }
    const t = d.target;
    this.cancelDrag();
    if (!t || !t.valid) {
      if (t && !t.valid) audio.ui();
      this.ctx.changed();
      return;
    }
    const item = d.item;
    const from = d.from;
    let result = { ok: false };
    if (t.type === "grid") {
      result = moveItem(item, from, { type: "grid", grid: t.grid, x: t.x, y: t.y, rot: t.rot });
    } else if (t.type === "merge") {
      result = moveItem(item, from, { type: "merge", grid: t.grid, target: t.target });
    } else if (t.type === "slot") {
      result = moveItem(item, from, { type: "slot", equip: t.equip, slot: t.slot });
    } else if (t.type === "load") {
      const n = loadAmmo(t.weapon, item);
      if (n > 0) {
        if (item.count <= 0) {
          if (from.type === "grid") removeItem(from.grid, item);
        }
        result = { ok: true };
        audio.reload(1);
      } else {
        result = { ok: false, msg: "다른 탄종이 장전되어 있습니다 (먼저 탄을 빼세요)" };
      }
    } else if (t.type === "zone") {
      this.ctx.onDropZone?.(t.zone, item, from);
      result = { ok: true };
    }
    if (result.ok) {
      audio.pickup();
      this.ctx.afterMove?.(item, from, t, result);
    } else if (result.msg) {
      this.ctx.toast?.(result.msg);
    }
    this.ctx.changed();
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    d.ghost.remove();
    d.highlight.remove();
    d.rotateBtn?.remove();
    if (d.scrollRaf) cancelAnimationFrame(d.scrollRaf);
    d.srcEl?.classList.remove("dragging");
    document.querySelectorAll(".drop-ok, .drop-bad").forEach((el) => el.classList.remove("drop-ok", "drop-bad"));
    this.drag = null;
  }
}
