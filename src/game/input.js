// 키보드/마우스 입력 상태

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false, leftPressed: false, wheel: 0 };
    this.enabled = false; // 레이드 중에만 Tab 등 기본 동작을 막는다
    this.target = target;

    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this.enabled && ["Tab", "Space", "KeyG", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouse.left = false;
      this.mouse.right = false;
    });
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    target.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.mouse.left = true;
        this.mouse.leftPressed = true;
      }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    target.addEventListener(
      "wheel",
      (e) => {
        this.mouse.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  /** 프레임 끝에 호출 */
  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.wheel = 0;
  }
}

function isTyping(e) {
  const el = e.target;
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
