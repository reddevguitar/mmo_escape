// 은신처: 장비/창고, 상인, 의뢰, 시설

import { ITEMS, RARITY, sellPrice, buyPrice } from "../data/items.js";
import { TRADER, SHOP_CATEGORIES } from "../data/trader.js";
import { QUESTS } from "../data/quests.js";
import { UPGRADES, UPGRADE_ORDER } from "../data/hideout.js";
import { h } from "../core/dom.js";
import { formatMoney, formatWeight } from "../core/util.js";
import {
  addItem, removeItem, findSpot, placeAt, makeStacks, cloneGrid, countItem, takeItem,
  unloadWeapon, splitStack, sortGrid, slotAccepts, gridWeight, itemWeight, SLOT_TYPES,
} from "../systems/inventory.js";
import { playerLevel, xpForLevel, maxHp, traderTier, applyHideoutDims, MAX_LEVEL } from "../systems/profile.js";
import { questState, isQuestComplete, handover, claimQuest, readyQuestCount } from "../systems/quests.js";
import { InventoryUI, hideTooltip, hideMenu } from "./invui.js";
import { itemIcon } from "./icons.js";
import { drawDuck, playerDuckOpts } from "../game/draw.js";
import { audio } from "../game/audio.js";

const TABS = [
  { id: "gear", name: "장비 · 창고" },
  { id: "trader", name: "상인" },
  { id: "quests", name: "의뢰" },
  { id: "upgrades", name: "시설" },
];

export class Hideout {
  constructor(app) {
    this.app = app;
    this.root = h("div", { class: "hideout" });
    this.tab = "gear";
    this.shopCat = "all";
    this.stashScroll = 0;
    this.inv = new InventoryUI({
      cell: 44,
      mode: "hideout",
      quickMove: (item, from) => this.quickMove(item, from),
      menuItems: (item, from) => this.menuItems(item, from),
      canDropZone: (zone) => zone === "sell",
      onDropZone: (zone, item, from) => {
        if (zone === "sell") this.sell(item, from);
      },
      toast: (msg) => this.app.toast(msg, "warn"),
      changed: () => this.changed(),
    });
  }

  get profile() {
    return this.app.profile;
  }

  show(parent) {
    parent.replaceChildren(this.root);
    this.render();
  }

  changed() {
    hideTooltip();
    this.app.save();
    this.render();
  }

  render() {
    const scroller = this.root.querySelector(".stash-scroll");
    if (scroller) this.stashScroll = scroller.scrollTop;
    this.inv.ctx.mode = this.tab === "trader" ? "trader" : "hideout";
    const content =
      this.tab === "gear" ? this.renderGear() : this.tab === "trader" ? this.renderTrader() : this.tab === "quests" ? this.renderQuests() : this.renderUpgrades();
    this.root.replaceChildren(this.renderTopbar(), h("div", { class: "hideout-content" }, content));
    const s2 = this.root.querySelector(".stash-scroll");
    if (s2) s2.scrollTop = this.stashScroll;
  }

  // ── 상단 바 ─────────────────────────────────────────

  renderTopbar() {
    const p = this.profile;
    const level = playerLevel(p);
    const cur = xpForLevel(level);
    const next = xpForLevel(Math.min(MAX_LEVEL, level + 1));
    const pct = level >= MAX_LEVEL ? 100 : ((p.xp - cur) / Math.max(1, next - cur)) * 100;
    const ready = readyQuestCount(p);
    return h(
      "header",
      { class: "topbar" },
      h("div", { class: "logo" }, h("span", { class: "logo-duck", text: "🦆" }), h("span", { text: "DUCKSCAPE" })),
      h(
        "nav",
        { class: "tabs" },
        TABS.map((t) =>
          h(
            "button",
            {
              class: `tab ${this.tab === t.id ? "active" : ""}`,
              onclick: () => {
                audio.ui();
                this.tab = t.id;
                this.render();
              },
            },
            t.name,
            t.id === "quests" && ready > 0 ? h("span", { class: "dot", text: String(ready) }) : null,
          ),
        ),
      ),
      h(
        "div",
        { class: "player-info" },
        h("div", { class: "name", text: p.name }),
        h("div", { class: "level" }, h("b", { text: `Lv.${level}` }), h("div", { class: "xpbar" }, h("i", { style: { width: `${pct}%` } })), h("small", { text: `${p.xp - cur} / ${next - cur} XP` })),
      ),
      h("div", { class: "money", text: formatMoney(p.money) }),
      h("button", { class: "deploy-btn", onclick: () => this.app.openDeploy() }, "출격 ▶"),
    );
  }

