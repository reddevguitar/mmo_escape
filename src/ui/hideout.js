// 은신처: 장비/창고, 상인, 의뢰, 시설

import { ITEMS, RARITY, sellPrice, buyPrice } from "../data/items.js";
import { TRADER, SHOP_CATEGORIES } from "../data/trader.js";
import { QUESTS } from "../data/quests.js";
import { UPGRADES, UPGRADE_ORDER } from "../data/hideout.js";
import { h } from "../core/dom.js";
import { formatMoney, formatWeight, formatTime } from "../core/util.js";
import {
  addItem, removeItem, findSpot, placeAt, makeStacks, cloneGrid, countItem, takeItem,
  unloadWeapon, splitStack, sortGrid, slotAccepts, gridWeight, itemWeight, SLOT_TYPES,
} from "../systems/inventory.js";
import { playerLevel, xpForLevel, maxHp, traderTier, applyHideoutDims, benchLevel, deliverMail, MAX_LEVEL } from "../systems/profile.js";
import { questState, isQuestComplete, handover, claimQuest, readyQuestCount } from "../systems/quests.js";
import { RECIPES, recipeStatus, craft } from "../systems/crafting.js";
import { RECIPE_GROUPS } from "../data/recipes.js";
import { restockPlan, applyRestock } from "../systems/restock.js";
import { MAPS, MAP_ORDER } from "../data/maps.js";
import { ENEMY_TYPES } from "../data/enemies.js";
import { InventoryUI, hideTooltip, hideMenu } from "./invui.js";
import { itemIcon } from "./icons.js";
import { twoStepButton, responsiveCell } from "./widgets.js";
import { drawDuck, playerDuckOpts, duckColors, DUCK_COLORS } from "../game/draw.js";
import { audio } from "../game/audio.js";

const TABS = [
  { id: "gear", name: "장비 · 창고" },
  { id: "trader", name: "상인" },
  { id: "bench", name: "작업대" },
  { id: "quests", name: "의뢰" },
  { id: "upgrades", name: "시설" },
  { id: "stats", name: "기록" },
];

