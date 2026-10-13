// 레이드 렌더러 (Canvas 2D). 정적 지형은 청크 캐시, 동적 요소는 매 프레임.

import { ITEMS } from "../data/items.js";
import { T, F, TS } from "../world/map.js";
import { DEG, clamp, angleDiff, smoothstep } from "../core/util.js";
import { drawDuck, drawCorpse, roundRect, shade, playerDuckOpts } from "./draw.js";

const CHUNK_TILES = 8;
const CHUNK = CHUNK_TILES * TS;
const MAX_CHUNKS = 40;
const VIEW_W = 1220;
const VIEW_H = 720;

const FLOOR_COLORS = {
  [F.GRASS]: "#6f9a4b",
  [F.DIRT]: "#9b7b53",
  [F.ROAD]: "#55585c",
  [F.CONCRETE]: "#8f918b",
  [F.WOOD]: "#a8794c",
  [F.TILE]: "#c4c9cb",
  [F.GRAVEL]: "#8a877d",
  [F.ASPHALT]: "#46494e",
};

const floorPalette = {};
for (const [k, base] of Object.entries(FLOOR_COLORS)) {
  floorPalette[k] = [];
  for (let i = 0; i < 8; i++) floorPalette[k].push(shade(base, (i - 3.5) * 0.022));
}

function wallColor(floor) {
  switch (floor) {
    case F.WOOD:
      return ["#6b5240", "#83664f"];
    case F.TILE:
      return ["#7e8388", "#9aa0a5"];
    case F.CONCRETE:
      return ["#5d6369", "#737a81"];
    case F.DIRT:
      return ["#7c3428", "#96443a"];
    default:
      return ["#5f625d", "#777a74"];
  }
}