  // ── 장비 / 창고 ─────────────────────────────────────

  characterPanel() {
    const p = this.profile;
    const eq = p.equip;
    const weight = Object.values(eq).reduce((s, it) => s + (it ? itemWeight(it) : 0), 0) + gridWeight(p.pockets) + gridWeight(p.secure);
    const preview = h("canvas", { class: "duck-preview", width: 220, height: 180 });
    requestAnimationFrame(() => {
      const g = preview.getContext("2d");
      g.clearRect(0, 0, 220, 180);
      g.save();
      g.translate(110, 96);
      g.scale(3.2, 3.2);
      drawDuck(g, 0, 0, -0.45, playerDuckOpts(eq, { moving: false }));
      g.restore();
    });
    const armorTxt = eq.armor ? `${ITEMS[eq.armor.id].cls}등급` : "없음";
    const helmetTxt = eq.helmet ? `${ITEMS[eq.helmet.id].cls}등급` : "없음";
    const bagGrid = eq.backpack ? eq.backpack.data.grid : null;
    return h(
      "section",
      { class: "panel character" },
      h("div", { class: "panel-title" }, h("span", { text: "내 오리" }), h("small", { text: "장비는 레이드에서 죽으면 잃습니다" })),
      h(
        "div",
        { class: "doll" },
        preview,
        h(
          "div",
          { class: "doll-stats" },
          stat("최대 체력", `${maxHp(p)}`),
          stat("소지 무게", formatWeight(weight), weight > 22 ? "warn" : ""),
          stat("방탄복", armorTxt),
          stat("헬멧", helmetTxt),
        ),
      ),
      h("div", { class: "slots-row" }, this.inv.slotView(eq, "primary"), this.inv.slotView(eq, "secondary")),
      h("div", { class: "slots-row" }, this.inv.slotView(eq, "helmet"), this.inv.slotView(eq, "armor"), this.inv.slotView(eq, "backpack")),
      h(
        "div",
        { class: "sub-grids" },
        h("div", { class: "sub" }, h("h4", { text: "주머니 · 단축키 3~6" }), this.inv.gridView(p.pockets, { quickKeys: true })),
        h("div", { class: "sub" }, h("h4", { text: "🔒 보안 컨테이너 · 사망해도 유지" }), this.inv.gridView(p.secure, { class: "secure" })),
      ),
      h(
        "div",
        { class: "sub" },
        h("h4", { text: eq.backpack ? `🎒 ${ITEMS[eq.backpack.id].name}` : "가방 없음 — 가방을 장착하면 더 많이 들 수 있습니다" }),
        bagGrid ? this.inv.gridView(bagGrid) : null,
      ),
    );
  }

