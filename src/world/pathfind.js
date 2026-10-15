// A* 경로 탐색 (8방향, 모서리 끼기 금지)

import { TS } from "./map.js";

class MinHeap {
  constructor() {
    this.nodes = [];
    this.prio = [];
  }

  get size() {
    return this.nodes.length;
  }

  push(node, p) {
    const nodes = this.nodes;
    const prio = this.prio;
    let i = nodes.length;
    nodes.push(node);
    prio.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= p) break;
      nodes[i] = nodes[parent];
      prio[i] = prio[parent];
      i = parent;
    }
    nodes[i] = node;
    prio[i] = p;
  }

  pop() {
    const nodes = this.nodes;
    const prio = this.prio;
    const top = nodes[0];
    const lastNode = nodes.pop();
    const lastPrio = prio.pop();
    if (nodes.length > 0) {
      let i = 0;
      const n = nodes.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let mp = lastPrio;
        if (l < n && prio[l] < mp) {
          m = l;
          mp = prio[l];
        }
        if (r < n && prio[r] < mp) {
          m = r;
          mp = prio[r];
        }
        if (m === i) break;
        nodes[i] = nodes[m];
        prio[i] = prio[m];
        i = m;
      }
      nodes[i] = lastNode;
      prio[i] = lastPrio;
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
  }

  /** 월드 좌표 → 월드 좌표 경로 (타일 중심점 배열). 실패 시 가장 가까이 간 지점까지 */
  find(sx, sy, ex, ey, maxNodes = 3500) {
    const m = this.map;
    const w = m.w;
    let stx = Math.floor(sx / TS);
    let sty = Math.floor(sy / TS);
    let etx = Math.floor(ex / TS);
    let ety = Math.floor(ey / TS);
    if (!m.isWalkableForAI(etx, ety)) {
      const near = m.nearestOpen(ex, ey, 4);
      if (!near) return null;
      etx = Math.floor(near.x / TS);
      ety = Math.floor(near.y / TS);
    }
    if (!m.inBounds(stx, sty)) return null;
    this.gen += 1;
    const gen = this.gen;
    const start = sty * w + stx;
    const goal = ety * w + etx;
    const heap = new MinHeap();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    heap.push(start, 0);
    let best = start;
    let bestH = Infinity;
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) {
        best = cur;
        break;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const hcur = Math.hypot(etx - cx, ety - cy);
      if (hcur < bestH) {
        bestH = hcur;
        best = cur;
      }
      if (++expanded > maxNodes) break;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!m.isWalkableForAI(nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          if (!m.isWalkableForAI(cx + dx, cy) || !m.isWalkableForAI(cx, cy + dy)) continue;
          // 문은 대각선으로 통과하지 않는다
          if (m.isDoor(nx, ny) || m.isDoor(cx, cy)) continue;
        }
        const ni = ny * w + nx;
        if (this.closed[ni] === gen) continue;
        const ng = this.g[cur] + cost;
        if (this.stamp[ni] === gen && ng >= this.g[ni]) continue;
        this.stamp[ni] = gen;
        this.g[ni] = ng;
        this.parent[ni] = cur;
        const h = Math.hypot(etx - nx, ety - ny);
        heap.push(ni, ng + h * 1.05);
      }
    }
    const path = [];
    let node = best;
    while (node !== -1 && node !== start) {
      const x = node % w;
      const y = (node - x) / w;
      path.push({ x: x * TS + TS / 2, y: y * TS + TS / 2, tx: x, ty: y });
      node = this.parent[node];
    }
    path.reverse();
    return path;
  }
}