function hash(tx, ty) {
  let h = (tx * 374761393 + ty * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.fog = document.createElement("canvas");
    this.fctx = this.fog.getContext("2d");
    this.cam = { x: 0, y: 0, scale: 1 };
    this.chunks = new Map();
    this.chunkScale = 1;
    this.map = null;
    this.mapImage = null;
    this.dpr = 1;
    this.cssW = 1;
    this.cssH = 1;
    this.mouse = { x: 0, y: 0 };
    this.time = 0;
    this.visPoly = [];
    this.resize();
  }

  resize() {
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.cssW = this.canvas.clientWidth || globalThis.innerWidth;
    this.cssH = this.canvas.clientHeight || globalThis.innerHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    // 안개는 절반 해상도로 그려 확대한다 (가장자리가 부드러워지고 비용도 1/4)
    this.fogScale = 0.5;
    this.fog.width = Math.max(1, Math.round(this.canvas.width * this.fogScale));
    this.fog.height = Math.max(1, Math.round(this.canvas.height * this.fogScale));
    this.cam.scale = Math.min(this.cssW / VIEW_W, this.cssH / VIEW_H) * 1.0;
    this.cam.scale = clamp(this.cam.scale, 0.55, 2.2);
    const cs = clamp(Math.ceil(this.cam.scale * this.dpr * 4) / 4, 1, 2);
    if (cs !== this.chunkScale) {
      this.chunkScale = cs;
      this.chunks.clear();
    }
  }

  attach(raid) {
    if (raid.map !== this.map) {
      this.map = raid.map;
      this.chunks.clear();
      this.mapImage = null;
      this.cam.x = raid.player.x;
      this.cam.y = raid.player.y;
    }
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.cssW / 2) / this.cam.scale + this.cam.x, y: (sy - this.cssH / 2) / this.cam.scale + this.cam.y };
  }

  updateCamera(raid, dt, aim) {
    const p = raid.player;
    const k = p.ads ? 0.42 : 0.2;
    let ox = (aim.x - p.x) * k;
    let oy = (aim.y - p.y) * k;
    const ol = Math.hypot(ox, oy);
    const maxOff = p.ads ? 420 : 220;
    if (ol > maxOff) {
      ox *= maxOff / ol;
      oy *= maxOff / ol;
    }
    const tx = p.x + ox;
    const ty = p.y + oy;
    const a = 1 - Math.exp(-dt * 9);
    this.cam.x += (tx - this.cam.x) * a;
    this.cam.y += (ty - this.cam.y) * a;
  }

  // ── 메인 렌더 ───────────────────────────────────────

  render(raid, dt, opts = {}) {
    this.time += dt;
    this.attach(raid);
    const ctx = this.ctx;
    const { dpr, cssW, cssH, cam } = this;
    const shakeX = raid.shake > 0 ? (Math.random() - 0.5) * raid.shake : 0;
    const shakeY = raid.shake > 0 ? (Math.random() - 0.5) * raid.shake : 0;
    const s = cam.scale;
    const ox = cssW / 2 - cam.x * s + shakeX;
    const oy = cssH / 2 - cam.y * s + shakeY;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = raid.def.theme === "farm" ? "#2f4a24" : "#3a3c3f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

    const view = {
      x0: cam.x - cssW / 2 / s - 60,
      y0: cam.y - cssH / 2 / s - 60,
      x1: cam.x + cssW / 2 / s + 60,
      y1: cam.y + cssH / 2 / s + 60,
    };
    this.view = view;

    this.drawChunks(ctx, view);
    this.drawDecals(ctx, raid);
    this.drawExtracts(ctx, raid);
    this.drawDoors(ctx, raid, view);
    this.drawContainers(ctx, raid, view);
    this.drawGrenades(ctx, raid);
    this.drawActors(ctx, raid);
    this.drawBullets(ctx, raid);
    this.drawParticles(ctx, raid);

    // 시야 (안개)
    this.drawFog(raid, ox, oy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.fog, 0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

    this.drawOverlayTexts(ctx, raid);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScreenEffects(ctx, raid);
    if (!opts.hideCursor) this.drawCrosshair(ctx, raid);
    if (opts.showMap) this.drawMapOverlay(ctx, raid);
  }

  // ── 정적 지형 (청크) ────────────────────────────────

  drawChunks(ctx, view) {
    const cx0 = Math.floor(view.x0 / CHUNK);
    const cy0 = Math.floor(view.y0 / CHUNK);
    const cx1 = Math.floor(view.x1 / CHUNK);
    const cy1 = Math.floor(view.y1 / CHUNK);
    const m = this.map;
    const maxCx = Math.ceil((m.w * TS) / CHUNK);
    const maxCy = Math.ceil((m.h * TS) / CHUNK);
    // 한 프레임에 새로 그리는 청크 수를 제한해 끊김을 줄인다
    let budget = this.chunks.size === 0 ? 99 : 2;
    for (let cy = Math.max(0, cy0); cy <= Math.min(maxCy - 1, cy1); cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(maxCx - 1, cx1); cx++) {
        let chunk = this.getChunk(cx, cy, false);
        if (!chunk && budget > 0) {
          budget -= 1;
          chunk = this.getChunk(cx, cy, true);
        }
        if (chunk) {
          ctx.drawImage(chunk, cx * CHUNK, cy * CHUNK, CHUNK + 0.75, CHUNK + 0.75);
        } else {
          ctx.fillStyle = FLOOR_COLORS[m.theme === "farm" ? F.GRASS : F.GRAVEL];
          ctx.fillRect(cx * CHUNK, cy * CHUNK, CHUNK + 0.75, CHUNK + 0.75);
        }
      }
    }
    // 여유가 있으면 화면 바로 바깥 청크를 미리 그려 둔다
    if (budget > 0) {
      for (let cy = Math.max(0, cy0 - 1); cy <= Math.min(maxCy - 1, cy1 + 1) && budget > 0; cy++) {
        for (let cx = Math.max(0, cx0 - 1); cx <= Math.min(maxCx - 1, cx1 + 1) && budget > 0; cx++) {
          if (!this.chunks.has(cy * 1000 + cx) && this.chunks.size < MAX_CHUNKS - 4) {
            this.getChunk(cx, cy, true);
            budget = 0;
          }
        }
      }
    }
  }

  getChunk(cx, cy, create = true) {
    const key = cy * 1000 + cx;
    let chunk = this.chunks.get(key);
    if (chunk) {
      this.chunks.delete(key);
      this.chunks.set(key, chunk);
      return chunk;
    }
    if (!create) return null;
    chunk = document.createElement("canvas");
    const cs = this.chunkScale;
    chunk.width = Math.ceil(CHUNK * cs);
    chunk.height = Math.ceil(CHUNK * cs);
    const c = chunk.getContext("2d");
    c.scale(cs, cs);
    c.translate(-cx * CHUNK, -cy * CHUNK);
    drawStatic(c, this.map, cx * CHUNK_TILES - 2, cy * CHUNK_TILES - 2, (cx + 1) * CHUNK_TILES + 2, (cy + 1) * CHUNK_TILES + 2);
    this.chunks.set(key, chunk);
    if (this.chunks.size > MAX_CHUNKS) {
      const oldest = this.chunks.keys().next().value;
      this.chunks.delete(oldest);
    }
    return chunk;
  }

  // ── 동적 요소 ──────────────────────────────────────

  drawDecals(ctx, raid) {
    for (const d of raid.decals) {
      if (!this.inView(d.x, d.y, 60)) continue;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      if (d.type === "blood") {
        ctx.fillStyle = "rgba(120,20,18,0.55)";
        const n = 3 + (d.seed % 4);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.28 + d.seed;
          const r = (6 + ((d.seed * (i + 3)) % 9)) * d.scale;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, r * 0.6, 0, 6.28);
          ctx.fill();
        }
      } else if (d.type === "scorch") {
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 55 * d.scale);
        g.addColorStop(0, "rgba(20,18,16,0.7)");
        g.addColorStop(1, "rgba(20,18,16,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 55 * d.scale, 0, 6.28);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawExtracts(ctx, raid) {
    const t = this.time;
    for (const x of raid.extracts) {
      if (!this.inView(x.x, x.y, x.r + 80)) continue;
      const active = raid.extractZone === x;
      ctx.save();
      ctx.fillStyle = active ? "rgba(90,230,120,0.22)" : "rgba(90,230,120,0.1)";
      ctx.beginPath();
      ctx.arc(x.x, x.y, x.r, 0, 6.28);
      ctx.fill();
      ctx.setLineDash([12, 10]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeStyle = "rgba(120,255,150,0.85)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
      // 연막 신호탄
      const pulse = (Math.sin(t * 3) + 1) / 2;
      ctx.fillStyle = `rgba(120,255,150,${0.35 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(x.x, x.y, 6 + pulse * 3, 0, 6.28);
      ctx.fill();
      ctx.restore();
    }
  }

  drawDoors(ctx, raid, view) {
    const m = raid.map;
    const tx0 = Math.max(0, Math.floor(view.x0 / TS));
    const ty0 = Math.max(0, Math.floor(view.y0 / TS));
    const tx1 = Math.min(m.w - 1, Math.floor(view.x1 / TS));
    const ty1 = Math.min(m.h - 1, Math.floor(view.y1 / TS));
    const highlight = raid.interaction?.type === "door" ? raid.interaction : null;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (m.tiles[ty * m.w + tx] !== T.DOOR) continue;
        const open = m.doorOpen[ty * m.w + tx] === 1;
        const horiz = isWallLike(m.tile(tx - 1, ty)) || isWallLike(m.tile(tx + 1, ty));
        const x = tx * TS;
        const y = ty * TS;
        ctx.save();
        const hl = highlight && highlight.tx === tx && highlight.ty === ty;
        ctx.fillStyle = "#7a5230";
        ctx.strokeStyle = hl ? "#ffe27a" : "#3d2814";
        ctx.lineWidth = hl ? 3 : 1.5;
        if (!open) {
          if (horiz) {
            ctx.fillRect(x, y + TS / 2 - 5, TS, 10);
            ctx.strokeRect(x, y + TS / 2 - 5, TS, 10);
          } else {
            ctx.fillRect(x + TS / 2 - 5, y, 10, TS);
            ctx.strokeRect(x + TS / 2 - 5, y, 10, TS);
          }
          ctx.fillStyle = "#d9b25a";
          if (horiz) ctx.fillRect(x + TS - 9, y + TS / 2 - 2, 4, 4);
          else ctx.fillRect(x + TS / 2 - 2, y + TS - 9, 4, 4);
        } else {
          // 열린 문: 경첩 쪽으로 접힌 판
          if (horiz) {
            ctx.fillRect(x, y + TS / 2 - 3, 6, TS * 0.95);
            ctx.strokeRect(x, y + TS / 2 - 3, 6, TS * 0.95);
          } else {
            ctx.fillRect(x + TS / 2 - 3, y, TS * 0.95, 6);
            ctx.strokeRect(x + TS / 2 - 3, y, TS * 0.95, 6);
          }
        }
        ctx.restore();
      }
    }
  }

  drawContainers(ctx, raid, view) {
    const target = raid.interaction?.type === "container" ? raid.interaction.target : null;
    for (const c of raid.containers) {
      if (!this.inView(c.x, c.y, 50)) continue;
      const empty = c.opened && c.grid.items.length === 0;
      const done = c.opened && !raid.nextHidden(c);
      ctx.save();
      if (empty) ctx.globalAlpha = 0.55;
      if (c.kind === "corpse") {
        drawCorpse(ctx, c.x, c.y, c.corpse.angle, { r: c.corpse.r, ...c.corpse.colors, armor: c.corpse.armor, boss: c.corpse.boss });
      } else {
        drawContainerArt(ctx, c);
      }
      ctx.globalAlpha = 1;
      // 미확인 표시
      if (!c.opened && c.kind !== "ground") {
        const pulse = (Math.sin(this.time * 4 + c.x) + 1) / 2;
        ctx.fillStyle = `rgba(255,226,122,${0.25 + pulse * 0.35})`;
        ctx.beginPath();
        ctx.arc(c.x + 12, c.y - 12, 3, 0, 6.28);
        ctx.fill();
      } else if (c.opened && !done) {
        ctx.fillStyle = "rgba(160,200,255,0.8)";
        ctx.font = "bold 12px system-ui";
        ctx.fillText("…", c.x + 8, c.y - 8);
      }
      if (c === target) {
        ctx.strokeStyle = "#ffe27a";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -this.time * 16;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.kind === "corpse" ? 26 : 24, 0, 6.28);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  drawGrenades(ctx, raid) {
    for (const g of raid.grenades) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(g.x + 2, g.y + 3, 6, 4, 0, 0, 6.28);
      ctx.fill();
      ctx.save();
      ctx.translate(g.x, g.y - g.z);
      ctx.rotate(g.rot);
      ctx.fillStyle = "#4a5a34";
      ctx.strokeStyle = "#1d2414";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 5, 0, 0, 6.28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#999";
      ctx.fillRect(-2, -8, 4, 4);
      ctx.restore();
      // 깜빡이는 경고
      if (g.fuse - g.t < 1 && Math.floor(g.t * 10) % 2 === 0) {
        ctx.strokeStyle = "rgba(255,80,60,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 14, 0, 6.28);
        ctx.stroke();
      }
    }
  }

  drawActors(ctx, raid) {
    const p = raid.player;
    for (const e of raid.enemies) {
      if (!e.alive || (e.seenAlpha ?? 0) <= 0.01) continue;
      if (!this.inView(e.x, e.y, 60)) continue;
      drawDuck(ctx, e.x, e.y, e.angle, {
        r: e.r,
        ...e.def.colors,
        walk: e.walkPhase,
        moving: e.moving,
        armor: e.equip.armor?.id,
        helmet: e.equip.helmet?.id,
        weapon: e.equip.primary?.id,
        hurt: e.hurtT > 0,
        neck: e.type === "goose",
        alpha: e.seenAlpha,
      });
    }
    if (p.alive) {
      drawDuck(ctx, p.x, p.y, p.angle, playerDuckOpts(p.equip, {
        weaponSlot: p.weaponSlot,
        walk: p.walkPhase,
        moving: Math.hypot(p.vx, p.vy) > 20,
        hurt: p.hurtT > 0,
        crouch: p.crouch,
        peck: p.pecking > 0,
      }));
      if (!p.equip[p.weaponSlot]) {
        // 무기가 없으면 아무것도 안 들고 있다
      }
    }
  }

  drawBullets(ctx, raid) {
    ctx.lineCap = "round";
    for (const b of raid.bullets) {
      const len = 26;
      const sp = Math.hypot(b.vx, b.vy);
      const tx = b.x - (b.vx / sp) * len;
      const ty = b.y - (b.vy / sp) * len;
      const g = ctx.createLinearGradient(tx, ty, b.x, b.y);
      g.addColorStop(0, "rgba(255,240,180,0)");
      g.addColorStop(1, b.color ?? "#ffe08a");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  drawParticles(ctx, raid) {
    for (const part of raid.particles) {
      const k = part.t / part.life;
      switch (part.type) {
        case "flash": {
          ctx.save();
          ctx.translate(part.x, part.y);
          ctx.rotate(part.angle);
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = "#fff4c2";
          ctx.beginPath();
          ctx.moveTo(0, -4 * part.size);
          ctx.lineTo(18 * part.size, 0);
          ctx.lineTo(0, 4 * part.size);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "rgba(255,190,80,0.8)";
          ctx.beginPath();
          ctx.arc(2, 0, 6 * part.size, 0, 6.28);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "spark":
          ctx.strokeStyle = `rgba(255,220,140,${1 - k})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(part.x, part.y);
          ctx.lineTo(part.x - part.vx * 0.025, part.y - part.vy * 0.025);
          ctx.stroke();
          break;
        case "feather":
          ctx.save();
          ctx.translate(part.x, part.y);
          ctx.rotate(part.rot);
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = part.color ?? "#fff";
          ctx.beginPath();
          ctx.ellipse(0, 0, 5, 2, 0, 0, 6.28);
          ctx.fill();
          ctx.restore();
          break;
        case "shell":
          ctx.save();
          ctx.translate(part.x, part.y);
          ctx.rotate(part.rot);
          ctx.fillStyle = "#d8a93e";
          ctx.fillRect(-2.5, -1, 5, 2);
          ctx.restore();
          break;
        case "smoke":
          ctx.fillStyle = `rgba(90,90,90,${0.35 * (1 - k)})`;
          ctx.beginPath();
          ctx.arc(part.x, part.y, part.size * (0.6 + k), 0, 6.28);
          ctx.fill();
          break;
        case "dust":
          ctx.fillStyle = `rgba(200,190,170,${0.4 * (1 - k)})`;
          ctx.beginPath();
          ctx.arc(part.x, part.y, part.size * (0.5 + k), 0, 6.28);
          ctx.fill();
          break;
        case "blast": {
          const r = part.size * (0.3 + k * 0.9);
          const g = ctx.createRadialGradient(part.x, part.y, 0, part.x, part.y, r);
          g.addColorStop(0, `rgba(255,250,210,${1 - k})`);
          g.addColorStop(0.4, `rgba(255,170,60,${0.9 * (1 - k)})`);
          g.addColorStop(1, "rgba(120,40,10,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(part.x, part.y, r, 0, 6.28);
          ctx.fill();
          break;
        }
        case "tracer":
          ctx.strokeStyle = part.color ?? "#ffe08a";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(part.x, part.y);
          ctx.lineTo(part.x2, part.y2);
          ctx.stroke();
          break;
        default:
          break;
      }
    }
  }

  // ── 시야 / 안개 ─────────────────────────────────────

  computeVisibility(raid) {
    const p = raid.player;
    const v = raid.playerVision();
    const m = raid.map;
    const rays = 540;
    const poly = this.visPoly;
    poly.length = 0;
    const half = v.fov / 2;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const d = Math.abs(angleDiff(p.angle, a));
      const t = smoothstep(half + 6 * DEG, half - 3 * DEG, d);
      const maxD = v.near + (v.viewDist - v.near) * t;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = m.raycast(p.x, p.y, dx, dy, maxD, "sight");
      // 벽 면이 살짝 보이도록 조금 더 연장
      const ext = hit < maxD ? Math.min(hit + 12, maxD) : hit;
      poly.push(p.x + dx * ext, p.y + dy * ext);
    }
    return v;
  }

  drawFog(raid, ox, oy) {
    const f = this.fctx;
    const { dpr } = this;
    const s = this.cam.scale;
    const night = raid.def.night;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0, 0, this.fog.width, this.fog.height);
    f.fillStyle = night ? "rgba(4,7,14,0.86)" : "rgba(10,14,20,0.6)";
    f.fillRect(0, 0, this.fog.width, this.fog.height);
    const p = raid.player;
    if (!p.alive) return;
    const v = this.computeVisibility(raid);
    const k = dpr * this.fogScale;
    f.setTransform(k * s, 0, 0, k * s, k * ox, k * oy);
    f.globalCompositeOperation = "destination-out";
    const g = f.createRadialGradient(p.x, p.y, Math.min(v.near, v.viewDist * 0.4), p.x, p.y, v.viewDist);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.7, "rgba(0,0,0,0.92)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = g;
    const poly = this.visPoly;
    f.beginPath();
    f.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) f.lineTo(poly[i], poly[i + 1]);
    f.closePath();
    f.fill();
    // 근거리는 항상 또렷하게
    const g2 = f.createRadialGradient(p.x, p.y, 0, p.x, p.y, 60);
    g2.addColorStop(0, "rgba(0,0,0,1)");
    g2.addColorStop(1, "rgba(0,0,0,0)");
    f.fillStyle = g2;
    f.beginPath();
    f.arc(p.x, p.y, 60, 0, 6.28);
    f.fill();
    f.globalCompositeOperation = "source-over";
  }

  // ── 텍스트 (안개 위) ────────────────────────────────

  drawOverlayTexts(ctx, raid) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 말풍선
    for (const e of raid.enemies) {
      if (!e.speech || e.speechT <= 0) continue;
      const visible = e.alive ? (e.seenAlpha ?? 0) > 0.3 : true;
      const p = raid.player;
      const near = Math.hypot(e.x - p.x, e.y - p.y) < 700;
      if (!visible && !near) continue;
      const alpha = Math.min(1, e.speechT * 2) * (visible ? 1 : 0.55);
      ctx.font = "bold 15px system-ui, sans-serif";
      const w = ctx.measureText(e.speech).width + 14;
      const x = e.x;
      const y = e.y - e.r - 26;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = visible ? "rgba(255,255,255,0.92)" : "rgba(200,210,230,0.6)";
      roundRect(ctx, x - w / 2, y - 12, w, 24, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 11);
      ctx.lineTo(x, y + 18);
      ctx.lineTo(x + 5, y + 11);
      ctx.fill();
      ctx.fillStyle = e.boss ? "#b3261e" : "#1b1f24";
      ctx.fillText(visible ? e.speech : "?!", x, y + 1);
      ctx.globalAlpha = 1;
    }
    // 피해 숫자
    for (const f of raid.floaters) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = "800 16px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    // 보이는 적의 체력바 (보스만)
    for (const e of raid.enemies) {
      if (!e.alive || !e.boss || (e.seenAlpha ?? 0) < 0.3) continue;
      const w = 60;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(e.x - w / 2, e.y + e.r + 10, w, 6);
      ctx.fillStyle = "#e5483b";
      ctx.fillRect(e.x - w / 2 + 1, e.y + e.r + 11, (w - 2) * (e.hp / e.maxHp), 4);
    }
    // 탈출구 이름
    for (const x of raid.extracts) {
      if (!this.inView(x.x, x.y, 200)) continue;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(`탈출: ${x.name}`, x.x, x.y - x.r - 12);
      ctx.fillStyle = "#9dffb4";
      ctx.fillText(`탈출: ${x.name}`, x.x, x.y - x.r - 12);
    }
    // 장전/사용 진행바 (플레이어 머리 위)
    const p = raid.player;
    const prog = p.reload ? p.reload.t / p.reload.dur : p.using ? p.using.t / p.using.dur : null;
    if (p.alive && prog !== null) {
      const w = 44;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(p.x - w / 2, p.y + 24, w, 6);
      ctx.fillStyle = p.reload ? "#ffd84a" : "#7fe08f";
      ctx.fillRect(p.x - w / 2 + 1, p.y + 25, (w - 2) * clamp(prog, 0, 1), 4);
    }
  }

  drawScreenEffects(ctx, raid) {
    const W = this.cssW;
    const H = this.cssH;
    const p = raid.player;
    // 피격 비네트
    const hurt = Math.max(raid.hurtFlash, p.alive && p.hp < p.maxHp * 0.3 ? 0.35 + Math.sin(this.time * 5) * 0.1 : 0);
    if (hurt > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(200,0,0,0)");
      g.addColorStop(1, `rgba(200,0,0,${Math.min(0.6, hurt * 0.6)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (!p.alive) {
      ctx.fillStyle = "rgba(60,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawCrosshair(ctx, raid) {
    const p = raid.player;
    if (!p.alive) return;
    const { x, y } = this.mouse;
    const w = raid.currentWeapon(p);
    let spreadDeg = 3;
    if (w) {
      const def = ITEMS[w.id];
      spreadDeg = def.spread * (Math.hypot(p.vx, p.vy) > 40 ? 1.5 : 1) * (p.ads ? 0.5 : 1) * (p.crouch ? 0.75 : 1) + p.bloom;
    }
    const d = (p.aimDist ?? 200) * this.cam.scale;
    const gap = clamp(Math.tan((spreadDeg * DEG) / 2) * d, 4, 80);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 4;
    const drawTicks = () => {
      ctx.beginPath();
      ctx.moveTo(gap, 0);
      ctx.lineTo(gap + 8, 0);
      ctx.moveTo(-gap, 0);
      ctx.lineTo(-gap - 8, 0);
      ctx.moveTo(0, gap);
      ctx.lineTo(0, gap + 8);
      ctx.moveTo(0, -gap);
      ctx.lineTo(0, -gap - 8);
      ctx.stroke();
    };
    drawTicks();
    ctx.strokeStyle = p.reload ? "#ffd84a" : "#ffffff";
    ctx.lineWidth = 2;
    drawTicks();
    ctx.fillStyle = "#fff";
    ctx.fillRect(-1, -1, 2, 2);
    if (raid.hitMarker) {
      const hm = raid.hitMarker;
      ctx.strokeStyle = hm.kill ? "#ff4b3e" : hm.armor ? "#9fc6ff" : hm.head ? "#ffd84a" : "#ffffff";
      ctx.lineWidth = hm.kill ? 3 : 2;
      const a = 7;
      const b = 14;
      ctx.beginPath();
      ctx.moveTo(-a, -a);
      ctx.lineTo(-b, -b);
      ctx.moveTo(a, -a);
      ctx.lineTo(b, -b);
      ctx.moveTo(-a, a);
      ctx.lineTo(-b, b);
      ctx.moveTo(a, a);
      ctx.lineTo(b, b);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── 지도 (M) ───────────────────────────────────────

  buildMapImage(m) {
    const px = 4;
    const c = document.createElement("canvas");
    c.width = m.w * px;
    c.height = m.h * px;
    const g = c.getContext("2d");
    for (let ty = 0; ty < m.h; ty++) {
      for (let tx = 0; tx < m.w; tx++) {
        const i = ty * m.w + tx;
        const t = m.tiles[i];
        let color = FLOOR_COLORS[m.floor[i]];
        if (t === T.WALL || t === T.CONTAINER) color = "#2a2c30";
        else if (t === T.TREE) color = "#2f5a2a";
        else if (t === T.ROCK) color = "#6a6a66";
        else if (t === T.WATER) color = "#3d7fa8";
        else if (t === T.WINDOW) color = "#7fb8d0";
        else if (t === T.DOOR) color = "#a0703c";
        else if (t !== T.NONE) color = "#6c5a44";
        g.fillStyle = color;
        g.fillRect(tx * px, ty * px, px, px);
      }
    }
    return { canvas: c, px };
  }

  drawMapOverlay(ctx, raid) {
    const m = raid.map;
    if (!this.mapImage) this.mapImage = this.buildMapImage(m);
    const { canvas, px } = this.mapImage;
    const W = this.cssW;
    const H = this.cssH;
    ctx.fillStyle = "rgba(6,10,14,0.82)";
    ctx.fillRect(0, 0, W, H);
    const scale = Math.min((W - 80) / canvas.width, (H - 120) / canvas.height);
    const mw = canvas.width * scale;
    const mh = canvas.height * scale;
    const mx = (W - mw) / 2;
    const my = (H - mh) / 2 + 20;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, mx, my, mw, mh);
    // 미탐색 지역 어둡게 (타일 해상도 마스크를 부드럽게 확대)
    const cell = px * scale;
    if (!this.fogMask || this.fogMask.width !== m.w) {
      this.fogMask = document.createElement("canvas");
      this.fogMask.width = m.w;
      this.fogMask.height = m.h;
    }
    const mctx = this.fogMask.getContext("2d");
    const img = mctx.createImageData(m.w, m.h);
    for (let i = 0; i < m.w * m.h; i++) {
      img.data[i * 4] = 6;
      img.data[i * 4 + 1] = 10;
      img.data[i * 4 + 2] = 14;
      img.data[i * 4 + 3] = m.explored[i] ? 0 : 190;
    }
    mctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogMask, mx, my, mw, mh);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.strokeRect(mx, my, mw, mh);
    const toMap = (x, y) => [mx + (x / TS) * cell, my + (y / TS) * cell];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const l of m.labels) {
      const [lx, ly] = toMap(l.x, l.y);
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(l.text, lx, ly);
    }
    for (const x of raid.extracts) {
      const [ex, ey] = toMap(x.x, x.y);
      ctx.fillStyle = "#58e07a";
      ctx.beginPath();
      ctx.arc(ex, ey, 7, 0, 6.28);
      ctx.fill();
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(x.name, ex, ey - 16);
      ctx.fillStyle = "#9dffb4";
      ctx.fillText(x.name, ex, ey - 16);
    }
    const p = raid.player;
    const [ppx, ppy] = toMap(p.x, p.y);
    ctx.save();
    ctx.translate(ppx, ppy);
    ctx.rotate(p.angle);
    ctx.fillStyle = "#ffd84a";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(`${raid.def.name} — 지도 (M 닫기)`, W / 2, my - 22);
    ctx.restore();
  }

  inView(x, y, pad = 0) {
    const v = this.view;
    return x > v.x0 - pad && x < v.x1 + pad && y > v.y0 - pad && y < v.y1 + pad;
  }
}

function isWallLike(t) {
  return t === T.WALL || t === T.WINDOW || t === T.DOOR;
}

// ── 정적 지형 그리기 ────────────────────────────────────

function drawStatic(ctx, m, tx0, ty0, tx1, ty1) {
  tx0 = Math.max(0, tx0);
  ty0 = Math.max(0, ty0);
  tx1 = Math.min(m.w - 1, tx1);
  ty1 = Math.min(m.h - 1, ty1);

  // 1. 바닥
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * m.w + tx;
      const f = m.floor[i];
      const sh = m.shade[i];
      ctx.fillStyle = floorPalette[f][sh & 7];
      ctx.fillRect(tx * TS, ty * TS, TS + 0.5, TS + 0.5);
      floorDetail(ctx, f, tx, ty, sh, m);
    }
  }

  // 2. 도로 표시
  for (const r of m.roads ?? []) {
    if (r.floor === F.DIRT) continue;
    ctx.strokeStyle = r.floor === F.ASPHALT ? "rgba(240,200,60,0.75)" : "rgba(240,240,230,0.6)";
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.beginPath();
    if (r.horizontal) {
      const y = (r.y + r.h / 2) * TS;
      ctx.moveTo(r.x * TS, y);
      ctx.lineTo((r.x + r.w) * TS, y);
    } else {
      const x = (r.x + r.w / 2) * TS;
      ctx.moveTo(x, r.y * TS);
      ctx.lineTo(x, (r.y + r.h) * TS);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(230,230,220,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (r.horizontal) {
      ctx.moveTo(r.x * TS, r.y * TS + 3);
      ctx.lineTo((r.x + r.w) * TS, r.y * TS + 3);
      ctx.moveTo(r.x * TS, (r.y + r.h) * TS - 3);
      ctx.lineTo((r.x + r.w) * TS, (r.y + r.h) * TS - 3);
    } else {
      ctx.moveTo(r.x * TS + 3, r.y * TS);
      ctx.lineTo(r.x * TS + 3, (r.y + r.h) * TS);
      ctx.moveTo((r.x + r.w) * TS - 3, r.y * TS);
      ctx.lineTo((r.x + r.w) * TS - 3, (r.y + r.h) * TS);
    }
    ctx.stroke();
  }

  // 3. 그림자
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = m.tiles[ty * m.w + tx];
      if (t === T.WALL || t === T.CONTAINER || t === T.CRATES || t === T.ROCK) {
        ctx.rect(tx * TS + 6, ty * TS + 8, TS, TS);
      } else if (t === T.TREE) {
        ctx.moveTo(tx * TS + TS / 2 + 8 + 22, ty * TS + TS / 2 + 10);
        ctx.ellipse(tx * TS + TS / 2 + 8, ty * TS + TS / 2 + 10, 22, 17, 0, 0, Math.PI * 2);
      }
    }
  }
  for (const s of m.shipping) ctx.rect(s.tx * TS + 8, s.ty * TS + 10, s.w * TS, s.h * TS);
  for (const v of m.vehicles) ctx.rect(v.tx * TS + 6, v.ty * TS + 8, v.w * TS, v.h * TS);
  ctx.fill();

  // 4. 물
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (m.tiles[ty * m.w + tx] !== T.WATER) continue;
      ctx.fillStyle = "#3a7aa3";
      ctx.fillRect(tx * TS, ty * TS, TS + 0.5, TS + 0.5);
      const h = hash(tx, ty);
      ctx.strokeStyle = "rgba(200,235,255,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx * TS + 6 + h * 10, ty * TS + 14 + h * 12);
      ctx.quadraticCurveTo(tx * TS + 16 + h * 10, ty * TS + 8 + h * 12, tx * TS + 26 + h * 8, ty * TS + 14 + h * 12);
      ctx.stroke();
      // 물가
      ctx.fillStyle = "rgba(230,240,220,0.18)";
      if (m.tile(tx, ty - 1) !== T.WATER) ctx.fillRect(tx * TS, ty * TS, TS, 4);
      if (m.tile(tx - 1, ty) !== T.WATER) ctx.fillRect(tx * TS, ty * TS, 4, TS);
    }
  }

  // 5. 가구 / 차량 / 컨테이너
  const inRange = (o) => o.tx + o.w >= tx0 && o.tx <= tx1 && o.ty + o.h >= ty0 && o.ty <= ty1;
  for (const f of m.furniture) if (inRange(f)) drawFurniture(ctx, f);
  for (const v of m.vehicles) if (inRange(v)) drawVehicle(ctx, v);
  for (const s of m.shipping) if (inRange(s)) drawShipping(ctx, s);

  // 6. 고체 타일
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * m.w + tx;
      const t = m.tiles[i];
      if (t === T.NONE || t === T.WATER || t === T.PROP || t === T.DOOR || t === T.CONTAINER || t === T.TREE) continue;
      const x = tx * TS;
      const y = ty * TS;
      const h = hash(tx, ty);
      switch (t) {
        case T.WALL:
        case T.WINDOW: {
          const [dark, light] = wallColor(m.floor[i]);
          ctx.fillStyle = dark;
          ctx.fillRect(x, y, TS + 0.5, TS + 0.5);
          const below = m.tile(tx, ty + 1);
          const front = below !== T.WALL && below !== T.WINDOW;
          ctx.fillStyle = light;
          ctx.fillRect(x, y, TS + 0.5, front ? TS - 8 : TS + 0.5);
          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 1;
          if (m.tile(tx, ty - 1) !== T.WALL && m.tile(tx, ty - 1) !== T.WINDOW) {
            ctx.beginPath();
            ctx.moveTo(x, y + 0.5);
            ctx.lineTo(x + TS, y + 0.5);
            ctx.stroke();
          }
          if (t === T.WINDOW) {
            const horiz = isWallLike(m.tile(tx - 1, ty)) || isWallLike(m.tile(tx + 1, ty));
            ctx.fillStyle = "rgba(170,225,245,0.85)";
            if (horiz) ctx.fillRect(x, y + TS / 2 - 5, TS + 0.5, 10);
            else ctx.fillRect(x + TS / 2 - 5, y, 10, TS + 0.5);
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            if (horiz) ctx.fillRect(x + 4, y + TS / 2 - 3, 8, 2);
            else ctx.fillRect(x + TS / 2 - 3, y + 4, 2, 8);
          }
          break;
        }
        case T.ROCK: {
          ctx.fillStyle = shade("#7d7d78", (h - 0.5) * 0.2);
          ctx.strokeStyle = "#4b4b47";
          ctx.lineWidth = 2;
          ctx.beginPath();
          const cx = x + TS / 2;
          const cy = y + TS / 2;
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * 6.28 + h;
            const rr = 15 + hash(tx + k, ty - k) * 7;
            if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
            else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.beginPath();
          ctx.arc(cx - 4, cy - 5, 6, 0, 6.28);
          ctx.fill();
          break;
        }
        case T.CRATES: {
          ctx.fillStyle = shade("#b0834a", (h - 0.5) * 0.15);
          ctx.strokeStyle = "#5c3f1e";
          ctx.lineWidth = 2;
          ctx.fillRect(x + 2, y + 2, TS - 4, TS - 4);
          ctx.strokeRect(x + 2, y + 2, TS - 4, TS - 4);
          ctx.beginPath();
          ctx.moveTo(x + 3, y + 3);
          ctx.lineTo(x + TS - 3, y + TS - 3);
          ctx.moveTo(x + TS - 3, y + 3);
          ctx.lineTo(x + 3, y + TS - 3);
          ctx.stroke();
          break;
        }
        case T.HAY: {
          ctx.fillStyle = "#d9b74f";
          ctx.strokeStyle = "#8a6d22";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x + TS / 2, y + TS / 2, TS / 2 - 2, 0, 6.28);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + TS / 2, y + TS / 2, TS / 4, 0, 5);
          ctx.stroke();
          break;
        }
        case T.COVER: {
          if (m.vehicles.some((v) => tx >= v.tx && tx < v.tx + v.w && ty >= v.ty && ty < v.ty + v.h)) break;
          if (m.theme === "farm") {
            ctx.fillStyle = "#b8a578";
            ctx.strokeStyle = "#6e6040";
            ctx.lineWidth = 1.5;
            for (let k = 0; k < 3; k++) {
              roundRect(ctx, x + 2, y + 2 + k * 12, TS - 4, 11, 4);
              ctx.fill();
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = "#a3a6a8";
            ctx.strokeStyle = "#5d6063";
            ctx.lineWidth = 2;
            ctx.fillRect(x + 4, y + 4, TS - 8, TS - 8);
            ctx.strokeRect(x + 4, y + 4, TS - 8, TS - 8);
            ctx.fillStyle = "rgba(240,190,40,0.7)";
            ctx.fillRect(x + 6, y + TS / 2 - 3, TS - 12, 6);
          }
          break;
        }
        case T.FENCE: {
          const horiz = m.tile(tx - 1, ty) === T.FENCE || m.tile(tx + 1, ty) === T.FENCE || m.tile(tx, ty - 1) !== T.FENCE;
          ctx.strokeStyle = "rgba(200,205,210,0.75)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (horiz) {
            ctx.moveTo(x, y + TS / 2);
            ctx.lineTo(x + TS, y + TS / 2);
          } else {
            ctx.moveTo(x + TS / 2, y);
            ctx.lineTo(x + TS / 2, y + TS);
          }
          ctx.stroke();
          ctx.strokeStyle = "rgba(200,205,210,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            if (horiz) {
              ctx.moveTo(x + k * 8, y + TS / 2 - 4);
              ctx.lineTo(x + k * 8 + 8, y + TS / 2 + 4);
            } else {
              ctx.moveTo(x + TS / 2 - 4, y + k * 8);
              ctx.lineTo(x + TS / 2 + 4, y + k * 8 + 8);
            }
          }
          ctx.stroke();
          ctx.fillStyle = "#5a5d60";
          if (horiz) ctx.fillRect(x - 2, y + TS / 2 - 4, 5, 8);
          else ctx.fillRect(x + TS / 2 - 4, y - 2, 8, 5);
          break;
        }
        default:
          break;
      }
    }
  }

  // 7. 나무 (캐노피가 겹쳐야 하므로 마지막)
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (m.tiles[ty * m.w + tx] !== T.TREE) continue;
      const h = hash(tx, ty);
      const x = tx * TS + TS / 2 + (h - 0.5) * 8;
      const y = ty * TS + TS / 2 + (hash(ty, tx) - 0.5) * 8;
      const r = 19 + h * 7;
      const base = m.theme === "farm" ? (h > 0.5 ? "#3f7134" : "#4b7e3a") : "#4d6b3c";
      ctx.fillStyle = shade(base, -0.25);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(x - 2, y - 2, r * 0.86, 0, 6.28);
      ctx.fill();
      ctx.fillStyle = shade(base, 0.15);
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, 6.28);
      ctx.fill();
    }
  }
}

function floorDetail(ctx, f, tx, ty, sh, m) {
  const x = tx * TS;
  const y = ty * TS;
  const h = hash(tx, ty);
  switch (f) {
    case F.GRASS:
      if (h < 0.35) {
        ctx.strokeStyle = "rgba(40,70,25,0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const gx = x + 8 + h * 60;
        const gy = y + 10 + (sh % 20);
        ctx.moveTo(gx, gy + 6);
        ctx.lineTo(gx - 3, gy);
        ctx.moveTo(gx + 3, gy + 6);
        ctx.lineTo(gx + 4, gy - 1);
        ctx.moveTo(gx + 6, gy + 6);
        ctx.lineTo(gx + 10, gy + 1);
        ctx.stroke();
      }
      if (h > 0.96) {
        ctx.fillStyle = sh % 2 ? "#f4e27a" : "#f2f2f2";
        ctx.beginPath();
        ctx.arc(x + 20, y + 18, 2.5, 0, 6.28);
        ctx.fill();
      }
      break;
    case F.DIRT:
    case F.GRAVEL:
      if (h < 0.6) {
        ctx.fillStyle = f === F.GRAVEL ? "rgba(255,255,255,0.12)" : "rgba(60,40,20,0.25)";
        for (let k = 0; k < 4; k++) {
          const px = x + hash(tx + k, ty) * TS;
          const py = y + hash(tx, ty + k) * TS;
          ctx.fillRect(px, py, 2.5, 2.5);
        }
      }
      break;
    case F.CONCRETE:
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      if (tx % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + TS);
        ctx.stroke();
      }
      if (ty % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(x, y + 0.5);
        ctx.lineTo(x + TS, y + 0.5);
        ctx.stroke();
      }
      if (h > 0.93) {
        ctx.fillStyle = "rgba(30,30,30,0.18)";
        ctx.beginPath();
        ctx.ellipse(x + 20, y + 20, 12, 8, h * 6, 0, 6.28);
        ctx.fill();
      }
      break;
    case F.WOOD:
      ctx.strokeStyle = "rgba(60,35,15,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        ctx.moveTo(x, y + k * 10);
        ctx.lineTo(x + TS, y + k * 10);
      }
      const seam = (tx * 13 + ty * 7) % 4;
      ctx.moveTo(x + seam * 10, y);
      ctx.lineTo(x + seam * 10, y + 10);
      ctx.moveTo(x + ((seam + 2) % 4) * 10, y + 20);
      ctx.lineTo(x + ((seam + 2) % 4) * 10, y + 30);
      ctx.stroke();
      break;
    case F.TILE:
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fillRect(x, y, TS, TS);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TS, TS);
      break;
    case F.ROAD:
    case F.ASPHALT:
      if (h > 0.9) {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 10);
        ctx.lineTo(x + 18, y + 16);
        ctx.lineTo(x + 24, y + 30);
        ctx.stroke();
      }
      break;
    default:
      break;
  }
  void m;
}

function drawFurniture(ctx, f) {
  const x = f.tx * TS;
  const y = f.ty * TS;
  const w = f.w * TS;
  const h = f.h * TS;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(x + 5, y + 6, w - 4, h - 4);
  switch (f.kind) {
    case "bed":
      ctx.fillStyle = "#6b4a32";
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = "#e9e4d8";
      ctx.fillRect(x + 6, y + 6, w - 12, h - 12);
      ctx.fillStyle = "#7da0c4";
      if (f.h >= f.w) ctx.fillRect(x + 6, y + h * 0.35, w - 12, h * 0.6 - 6);
      else ctx.fillRect(x + w * 0.35, y + 6, w * 0.6 - 6, h - 12);
      ctx.fillStyle = "#fff";
      if (f.h >= f.w) ctx.fillRect(x + 10, y + 9, w - 20, 12);
      else ctx.fillRect(x + 9, y + 10, 12, h - 20);
      break;
    case "table":
      ctx.fillStyle = "#8a5d34";
      ctx.strokeStyle = "#4b3018";
      ctx.lineWidth = 2;
      roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.1)";
      ctx.fillRect(x + 9, y + 9, w - 18, 4);
      break;
    case "couch":
      ctx.fillStyle = "#7a4a5c";
      ctx.strokeStyle = "#3e2430";
      ctx.lineWidth = 2;
      roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#93607a";
      if (f.w > f.h) for (let k = 0; k < f.w; k++) roundRect(ctx, x + 6 + k * TS, y + 10, TS - 8, h - 16, 5), ctx.fill();
      else for (let k = 0; k < f.h; k++) roundRect(ctx, x + 10, y + 6 + k * TS, w - 16, TS - 8, 5), ctx.fill();
      break;
    case "desk":
      ctx.fillStyle = "#9a9178";
      ctx.strokeStyle = "#4e4a3c";
      ctx.lineWidth = 2;
      ctx.fillRect(x + 3, y + 5, w - 6, h - 10);
      ctx.strokeRect(x + 3, y + 5, w - 6, h - 10);
      ctx.fillStyle = "#e8e8e0";
      ctx.fillRect(x + 10, y + 10, 12, 9);
      break;
    case "shelf":
      ctx.fillStyle = "#6e6a62";
      ctx.strokeStyle = "#3a3833";
      ctx.lineWidth = 2;
      ctx.fillRect(x + 2, y + 6, w - 4, h - 12);
      ctx.strokeRect(x + 2, y + 6, w - 4, h - 12);
      for (let k = 0; k < Math.max(f.w, f.h); k++) {
        ctx.fillStyle = ["#b05a3a", "#3a6ab0", "#c9a33a", "#5a9a4a"][k % 4];
        if (f.w >= f.h) ctx.fillRect(x + 6 + k * TS, y + 10, TS - 14, h - 20);
        else ctx.fillRect(x + 10, y + 6 + k * TS, w - 20, TS - 14);
      }
      break;
    case "machine":
      ctx.fillStyle = "#5f6b72";
      ctx.strokeStyle = "#2c3236";
      ctx.lineWidth = 2;
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = "#e0b23a";
      ctx.fillRect(x + 3, y + 3, w - 6, 6);
      ctx.fillStyle = "#2c3236";
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2 + 3, Math.min(w, h) / 4, 0, 6.28);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = "#777";
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  }
  ctx.restore();
}

function drawVehicle(ctx, v) {
  const x = v.tx * TS;
  const y = v.ty * TS;
  const w = v.w * TS;
  const h = v.h * TS;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (!v.horizontal) ctx.rotate(Math.PI / 2);
  if (v.flip) ctx.rotate(Math.PI);
  const L = Math.max(w, h) - 8;
  const W = Math.min(w, h) - 10;
  ctx.fillStyle = "#1e1f22";
  for (const sx of [-L * 0.3, L * 0.3]) for (const sy of [-W / 2 - 2, W / 2 - 4]) ctx.fillRect(sx - 8, sy, 16, 6);
  ctx.fillStyle = v.color;
  ctx.strokeStyle = shade(v.color, -0.45);
  ctx.lineWidth = 2;
  roundRect(ctx, -L / 2, -W / 2, L, W, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(160,210,235,0.85)";
  roundRect(ctx, L * 0.08, -W / 2 + 5, L * 0.18, W - 10, 4);
  ctx.fill();
  roundRect(ctx, -L * 0.36, -W / 2 + 6, L * 0.12, W - 12, 4);
  ctx.fill();
  ctx.fillStyle = shade(v.color, 0.15);
  roundRect(ctx, -L * 0.22, -W / 2 + 6, L * 0.28, W - 12, 4);
  ctx.fill();
  ctx.fillStyle = "#fff7c0";
  ctx.fillRect(L / 2 - 4, -W / 2 + 4, 3, 7);
  ctx.fillRect(L / 2 - 4, W / 2 - 11, 3, 7);
  ctx.restore();
}

function drawShipping(ctx, s) {
  const x = s.tx * TS;
  const y = s.ty * TS;
  const w = s.w * TS;
  const h = s.h * TS;
  ctx.fillStyle = s.color;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = shade(s.color, -0.4);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = shade(s.color, -0.2);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (s.horizontal) {
    for (let k = x + 8; k < x + w - 4; k += 8) {
      ctx.moveTo(k, y + 4);
      ctx.lineTo(k, y + h - 4);
    }
  } else {
    for (let k = y + 8; k < y + h - 4; k += 8) {
      ctx.moveTo(x + 4, k);
      ctx.lineTo(x + w - 4, k);
    }
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(x + 3, y + 3, s.horizontal ? w - 6 : 8, s.horizontal ? 8 : h - 6);
}

function drawContainerArt(ctx, c) {
  const x = c.x;
  const y = c.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-14, -12, 32, 30);
  switch (c.kind) {
    case "crate":
      ctx.fillStyle = "#b07d42";
      ctx.strokeStyle = "#5a3c1a";
      ctx.lineWidth = 2;
      ctx.fillRect(-16, -16, 32, 32);
      ctx.strokeRect(-16, -16, 32, 32);
      ctx.beginPath();
      ctx.moveTo(-16, -5);
      ctx.lineTo(16, -5);
      ctx.moveTo(-16, 6);
      ctx.lineTo(16, 6);
      ctx.stroke();
      break;
    case "weaponbox":
      ctx.fillStyle = "#4f5d36";
      ctx.strokeStyle = "#232a17";
      ctx.lineWidth = 2;
      ctx.fillRect(-18, -11, 36, 22);
      ctx.strokeRect(-18, -11, 36, 22);
      ctx.fillStyle = "#c9b24a";
      ctx.fillRect(-14, -2, 6, 4);
      ctx.fillRect(8, -2, 6, 4);
      ctx.fillStyle = "#e0d27a";
      ctx.font = "bold 8px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("AMMO", 0, 3);
      break;
    case "drawer":
      ctx.fillStyle = "#8c6239";
      ctx.strokeStyle = "#47301a";
      ctx.lineWidth = 2;
      ctx.fillRect(-16, -14, 32, 28);
      ctx.strokeRect(-16, -14, 32, 28);
      ctx.fillStyle = "#d9b25a";
      for (const yy of [-6, 5]) {
        ctx.strokeRect(-13, yy - 5, 26, 9);
        ctx.fillRect(-3, yy - 1, 6, 2);
      }
      break;
    case "medcab":
      ctx.fillStyle = "#e9ecee";
      ctx.strokeStyle = "#8b9196";
      ctx.lineWidth = 2;
      ctx.fillRect(-15, -15, 30, 30);
      ctx.strokeRect(-15, -15, 30, 30);
      ctx.fillStyle = "#d8352a";
      ctx.fillRect(-3, -10, 6, 20);
      ctx.fillRect(-10, -3, 20, 6);
      break;
    case "fridge":
      ctx.fillStyle = "#f0f2f2";
      ctx.strokeStyle = "#9aa1a5";
      ctx.lineWidth = 2;
      roundRect(ctx, -15, -17, 30, 34, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-15, -4);
      ctx.lineTo(15, -4);
      ctx.stroke();
      ctx.fillStyle = "#9aa1a5";
      ctx.fillRect(8, -14, 3, 7);
      ctx.fillRect(8, 0, 3, 10);
      break;
    case "safe":
      ctx.fillStyle = "#3b4045";
      ctx.strokeStyle = "#16191c";
      ctx.lineWidth = 2;
      ctx.fillRect(-15, -15, 30, 30);
      ctx.strokeRect(-15, -15, 30, 30);
      ctx.strokeStyle = "#c9b24a";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, 6.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5, -4);
      ctx.stroke();
      break;
    case "toolcab":
      ctx.fillStyle = "#b8322a";
      ctx.strokeStyle = "#5c1712";
      ctx.lineWidth = 2;
      ctx.fillRect(-16, -14, 32, 28);
      ctx.strokeRect(-16, -14, 32, 28);
      ctx.fillStyle = "#ddd";
      for (const yy of [-8, -1, 6]) ctx.fillRect(-10, yy, 20, 2);
      break;
    case "pc":
      ctx.fillStyle = "#9a9178";
      ctx.fillRect(-17, -12, 34, 24);
      ctx.fillStyle = "#26292d";
      ctx.fillRect(-9, -10, 18, 12);
      ctx.fillStyle = "#3c7fb0";
      ctx.fillRect(-7, -8, 14, 8);
      ctx.fillStyle = "#ddd";
      ctx.fillRect(-10, 5, 20, 5);
      break;
    case "jacket":
      ctx.fillStyle = "#3e5a73";
      ctx.strokeStyle = "#1f2f3d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-14, -10);
      ctx.lineTo(-4, -14);
      ctx.lineTo(4, -14);
      ctx.lineTo(14, -10);
      ctx.lineTo(12, 12);
      ctx.lineTo(-12, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 12);
      ctx.stroke();
      break;
    case "duffle":
      ctx.fillStyle = "#4c5a3c";
      ctx.strokeStyle = "#252d1c";
      ctx.lineWidth = 2;
      roundRect(ctx, -18, -10, 36, 20, 9);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.quadraticCurveTo(0, -18, 10, -10);
      ctx.stroke();
      break;
    case "trunk":
      ctx.fillStyle = "rgba(20,20,20,0.6)";
      ctx.fillRect(-12, -12, 24, 24);
      ctx.strokeStyle = "#ffe27a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-12, -12, 24, 24);
      break;
    case "ground":
      ctx.fillStyle = "#6b5a3e";
      ctx.strokeStyle = "#2e2618";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 2, 11, 9, 0, 0, 6.28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#8a7550";
      ctx.fillRect(-4, -9, 8, 5);
      break;
    default:
      ctx.fillStyle = "#888";
      ctx.fillRect(-14, -14, 28, 28);
  }
  ctx.restore();
}
