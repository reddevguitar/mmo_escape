// 타이틀, 출격 선택, 결과, 일시정지, 튜토리얼 화면

import { ITEMS } from "../data/items.js";
import { MAPS, MAP_ORDER } from "../data/maps.js";
import { ENEMY_TYPES } from "../data/enemies.js";
import { h } from "../core/dom.js";
import { formatMoney, formatTime } from "../core/util.js";
import { playerLevel } from "../systems/profile.js";
import { scavCooldownLeft } from "../systems/scav.js";
import { itemIcon } from "./icons.js";
import { audio } from "../game/audio.js";
import { twoStepButton, touchMode } from "./widgets.js";

export const CONTROLS = [
  ["WASD", "이동"],
  ["마우스", "조준"],
  ["좌클릭", "사격 (맨손이면 쪼기)"],
  ["우클릭", "정밀 조준 (시야↑ 탄퍼짐↓)"],
  ["Shift", "달리기"],
  ["C / Ctrl", "웅크리기 (조용히)"],
  ["R", "재장전"],
  ["F", "수색 / 문 열기"],
  ["Tab", "인벤토리"],
  ["1 / 2 / 휠", "무기 교체"],
  ["3 ~ 6", "주머니 아이템 사용"],
  ["G", "수류탄 투척"],
  ["M", "지도"],
  ["Esc", "일시정지"],
];

export const TOUCH_CONTROLS = [
  ["왼쪽 스틱", "이동 (끝까지 밀면 달리기)"],
  ["오른쪽 스틱", "조준 · 바깥 원까지 밀면 사격"],
  ["🎯", "정밀 조준 켜기/끄기"],
  ["↻ / ⇄", "재장전 / 무기 교체"],
  ["손", "수색 / 문 열기"],
  ["🎒 / 🗺", "인벤토리 / 지도"],
  ["아이템 탭", "메뉴 (사용·장착·이동)"],
  ["길게 눌러 끌기", "아이템 옮기기 (↻ 버튼으로 회전)"],
];

function controlsList(touch = touchMode()) {
  return h("div", { class: "controls-list" }, (touch ? TOUCH_CONTROLS : CONTROLS).map(([k, v]) => h("div", {}, h("kbd", { text: k }), h("span", { text: v }))));
}

export function titleScreen({ profile, onContinue, onNew }) {
  const nameInput = h("input", { class: "name-input", maxlength: 14, placeholder: "오리 이름", value: profile?.name ?? `오리${Math.floor(Math.random() * 900 + 100)}` });
  if (!profile) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onNew(nameInput.value);
    });
  }
  const box = profile
    ? h(
        "div",
        { class: "title-box" },
        h("div", { class: "save-info", text: `${profile.name} · Lv.${playerLevel(profile)} · ${formatMoney(profile.money)} · 출격 ${profile.stats.raids}회` }),
        h("button", { class: "big-btn", text: "이어하기", onclick: () => onContinue() }),
        twoStepButton("ghost-btn danger", "새로 시작 (저장 삭제)", "한 번 더 누르면 모든 진행이 지워집니다", () => onNew(nameInput.value)),
        h("label", { class: "rename" }, "새로 시작할 때 이름: ", nameInput),
      )
    : h(
        "div",
        { class: "title-box" },
        h("label", { text: "오리 이름" }),
        nameInput,
        h("button", { class: "big-btn", text: "시작하기", onclick: () => onNew(nameInput.value) }),
      );
  return h(
    "div",
    { class: "title-screen" },
    h(
      "div",
      { class: "title-art" },
      h("div", { class: "title-duck", text: "🦆" }),
      h("h1", { text: "DUCKSCAPE" }),
      h("p", { class: "subtitle", text: "오리들의 탈출 — 탑다운 익스트랙션 슈터" }),
    ),
    box,
    h(
      "div",
      { class: "title-how" },
      h("h3", { text: "어떻게 하나요?" }),
      h(
        "ol",
        {},
        h("li", { text: "은신처에서 장비를 챙겨 출격합니다." }),
        h("li", { text: "상자와 시체를 뒤져 전리품을 모으세요. 적 오리들이 돌아다닙니다." }),
        h("li", { text: "제한 시간 안에 탈출 지점에 도착해 버티면 탈출 성공!" }),
        h("li", { text: "죽으면 가져간 장비를 모두 잃습니다. 보안 컨테이너 안의 물건만 남습니다." }),
        h("li", { text: "전리품을 팔아 더 좋은 장비를 사고, 의뢰와 시설로 성장하세요." }),
      ),
      controlsList(),
      h("p", { class: "hint", text: "PC는 키보드·마우스, 휴대폰·태블릿은 화면 터치로 플레이합니다. 진행 상황은 이 브라우저에 자동 저장됩니다." }),
    ),
  );
}

