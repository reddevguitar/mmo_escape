// 아이템 아이콘을 캔버스로 그려 dataURL로 캐시

import { ITEMS } from "../data/items.js";
import { shade, roundRect } from "../game/draw.js";

const CELL = 64;
const cache = new Map();
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

export function itemIcon(id) {
  let url = cache.get(id);
  if (url) return url;
  const def = ITEMS[id];
  const c = document.createElement("canvas");
  c.width = def.w * CELL;
  c.height = def.h * CELL;
  const g = c.getContext("2d");
  try {
    drawIcon(g, def, c.width, c.height);
  } catch {
    // 아이콘 실패 시 빈 칸
  }
  url = c.toDataURL();
  cache.set(id, url);
  return url;
}

function drawIcon(g, def, W, H) {
  if (def.type === "weapon") return drawGun(g, def, W, H);
  if (def.type === "ammo") return drawAmmo(g, def, W, H);
  if (def.type === "armor") return drawVest(g, def, W, H);
  if (def.type === "helmet") return drawHelmet(g, def, W, H);
  if (def.type === "backpack") return drawBag(g, def, W, H);
  if (typeof def.icon === "string" && def.icon.startsWith("draw:")) return drawSpecial(g, def.icon.slice(5), W, H);
  // 이모지
  const size = Math.min(W, H) * 0.62;
  g.font = `${size}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.fillText(def.icon ?? "❔", W / 2, H / 2 + size * 0.05);
}

function drawGun(g, def, W, H) {
  const metal = "#2c3035";
  const metal2 = "#3e444b";
  const wood = "#7a4f2a";
  const cy = H / 2;
  const k = Math.min(W / 4, H) / 64; // 기준 배율
  g.save();
  g.shadowColor = "rgba(0,0,0,0.5)";
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.lineJoin = "round";
  const wc = def.wclass;
  if (wc === "pistol") {
    const x0 = W * 0.12;
    const x1 = W * 0.88;
    g.fillStyle = metal2;
    g.fillRect(x0, cy - H * 0.22, x1 - x0, H * 0.2);
    g.fillStyle = metal;
    g.beginPath();
    g.moveTo(x0 + W * 0.06, cy - H * 0.04);
    g.lineTo(x0 + W * 0.3, cy - H * 0.04);
    g.lineTo(x0 + W * 0.24, cy + H * 0.36);
    g.lineTo(x0 + W * 0.04, cy + H * 0.36);
    g.closePath();
    g.fill();
    g.strokeStyle = metal;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x0 + W * 0.38, cy + H * 0.04, H * 0.1, 0, Math.PI);
    g.stroke();
    if (def.auto) {
      g.fillStyle = "#c9a33a";
      g.fillRect(x0 + W * 0.05, cy + H * 0.3, W * 0.2, H * 0.12);
    }
  } else if (wc === "smg" && def.w === 2) {
    // 우지: 각진 몸통, 손잡이에 탄창
    g.fillStyle = metal2;
    g.fillRect(W * 0.1, cy - H * 0.18, W * 0.72, H * 0.2);
    g.fillStyle = metal;
    g.fillRect(W * 0.82, cy - H * 0.12, W * 0.12, H * 0.07);
    g.fillRect(W * 0.38, cy, W * 0.16, H * 0.42);
    g.fillStyle = "#1b1d20";
    g.fillRect(W * 0.41, cy + H * 0.3, W * 0.1, H * 0.16);
  } else {
    const bodyH = H * (def.h >= 2 ? 0.17 : 0.3);
    const x0 = W * 0.2;
    const x1 = W * (wc === "shotgun" ? 0.62 : 0.66);
    // 개머리판
    g.fillStyle = wc === "rifle" && def.caliber === "762" ? wood : wc === "shotgun" || wc === "dmr" ? wood : metal;
    g.beginPath();
    g.moveTo(W * 0.03, cy - bodyH * 0.6);
    g.lineTo(x0, cy - bodyH * 0.5);
    g.lineTo(x0, cy + bodyH * 0.6);
    g.lineTo(W * 0.03, cy + bodyH * 1.4);
    g.closePath();
    g.fill();
    // 몸통
    g.fillStyle = metal2;
    g.fillRect(x0, cy - bodyH / 2, x1 - x0, bodyH);
    // 총열 덮개/총열
    g.fillStyle = wc === "shotgun" || (wc === "rifle" && def.caliber === "762") ? wood : metal;
    g.fillRect(x1, cy - bodyH * 0.38, W * 0.17, bodyH * 0.76);
    g.fillStyle = metal;
    g.fillRect(x1 + W * 0.17, cy - bodyH * 0.18, W * (0.97 - 0.17) - x1, bodyH * 0.36);
    // 손잡이
    g.fillStyle = metal;
    g.beginPath();
    g.moveTo(x0 + W * 0.04, cy + bodyH / 2);
    g.lineTo(x0 + W * 0.1, cy + bodyH / 2);
    g.lineTo(x0 + W * 0.07, cy + bodyH / 2 + H * 0.2);
    g.lineTo(x0 + W * 0.01, cy + bodyH / 2 + H * 0.2);
    g.closePath();
    g.fill();
    // 탄창
    if (wc !== "shotgun") {
      g.fillStyle = "#1b1d20";
      const mx = x0 + (x1 - x0) * 0.45;
      if (wc === "lmg") {
        g.fillStyle = "#48523a";
        g.fillRect(mx - W * 0.06, cy + bodyH / 2, W * 0.14, H * 0.3);
      } else if (def.caliber === "762" && wc === "rifle") {
        g.beginPath();
        g.moveTo(mx, cy + bodyH / 2);
        g.lineTo(mx + W * 0.06, cy + bodyH / 2);
        g.quadraticCurveTo(mx + W * 0.1, cy + H * 0.3, mx + W * 0.12, cy + H * 0.4);
        g.lineTo(mx + W * 0.06, cy + H * 0.42);
        g.quadraticCurveTo(mx + W * 0.04, cy + H * 0.3, mx, cy + bodyH / 2);
        g.fill();
      } else {
        g.fillRect(mx, cy + bodyH / 2, W * 0.05, H * (wc === "dmr" ? 0.18 : 0.3));
      }
    } else {
      g.fillStyle = metal;
      g.fillRect(x1 + W * 0.02, cy + bodyH * 0.3, W * 0.12, bodyH * 0.35);
    }
    if (wc === "dmr") {
      g.fillStyle = "#111";
      g.fillRect(x0 + W * 0.05, cy - bodyH / 2 - H * 0.16, W * 0.22, H * 0.12);
      g.fillStyle = "#3b6ea8";
      g.fillRect(x0 + W * 0.25, cy - bodyH / 2 - H * 0.15, W * 0.02, H * 0.1);
    }
    if (wc === "rifle" && def.caliber === "556") {
      g.fillStyle = metal;
      g.fillRect(x0 + W * 0.04, cy - bodyH / 2 - H * 0.08, W * 0.18, H * 0.06);
    }
    if (wc === "lmg") {
      g.strokeStyle = metal;
      g.lineWidth = 3 * k;
      g.beginPath();
      g.moveTo(W * 0.8, cy + bodyH * 0.2);
      g.lineTo(W * 0.76, cy + H * 0.42);
      g.moveTo(W * 0.8, cy + bodyH * 0.2);
      g.lineTo(W * 0.86, cy + H * 0.42);
      g.stroke();
    }
  }
  g.restore();
}

function drawAmmo(g, def, W, H) {
  const shell = def.caliber === "12g";
  const tip = def.id.endsWith("_ap") ? "#3d7fd6" : def.id === "12g_slug" ? "#9aa0a6" : shell ? "#c8342a" : "#b8752e";
  const n = 3;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.4)";
  g.shadowBlur = 4;
  for (let i = 0; i < n; i++) {
    const x = W * (0.24 + i * 0.26);
    const bw = W * (shell ? 0.18 : 0.13);
    const bh = H * (def.caliber === "9mm" ? 0.42 : shell ? 0.56 : 0.66);
    const y = H / 2 - bh / 2 + (i % 2) * 4;
    if (shell) {
      g.fillStyle = tip;
      roundRect(g, x - bw / 2, y, bw, bh * 0.75, 3);
      g.fill();
      g.fillStyle = "#d9b04a";
      g.fillRect(x - bw / 2, y + bh * 0.7, bw, bh * 0.3);
    } else {
      g.fillStyle = "#d9b04a";
      g.fillRect(x - bw / 2, y + bh * 0.35, bw, bh * 0.65);
      g.fillStyle = tip;
      g.beginPath();
      g.moveTo(x - bw / 2, y + bh * 0.36);
      g.quadraticCurveTo(x - bw / 2, y, x, y);
      g.quadraticCurveTo(x + bw / 2, y, x + bw / 2, y + bh * 0.36);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

function drawVest(g, def, W, H) {
  const c = def.color ?? "#444";
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 8;
  g.fillStyle = c;
  g.strokeStyle = shade(c, -0.5);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W * 0.22, H * 0.12);
  g.lineTo(W * 0.38, H * 0.12);
  g.quadraticCurveTo(W * 0.5, H * 0.28, W * 0.62, H * 0.12);
  g.lineTo(W * 0.78, H * 0.12);
  g.lineTo(W * 0.86, H * 0.38);
  g.lineTo(W * 0.82, H * 0.9);
  g.lineTo(W * 0.18, H * 0.9);
  g.lineTo(W * 0.14, H * 0.38);
  g.closePath();
  g.fill();
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = shade(c, 0.15);
  roundRect(g, W * 0.3, H * 0.4, W * 0.4, H * 0.32, 6);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = `bold ${H * 0.2}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(def.cls), W / 2, H * 0.57);
  g.restore();
}

