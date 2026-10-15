// 레이드 HUD와 레이드 중 인벤토리(Tab)

import { ITEMS } from "../data/items.js";
import { h } from "../core/dom.js";
import { formatTime, formatWeight, clamp } from "../core/util.js";
import { addItem, removeItem, placeAt, unloadWeapon, splitStack, SLOT_TYPES, slotAccepts, countItem } from "../systems/inventory.js";
import { InventoryUI, hideTooltip, hideMenu } from "./invui.js";
import { itemIcon } from "./icons.js";
import { detach, transfer } from "./hideout.js";

export class RaidUI {
  constructor(app, raid) {
    this.app = app;
    this.raid = raid;
    this.invOpen = false;
    this.lastHud = 0;
    this.root = h("div", { class: "raid-ui" });
    this.hud = this.buildHud();
    this.invLayer = h("div", { class: "raid-inv hidden" });
    this.root.append(this.hud.el, this.invLayer);
    this.inv = new InventoryUI({
      cell: 42,
      mode: "raid",
      isHidden: (item, grid) => !!grid.seen && !grid.seen.has(item.uid),
      searching: (grid) => (grid.owner && grid.owner === raid.lootTarget ? raid.nextHidden(grid.owner) : null),
      quickMove: (item, from) => this.quickMove(item, from),
      menuItems: (item, from) => this.menuItems(item, from),
      canDropZone: (zone) => zone === "ground",
      onDropZone: (zone, item, from) => {
        detach(item, from);
        raid.dropToGround(item);
      },
      afterMove: (item, from, t, result) => {
        if (t.grid?.seen) t.grid.seen.add(item.uid);
        // 장비 교체로 원래 자리(상자)로 밀려난 아이템은 이미 아는 물건
        if (result?.displaced && from.grid?.seen) from.grid.seen.add(result.displaced.uid);
      },
      toast: (msg) => this.app.toast(msg, "warn"),
      changed: () => {
        hideTooltip();
        raid.invDirty = true;
      },
    });
  }

  get profile() {
    return this.app.profile;
  }

  // ── HUD ────────────────────────────────────────────

  buildHud() {
    const el = h("div", { class: "hud" });
    const timer = h("div", { class: "raid-timer" });
    const mapName = h("div", { class: "raid-map", text: this.raid.def.name });
    const feed = h("div", { class: "feed" });
    const extracts = h("div", { class: "extract-list" });
    const hpFill = h("i");
    const hpText = h("b");
    const stam = h("i");
    const energy = h("i");
    const water = h("i");
    const status = h("div", { class: "status-icons" });
    const weaponName = h("div", { class: "w-name" });
    const ammo = h("div", { class: "w-ammo" });
    const weaponSub = h("div", { class: "w-sub" });
    const quick = h("div", { class: "quickslots" });
    const prompt = h("div", { class: "prompt hidden" });
    const extractBox = h("div", { class: "extract-count hidden" });
    el.append(
      h("div", { class: "hud-tl" }, mapName, timer, feed),
      h("div", { class: "hud-tr" }, h("h4", { text: "탈출 지점" }), extracts, h("small", { class: "hud-help", text: "M 지도 · Tab 인벤토리 · Esc 메뉴" })),
      h(
        "div",
        { class: "hud-bl" },
        h("div", { class: "hp-row" }, h("span", { text: "HP" }), h("div", { class: "bar hp" }, hpFill), hpText),
        h("div", { class: "mini-bars" }, h("div", { class: "bar stam", title: "스태미나" }, stam), h("div", { class: "bar energy", title: "에너지" }, energy), h("div", { class: "bar water", title: "수분" }, water)),
        h("div", { class: "mini-labels" }, h("span", { text: "스태미나" }), h("span", { text: "에너지" }), h("span", { text: "수분" })),
        status,
      ),
      h("div", { class: "hud-bc" }, quick),
      h("div", { class: "hud-br" }, weaponName, ammo, weaponSub),
      h("div", { class: "hud-center" }, extractBox, prompt),
    );
    return { el, timer, feed, extracts, hpFill, hpText, stam, energy, water, status, weaponName, ammo, weaponSub, quick, prompt, extractBox };
  }