export function deployModal({ profile, onDeploy, onClose }) {
  const level = playerLevel(profile);
  let selected = MAP_ORDER.find((id) => level >= MAPS[id].minLevel && id === (profile.lastResult?.mapId ?? "farm")) ?? "farm";
  let mode = "pmc";
  const eq = profile.equip;
  const warnings = [];
  if (!eq.primary && !eq.secondary) warnings.push("무기가 없습니다. 부리로 쪼는 것밖에 못 합니다!");
  for (const slot of ["primary", "secondary"]) {
    const w = eq[slot];
    if (!w) continue;
    const def = ITEMS[w.id];
    const grids = [profile.pockets, eq.backpack?.data.grid, profile.secure].filter(Boolean);
    let spare = 0;
    for (const g of grids) for (const it of g.items) if (ITEMS[it.id].type === "ammo" && ITEMS[it.id].caliber === def.caliber) spare += it.count;
    if (w.data.mag === 0 && spare === 0) warnings.push(`${def.name}에 탄이 없고 예비 탄약도 없습니다.`);
    else if (spare === 0) warnings.push(`${def.name}의 예비 탄약이 없습니다 (재장전 불가).`);
  }
  if (!eq.backpack) warnings.push("가방이 없습니다. 전리품을 많이 못 담습니다.");
  const medCount = [profile.pockets, eq.backpack?.data.grid].filter(Boolean).reduce((s, g) => s + g.items.filter((i) => ITEMS[i.id].type === "med").length, 0);
  if (medCount === 0) warnings.push("의료품이 없습니다. 출혈을 멈출 수 없습니다.");

  const cards = h("div", { class: "map-cards" });
  const deployBtn = h("button", { class: "big-btn", text: "출격!" });
  const renderCards = () => {
    cards.replaceChildren(
      ...MAP_ORDER.map((id) => {
        const m = MAPS[id];
        const locked = level < m.minLevel;
        const enemies = Object.entries(m.enemies).map(([t, n]) => `${ENEMY_TYPES[t].name} ${n}`);
        if (m.boss) enemies.push(`보스: ${ENEMY_TYPES[m.boss.type].name}`);
        return h(
          "button",
          {
            class: `map-card ${selected === id ? "selected" : ""} ${locked ? "locked" : ""} theme-${m.theme} ${m.night ? "night" : ""}`,
            disabled: locked,
            onclick: () => {
              audio.ui();
              selected = id;
              renderCards();
            },
          },
          h("div", { class: "map-name", text: m.name }),
          h("div", { class: "map-sub", text: m.subtitle }),
          h("p", { text: m.desc }),
          h(
            "div",
            { class: "map-stats" },
            h("span", { text: `난이도 ${"★".repeat(m.difficulty)}${"☆".repeat(3 - m.difficulty)}` }),
            h("span", { text: `제한 ${formatTime(m.raidTime)}` }),
            h("span", { text: `전리품 x${m.lootMul}` }),
          ),
          h("small", { text: enemies.join(" · ") }),
          locked ? h("div", { class: "lock-badge", text: `🔒 Lv.${m.minLevel} 필요` }) : null,
        );
      }),
    );
  };
  renderCards();
  deployBtn.onclick = () => {
    if (mode === "scav" && scavCooldownLeft(profile) > 0) return;
    onDeploy(selected, mode);
  };

  const slotName = (it) => (it ? ITEMS[it.id].name : "—");
  const pmcInfo = h(
    "div",
    { class: "mode-info" },
    h(
      "div",
      { class: "loadout" },
      h("div", {}, h("small", { text: "주무기" }), h("b", { text: slotName(eq.primary) })),
      h("div", {}, h("small", { text: "보조무기" }), h("b", { text: slotName(eq.secondary) })),
      h("div", {}, h("small", { text: "방탄복" }), h("b", { text: slotName(eq.armor) })),
      h("div", {}, h("small", { text: "헬멧" }), h("b", { text: slotName(eq.helmet) })),
      h("div", {}, h("small", { text: "가방" }), h("b", { text: slotName(eq.backpack) })),
    ),
    warnings.length ? h("ul", { class: "warnings" }, warnings.map((w) => h("li", { text: `⚠ ${w}` }))) : h("p", { class: "ok-line", text: "✔ 준비 완료" }),
    h("p", { class: "hint", text: "레이드 중 페이지를 닫거나 새로고침하면 실종(사망) 처리됩니다." }),
  );
  const cooldownText = h("b");
  const scavInfo = h(
    "div",
    { class: "mode-info scav-info hidden" },
    h(
      "ul",
      { class: "scav-points" },
      h("li", { text: "무작위 무기·장비를 받아 나갑니다. 은신처 장비는 그대로 둡니다." }),
      h("li", { text: "떠돌이 오리들은 같은 편입니다. 먼저 쏘면 근처 떠돌이들이 적이 됩니다. (용병·고양이·거위는 여전히 적)" }),
      h("li", { text: "죽어도 잃는 것이 없습니다. 탈출하면 들고 나온 것을 전부 가집니다. 창고가 차면 우편함으로 갑니다." }),
      h("li", { text: "보안 컨테이너는 가져갈 수 없습니다." }),
    ),
    h("p", { class: "cooldown" }, "다음 떠돌이 출격: ", cooldownText),
  );
  const tabs = h("div", { class: "mode-tabs" });
  const renderTabs = () => {
    const left = scavCooldownLeft(profile);
    cooldownText.textContent = left > 0 ? `${formatTime(left / 1000)} 후 가능` : "지금 가능";
    pmcInfo.classList.toggle("hidden", mode !== "pmc");
    scavInfo.classList.toggle("hidden", mode !== "scav");
    deployBtn.disabled = mode === "scav" && left > 0;
    deployBtn.textContent = mode === "scav" ? "떠돌이로 출격!" : "출격!";
    tabs.replaceChildren(
      h("button", { class: `mode-tab ${mode === "pmc" ? "active" : ""}`, onclick: () => ((mode = "pmc"), renderTabs()) }, h("b", { text: "🦆 오리 출격" }), h("small", { text: "내 장비로, 죽으면 잃는다" })),
      h(
        "button",
        { class: `mode-tab ${mode === "scav" ? "active" : ""}`, onclick: () => ((mode = "scav"), renderTabs()) },
        h("b", { text: "🎲 떠돌이 출격" }),
        h("small", { text: left > 0 ? `대기 ${formatTime(left / 1000)}` : "무료 장비, 손실 없음" }),
      ),
    );
  };
  renderTabs();
  const modal = h(
    "div",
    { class: "modal-backdrop" },
    h(
      "div",
      { class: "modal deploy" },
      h("h2", { text: "출격" }),
      tabs,
      cards,
      pmcInfo,
      scavInfo,
      h("div", { class: "modal-buttons" }, h("button", { class: "ghost-btn", text: "취소", onclick: onClose }), deployBtn),
    ),
  );
  // 대기 시간 표시 갱신 (모달이 닫히면 멈춘다)
  const timer = setInterval(() => {
    if (!modal.isConnected) {
      clearInterval(timer);
      return;
    }
    if (mode === "scav" || scavCooldownLeft(profile) > 0) renderTabs();
  }, 1000);
  return modal;
}

