// 작업대 제작: 창고의 재료를 소모해 새 아이템을 만든다

import { ITEMS } from "../data/items.js";
import { RECIPES, RECIPE_MAP } from "../data/recipes.js";
import { forEachItemDeep, removeItem, makeStacks, addItem, cloneGrid } from "./inventory.js";
import { benchLevel } from "./profile.js";

/** 재료로 쓸 수 있는 아이템인가 (내용물이 든 가방, 탄이 든 총은 제외) */
function usable(item) {
  const def = ITEMS[item.id];
  if (def.type === "backpack" && item.data?.grid?.items.length) return false;
  if (def.type === "weapon" && item.data?.mag > 0) return false;
  return true;
}

export function countUsable(grid, id) {
  let n = 0;
  forEachItemDeep(grid, (item) => {
    if (item.id === id && usable(item)) n += item.count;
  });
  return n;
}

function takeUsable(grid, id, n) {
  let need = n;
  forEachItemDeep(grid, (item, owner) => {
    if (need <= 0 || item.id !== id || !usable(item)) return;
    const take = Math.min(item.count, need);
    item.count -= take;
    need -= take;
    if (item.count <= 0) removeItem(owner, item);
  });
  return n - need;
}

export function recipeStatus(profile, recipe) {
  const bench = benchLevel(profile);
  const inputs = recipe.input.map(([id, n]) => ({ id, n, have: countUsable(profile.stash, id) }));
  const tools = (recipe.tools ?? []).map((id) => ({ id, have: countUsable(profile.stash, id) > 0 }));
  const locked = bench < recipe.bench;
  const enough = inputs.every((i) => i.have >= i.n) && tools.every((t) => t.have);
  const afford = profile.money >= (recipe.cost ?? 0);
  return { locked, inputs, tools, enough, afford, ok: !locked && enough && afford };
}

export function craft(profile, recipeId) {
  const recipe = RECIPE_MAP[recipeId];
  if (!recipe) return { ok: false, msg: "알 수 없는 제작법입니다" };
  const st = recipeStatus(profile, recipe);
  if (st.locked) return { ok: false, msg: `작업대 Lv.${recipe.bench}이 필요합니다` };
  if (!st.enough) return { ok: false, msg: "재료가 부족합니다" };
  if (!st.afford) return { ok: false, msg: "돈이 부족합니다" };

  // 재료를 뺀 뒤 결과물이 들어갈 자리가 있는지 복사본으로 먼저 확인
  const trial = cloneGrid(profile.stash);
  for (const [id, n] of recipe.input) takeUsable(trial, id, n);
  const [outId, outN] = recipe.out;
  for (const piece of makeStacks(outId, outN)) {
    if (!addItem(trial, piece)) return { ok: false, msg: "창고 공간이 부족합니다" };
  }

  for (const [id, n] of recipe.input) takeUsable(profile.stash, id, n);
  for (const piece of makeStacks(outId, outN)) addItem(profile.stash, piece);
  profile.money -= recipe.cost ?? 0;
  profile.stats.crafted = (profile.stats.crafted ?? 0) + 1;
  return { ok: true, name: ITEMS[outId].name, count: outN };
}

export { RECIPES };