  updateHud(dt) {
    const raid = this.raid;
    const p = raid.player;
    const hud = this.hud;
    // 바는 매 프레임
    hud.hpFill.style.width = `${clamp(p.hp / p.maxHp, 0, 1) * 100}%`;
    hud.stam.style.width = `${p.stamina}%`;
    hud.energy.style.width = `${p.energy}%`;
    hud.water.style.width = `${p.water}%`;

    this.lastHud -= dt;
    if (this.lastHud > 0) return;
    this.lastHud = 0.1;

    hud.timer.textContent = formatTime(raid.timeLeft);
    hud.timer.classList.toggle("urgent", raid.timeLeft < 120);
    hud.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
    hud.hpFill.parentElement.classList.toggle("low", p.hp < p.maxHp * 0.3);

    // 상태
    const st = [];
    if (p.bleeding) st.push(["🩸", "출혈 — 붕대 필요", "bad"]);
    if (p.energy <= 15) st.push(["🍞", p.energy <= 0 ? "굶주림 — 체력 감소" : "배고픔", p.energy <= 0 ? "bad" : "warn"]);
    if (p.water <= 15) st.push(["💧", p.water <= 0 ? "탈수 — 체력 감소" : "목마름", p.water <= 0 ? "bad" : "warn"]);
    if (raid.carriedWeight() > 22) st.push(["🏋️", `과적 ${formatWeight(raid.carriedWeight())}`, "warn"]);
    if (p.crouch) st.push(["🦆", "웅크림 (조용히 이동)", "info"]);
    if (p.exhausted) st.push(["😮‍💨", "지침", "warn"]);
    if (p.stamBuffT > 0) st.push(["⚡", "에너지 드링크", "good"]);
    hud.status.replaceChildren(...st.map(([icon, label, cls]) => h("span", { class: `st ${cls}`, title: label }, icon, h("small", { text: label }))));

    // 무기
    const w = raid.currentWeapon(p);
    if (w) {
      const def = ITEMS[w.id];
      hud.weaponName.textContent = `${p.weaponSlot === "primary" ? "1" : "2"} · ${def.name}`;
      hud.ammo.textContent = `${w.data.mag} / ${raid.reserveAmmo(w)}`;
      hud.ammo.classList.toggle("empty", w.data.mag === 0);
      const ammoName = w.data.ammoId ? ITEMS[w.data.ammoId].name : "탄 없음";
      hud.weaponSub.textContent = p.reload ? "재장전 중…" : `${ammoName} · ${def.auto ? "자동" : "반자동"}`;
    } else {
      hud.weaponName.textContent = "맨손 (부리 쪼기)";
      hud.ammo.textContent = "—";
      hud.weaponSub.textContent = "왼쪽 클릭으로 쪼기";
    }
    const frags = countItem([this.profile.pockets, this.profile.equip.backpack?.data.grid, this.profile.secure].filter(Boolean), "frag");

    // 퀵슬롯
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const item = this.profile.pockets.items.find((it) => it.x === i);
      const using = p.using && p.using.item === item;
      slots.push(
        h(
          "div",
          { class: `qs ${using ? "using" : ""}` },
          h("span", { class: "qk", text: String(i + 3) }),
          item ? h("img", { src: itemIcon(item.id) }) : null,
          item && item.count > 1 ? h("span", { class: "qc", text: String(item.count) }) : null,
        ),
      );
    }
    slots.push(h("div", { class: "qs" }, h("span", { class: "qk", text: "G" }), h("span", { class: "qe", text: "💣" }), h("span", { class: "qc", text: String(frags) })));
    hud.quick.replaceChildren(...slots);

    // 탈출 목록
    hud.extracts.replaceChildren(
      ...raid.extracts.map((x) => {
        const d = Math.hypot(x.x - p.x, x.y - p.y);
        const ang = Math.atan2(x.y - p.y, x.x - p.x);
        return h(
          "div",
          { class: `x ${raid.extractZone === x ? "active" : ""}` },
          h("span", { class: "arrow", style: { transform: `rotate(${ang}rad)` }, text: "➤" }),
          h("span", { class: "xn", text: x.name }),
          h("small", { text: `${Math.round(d / 20)}m` }),
        );
      }),
    );