/** 일괄 판매에서 빼야 하는 아이템: 진행 중인 의뢰, 다음 시설 업그레이드, 제작 재료 */
function protectedItems(profile) {
  const keep = new Set();
  for (const q of QUESTS) {
    const rec = profile.quests[q.id];
    if (!rec || rec.state !== "active") continue;
    q.goals.forEach((g, i) => {
      if (g.type === "handover" && (rec.progress[i] ?? 0) < g.count) keep.add(g.item);
    });
  }
  for (const key of UPGRADE_ORDER) {
    const next = UPGRADES[key].levels[profile.hideout[key] + 1];
    for (const [id] of next?.items ?? []) keep.add(id);
  }
  for (const r of RECIPES) {
    for (const [id] of r.input) keep.add(id);
    for (const id of r.tools ?? []) keep.add(id);
  }
  return keep;
}

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
      quickLabel: (item, from) => {
        const inStash = from.type === "grid" && from.grid === this.profile.stash;
        if (inStash) return this.tab === "trader" ? null : "가방으로 옮기기";
        return "창고로 옮기기";
      },
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
    // 보험 장비 도착 시간 갱신
    this.mailTimer = setInterval(() => {
      if ((this.profile.mail ?? []).some((it) => it.data?.returnAt)) this.refreshMailBanner();
    }, 5000);
  }

  changed() {
    hideTooltip();
    this.app.save();
    this.render();
  }

  render() {
    const scroller = this.root.querySelector(".stash-scroll");
    if (scroller) this.stashScroll = scroller.scrollTop;
    const pageScroll = this.root.querySelector(".hideout-content")?.scrollTop ?? 0;
    this.inv.ctx.mode = this.tab === "trader" ? "trader" : "hideout";
    this.inv.cell = responsiveCell(44);
    const views = {
      gear: () => this.renderGear(),
      trader: () => this.renderTrader(),
      bench: () => this.renderBench(),
      quests: () => this.renderQuests(),
      upgrades: () => this.renderUpgrades(),
      stats: () => this.renderStats(),
    };
    const content = (views[this.tab] ?? views.gear)();
    this.root.replaceChildren(this.renderTopbar(), h("div", { class: "hideout-content" }, this.mailBanner(), content));
    const s2 = this.root.querySelector(".stash-scroll");
    if (s2) s2.scrollTop = this.stashScroll;
    const c2 = this.root.querySelector(".hideout-content");
    if (c2) c2.scrollTop = pageScroll;
  }

  /** 우편함: 창고에 자리가 없어 못 받은 아이템, 보험으로 돌아오는 중인 장비 */
  mailBanner() {
    const mail = this.profile.mail ?? [];
    if (!mail.length) return h("div", { class: "mail-slot" });
    const now = Date.now();
    const waiting = mail.filter((it) => (it.data?.returnAt ?? 0) > now);
    const ready = mail.length - waiting.length;
    const soonest = waiting.length ? Math.min(...waiting.map((it) => it.data.returnAt)) - now : 0;
    const desc = [
      ready ? `받을 수 있는 아이템 ${ready}개` : null,
      waiting.length ? `보험 회수 중 ${waiting.length}개 (가장 빠른 것 ${formatTime(Math.ceil(soonest / 1000))} 후)` : null,
    ].filter(Boolean);
    return h(
      "div",
      { class: "mail-slot" },
      h(
        "div",
        { class: "mail-banner" },
        h("span", { class: "mail-icon", text: waiting.length && !ready ? "🛡️" : "📬" }),
        h("div", {}, h("b", { text: `우편함 · ${desc.join(" · ")}` }), h("small", { text: ready ? "창고에 자리를 만들고 받으세요." : "보험 처리된 장비가 곧 도착합니다." })),
        h(
          "div",
          { class: "mail-items" },
          mail.slice(0, 6).map((it) => h("img", { class: (it.data?.returnAt ?? 0) > now ? "pending" : "", src: itemIcon(it.id), title: ITEMS[it.id].name })),
        ),
        h("button", {
          class: "small-btn",
          text: "창고로 받기",
          disabled: !ready,
          onclick: () => {
            const r = deliverMail(this.profile);
            if (r.delivered) this.app.toast(`${r.delivered}개를 창고로 옮겼습니다${r.left ? ` (남은 ${r.left}개)` : ""}`, "good");
            else this.app.toast("창고에 빈 자리가 없습니다", "warn");
            this.changed();
          },
        }),
      ),
    );
  }

  /** 보험 도착 시간 표시만 갱신 (화면 전체를 다시 그리지 않는다) */
  refreshMailBanner() {
    const slot = this.root.querySelector(".mail-slot");
    if (slot) slot.replaceWith(this.mailBanner());
  }

  /** 빠른 보급: 장착한 총의 탄약과 붕대를 가방에 채운다 */
  restockRow() {
    const plan = restockPlan(this.profile);
    if (!plan.lines.length) return h("div", { class: "restock done" }, h("span", { text: "✔ 탄약·붕대 넉넉함" }));
    const what = plan.lines.map((l) => `${ITEMS[l.id].short} ${l.fromStash + l.buy}`).join(" · ");
    return h(
      "div",
      { class: "restock" },
      h("div", {}, h("b", { text: "빠른 보급" }), h("small", { text: `${what} (창고에서 먼저, 모자라면 구매)` })),
      h("button", {
        class: `buy ${this.profile.money < plan.total ? "poor" : ""}`,
        text: plan.total ? `채우기 ${formatMoney(plan.total)}` : "채우기 (무료)",
        onclick: () => {
          const r = applyRestock(this.profile);
          if (r.ok) {
            audio.reload(1);
            this.app.toast(`보급 완료${r.cost ? ` (-${formatMoney(r.cost)})` : ""}`, "good");
          } else this.app.toast(r.msg, "warn");
          this.changed();
        },
      }),
    );
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
      drawDuck(g, 0, 0, -0.45, playerDuckOpts(eq, { moving: false, colors: duckColors(p.settings.duckColor) }));
      g.restore();
    });
    const armorTxt = eq.armor ? `${ITEMS[eq.armor.id].cls}등급` : "없음";
    const helmetTxt = eq.helmet ? `${ITEMS[eq.helmet.id].cls}등급` : "없음";
    const bagGrid = eq.backpack ? eq.backpack.data.grid : null;
    return h(
      "section",
      { class: "panel character" },
      h("div", { class: "panel-title" }, h("span", { text: "내 오리" }), h("small", { text: "장비는 레이드에서 죽으면 잃습니다" })),
      this.restockRow(),
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
          h(
            "div",
            { class: "color-chips", title: "오리 색" },
            Object.entries(DUCK_COLORS).map(([key, c]) =>
              h("button", {
                class: `color-chip ${p.settings.duckColor === key ? "active" : ""}`,
                title: c.name,
                "aria-label": `오리 색: ${c.name}`,
                style: { background: `linear-gradient(135deg, ${c.head} 0 45%, ${c.body} 45%)` },
                onclick: () => {
                  p.settings.duckColor = key;
                  audio.ui();
                  this.changed();
                },
              }),
            ),
          ),
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
      h("p", {
        class: "hint",
        text: this.app.touch
          ? trader
            ? "아이템을 탭해 판매하거나, 길게 눌러 판매 칸으로 끌어놓으세요."
            : "탭: 정보·메뉴 · 길게 눌러 끌기 (끄는 중 ↻ 회전) · 탄약을 총 위에 놓으면 장전"
          : trader
            ? "아이템을 왼쪽 판매 칸으로 끌어놓거나 Shift+클릭하면 판매합니다."
            : "드래그로 이동 · 드래그 중 R 회전 · Shift+클릭 빠른 이동 · 탄약을 총 위에 놓으면 장전",
      }),
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
        this.junkSellRow(),
      ),
      this.stashPanel({ trader: true }),
    );
  }

  /** 창고의 '전리품' 중 의뢰·시설·제작에 안 쓰이는 것 */
  junkItems() {
    const keep = protectedItems(this.profile);
    return this.profile.stash.items.filter((it) => {
      const def = ITEMS[it.id];
      return def.type === "loot" && def.rarity < 4 && !keep.has(it.id);
    });
  }

  junkSellRow() {
    const junk = this.junkItems();
    if (!junk.length) return h("p", { class: "hint", text: "팔 만한 귀중품이 없습니다. (의뢰·시설·제작에 필요한 재료는 일괄 판매에서 빠집니다)" });
    const total = junk.reduce((s, it) => s + sellPrice(it), 0);
    return h(
      "div",
      { class: "junk-row" },
      h("small", { text: `귀중품 ${junk.length}개 · ${formatMoney(total)} (의뢰·시설·제작 재료와 전설 등급은 제외)` }),
      twoStepButton("small-btn", "귀중품 일괄 판매", `한 번 더 누르면 ${formatMoney(total)}에 판매`, () => {
        let sum = 0;
        for (const it of this.junkItems()) {
          sum += sellPrice(it);
          removeItem(this.profile.stash, it);
        }
        this.profile.money += sum;
        audio.pickup();
        this.app.toast(`귀중품 판매 (+${formatMoney(sum)})`, "good");
        this.changed();
      }),
    );
  }

  // ── 작업대 ─────────────────────────────────────────

  renderBench() {
    const p = this.profile;
    const bench = benchLevel(p);
    const next = UPGRADES.bench.levels[p.hideout.bench + 1];
    return h(
      "div",
      { class: "two-col" },
      h(
        "section",
        { class: "panel bench" },
        h(
          "div",
          { class: "panel-title" },
          h("span", { text: `🛠️ ${UPGRADES.bench.levels[p.hideout.bench].label} · Lv.${bench}` }),
          h("small", { text: next ? `시설 탭에서 ${next.label}(으)로 올리면 더 많은 제작법이 열립니다` : "모든 제작법 사용 가능" }),
        ),
        h("p", { class: "hint", text: "재료는 창고에서 꺼내 씁니다. 내용물이 든 가방이나 탄이 든 총은 재료로 쓰지 않습니다." }),
        RECIPE_GROUPS.map((g) => {
          const list = RECIPES.filter((r) => r.group === g.id);
          return h("div", { class: "recipe-group" }, h("h4", { text: g.name }), h("div", { class: "recipes" }, list.map((r) => this.recipeCard(r))));
        }),
      ),
      this.stashPanel(),
    );
  }

  recipeCard(r) {
    const st = recipeStatus(this.profile, r);
    const [outId, outN] = r.out;
    const def = ITEMS[outId];
    return h(
      "div",
      { class: `recipe rarity-${def.rarity} ${st.locked ? "locked" : ""} ${st.ok ? "ready" : ""}` },
      h("div", { class: "offer-icon" }, h("img", { src: itemIcon(outId), draggable: false })),
      h(
        "div",
        { class: "recipe-info" },
        h("b", { style: { color: RARITY[def.rarity].color }, text: `${def.name}${outN > 1 ? ` x${outN}` : ""}` }),
        h(
          "div",
          { class: "recipe-inputs" },
          st.inputs.map((i) => h("span", { class: `req ${i.have >= i.n ? "ok" : "no"}`, title: ITEMS[i.id].name }, h("img", { src: itemIcon(i.id) }), `${ITEMS[i.id].short} ${Math.min(i.have, 999)}/${i.n}`)),
          st.tools.map((t) => h("span", { class: `req tool ${t.have ? "ok" : "no"}`, title: `${ITEMS[t.id].name} (소모되지 않음)` }, h("img", { src: itemIcon(t.id) }), `도구 ${ITEMS[t.id].short}`)),
        ),
      ),
      st.locked
        ? h("span", { class: "lock", text: `🔒 작업대 Lv.${r.bench}` })
        : h("button", {
            class: `buy ${st.ok ? "" : "poor"}`,
            text: `제작 ${formatMoney(r.cost ?? 0)}`,
            disabled: !st.ok,
            onclick: () => {
              const res = craft(this.profile, r.id);
              if (res.ok) {
                audio.reveal(def.rarity);
                this.app.toast(`${res.name}${res.count > 1 ? ` x${res.count}` : ""} 제작 완료`, "good");
              } else {
                this.app.toast(res.msg, "warn");
              }
              this.changed();
            },
          }),
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
                this.app.toast(`의뢰 완료: ${q.name}${r.mailed ? ` (창고가 가득 차 ${r.mailed}개는 우편함으로)` : ""}`, "good");
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

  // ── 기록 ───────────────────────────────────────────

  renderStats() {
    const s = this.profile.stats;
    const rate = s.raids ? Math.round((s.extracts / s.raids) * 100) : 0;
    const big = (label, value, sub) => h("div", { class: "stat-big" }, h("small", { text: label }), h("b", { text: value }), sub ? h("span", { text: sub }) : null);
    const kills = Object.entries(s.killsByType ?? {}).sort((a, b) => b[1] - a[1]);
    return h(
      "div",
      { class: "two-col" },
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-title" }, h("span", { text: "📊 기록" }), h("small", { text: this.profile.name })),
        h(
          "div",
          { class: "stat-grid" },
          big("출격", `${s.raids}회`, s.scavRaids ? `떠돌이 ${s.scavRaids}회 포함` : null),
          big("생존율", `${rate}%`, `탈출 ${s.extracts} · 사망 ${s.deaths}`),
          big("처치", `${s.kills}`, null),
          big("최고 반출", formatMoney(s.bestLoot ?? 0), "한 번에 들고 나온 가치"),
          big("누적 반출", formatMoney(s.totalLoot ?? 0), null),
          big("최장 생존", formatTime(s.longestRaid ?? 0), null),
          big("문 따기", `${s.unlocks ?? 0}`, null),
          big("제작", `${s.crafted ?? 0}`, null),
          big("보험 회수", `${s.insuranceReturns ?? 0}`, null),
        ),
      ),
      h(
        "section",
        { class: "panel" },
        h("div", { class: "panel-title" }, h("span", { text: "지역별" })),
        h(
          "div",
          { class: "map-rows" },
          MAP_ORDER.map((id) => {
            const m = s.mapStats?.[id] ?? { raids: 0, extracts: 0 };
            const r = m.raids ? Math.round((m.extracts / m.raids) * 100) : 0;
            return h("div", { class: "map-row" }, h("span", { text: MAPS[id].name }), h("div", { class: "goal-bar" }, h("i", { style: { width: `${r}%` } })), h("small", { text: m.raids ? `${m.extracts}/${m.raids} 탈출` : "기록 없음" }));
          }),
        ),
        h("div", { class: "panel-title", style: { marginTop: "16px" } }, h("span", { text: "처치한 적" })),
        kills.length
          ? h("div", { class: "kill-list" }, kills.map(([t, n]) => h("span", { text: `${ENEMY_TYPES[t]?.name ?? t} x${n}` })))
          : h("p", { class: "hint", text: "아직 처치 기록이 없습니다." }),
      ),
    );
  }

  destroy() {
    clearInterval(this.mailTimer);
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
