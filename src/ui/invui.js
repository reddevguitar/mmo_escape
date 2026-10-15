// 그리드 인벤토리 UI: 드래그 앤 드롭, 회전(R), 스택 합치기, 탄약 장전, 툴팁, 우클릭 메뉴

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

export function hideTooltip() {
  tooltip.classList.add("hidden");
}

export class InventoryUI {
  /**
   * ctx: {
   *   cell, mode,
   *   isHidden(item, grid), searching(grid) -> item|null,
   *   quickMove(item, from), menuItems(item, from) -> [{label, action}],
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
    this.onKey = (e) => {
      if (this.drag && e.code === "KeyR") {
        e.preventDefault();
        this.rotateDrag();
      }
    };
    window.addEventListener("keydown", this.onKey);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
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
    el.addEventListener("pointerenter", (e) => this.showTooltip(e, item));
    el.addEventListener("pointermove", (e) => this.moveTooltip(e));
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
      this.openMenu(e, item, from);
    });
    return el;
  }

  // ── 툴팁 / 메뉴 ────────────────────────────────────

  showTooltip(e, item) {
    if (this.drag) return;
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
    const hint = this.ctx.mode === "raid" ? "우클릭: 메뉴 · Shift+클릭: 빠른 이동 · 드래그 중 R: 회전" : this.ctx.mode === "trader" ? "Shift+클릭: 판매 · 우클릭: 메뉴 · 드래그 중 R: 회전" : "우클릭: 메뉴 · Shift+클릭: 빠른 이동 · 드래그 중 R: 회전";
    lines.push(h("div", { class: "tt-hint", text: hint }));
    tooltip.replaceChildren(...lines);
    tooltip.classList.remove("hidden");
    this.moveTooltip(e);
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

  openMenu(e, item, from) {
    hideTooltip();
    const items = this.ctx.menuItems?.(item, from) ?? [];
    if (!items.length) return;
    menu.replaceChildren(
      h("div", { class: "menu-title", text: ITEMS[item.id].name }),
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
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - r.height - 8)}px`;
  }

  // ── 드래그 ─────────────────────────────────────────

  pointerDown(e, item, from) {
    if (e.button !== 0) return;
    e.preventDefault();
    hideMenu();
    if (e.shiftKey || e.ctrlKey) {
      this.ctx.quickMove?.(item, from);
      this.ctx.changed();
      return;
    }
    this.pending = { item, from, x: e.clientX, y: e.clientY, el: e.currentTarget };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  startDrag(e) {
    const { item, from, el } = this.pending;
    hideTooltip();
    const def = ITEMS[item.id];
    const ghost = h("div", { class: `drag-ghost item rarity-${def.rarity}` });
    ghost.append(h("img", { src: itemIcon(item.id), draggable: false }));
    document.body.append(ghost);
    const highlight = h("div", { class: "drop-highlight hidden" });
    this.drag = { item, from, rot: item.rot, ghost, highlight, srcEl: el, target: null };
    el.classList.add("dragging");
    this.layoutGhost();
    this.pointerMove(e);
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
    this.lastPointer = { clientX: e.clientX, clientY: e.clientY };
    if (this.pending && !this.drag) {
      if (Math.hypot(e.clientX - this.pending.x, e.clientY - this.pending.y) < 5) return;
      this.startDrag(e);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const gw = parseFloat(d.ghost.style.width);
    const gh = parseFloat(d.ghost.style.height);
    d.ghost.style.left = `${e.clientX - gw / 2}px`;
    d.ghost.style.top = `${e.clientY - gh / 2}px`;
    d.target = this.computeTarget(e.clientX, e.clientY);
    this.showHighlight(d.target);
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
      const [w, hh] = d.rot ? [def.h, def.w] : [def.w, def.h];
      const gx = Math.round((x - rect.left) / cell - w / 2);
      const gy = Math.round((y - rect.top) / cell - hh / 2);
      return { type: "grid", grid: drop.grid, x: gx, y: gy, rot: d.rot, el: dropEl, cell, w, h: hh, valid: canPlace(drop.grid, item, gx, gy, d.rot) };
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

  pointerUp() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    const d = this.drag;
    this.pending = null;
    if (!d) return;
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
    d.srcEl?.classList.remove("dragging");
    document.querySelectorAll(".drop-ok, .drop-bad").forEach((el) => el.classList.remove("drop-ok", "drop-bad"));
    this.drag = null;
  }
}