export function resultsScreen({ result, summary, onContinue }) {
  const titles = result.scav
    ? {
        extracted: ["탈출 성공!", "떠돌이로 들고 나온 것은 전부 당신의 것입니다."],
        dead: ["사망", "떠돌이 출격이라 잃은 것은 없습니다."],
        mia: ["실종 (MIA)", "떠돌이 출격이라 잃은 것은 없습니다."],
      }
    : {
        extracted: ["탈출 성공!", "살아서 돌아왔습니다. 가져온 전리품은 모두 당신의 것입니다."],
        dead: ["사망", "가져간 장비를 모두 잃었습니다. 보안 컨테이너만 무사합니다."],
        mia: ["실종 (MIA)", "탈출하지 못했습니다. 가져간 장비를 모두 잃었습니다."],
      };
  const [title, desc] = titles[result.status];
  const newItems = result.newItems ?? [];
  const kills = {};
  for (const k of result.kills) kills[k.name] = (kills[k.name] ?? 0) + 1;
  const gained = result.endValue - result.startValue;
  return h(
    "div",
    { class: `results status-${result.status}` },
    h(
      "div",
      { class: "results-box" },
      h("div", { class: "results-icon", text: result.status === "extracted" ? "🦆" : "🪦" }),
      h("h1", { text: title }),
      h("p", { class: "cause", text: result.status === "extracted" ? `${result.cause}(으)로 탈출` : `원인: ${result.cause ?? "알 수 없음"}` }),
      h("p", { text: desc }),
      h(
        "div",
        { class: "results-grid" },
        cell("지역", result.mapName ?? MAPS[result.mapId]?.name ?? "-"),
        cell("생존 시간", formatTime(result.time)),
        cell("처치", `${result.kills.length}`),
        cell("수색한 컨테이너", `${result.searched}`),
        cell("가한 피해", `${result.damageDealt ?? 0}`),
        cell("반출 가치", result.status === "extracted" ? `${formatMoney(result.endValue)} (${gained >= 0 ? "+" : ""}${formatMoney(gained)})` : "$0"),
      ),
      Object.keys(kills).length ? h("div", { class: "kill-list" }, Object.entries(kills).map(([n, c]) => h("span", { text: `${n} x${c}` }))) : null,
      newItems.length
        ? h(
            "div",
            { class: "loot-list" },
            h("h4", { text: `새로 얻은 전리품 ${newItems.length}종` }),
            h(
              "div",
              { class: "loot-chips" },
              newItems.slice(0, 14).map((it) =>
                h("span", { class: `loot-chip rarity-${ITEMS[it.id].rarity}`, title: ITEMS[it.id].name }, h("img", { src: itemIcon(it.id) }), `${ITEMS[it.id].short}${it.count > 1 ? ` x${it.count}` : ""}`),
              ),
              newItems.length > 14 ? h("span", { class: "loot-more", text: `외 ${newItems.length - 14}종` }) : null,
            ),
          )
        : null,
      summary.mailed ? h("div", { class: "mail-note", text: `📬 창고에 자리가 없어 ${summary.mailed}개는 우편함에 있습니다.` }) : null,
      h(
        "div",
        { class: "xp-box" },
        h("div", {}, h("span", { text: "처치" }), h("b", { text: `+${result.xp.kills} XP` })),
        h("div", {}, h("span", { text: "수색" }), h("b", { text: `+${result.xp.search} XP` })),
        h("div", {}, h("span", { text: "생존" }), h("b", { text: `+${result.xp.survival} XP` })),
        h("div", { class: "total" }, h("span", { text: "합계" }), h("b", { text: `+${result.xp.total} XP` })),
      ),
      summary.levelAfter > summary.levelBefore ? h("div", { class: "level-up", text: `레벨 업! Lv.${summary.levelBefore} → Lv.${summary.levelAfter}` }) : null,
      summary.progressed.length ? h("div", { class: "quest-progress", text: `의뢰 진행: ${summary.progressed.join(", ")}` }) : null,
      h("button", { class: "big-btn", text: "은신처로 돌아가기", onclick: onContinue }),
    ),
  );
}

