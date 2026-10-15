// 공통 유틸리티 (순수 함수)

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** -PI..PI 범위의 각도 차이 */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** 현재 각도를 목표 각도로 최대 maxStep만큼 회전 */
export function turnToward(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

let uidCounter = 0;
const uidPrefix = Math.floor(Math.random() * 46656).toString(36);
export function uid() {
  uidCounter += 1;
  return `${uidPrefix}${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function formatMoney(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function formatWeight(kg) {
  return `${kg.toFixed(1)}kg`;
}
