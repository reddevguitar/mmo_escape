// 상인 "마담 꽥". 플레이어 레벨에 따라 판매 품목이 늘어납니다.
// [itemId, 구매 단위 수량]

export const TRADER = {
  name: "마담 꽥",
  greeting: "꽥. 살 거면 사고, 팔 거면 팔아.",
  tiers: [
    {
      level: 1,
      minPlayerLevel: 1,
      offers: [
        ["p9", 1], ["uzi", 1], ["sg12", 1],
        ["9mm", 30], ["12g", 20],
        ["bandage", 1], ["stim", 1], ["crackers", 1], ["bread", 1], ["water", 1], ["soda", 1],
        ["helmet_cap", 1], ["vest_police", 1], ["bag_sling", 1], ["bag_scav", 1],
      ],
    },
    {
      level: 2,
      minPlayerLevel: 4,
      offers: [
        ["mp5", 1], ["ak47", 1],
        ["9mm_ap", 30], ["762", 30], ["556", 30], ["12g_slug", 20],
        ["ifak", 1], ["canned", 1], ["energy_drink", 1], ["frag", 1],
        ["helmet_6b", 1], ["vest_plate", 1], ["bag_tactical", 1], ["key_farm", 1],
      ],
    },
    {
      level: 3,
      minPlayerLevel: 8,
      offers: [
        ["ar15", 1], ["svd", 1],
        ["762_ap", 30], ["556_ap", 30],
        ["bigkit", 1], ["helmet_ballistic", 1], ["vest_tactical", 1], ["bag_raid", 1], ["key_factory", 1],
      ],
    },
  ],
};

export const SHOP_CATEGORIES = [
  { id: "all", name: "전체", types: null },
  { id: "weapon", name: "무기", types: ["weapon"] },
  { id: "ammo", name: "탄약", types: ["ammo", "grenade"] },
  { id: "gear", name: "장비", types: ["armor", "helmet", "backpack"] },
  { id: "med", name: "의료/식량", types: ["med", "food"] },
  { id: "key", name: "열쇠", types: ["key"] },
];
