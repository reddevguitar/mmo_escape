// 아이템 정의. value는 기준 가치($). 상인 구매가 = value * BUY_MUL, 판매가 = value * SELL_MUL.
// w/h는 인벤토리 칸 크기, weight는 kg.

export const BUY_MUL = 1.2;
export const SELL_MUL = 0.6;

export const RARITY = [
  { name: "일반", color: "#8c949a" },
  { name: "고급", color: "#5fbf6a" },
  { name: "희귀", color: "#4f9de8" },
  { name: "영웅", color: "#b06ef0" },
  { name: "전설", color: "#f0b23c" },
];

export const TYPE_NAMES = {
  weapon: "무기",
  ammo: "탄약",
  armor: "방탄복",
  helmet: "헬멧",
  backpack: "가방",
  med: "의료품",
  food: "식량",
  grenade: "투척물",
  loot: "전리품",
};

export const CALIBERS = {
  "9mm": "9x19mm",
  "556": "5.56x45mm",
  "762": "7.62x39mm",
  "12g": "12게이지",
};

export const WEAPON_CLASS_NAMES = {
  pistol: "권총",
  smg: "기관단총",
  shotgun: "산탄총",
  rifle: "돌격소총",
  dmr: "지정사수소총",
  lmg: "기관총",
};