  stashPanel({ trader = false } = {}) {
    const p = this.profile;
    const value = p.stash.items.reduce((s, it) => s + sellPrice(it), 0);
    return h(
      "section",
      { class: "panel stash" },
      h(
        "div",
        { class: "panel-title" },
        h("span", { text: `창고 ${p.stash.w} x ${p.stash.h}` }),
        h("small", { text: `판매 가치 ${formatMoney(value)}` }),
        h("button", {
          class: "small-btn",
          text: "정렬",
          onclick: () => {
            if (!sortGrid(p.stash)) this.app.toast("정렬할 공간이 부족합니다", "warn");
            this.changed();
          },
        }),
      ),
      trader ? h("p", { class: "hint", text: "아이템을 왼쪽 판매 칸으로 끌어놓거나 Shift+클릭하면 판매합니다." }) : h("p", { class: "hint", text: "드래그로 이동 · 드래그 중 R 회전 · Shift+클릭 빠른 이동 · 탄약을 총 위에 놓으면 장전" }),
      h("div", { class: "stash-scroll" }, this.inv.gridView(p.stash)),
    );
  }

  renderGear() {
    return h("div", { class: "two-col" }, this.characterPanel(), this.stashPanel());
  }

  // ── 상인 ───────────────────────────────────────────

  renderTrader() {
    const p = this.profile;
    const tier = traderTier(p);
    const cat = SHOP_CATEGORIES.find((c) => c.id === this.shopCat);
    const offers = [];
    TRADER.tiers.forEach((t, i) => {
      for (const [id, qty] of t.offers) offers.push({ id, qty, tier: i, locked: i > tier, minLevel: t.minPlayerLevel });
    });
    const shown = offers.filter((o) => !cat.types || cat.types.includes(ITEMS[o.id].type));
    const nextTier = TRADER.tiers[tier + 1];
    return h(
      "div",
      { class: "two-col" },
      h(
        "section",
        { class: "panel trader" },
        h(
          "div",
          { class: "trader-head" },
          h("div", { class: "trader-avatar", text: "🦆" }),
          h(
            "div",
            {},
            h("h3", { text: `${TRADER.name} · 신뢰도 ${tier + 1}` }),
            h("p", { text: `"${TRADER.greeting}"` }),
            nextTier ? h("small", { text: `Lv.${nextTier.minPlayerLevel} 달성 시 신뢰도 ${tier + 2} 품목 해금` }) : h("small", { text: "모든 품목 해금됨" }),
          ),
        ),
        h(
          "div",
          { class: "cat-tabs" },
          SHOP_CATEGORIES.map((c) =>
            h("button", {
              class: `chip ${this.shopCat === c.id ? "active" : ""}`,
              text: c.name,
              onclick: () => {
                this.shopCat = c.id;
                this.render();
              },
            }),
          ),
        ),
        h("div", { class: "offers" }, shown.map((o) => this.offerCard(o))),
        this.inv.zoneView("sell", "여기에 끌어놓아 판매 (판매가 = 가치의 60%)", "sell-zone"),
      ),
      this.stashPanel({ trader: true }),
    );
  }

  offerCard(o) {
    const def = ITEMS[o.id];
    const price = buyPrice(o.id, o.qty);
    const afford = this.profile.money >= price;
    return h(
      "div",
      { class: `offer rarity-${def.rarity} ${o.locked ? "locked" : ""}` },
      h("div", { class: "offer-icon" }, h("img", { src: itemIcon(o.id), draggable: false })),
      h("div", { class: "offer-info" }, h("b", { style: { color: RARITY[def.rarity].color }, text: def.name }), h("small", { text: o.qty > 1 ? `${o.qty}발 묶음` : `${def.w}x${def.h} · ${def.desc}` })),
      o.locked
        ? h("span", { class: "lock", text: `🔒 Lv.${o.minLevel}` })
        : h("button", {
            class: `buy ${afford ? "" : "poor"}`,
            text: formatMoney(price),
            title: "구매",
            onclick: () => this.buy(o.id, o.qty),
          }),
    );
  }

