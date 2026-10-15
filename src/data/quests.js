// 의뢰. goals 종류:
//  { type: "extract", map: "farm" | "any" }   해당 맵에서 탈출
//  { type: "kill", enemy: "scav" | "raider" | "goose" | "any", map?: id }
//  { type: "handover", item: id }            창고에서 아이템 제출
//  { type: "search", count }                 컨테이너 수색
// 선행 의뢰(req)가 모두 끝나면 자동으로 활성화됩니다.

export const QUESTS = [
  {
    id: "q_first",
    name: "첫 출격",
    giver: "마담 꽥",
    desc: "은신처 밖은 위험하지만, 살아 돌아오는 법부터 배워야 한다. 아무 지역에서나 탈출에 성공하라.",
    goals: [{ type: "extract", map: "any", count: 1, label: "탈출 성공" }],
    reward: { money: 12000, xp: 500, items: [["bandage", 2], ["9mm", 60]] },
    req: [],
  },
  {
    id: "q_search",
    name: "뒤져보는 습관",
    giver: "마담 꽥",
    desc: "좋은 오리는 모든 서랍을 열어본다. 컨테이너를 12개 수색하라.",
    goals: [{ type: "search", count: 12, label: "컨테이너 수색" }],
    reward: { money: 15000, xp: 600, items: [["bag_scav", 1]] },
    req: ["q_first"],
  },
  {
    id: "q_scav",
    name: "꽥꽥 소탕 작전",
    giver: "마담 꽥",
    desc: "농장의 떠돌이 오리들이 우리 보급로를 털고 있다. 떠돌이 오리 6마리를 처치하라.",
    goals: [{ type: "kill", enemy: "scav", count: 6, label: "떠돌이 오리 처치" }],
    reward: { money: 22000, xp: 900, items: [["mp5", 1], ["9mm", 60]] },
    req: ["q_first"],
  },
  {
    id: "q_ducks",
    name: "고무 오리 수집가",
    giver: "삑삑 박사",
    desc: "삑삑 소리가 나는 그것… 나는 그것이 필요하다. 고무 오리 3개를 가져와라.",
    goals: [{ type: "handover", item: "rubber_duck", count: 3, label: "고무 오리 제출" }],
    reward: { money: 30000, xp: 800, items: [["bag_tactical", 1]] },
    req: ["q_first"],
  },
  {
    id: "q_meds",
    name: "의약품 보급",
    giver: "삑삑 박사",
    desc: "부상당한 오리들이 늘고 있다. 의약품 상자 2개와 붕대 3개를 제출하라.",
    goals: [
      { type: "handover", item: "meds_box", count: 2, label: "의약품 상자 제출" },
      { type: "handover", item: "bandage", count: 3, label: "붕대 제출" },
    ],
    reward: { money: 26000, xp: 900, items: [["ifak", 2]] },
    req: ["q_search"],
  },
  {
    id: "q_night",
    name: "올빼미 오리",
    giver: "마담 꽥",
    desc: "어둠 속에서 살아남는 법을 익혀라. 야간 농장에서 탈출하라.",
    goals: [{ type: "extract", map: "farm_night", count: 1, label: "야간 농장 탈출" }],
    reward: { money: 30000, xp: 1200, items: [["helmet_6b", 1], ["frag", 2]] },
    req: ["q_scav"],
  },
  {
    id: "q_factory",
    name: "공장 정찰",
    giver: "마담 꽥",
    desc: "폐공장 지대의 상황을 알아야 한다. 공장 지대에 진입해 살아서 탈출하라.",
    goals: [{ type: "extract", map: "factory", count: 1, label: "폐공장 지대 탈출" }],
    reward: { money: 45000, xp: 1500, items: [["vest_plate", 1], ["762", 60]] },
    req: ["q_scav"],
  },
  {
    id: "q_raider",
    name: "용병 사냥",
    giver: "마담 꽥",
    desc: "거위에게 고용된 용병 오리들이 골칫거리다. 용병 오리 4마리를 처치하라.",
    goals: [{ type: "kill", enemy: "raider", count: 4, label: "용병 오리 처치" }],
    reward: { money: 70000, xp: 2200, items: [["ar15", 1], ["556", 90]] },
    req: ["q_factory"],
  },
  {
    id: "q_intel",
    name: "기밀 문서",
    giver: "삑삑 박사",
    desc: "공장 사무실 어딘가에 거위의 계획이 담긴 서류가 있다. 기밀 문서 1개를 제출하라.",
    goals: [{ type: "handover", item: "intel", count: 1, label: "기밀 문서 제출" }],
    reward: { money: 90000, xp: 2000, items: [["bigkit", 1], ["556_ap", 60]] },
    req: ["q_factory"],
  },
  {
    id: "q_goose",
    name: "거위 왕 처치",
    giver: "마담 꽥",
    desc: "모든 문제의 원흉, 폐공장의 대왕 거위를 쓰러뜨려라.",
    goals: [{ type: "kill", enemy: "goose", count: 1, label: "대왕 거위 처치" }],
    reward: { money: 200000, xp: 5000, items: [["vest_tactical", 1], ["helmet_ballistic", 1]] },
    req: ["q_raider"],
  },
  {
    id: "q_egg",
    name: "황금알을 낳는 거위",
    giver: "삑삑 박사",
    desc: "거위가 품고 있던 황금알… 연구해보고 싶다. 황금 거위알을 제출하라.",
    goals: [{ type: "handover", item: "golden_egg", count: 1, label: "황금 거위알 제출" }],
    reward: { money: 480000, xp: 6000, items: [["bag_raid", 1]] },
    req: ["q_goose"],
  },
];

export const QUEST_MAP = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
