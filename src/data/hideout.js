// 은신처 시설 업그레이드. levels[0]은 기본 상태.

export const UPGRADES = {
  stash: {
    name: "창고",
    icon: "📦",
    desc: "창고 공간을 넓힌다.",
    levels: [
      { label: "10 x 12", stashH: 12 },
      { label: "10 x 18", stashH: 18, cost: 40000, items: [["bolts", 2], ["tape", 1]] },
      { label: "10 x 26", stashH: 26, cost: 120000, items: [["toolbox", 1], ["wires", 2]] },
      { label: "10 x 36", stashH: 36, cost: 300000, items: [["fuel", 1], ["battery", 3]] },
    ],
  },
  secure: {
    name: "보안 컨테이너",
    icon: "🔒",
    desc: "사망해도 잃지 않는 보안 컨테이너를 키운다.",
    levels: [
      { label: "2 x 2", secureW: 2, secureH: 2 },
      { label: "3 x 2", secureW: 3, secureH: 2, cost: 60000, items: [["battery", 2], ["wires", 2]] },
      { label: "3 x 3", secureW: 3, secureH: 3, cost: 180000, items: [["chem", 2], ["golden_feather", 1]] },
    ],
  },
  gym: {
    name: "훈련장",
    icon: "🏋️",
    desc: "최대 체력을 올린다.",
    levels: [
      { label: "최대 체력 100", maxHp: 100 },
      { label: "최대 체력 115", maxHp: 115, cost: 50000, items: [["canned", 3], ["water", 2]] },
      { label: "최대 체력 130", maxHp: 130, cost: 150000, items: [["energy_drink", 3], ["ifak", 1]] },
    ],
  },
};

export const UPGRADE_ORDER = ["stash", "secure", "gym"];