function cell(label, value) {
  return h("div", { class: "rcell" }, h("small", { text: label }), h("b", { text: value }));
}

export function pauseModal({ profile, scav = false, onResume, onAbandon, onVolume, onToggleNumbers, onToggleSoundMarkers }) {
  const vol = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: String(profile.settings.volume) });
  vol.addEventListener("input", () => onVolume(Number(vol.value)));
  const nums = h("input", { type: "checkbox" });
  nums.checked = profile.settings.damageNumbers;
  nums.addEventListener("change", () => onToggleNumbers(nums.checked));
  const marks = h("input", { type: "checkbox" });
  marks.checked = profile.settings.soundMarkers !== false;
  marks.addEventListener("change", () => onToggleSoundMarkers?.(marks.checked));
  return h(
    "div",
    { class: "modal-backdrop" },
    h(
      "div",
      { class: "modal pause" },
      h("h2", { text: "일시정지" }),
      h("label", { class: "setting" }, h("span", { text: "음량" }), vol),
      h("label", { class: "setting" }, h("span", { text: "피해 숫자 표시" }), nums),
      h("label", { class: "setting" }, h("span", { text: "소리 방향 표시" }), marks),
      controlsList(),
      h(
        "div",
        { class: "modal-buttons" },
        scav
          ? twoStepButton("ghost-btn danger", "레이드 포기 (떠돌이 — 손실 없음)", "한 번 더 누르면 포기합니다. 들고 있는 것은 두고 갑니다", onAbandon)
          : twoStepButton("ghost-btn danger", "레이드 포기 (실종 처리)", "한 번 더 누르면 장비를 모두 잃고 포기합니다", onAbandon),
        h("button", { class: "big-btn", text: "계속하기", onclick: onResume }),
      ),
    ),
  );
}