  buy(id, qty) {
    const p = this.profile;
    const price = buyPrice(id, qty);
    if (p.money < price) {
      this.app.toast("돈이 부족합니다", "warn");
      return;
    }
    const items = makeStacks(id, qty);
    const trial = cloneGrid(p.stash);
    for (const item of items) {
      if (!addItem(trial, JSON.parse(JSON.stringify(item)))) {
        this.app.toast("창고 공간이 부족합니다", "warn");
        return;
      }
    }
    for (const item of items) addItem(p.stash, item);
    p.money -= price;
    audio.pickup();
    this.app.toast(`${ITEMS[id].name}${qty > 1 ? ` x${qty}` : ""} 구매 (-${formatMoney(price)})`);
    this.changed();
  }

  sell(item, from) {
    const p = this.profile;
    const def = ITEMS[item.id];
    if (def.type === "backpack" && item.data?.grid?.items.length) {
      this.app.toast("가방을 비운 뒤 판매하세요", "warn");
      return;
    }
    const price = sellPrice(item);
    detach(item, from);
    p.money += price;
    audio.pickup();
    this.app.toast(`${def.name}${item.count > 1 ? ` x${item.count}` : ""} 판매 (+${formatMoney(price)})`);
  }

  // ── 빠른 이동 / 메뉴 ────────────────────────────────

  carried() {
    const p = this.profile;
    const grids = [];
    if (p.equip.backpack) grids.push(p.equip.backpack.data.grid);
    grids.push(p.pockets);
    return grids;
  }

  quickMove(item, from) {
    const p = this.profile;
    if (this.tab === "trader" && from.type === "grid" && from.grid === p.stash) {
      this.sell(item, from);
      return;
    }
    if (from.type === "grid" && from.grid === p.stash) {
      const def = ITEMS[item.id];
      const slot = Object.keys(SLOT_TYPES).find((s) => SLOT_TYPES[s] === def.type && !p.equip[s]);
      if (slot) {
        removeItem(p.stash, item);
        p.equip[slot] = item;
        return;
      }
      if (!transfer(item, from, this.carried())) this.app.toast("가방/주머니에 공간이 없습니다", "warn");
      return;
    }
    if (!transfer(item, from, [p.stash])) this.app.toast("창고 공간이 부족합니다", "warn");
  }

  menuItems(item, from) {
    const p = this.profile;
    const def = ITEMS[item.id];
    const out = [];
    if (from.type === "grid" && ["weapon", "armor", "helmet", "backpack"].includes(def.type)) {
      out.push({
        label: "장착",
        primary: true,
        action: () => {
          const slots = Object.keys(SLOT_TYPES).filter((s) => slotAccepts(s, item));
          const slot = slots.find((s) => !p.equip[s]) ?? slots[0];
          const old = p.equip[slot];
          removeItem(from.grid, item);
          p.equip[slot] = item;
          if (old && !addItem(from.grid, old) && !addItem(p.stash, old)) {
            // 되돌리기
            p.equip[slot] = old;
            addItem(from.grid, item);
            this.app.toast("교체할 공간이 부족합니다", "warn");
          }
        },
      });
    }
    if (from.type === "slot") {
      out.push({
        label: "해제 → 창고",
        primary: true,
        action: () => {
          if (!transfer(item, from, [p.stash])) this.app.toast("창고 공간이 부족합니다", "warn");
        },
      });
    }
    if (def.type === "weapon" && item.data.mag > 0) {
      out.push({
        label: `탄 빼기 (${item.data.mag}발)`,
        action: () => {
          const stacks = unloadWeapon(item);
          const target = from.type === "grid" ? from.grid : p.stash;
          for (const s of stacks) if (!addItem(target, s) && !addItem(p.stash, s)) this.app.toast("공간이 부족해 일부 탄을 잃었습니다", "warn");
        },
      });
    }
    if (def.type === "weapon" && from) {
      const ammoIds = Object.keys(ITEMS).filter((id) => ITEMS[id].type === "ammo" && ITEMS[id].caliber === def.caliber);
      for (const aid of ammoIds) {
        const have = countItem([p.stash, ...this.carried(), p.secure], aid);
        if (have <= 0 || item.data.mag >= def.mag) continue;
        if (item.data.mag > 0 && item.data.ammoId !== aid) continue;
        out.push({
          label: `장전: ${ITEMS[aid].name} (${have})`,
          action: () => {
            const need = def.mag - item.data.mag;
            const got = takeItem([...this.carried(), p.secure, p.stash], aid, need);
            item.data.mag += got;
            item.data.ammoId = aid;
            audio.reload(1);
          },
        });
      }
    }
    if (def.stack > 1 && item.count > 1 && from.type === "grid") {
      out.push({
        label: "나누기",
        action: () => {
          if (!splitStack(from.grid, item)) this.app.toast("나눌 공간이 없습니다", "warn");
        },
      });
    }
    if (def.type === "backpack" && item.data.grid.items.length > 0) {
      out.push({
        label: "내용물 꺼내기 → 창고",
        action: () => {
          for (const inner of [...item.data.grid.items]) {
            removeItem(item.data.grid, inner);
            if (!addItem(p.stash, inner)) {
              addItem(item.data.grid, inner);
              this.app.toast("창고 공간이 부족합니다", "warn");
              break;
            }
          }
        },
      });
    }
    out.push({ label: `판매 ${formatMoney(sellPrice(item))}`, danger: true, action: () => this.sell(item, from) });
    return out;
  }