const defs = {
  // ── 무기 ─────────────────────────────────────────────
  p9: {
    name: "P9 권총", short: "P9", type: "weapon", wclass: "pistol", caliber: "9mm",
    mag: 12, rpm: 360, auto: false, spread: 2.6, recoil: 2.4, recover: 14,
    range: 620, speed: 1500, reload: 1.5, dmg: 1.0, noise: 750,
    w: 2, h: 1, weight: 0.8, value: 9000, rarity: 0,
    desc: "어디서나 굴러다니는 9mm 권총. 없는 것보단 낫다.",
  },
  g18: {
    name: "G18 기관권총", short: "G18", type: "weapon", wclass: "pistol", caliber: "9mm",
    mag: 20, rpm: 1000, auto: true, spread: 4.2, recoil: 1.6, recover: 12,
    range: 560, speed: 1450, reload: 1.7, dmg: 0.95, noise: 750,
    w: 2, h: 1, weight: 0.9, value: 24000, rarity: 2,
    desc: "연발이 되는 권총. 탄창이 순식간에 비어버린다.",
  },
  uzi: {
    name: "우지 기관단총", short: "UZI", type: "weapon", wclass: "smg", caliber: "9mm",
    mag: 25, rpm: 900, auto: true, spread: 4.8, recoil: 1.1, recover: 12,
    range: 620, speed: 1550, reload: 2.0, dmg: 0.95, noise: 800,
    w: 2, h: 2, weight: 2.2, value: 19000, rarity: 1,
    desc: "작고 시끄럽고 빠르다. 근거리 난전용.",
  },
  mp5: {
    name: "MP-5 기관단총", short: "MP5", type: "weapon", wclass: "smg", caliber: "9mm",
    mag: 30, rpm: 780, auto: true, spread: 2.8, recoil: 0.8, recover: 13,
    range: 720, speed: 1650, reload: 2.2, dmg: 1.05, noise: 850,
    w: 3, h: 2, weight: 2.6, value: 32000, rarity: 2,
    desc: "안정적인 반동의 기관단총. 실내전의 정석.",
  },
  sg12: {
    name: "SG-12 펌프 산탄총", short: "SG12", type: "weapon", wclass: "shotgun", caliber: "12g",
    mag: 6, rpm: 75, auto: false, spread: 7, recoil: 5, recover: 10,
    range: 420, speed: 1300, reload: 0.5, reloadType: "single", dmg: 1.0, noise: 1000,
    w: 4, h: 1, weight: 3.4, value: 24000, rarity: 1,
    desc: "한 발씩 장전하는 펌프액션. 가까이서는 무엇이든 멈춘다.",
  },
  ak47: {
    name: "AK-47 소총", short: "AK", type: "weapon", wclass: "rifle", caliber: "762",
    mag: 30, rpm: 600, auto: true, spread: 2.6, recoil: 1.5, recover: 11,
    range: 900, speed: 2000, reload: 2.6, dmg: 1.0, noise: 1100,
    w: 4, h: 2, weight: 3.6, value: 48000, rarity: 2,
    desc: "튼튼하고 강력하다. 반동은 감수할 것.",
  },
  ar15: {
    name: "AR-15 소총", short: "AR15", type: "weapon", wclass: "rifle", caliber: "556",
    mag: 30, rpm: 760, auto: true, spread: 1.9, recoil: 1.0, recover: 13,
    range: 980, speed: 2300, reload: 2.4, dmg: 1.0, noise: 1050,
    w: 4, h: 2, weight: 3.1, value: 62000, rarity: 3,
    desc: "정확하고 다루기 쉬운 돌격소총.",
  },
  svd: {
    name: "SVD 저격소총", short: "SVD", type: "weapon", wclass: "dmr", caliber: "762",
    mag: 10, rpm: 180, auto: false, spread: 0.5, recoil: 4, recover: 9,
    range: 1400, speed: 2900, reload: 3.0, dmg: 1.35, noise: 1300,
    w: 5, h: 1, weight: 4.3, value: 95000, rarity: 3,
    desc: "멀리서 한 발. 조준(우클릭)할 때 진가를 발휘한다.",
  },
  pkm: {
    name: "PKM 기관총", short: "PKM", type: "weapon", wclass: "lmg", caliber: "762",
    mag: 100, rpm: 650, auto: true, spread: 3.2, recoil: 1.0, recover: 10,
    range: 950, speed: 2100, reload: 5.5, dmg: 1.0, noise: 1300, moveMul: 0.88,
    w: 5, h: 2, weight: 7.5, value: 140000, rarity: 4,
    desc: "대왕 거위의 애총. 무겁지만 100발 탄띠는 든든하다.",
  },

  // ── 탄약 ─────────────────────────────────────────────
  "9mm": {
    name: "9mm FMJ", short: "9mm", type: "ammo", caliber: "9mm", damage: 26, pen: 14, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.008, value: 45, rarity: 0, tracer: "#ffe08a",
    desc: "가장 흔한 권총탄.",
  },
  "9mm_ap": {
    name: "9mm AP", short: "9AP", type: "ammo", caliber: "9mm", damage: 23, pen: 32, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.008, value: 140, rarity: 2, tracer: "#9fe7ff",
    desc: "철심탄. 방탄복을 뚫는다.",
  },
  "556": {
    name: "5.56 M855", short: "556", type: "ammo", caliber: "556", damage: 38, pen: 30, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.012, value: 100, rarity: 1, tracer: "#ffe08a",
    desc: "표준 소총탄.",
  },
  "556_ap": {
    name: "5.56 M995", short: "556AP", type: "ammo", caliber: "556", damage: 35, pen: 50, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.012, value: 340, rarity: 3, tracer: "#9fe7ff",
    desc: "고관통 철갑탄.",
  },
  "762": {
    name: "7.62 PS", short: "762", type: "ammo", caliber: "762", damage: 46, pen: 34, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.016, value: 120, rarity: 1, tracer: "#ffcf6a",
    desc: "묵직한 소총탄.",
  },
  "762_ap": {
    name: "7.62 BP", short: "762BP", type: "ammo", caliber: "762", damage: 44, pen: 52, pellets: 1,
    w: 1, h: 1, stack: 60, weight: 0.016, value: 380, rarity: 3, tracer: "#9fe7ff",
    desc: "중장갑도 뚫어내는 철갑탄.",
  },
  "12g": {
    name: "12g 벅샷", short: "12g", type: "ammo", caliber: "12g", damage: 12, pen: 4, pellets: 8,
    w: 1, h: 1, stack: 20, weight: 0.05, value: 70, rarity: 0, tracer: "#ffb35c",
    desc: "산탄 8발. 방탄복에는 약하다.",
  },
  "12g_slug": {
    name: "12g 슬러그", short: "SLUG", type: "ammo", caliber: "12g", damage: 80, pen: 24, pellets: 1,
    w: 1, h: 1, stack: 20, weight: 0.05, value: 190, rarity: 2, tracer: "#ffb35c",
    desc: "단발 대형 탄두. 한 방이 무겁다.",
  },

  // ── 방탄복 / 헬멧 ────────────────────────────────────
  vest_police: {
    name: "경찰 방탄복", short: "2등급", type: "armor", cls: 2, dur: 40, slow: 0,
    w: 3, h: 3, weight: 3.5, value: 16000, rarity: 1, color: "#3c4f6b",
    desc: "권총탄 정도는 막아준다.",
  },
  vest_plate: {
    name: "판형 방탄복", short: "3등급", type: "armor", cls: 3, dur: 50, slow: 0.03,
    w: 3, h: 3, weight: 6.5, value: 38000, rarity: 2, color: "#5a6646",
    desc: "강판이 들어간 방탄복.",
  },
  vest_tactical: {
    name: "전술 방탄복", short: "4등급", type: "armor", cls: 4, dur: 60, slow: 0.05,
    w: 3, h: 3, weight: 8.5, value: 78000, rarity: 3, color: "#2f3a2f",
    desc: "용병들이 즐겨 입는 고급 방탄복.",
  },
  vest_heavy: {
    name: "중장갑 방탄복", short: "5등급", type: "armor", cls: 5, dur: 80, slow: 0.09,
    w: 3, h: 3, weight: 12, value: 170000, rarity: 4, color: "#24262b",
    desc: "걸어다니는 금고. 대신 느려진다.",
  },
  helmet_cap: {
    name: "공사장 안전모", short: "1등급", type: "helmet", cls: 1, dur: 15,
    w: 2, h: 2, weight: 0.5, value: 4500, rarity: 0, color: "#f2c230",
    desc: "머리에 떨어지는 볼트 정도는 막아준다.",
  },
  helmet_6b: {
    name: "군용 헬멧", short: "3등급", type: "helmet", cls: 3, dur: 30,
    w: 2, h: 2, weight: 1.6, value: 24000, rarity: 2, color: "#55603f",
    desc: "표준 보병용 헬멧.",
  },
  helmet_ballistic: {
    name: "방탄 헬멧", short: "4등급", type: "helmet", cls: 4, dur: 40,
    w: 2, h: 2, weight: 1.4, value: 62000, rarity: 3, color: "#2b2f33",
    desc: "가볍고 단단한 고급 헬멧.",
  },

  // ── 가방 ─────────────────────────────────────────────
  bag_sling: {
    name: "슬링백", short: "3x2", type: "backpack", gw: 3, gh: 2,
    w: 2, h: 2, weight: 0.4, value: 7000, rarity: 0, color: "#6b5a3e",
    desc: "작은 크로스백.",
  },
  bag_scav: {
    name: "잡동사니 배낭", short: "4x4", type: "backpack", gw: 4, gh: 4,
    w: 3, h: 3, weight: 0.9, value: 16000, rarity: 1, color: "#5c6b3e",
    desc: "낡았지만 꽤 들어간다.",
  },
  bag_tactical: {
    name: "전술 배낭", short: "5x5", type: "backpack", gw: 5, gh: 5,
    w: 3, h: 4, weight: 1.4, value: 42000, rarity: 2, color: "#3f4a38",
    desc: "몰리 시스템이 달린 군용 배낭.",
  },
  bag_raid: {
    name: "대형 레이드 배낭", short: "6x7", type: "backpack", gw: 6, gh: 7,
    w: 4, h: 5, weight: 2.2, value: 98000, rarity: 3, color: "#2f3530",
    desc: "욕심쟁이 오리를 위한 초대형 배낭.",
  },

  // ── 의료품 ───────────────────────────────────────────
  bandage: {
    name: "붕대", short: "붕대", type: "med", heal: 0, uses: 1, useTime: 2.0, stopsBleed: true,
    w: 1, h: 1, weight: 0.1, value: 2200, rarity: 0, icon: "🩹",
    desc: "출혈을 멈춘다.",
  },
  stim: {
    name: "회복 주사기", short: "주사", type: "med", heal: 40, uses: 1, useTime: 1.8,
    w: 1, h: 1, weight: 0.1, value: 7000, rarity: 1, icon: "💉",
    desc: "체력을 40 회복한다.",
  },
  ifak: {
    name: "IFAK 구급 파우치", short: "IFAK", type: "med", heal: 60, uses: 150, pool: true, useTime: 3.0, stopsBleed: true,
    w: 1, h: 1, weight: 0.4, value: 18000, rarity: 2, icon: "draw:pouch",
    desc: "한 번에 최대 60 회복, 총 150. 출혈도 멈춘다.",
  },
  bigkit: {
    name: "대형 구급상자", short: "구급", type: "med", heal: 85, uses: 320, pool: true, useTime: 4.0, stopsBleed: true,
    w: 2, h: 1, weight: 1.1, value: 34000, rarity: 3, icon: "draw:medcase",
    desc: "한 번에 최대 85 회복, 총 320. 출혈도 멈춘다.",
  },

  // ── 식량 ─────────────────────────────────────────────
  crackers: {
    name: "건빵", short: "건빵", type: "food", energy: 18, water: -3, useTime: 2.0,
    w: 1, h: 1, weight: 0.2, value: 1800, rarity: 0, icon: "🍘",
    desc: "퍽퍽하다. 에너지 +18",
  },
  bread: {
    name: "식빵", short: "식빵", type: "food", energy: 28, heal: 5, useTime: 2.2,
    w: 1, h: 1, weight: 0.3, value: 3200, rarity: 0, icon: "🍞",
    desc: "오리는 빵을 좋아한다. 에너지 +28, 체력 +5",
  },
  canned: {
    name: "통조림", short: "통조림", type: "food", energy: 40, water: 5, useTime: 3.0,
    w: 1, h: 1, weight: 0.4, value: 4800, rarity: 1, icon: "🥫",
    desc: "든든한 한 끼. 에너지 +40",
  },
  water: {
    name: "생수", short: "물", type: "food", water: 50, useTime: 2.4,
    w: 1, h: 2, weight: 0.6, value: 3600, rarity: 0, icon: "💧",
    desc: "수분 +50",
  },
  soda: {
    name: "탄산음료", short: "콜라", type: "food", water: 28, energy: 8, useTime: 1.8,
    w: 1, h: 1, weight: 0.4, value: 2600, rarity: 0, icon: "🥤",
    desc: "수분 +28, 에너지 +8",
  },
  energy_drink: {
    name: "에너지 드링크", short: "에너지", type: "food", water: 20, energy: 15, stamBuff: 90, useTime: 1.8,
    w: 1, h: 1, weight: 0.4, value: 6500, rarity: 1, icon: "⚡",
    desc: "90초간 스태미나 회복 2배. 수분 +20",
  },

  // ── 투척물 ───────────────────────────────────────────
  frag: {
    name: "세열 수류탄", short: "수류탄", type: "grenade", damage: 130, radius: 180, fuse: 2.3,
    w: 1, h: 1, weight: 0.6, value: 9000, rarity: 1, icon: "💣",
    desc: "G키로 투척. 벽 너머로 넘기기 좋다.",
  },

  // ── 전리품 ───────────────────────────────────────────
  scrap: { name: "고철", short: "고철", type: "loot", w: 1, h: 1, weight: 0.8, value: 900, rarity: 0, icon: "⚙️", desc: "고물상에 팔면 푼돈은 된다." },
  bolts: { name: "볼트 한 줌", short: "볼트", type: "loot", w: 1, h: 1, weight: 0.3, value: 2400, rarity: 0, icon: "🔩", desc: "시설 건설 재료." },
  tape: { name: "덕트 테이프", short: "테이프", type: "loot", w: 1, h: 1, weight: 0.2, value: 2800, rarity: 0, icon: "🧻", desc: "덕(Duck)트 테이프. 뭐든 고친다." },
  lighter: { name: "라이터", short: "라이터", type: "loot", w: 1, h: 1, weight: 0.1, value: 1500, rarity: 0, icon: "🔥", desc: "불은 붙는다." },
  wires: { name: "전선 뭉치", short: "전선", type: "loot", w: 1, h: 1, weight: 0.3, value: 3200, rarity: 1, icon: "🔌", desc: "시설 건설 재료." },
  battery: { name: "배터리", short: "배터리", type: "loot", w: 1, h: 1, weight: 0.4, value: 4200, rarity: 1, icon: "🔋", desc: "시설 건설 재료." },
  cassette: { name: "카세트 테이프", short: "카세트", type: "loot", w: 1, h: 1, weight: 0.1, value: 3500, rarity: 1, icon: "📼", desc: "누군가의 믹스테이프." },
  rubber_duck: { name: "고무 오리", short: "고무오리", type: "loot", w: 1, h: 1, weight: 0.1, value: 6500, rarity: 1, icon: "🐤", desc: "삑. 수집가들이 찾는다." },
  meds_box: { name: "의약품 상자", short: "약상자", type: "loot", w: 2, h: 1, weight: 0.8, value: 9000, rarity: 1, icon: "💊", desc: "의뢰 납품용 의약품." },
  watch: { name: "오래된 시계", short: "시계", type: "loot", w: 1, h: 1, weight: 0.1, value: 14000, rarity: 2, icon: "⌚", desc: "아직 간다." },
  chem: { name: "화학 시약", short: "시약", type: "loot", w: 1, h: 1, weight: 0.3, value: 12000, rarity: 2, icon: "🧪", desc: "연구소에서 흘러나온 시약." },
  camera: { name: "필름 카메라", short: "카메라", type: "loot", w: 2, h: 1, weight: 0.7, value: 17000, rarity: 2, icon: "📷", desc: "수집가 아이템." },
  toolbox: { name: "공구 상자", short: "공구", type: "loot", w: 2, h: 2, weight: 3, value: 15000, rarity: 2, icon: "🧰", desc: "시설 건설 재료." },
  fuel: { name: "연료통", short: "연료", type: "loot", w: 2, h: 2, weight: 5, value: 19000, rarity: 2, icon: "⛽", desc: "시설 건설 재료." },
  ring: { name: "보석 반지", short: "반지", type: "loot", w: 1, h: 1, weight: 0.05, value: 26000, rarity: 2, icon: "💍", desc: "반짝인다." },
  golden_feather: { name: "황금 깃털", short: "깃털", type: "loot", w: 1, h: 1, weight: 0.05, value: 42000, rarity: 3, icon: "🪶", desc: "전설의 오리가 남긴 깃털." },
  intel: { name: "기밀 문서", short: "문서", type: "loot", w: 2, h: 1, weight: 0.3, value: 48000, rarity: 3, icon: "📁", desc: "공장 사무실의 비밀 서류." },
  duckcoin: { name: "덕코인", short: "₿", type: "loot", w: 1, h: 1, weight: 0.05, value: 80000, rarity: 3, icon: "🪙", desc: "오리들의 암호화폐." },
  gpu: { name: "그래픽카드", short: "GPU", type: "loot", w: 2, h: 1, weight: 0.9, value: 125000, rarity: 4, icon: "draw:gpu", desc: "덕코인 채굴용. 매우 비싸다." },
  golden_egg: { name: "황금 거위알", short: "황금알", type: "loot", w: 2, h: 2, weight: 1.5, value: 360000, rarity: 4, icon: "draw:egg", desc: "대왕 거위가 품고 있던 황금알." },
};

for (const [id, def] of Object.entries(defs)) {
  def.id = id;
  def.stack ??= 1;
  def.rarity ??= 0;
}

export const ITEMS = defs;

export function getDef(id) {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}

export function sellPrice(item) {
  const def = ITEMS[item.id];
  if (!def) return 0;
  let value = def.value;
  if (def.type === "armor" || def.type === "helmet") {
    const dur = item.data?.dur ?? def.dur;
    value *= 0.3 + 0.7 * (dur / def.dur);
  }
  if (def.pool) {
    value *= 0.25 + 0.75 * ((item.data?.uses ?? def.uses) / def.uses);
  }
  let total = value * SELL_MUL * (item.count ?? 1);
  if (def.type === "weapon" && item.data?.mag > 0 && item.data.ammoId) {
    total += ITEMS[item.data.ammoId].value * SELL_MUL * item.data.mag;
  }
  return Math.max(1, Math.round(total));
}

export function buyPrice(id, count = 1) {
  return Math.round(ITEMS[id].value * BUY_MUL * count);
}
