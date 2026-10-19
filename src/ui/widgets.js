// 여러 화면에서 쓰는 작은 UI 조각

import { h } from "../core/dom.js";

/**
 * 되돌릴 수 없는 동작용 버튼: 첫 클릭은 경고만, 3초 안에 다시 누르면 실행.
 * (브라우저 confirm 창은 임베드 환경에서 막힐 수 있어 페이지 안에서 확인한다)
 */
export function twoStepButton(cls, label, armedLabel, action) {
  let timer = null;
  const btn = h("button", { class: cls, text: label });
  btn.addEventListener("click", () => {
    if (btn.classList.contains("armed")) {
      clearTimeout(timer);
      action();
      return;
    }
    btn.classList.add("armed");
    btn.textContent = typeof armedLabel === "function" ? armedLabel() : armedLabel;
    timer = setTimeout(() => {
      btn.classList.remove("armed");
      btn.textContent = label;
    }, 3000);
  });
  return btn;
}

/** 화면 너비에 맞는 인벤토리 칸 크기 (창고 10칸이 화면에 들어가게) */
export function responsiveCell(base = 44) {
  const w = globalThis.innerWidth || 1280;
  return Math.max(28, Math.min(base, Math.floor((w - 72) / 10)));
}

/** 터치로 조작 중인가 (body.touch는 main.js가 마지막 입력 장치에 맞춰 켜고 끈다) */
export function touchMode() {
  return globalThis.document?.body?.classList.contains("touch") ?? false;
}