  // ── 의뢰 ───────────────────────────────────────────

  renderQuests() {
    const p = this.profile;
    const active = QUESTS.filter((q) => questState(p, q.id) === "active");
    const done = QUESTS.filter((q) => questState(p, q.id) === "done");
    const locked = QUESTS.filter((q) => questState(p, q.id) === "locked");
    active.sort((a, b) => Number(isQuestComplete(p, b.id)) - Number(isQuestComplete(p, a.id)));
    return h(
      "div",
      { class: "quests" },
      h("section", { class: "panel" }, h("div", { class: "panel-title" }, h("span", { text: `진행 중인 의뢰 (${active.length})` })), active.length ? active.map((q) => this.questCard(q)) : h("p", { class: "hint", text: "진행 중인 의뢰가 없습니다." })),
      h(
        "section",
        { class: "panel side" },
        h("div", { class: "panel-title" }, h("span", { text: `완료 (${done.length})` })),
        done.map((q) => h("div", { class: "quest-done", text: `✔ ${q.name}` })),
        h("div", { class: "panel-title", style: { marginTop: "16px" } }, h("span", { text: `잠김 (${locked.length})` })),
        locked.map((q) => h("div", { class: "quest-locked", text: `🔒 ${q.name}` })),
      ),
    );
  }

  questCard(q) {
    const p = this.profile;
    const rec = p.quests[q.id];
    const complete = isQuestComplete(p, q.id);
    return h(
      "div",
      { class: `quest ${complete ? "complete" : ""}` },
      h("div", { class: "quest-head" }, h("b", { text: q.name }), h("small", { text: `의뢰인: ${q.giver}` })),
      h("p", { text: q.desc }),
      h(
        "div",
        { class: "goals" },
        q.goals.map((g, i) => {
          const prog = rec.progress[i] ?? 0;
          const have = g.type === "handover" ? countItem([p.stash], g.item) : 0;
          return h(
            "div",
            { class: "goal" },
            h("span", { text: `${g.label}${g.type === "handover" ? ` (${ITEMS[g.item].name})` : ""}` }),
            h("div", { class: "goal-bar" }, h("i", { style: { width: `${(prog / g.count) * 100}%` } })),
            h("b", { text: `${prog}/${g.count}` }),
            g.type === "handover" && prog < g.count
              ? h("button", {
                  class: "small-btn",
                  disabled: have <= 0,
                  text: `제출 (보유 ${have})`,
                  onclick: () => {
                    const r = handover(p, q.id, i);
                    if (!r.ok) this.app.toast(r.msg, "warn");
                    this.changed();
                  },
                })
              : null,
          );
        }),
      ),
      h(
        "div",
        { class: "rewards" },
        h("span", { text: "보상:" }),
        h("b", { text: formatMoney(q.reward.money ?? 0) }),
        h("b", { text: `${q.reward.xp ?? 0} XP` }),
        (q.reward.items ?? []).map(([id, n]) => h("span", { class: "reward-item" }, h("img", { src: itemIcon(id) }), `${ITEMS[id].name}${n > 1 ? ` x${n}` : ""}`)),
      ),
      complete
        ? h("button", {
            class: "claim-btn",
            text: "보상 받기",
            onclick: () => {
              const r = claimQuest(p, q.id);
              if (r.ok) {
                audio.reveal(3);
                this.app.toast(`의뢰 완료: ${q.name}`, "good");
              } else this.app.toast(r.msg, "warn");
              this.changed();
            },
          })
        : null,
    );
  }

