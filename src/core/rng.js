// 시드 기반 난수 (mulberry32). 맵 생성은 고정 시드, 루팅/적은 매 레이드 랜덤.

export class Rng {
  constructor(seed = Date.now()) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  /** [[value, weight], ...] 에서 가중치 추첨 */
  weighted(entries) {
    let total = 0;
    for (const [, w] of entries) total += w;
    let roll = this.next() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** 대략적인 정규분포 (-1..1 근처, 중앙 집중) */
  gauss() {
    return (this.next() + this.next() + this.next() - 1.5) / 1.5;
  }

  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}
