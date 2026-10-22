// 작업대 제작법. bench = 필요한 작업대 레벨(1~3).
// input은 창고에서 소모, tools는 창고에 있어야 하지만 소모되지 않는다.

export const RECIPE_GROUPS = [
  { id: "ammo", name: "탄약" },
  { id: "med", name: "의료 · 식량" },
  { id: "gear", name: "장비 · 투척물" },
  { id: "trade", name: "특수" },
];

export const RECIPES = [
  { id: "r_9mm", group: "ammo", out: ["9mm", 40], input: [["bolts", 1], ["scrap", 1]], cost: 400, bench: 1 },
  { id: "r_12g", group: "ammo", out: ["12g", 20], input: [["scrap", 2], ["lighter", 1]], cost: 400, bench: 1 },
  { id: "r_12g_slug", group: "ammo", out: ["12g_slug", 12], input: [["12g", 20], ["bolts", 1]], cost: 800, bench: 2 },
  { id: "r_762", group: "ammo", out: ["762", 30], input: [["bolts", 2], ["scrap", 1]], cost: 900, bench: 2 },
  { id: "r_556", group: "ammo", out: ["556", 30], input: [["bolts", 2], ["wires", 1]], cost: 900, bench: 2 },
  { id: "r_9mm_ap", group: "ammo", out: ["9mm_ap", 30], input: [["9mm", 30], ["chem", 1]], cost: 1500, bench: 2 },
  { id: "r_762_ap", group: "ammo", out: ["762_ap", 30], input: [["762", 30], ["chem", 1], ["battery", 1]], cost: 3000, bench: 3 },
  { id: "r_556_ap", group: "ammo", out: ["556_ap", 30], input: [["556", 30], ["chem", 1], ["battery", 1]], cost: 3000, bench: 3 },

  { id: "r_bandage", group: "med", out: ["bandage", 2], input: [["tape", 1]], cost: 200, bench: 1 },
  { id: "r_bread", group: "med", out: ["bread", 2], input: [["crackers", 2]], cost: 100, bench: 1 },
  { id: "r_stim", group: "med", out: ["stim", 1], input: [["chem", 1], ["bandage", 1]], cost: 600, bench: 1 },
  { id: "r_energy", group: "med", out: ["energy_drink", 1], input: [["soda", 1], ["battery", 1]], cost: 500, bench: 2 },
  { id: "r_ifak", group: "med", out: ["ifak", 1], input: [["meds_box", 1], ["tape", 1]], cost: 1200, bench: 2 },
  { id: "r_bigkit", group: "med", out: ["bigkit", 1], input: [["ifak", 1], ["meds_box", 2], ["chem", 1]], cost: 4000, bench: 3 },

  { id: "r_frag", group: "gear", out: ["frag", 2], input: [["fuel", 1], ["scrap", 2]], cost: 1000, bench: 1 },
  { id: "r_bag", group: "gear", out: ["bag_tactical", 1], input: [["bag_scav", 1], ["tape", 2], ["wires", 1]], cost: 3000, bench: 2 },
  { id: "r_helmet", group: "gear", out: ["helmet_6b", 1], input: [["helmet_cap", 1], ["scrap", 3], ["bolts", 2]], cost: 4000, bench: 2 },
  { id: "r_vest", group: "gear", out: ["vest_plate", 1], input: [["vest_police", 1], ["scrap", 4], ["toolbox", 1]], cost: 6000, bench: 3 },

  { id: "r_key_farm", group: "trade", out: ["key_farm", 1], input: [["bolts", 2], ["lighter", 1]], cost: 6000, bench: 2 },
  { id: "r_mining", group: "trade", out: ["duckcoin", 1], input: [["battery", 3]], tools: ["gpu"], cost: 5000, bench: 3 },
];

export const RECIPE_MAP = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