    // 피드
    hud.feed.replaceChildren(...raid.feed.map((f) => h("div", { style: { color: f.color, opacity: String(clamp(1 - (raid.time - f.t - 5) / 2, 0, 1)) }, text: f.text })));

    // 상호작용 안내
    const it = raid.interaction;
    if (it && p.alive && !this.invOpen) {
      let label = "";
      if (it.type === "door") label = it.open ? "문 닫기" : "문 열기";
      else label = `${it.target.name} ${it.target.opened ? "열기" : "수색"}`;
      hud.prompt.replaceChildren(h("kbd", { text: "F" }), label);
      hud.prompt.classList.remove("hidden");
    } else {
      hud.prompt.classList.add("hidden");
    }

    if (raid.extractZone) {
      hud.extractBox.classList.remove("hidden");
      hud.extractBox.textContent = `${raid.extractZone.name}에서 탈출 중… ${Math.max(0, 7 - raid.extractT).toFixed(1)}s`;
    } else {
      hud.extractBox.classList.add("hidden");
    }
  }

  // ── 인벤토리 ────────────────────────────────────────

  toggleInventory(force) {
    const open = force ?? !this.invOpen;
    this.invOpen = open;
    this.invLayer.classList.toggle("hidden", !open);
    if (!open) {
      hideTooltip();
      hideMenu();
      this.inv.cancelDrag();
      this.raid.lootTarget = null;
    }
    this.raid.invDirty = true;
  }

  renderInventory() {
    if (!this.invOpen) return;
    const raid = this.raid;
    const p = this.profile;
    const eq = p.equip;
    const player = raid.player;
    const left = h(
      "section",
      { class: "panel inv-left" },
      h(
        "div",
        { class: "panel-title" },
        h("span", { text: "내 장비" }),
        h("small", { text: `HP ${Math.ceil(player.hp)}/${player.maxHp} · ${formatWeight(raid.carriedWeight())}` }),
      ),
      h("div", { class: "slots-row" }, this.inv.slotView(eq, "primary", { active: player.weaponSlot === "primary" }), this.inv.slotView(eq, "secondary", { active: player.weaponSlot === "secondary" })),
      h("div", { class: "slots-row" }, this.inv.slotView(eq, "helmet"), this.inv.slotView(eq, "armor"), this.inv.slotView(eq, "backpack")),
      h(
        "div",
        { class: "sub-grids" },
        h("div", { class: "sub" }, h("h4", { text: "주머니 · 3~6" }), this.inv.gridView(p.pockets, { quickKeys: true })),
        h("div", { class: "sub" }, h("h4", { text: "🔒 보안 컨테이너" }), this.inv.gridView(p.secure, { class: "secure" })),
      ),
      h("div", { class: "sub" }, h("h4", { text: eq.backpack ? `🎒 ${ITEMS[eq.backpack.id].name}` : "가방 없음" }), eq.backpack ? this.inv.gridView(eq.backpack.data.grid) : null),
    );

    const c = raid.lootTarget;
    let right;
    if (c) {
      const hidden = c.grid.items.filter((it) => !c.grid.seen.has(it.uid)).length;
      right = h(
        "section",
        { class: "panel inv-right" },
        h("div", { class: "panel-title" }, h("span", { text: c.name }), h("small", { text: hidden > 0 ? `수색 중… (${hidden}개 남음)` : c.grid.items.length ? "수색 완료" : "비어 있음" })),
        h("p", { class: "hint", text: "Shift+클릭: 내 가방으로 · 드래그 중 R: 회전 · 수색은 인벤토리를 연 동안 진행됩니다" }),
        this.inv.gridView(c.grid),
        this.inv.zoneView("ground", "여기에 놓으면 바닥에 버립니다", "ground-zone"),
      );
    } else {
      right = h(
        "section",
        { class: "panel inv-right" },
        h("div", { class: "panel-title" }, h("span", { text: "주변" })),
        h("p", { class: "hint", text: "상자나 시체 근처에서 F를 눌러 수색하세요." }),
        this.inv.zoneView("ground", "여기에 놓으면 바닥에 버립니다", "ground-zone"),
      );
    }
    this.invLayer.replaceChildren(h("div", { class: "inv-wrap" }, left, right), h("div", { class: "inv-footer", text: "Tab / Esc 닫기 · 인벤토리를 열어도 시간은 흐릅니다!" }));
  }

  quickMove(item, from) {
    const raid = this.raid;
    const p = this.profile;
    const carried = [p.equip.backpack?.data.grid, p.pockets].filter(Boolean);
    const lootGrid = raid.lootTarget?.grid;
    if (from.type === "grid" && from.grid.seen) {
      const def = ITEMS[item.id];
      const slot = Object.keys(SLOT_TYPES).find((s) => SLOT_TYPES[s] === def.type && !p.equip[s]);
      if (slot) {
        removeItem(from.grid, item);
        p.equip[slot] = item;
        return;
      }
      if (!transfer(item, from, carried)) this.app.toast("가방에 공간이 없습니다", "warn");
      return;
    }
    if (lootGrid) {
      if (transfer(item, from, [lootGrid])) lootGrid.seen.add(item.uid);
      else this.app.toast("상자에 공간이 없습니다", "warn");
      return;
    }
    detach(item, from);
    raid.dropToGround(item);
  }

  menuItems(item, from) {
    const raid = this.raid;
    const p = this.profile;
    const def = ITEMS[item.id];
    const out = [];
    const inLoot = from.type === "grid" && !!from.grid.seen;
    if ((def.type === "med" || def.type === "food") && from.type === "grid") {
      out.push({
        label: "사용",
        primary: true,
        action: () => {
          if (inLoot) {
            // 바닥/상자의 물건은 먼저 줍고 사용
            if (!transfer(item, from, [p.pockets, p.equip.backpack?.data.grid].filter(Boolean))) {
              this.app.toast("주울 공간이 없습니다", "warn");
              return;
            }
            const grid = [p.pockets, p.equip.backpack?.data.grid].find((g) => g?.items.includes(item));
            raid.useItem(item, grid);
          } else {
            raid.useItem(item, from.grid);
          }
        },
      });
    }
    if (from.type === "grid" && ["weapon", "armor", "helmet", "backpack"].includes(def.type)) {
      out.push({
        label: "장착",
        primary: true,
        action: () => {
          const slots = Object.keys(SLOT_TYPES).filter((s) => slotAccepts(s, item));
          const slot = slots.find((s) => !p.equip[s]) ?? slots[0];
          const old = p.equip[slot];
          const orig = { x: item.x, y: item.y, rot: item.rot };
          removeItem(from.grid, item);
          p.equip[slot] = item;
          if (!old) return;
          const targets = [from.grid, p.equip.backpack?.data.grid, p.pockets, raid.lootTarget?.grid].filter(Boolean);
          const dest = targets.find((g) => addItem(g, old));
          if (dest) {
            dest.seen?.add(old.uid);
            return;
          }
          // 둘 곳이 없으면 원상복구
          p.equip[slot] = old;
          placeAt(from.grid, item, orig.x, orig.y, orig.rot);
          this.app.toast("교체할 공간이 부족합니다", "warn");
        },
      });
    }
    if (from.type === "slot") {
      out.push({
        label: "해제",
        action: () => {
          const target = raid.lootTarget?.grid;
          const grids = [p.equip.backpack?.data.grid, target].filter(Boolean);
          if (!transfer(item, from, grids)) {
            detach(item, from);
            raid.dropToGround(item);
          } else if (target?.items.includes(item)) target.seen.add(item.uid);
        },
      });
    }
    if (def.type === "weapon" && item.data.mag > 0) {
      out.push({
        label: `탄 빼기 (${item.data.mag}발)`,
        action: () => {
          for (const s of unloadWeapon(item)) {
            const grids = [p.pockets, p.equip.backpack?.data.grid, p.secure].filter(Boolean);
            if (!grids.some((g) => addItem(g, s))) raid.dropToGround(s);
          }
        },
      });
    }
    if (def.stack > 1 && item.count > 1 && from.type === "grid") {
      out.push({ label: "나누기", action: () => splitStack(from.grid, item) || this.app.toast("나눌 공간이 없습니다", "warn") });
    }
    if (!inLoot) {
      out.push({
        label: "버리기",
        danger: true,
        action: () => {
          detach(item, from);
          raid.dropToGround(item);
        },
      });
    }
    return out;
  }

  destroy() {
    this.inv.destroy();
    hideTooltip();
    hideMenu();
  }
}