function drawHelmet(g, def, W, H) {
  const c = def.color ?? "#555";
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 8;
  g.fillStyle = c;
  g.strokeStyle = shade(c, -0.5);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W * 0.12, H * 0.68);
  g.quadraticCurveTo(W * 0.14, H * 0.18, W * 0.5, H * 0.18);
  g.quadraticCurveTo(W * 0.86, H * 0.18, W * 0.88, H * 0.68);
  g.lineTo(W * 0.94, H * 0.74);
  g.lineTo(W * 0.06, H * 0.74);
  g.closePath();
  g.fill();
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.beginPath();
  g.ellipse(W * 0.38, H * 0.34, W * 0.12, H * 0.06, -0.4, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawBag(g, def, W, H) {
  const c = def.color ?? "#6b5a3e";
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 8;
  g.fillStyle = c;
  g.strokeStyle = shade(c, -0.5);
  g.lineWidth = 3;
  roundRect(g, W * 0.16, H * 0.16, W * 0.68, H * 0.76, Math.min(W, H) * 0.14);
  g.fill();
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = shade(c, -0.35);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(W * 0.36, H * 0.16);
  g.quadraticCurveTo(W * 0.5, H * 0.02, W * 0.64, H * 0.16);
  g.stroke();
  g.fillStyle = shade(c, 0.12);
  roundRect(g, W * 0.26, H * 0.52, W * 0.48, H * 0.3, 6);
  g.fill();
  g.strokeStyle = shade(c, -0.45);
  g.lineWidth = 2;
  g.stroke();
  g.restore();
}

function drawSpecial(g, kind, W, H) {
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 8;
  if (kind === "pouch") {
    g.fillStyle = "#5c6b3e";
    roundRect(g, W * 0.18, H * 0.2, W * 0.64, H * 0.64, 10);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#d8352a";
    g.fillRect(W * 0.44, H * 0.32, W * 0.12, H * 0.4);
    g.fillRect(W * 0.3, H * 0.46, W * 0.4, H * 0.12);
  } else if (kind === "medcase") {
    g.fillStyle = "#c62f26";
    roundRect(g, W * 0.08, H * 0.2, W * 0.84, H * 0.64, 10);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#fff";
    g.fillRect(W * 0.46, H * 0.3, W * 0.08, H * 0.44);
    g.fillRect(W * 0.38, H * 0.45, W * 0.24, H * 0.14);
  } else if (kind === "gpu") {
    g.fillStyle = "#1d2125";
    roundRect(g, W * 0.06, H * 0.2, W * 0.88, H * 0.56, 6);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#3aa864";
    g.fillRect(W * 0.12, H * 0.76, W * 0.5, H * 0.08);
    for (const fx of [0.3, 0.7]) {
      g.fillStyle = "#3a4047";
      g.beginPath();
      g.arc(W * fx, H * 0.48, H * 0.22, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#7a838c";
      g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath();
        g.moveTo(W * fx, H * 0.48);
        g.lineTo(W * fx + Math.cos(a) * H * 0.18, H * 0.48 + Math.sin(a) * H * 0.18);
        g.stroke();
      }
    }
  } else if (kind === "egg") {
    const grad = g.createRadialGradient(W * 0.4, H * 0.35, 4, W * 0.5, H * 0.52, W * 0.42);
    grad.addColorStop(0, "#fff6c8");
    grad.addColorStop(0.35, "#f5c842");
    grad.addColorStop(1, "#a8740e");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(W * 0.5, H * 0.53, W * 0.3, H * 0.38, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