export function tutorialModal({ onClose }) {
  const touch = touchMode();
  return h(
    "div",
    { class: "modal-backdrop" },
    h(
      "div",
      { class: "modal tutorial" },
      h("h2", { text: "은신처에 온 걸 환영해, 신입 오리!" }),
      h(
        "div",
        { class: "tut-steps" },
        touch
          ? step("🎒", "장비 · 창고", "아이템을 탭하면 정보와 메뉴(장착·옮기기·판매)가 나옵니다. 길게 눌러 끌면 원하는 칸에 놓을 수 있고, 끄는 동안 ↻ 버튼으로 돌립니다.")
          : step("🎒", "장비 · 창고", "창고의 아이템을 끌어서 장비 슬롯/가방/주머니에 넣으세요. 드래그 중 R로 회전, 탄약을 총 위에 떨어뜨리면 장전됩니다."),
        touch
          ? step("🕹️", "조작", "왼쪽 스틱으로 이동(끝까지 밀면 달리기), 오른쪽 스틱으로 조준합니다. 오른쪽 스틱을 바깥 원까지 밀면 사격!")
          : step("🔫", "출격", "레이드에 들고 간 것은 죽으면 모두 잃습니다. 꼭 필요한 것만, 그리고 예비 탄약과 붕대는 반드시!"),
        step("📦", "수색", touch ? "상자·시체 가까이에서 화면의 ✋ 안내를 누르면 수색이 시작됩니다. 아이템은 하나씩 드러나고, 그동안에도 적은 움직입니다." : "상자·시체 근처에서 F를 누르면 수색이 시작됩니다. 아이템은 하나씩 드러나고, 그동안에도 적은 움직입니다."),
        step("🚪", "탈출", "오른쪽 위 탈출 지점 중 하나로 가서 7초간 버티세요. 시간이 다 되면 실종 처리됩니다. 죽으면 들고 간 것은 모두 잃습니다."),
        step("🔒", "보안 컨테이너", "보안 컨테이너 안의 물건은 죽어도 남습니다. 비싼 전리품은 여기에!"),
        step("📈", "성장", "전리품을 상인에게 팔고, 의뢰를 완료하고, 시설을 업그레이드하세요. 레벨이 오르면 상인이 더 좋은 물건을 팝니다."),
      ),
      h("p", { class: "hint", text: "시야는 바라보는 방향의 부채꼴입니다. 등 뒤는 보이지 않으니 소리(총성/발소리/꽥!)에 귀를 기울이세요." }),
      h("div", { class: "modal-buttons" }, h("button", { class: "big-btn", text: "알겠어요", onclick: onClose })),
    ),
  );
}

function step(icon, title, text) {
  return h("div", { class: "tut-step" }, h("div", { class: "tut-icon", text: icon }), h("div", {}, h("b", { text: title }), h("p", { text })));
}