  // ── 시설 ───────────────────────────────────────────

  renderUpgrades() {
    return h("div", { class: "upgrades" }, UPGRADE_ORDER.map((key) => this.upgradeCard(key)));
  }

  upgradeCard(key) {
    const p = this.profile;
    const up = UPGRADES[key];
    const lvl = p.hideout[key];
    const cur = up.levels[lvl];
    const next = up.levels[lvl + 1];
    const reqs = next ? (next.items ?? []).map(([id, n]) => ({ id, n, have: countItem([p.stash], id) })) : [];
    const canUp = next && p.money >= next.cost && reqs.every((r) => r.have >= r.n);
    return h(
      "section",
      { class: "panel upgrade" },
      h("div", { class: "up-icon", text: up.icon }),
      h("h3", { text: `${up.name} · Lv.${lvl + 1}` }),
      h("p", { text: up.desc }),
      h("div", { class: "up-cur", text: `현재: ${cur.label}` }),
      next
        ? h(
            "div",
            { class: "up-next" },
            h("div", { text: `다음: ${next.label}` }),
            h("div", { class: `req ${p.money >= next.cost ? "ok" : "no"}`, text: `${formatMoney(next.cost)}` }),
            reqs.map((r) => h("div", { class: `req ${r.have >= r.n ? "ok" : "no"}` }, h("img", { src: itemIcon(r.id) }), `${ITEMS[r.id].name} ${r.have}/${r.n}`)),
            h("button", {
              class: "claim-btn",
              disabled: !canUp,
              text: "업그레이드",
              onclick: () => {
                p.money -= next.cost;
                for (const r of reqs) takeItem([p.stash], r.id, r.n);
                p.hideout[key] += 1;
                applyHideoutDims(p);
                audio.reveal(3);
                this.app.toast(`${up.name} 업그레이드 완료!`, "good");
                this.changed();
              },
            }),
          )
        : h("div", { class: "up-max", text: "최대 레벨" }),
    );
  }

  destroy() {
    hideMenu();
    this.inv.destroy();
  }
}

function stat(label, value, cls = "") {
  return h("div", { class: `stat ${cls}` }, h("span", { text: label }), h("b", { text: value }));
}

/** 출처에서 떼어내기 */
export function detach(item, from) {
  if (from.type === "grid") removeItem(from.grid, item);
  else if (from.type === "slot") from.equip[from.slot] = null;
}

/** 다른 그리드들로 옮기기. 실패하면 원위치 */
export function transfer(item, from, grids) {
  const orig = { x: item.x, y: item.y, rot: item.rot };
  detach(item, from);
  for (const grid of grids) {
    if (!grid) continue;
    if (from.type === "grid" && grid === from.grid) continue;
    if (addItem(grid, item)) return true;
  }
  if (item.count > 0) {
    if (from.type === "grid") {
      placeAt(from.grid, item, orig.x, orig.y, orig.rot);
    } else {
      from.equip[from.slot] = item;
    }
  }
  return false;
}

export { findSpot };
