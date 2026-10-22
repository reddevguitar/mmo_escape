// 컨테이너 종류와 루팅 테이블
// table 항목: [itemId, weight, [minCount, maxCount]?]

export const CONTAINERS = {
  crate: { name: "나무 상자", gw: 4, gh: 4, rolls: [1, 4], table: "crate", size: [1, 1] },
  drawer: { name: "서랍장", gw: 4, gh: 2, rolls: [1, 3], table: "drawer", size: [1, 1] },
  medcab: { name: "의약품 보관함", gw: 3, gh: 3, rolls: [1, 3], table: "medical", size: [1, 1] },
  weaponbox: { name: "무기 상자", gw: 5, gh: 3, rolls: [1, 3], table: "weapon", size: [2, 1] },
  fridge: { name: "냉장고", gw: 3, gh: 4, rolls: [1, 4], table: "food", size: [1, 1] },
  safe: { name: "금고", gw: 3, gh: 3, rolls: [1, 3], table: "safe", size: [1, 1] },
  toolcab: { name: "공구함", gw: 4, gh: 3, rolls: [1, 3], table: "tools", size: [1, 1] },
  jacket: { name: "버려진 재킷", gw: 2, gh: 2, rolls: [0, 2], table: "jacket", size: [1, 1], walkable: true },
  pc: { name: "컴퓨터", gw: 3, gh: 2, rolls: [0, 2], table: "pc", size: [1, 1] },
  duffle: { name: "더플백", gw: 5, gh: 3, rolls: [1, 4], table: "duffle", size: [1, 1], walkable: true },
  trunk: { name: "자동차 트렁크", gw: 5, gh: 3, rolls: [1, 3], table: "duffle", size: [1, 1] },
  corpse: { name: "시체", gw: 6, gh: 6 },
  ground: { name: "바닥", gw: 6, gh: 6 },
};

export const LOOT_TABLES = {
  crate: [
    ["scrap", 10], ["bolts", 8], ["tape", 6], ["wires", 5], ["battery", 3],
    ["9mm", 6, [10, 30]], ["12g", 4, [6, 14]], ["762", 2, [10, 25]], ["556", 1.5, [10, 25]],
    ["crackers", 4], ["canned", 2], ["water", 2], ["toolbox", 1.2], ["fuel", 1],
    ["bag_scav", 0.6], ["rubber_duck", 1.5], ["frag", 0.8],
  ],
  drawer: [
    ["lighter", 8], ["cassette", 6], ["rubber_duck", 4], ["watch", 3], ["ring", 1.5],
    ["bandage", 5], ["9mm", 4, [6, 20]], ["battery", 3], ["wires", 3],
    ["golden_feather", 0.4], ["duckcoin", 0.25], ["camera", 1.2], ["soda", 2], ["key_farm", 0.35],
  ],
  medical: [
    ["bandage", 10], ["stim", 6], ["ifak", 2.5], ["bigkit", 0.8], ["meds_box", 3], ["chem", 1.5],
  ],
  weapon: [
    ["p9", 6], ["uzi", 4], ["sg12", 4], ["mp5", 2.5], ["ak47", 2], ["g18", 1], ["ar15", 0.8], ["svd", 0.5],
    ["9mm", 6, [15, 40]], ["9mm_ap", 1.5, [10, 30]], ["12g", 4, [8, 20]], ["12g_slug", 1.5, [5, 12]],
    ["762", 3, [15, 40]], ["556", 2, [15, 40]], ["762_ap", 0.6, [10, 25]], ["556_ap", 0.5, [10, 25]],
    ["frag", 3], ["vest_police", 1.5], ["vest_plate", 0.8], ["helmet_6b", 1], ["helmet_cap", 1.5],
  ],
  food: [
    ["water", 8], ["soda", 6], ["canned", 5], ["crackers", 5], ["bread", 7], ["energy_drink", 2],
  ],
  safe: [
    ["ring", 6], ["watch", 5], ["golden_feather", 3], ["duckcoin", 2.5], ["intel", 1.5], ["gpu", 0.6], ["key_factory", 0.8],
  ],
  tools: [
    ["bolts", 8], ["tape", 6], ["wires", 6], ["battery", 4], ["toolbox", 2.5], ["fuel", 2], ["scrap", 6], ["chem", 1],
  ],
  jacket: [
    ["lighter", 6], ["9mm", 4, [4, 12]], ["bandage", 4], ["crackers", 3], ["cassette", 2],
    ["rubber_duck", 2], ["watch", 0.8], ["stim", 1],
  ],
  pc: [
    ["wires", 6], ["battery", 5], ["intel", 1.2], ["gpu", 0.7], ["cassette", 3], ["chem", 1], ["key_factory", 0.4],
  ],
  duffle: [
    ["9mm", 4, [10, 30]], ["12g", 3, [6, 14]], ["762", 2, [10, 30]], ["canned", 3], ["water", 3],
    ["bandage", 3], ["stim", 1.5], ["frag", 1.2], ["bag_scav", 1], ["bag_tactical", 0.3],
    ["helmet_cap", 1.2], ["vest_police", 0.8], ["tape", 3], ["rubber_duck", 2], ["watch", 1], ["uzi", 0.6],
  ],
  // 적 시체에 추가로 들어가는 잡동사니
  body_scav: [
    ["crackers", 4], ["soda", 3], ["bandage", 4], ["lighter", 4], ["scrap", 4], ["cassette", 2],
    ["rubber_duck", 2], ["bolts", 2], ["stim", 1], ["watch", 0.7], ["frag", 0.6], ["bread", 3], ["key_farm", 0.3],
  ],
  body_raider: [
    ["stim", 4], ["ifak", 2], ["frag", 3], ["energy_drink", 3], ["canned", 2], ["water", 2],
    ["watch", 2], ["ring", 1.2], ["golden_feather", 0.6], ["duckcoin", 0.4], ["intel", 0.5], ["battery", 2], ["key_factory", 0.5],
  ],
  body_cat: [
    ["cat_bell", 4], ["scrap", 1], ["bread", 1], ["rubber_duck", 0.5],
  ],
  body_goose: [
    ["duckcoin", 3], ["golden_feather", 3], ["gpu", 1.5], ["intel", 2], ["bigkit", 2], ["762_ap", 3, [20, 40]],
  ],
};
