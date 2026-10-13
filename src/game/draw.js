// 캐릭터/아이템 그리기 (레이드 렌더러와 은신처 미리보기에서 공용)

import { ITEMS } from "../data/items.js";

const WEAPON_LEN = { pistol: 15, smg: 21, shotgun: 30, rifle: 29, dmr: 36, lmg: 34 };

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

/**
 * 탑다운 오리. (x,y) 중심, angle 바라보는 방향.
 * o: { r, body, head, beak, ring, walk, moving, armor, helmet, weapon, backpack, hurt, crouch, peck, neck, alpha }
 */
export function drawDuck(ctx, x, y, angle, o) {
  const r = o.r ?? 14;
  const s = o.crouch ? 0.9 : 1;
  ctx.save();
  ctx.translate(x, y);
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;

  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ellipse(ctx, 3, 5, r * 1.15 * s, r * 0.95 * s);
  ctx.fill();

  ctx.rotate(angle);
  ctx.scale(s, s);
  const bob = o.moving ? Math.sin(o.walk ?? 0) : 0;

  // 발
  ctx.fillStyle = "#f0a030";
  const fo = bob * 4;
  ellipse(ctx, -r * 0.35 + fo, -r * 0.45, 4, 3);
  ctx.fill();
  ellipse(ctx, -r * 0.35 - fo, r * 0.45, 4, 3);
  ctx.fill();

  // 가방
  if (o.backpack) {
    const bdef = ITEMS[o.backpack];
    const bw = 6 + bdef.gw * 1.6;
    const bh = 8 + bdef.gh * 1.4;
    ctx.fillStyle = bdef.color ?? "#6b5a3e";
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, -r * 0.95 - bw * 0.55, -bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.stroke();
  }

  // 꼬리
  ctx.fillStyle = shade(o.body, -0.15);
  ctx.beginPath();
  ctx.moveTo(-r * 1.0, -r * 0.3);
  ctx.lineTo(-r * 1.45, 0);
  ctx.lineTo(-r * 1.0, r * 0.3);
  ctx.closePath();
  ctx.fill();

  // 몸통
  ctx.fillStyle = o.body;
  ctx.strokeStyle = shade(o.body, -0.4);
  ctx.lineWidth = 1.6;
  ellipse(ctx, -r * 0.1, 0, r * 1.05, r * 0.88);
  ctx.fill();
  ctx.stroke();

  // 날개
  ctx.fillStyle = shade(o.body, -0.12);
  ellipse(ctx, -r * 0.25, -r * 0.62, r * 0.6, r * 0.24, -0.15 + bob * 0.08);
  ctx.fill();
  ellipse(ctx, -r * 0.25, r * 0.62, r * 0.6, r * 0.24, 0.15 - bob * 0.08);
  ctx.fill();

  // 방탄복
  if (o.armor) {
    const adef = ITEMS[o.armor];
    ctx.fillStyle = adef.color ?? "#444";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1.2;
    roundRect(ctx, -r * 0.75, -r * 0.62, r * 1.15, r * 1.24, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(-r * 0.55, -r * 0.4, r * 0.75, r * 0.32);
    ctx.fillRect(-r * 0.55, r * 0.08, r * 0.75, r * 0.32);
  }

  // 무기
  if (o.weapon) {
    const wdef = ITEMS[o.weapon];
    const len = WEAPON_LEN[wdef.wclass] ?? 22;
    ctx.fillStyle = "#26292d";
    ctx.strokeStyle = "#0e0f11";
    ctx.lineWidth = 1;
    const wy = r * 0.35;
    const back = wdef.wclass === "pistol" ? r * 0.2 : -r * 0.2;
    roundRect(ctx, back, wy - 2.5, len + r * 0.4, 5, 1.5);
    ctx.fill();
    ctx.stroke();
    if (wdef.wclass === "rifle" || wdef.wclass === "lmg" || wdef.wclass === "smg") {
      ctx.fillStyle = "#3a3f45";
      ctx.fillRect(back + len * 0.35, wy + 2, 5, wdef.wclass === "lmg" ? 8 : 6);
    }
    if (wdef.wclass === "dmr") {
      ctx.fillStyle = "#111";
      ctx.fillRect(back + len * 0.3, wy - 4.5, 10, 3);
    }
    if (wdef.wclass === "shotgun" || wdef.wclass === "rifle") {
      ctx.fillStyle = "#6b4a2b";
      ctx.fillRect(back - 3, wy - 2.5, 7, 5);
    }
    // 날개 끝으로 총을 쥔 모습
    ctx.fillStyle = shade(o.body, -0.18);
    ellipse(ctx, back + 6, wy + 1, 4, 3.5);
    ctx.fill();
  }

  // 머리 (거위는 목이 길다)
  const peck = o.peck ? 7 : 0;
  const hx = r * (o.neck ? 1.05 : 0.62) + peck;
  const hr = r * (o.neck ? 0.42 : 0.56);
  if (o.neck) {
    ctx.strokeStyle = o.head;
    ctx.lineWidth = r * 0.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.4, 0);
    ctx.lineTo(hx, 0);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  if (o.ring) {
    ctx.fillStyle = o.ring;
    ellipse(ctx, hx - hr * 0.75, 0, hr * 0.35, hr * 0.85);
    ctx.fill();
  }
  ctx.fillStyle = o.head;
  ctx.strokeStyle = shade(o.head, -0.45);
  ctx.lineWidth = 1.4;
  ellipse(ctx, hx, 0, hr, hr * 0.95);
  ctx.fill();
  ctx.stroke();

  // 부리
  ctx.fillStyle = o.beak;
  ctx.strokeStyle = shade(o.beak, -0.35);
  ctx.lineWidth = 1;
  ellipse(ctx, hx + hr * 0.95, 0, hr * 0.62, hr * 0.42);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = shade(o.beak, -0.45);
  ctx.beginPath();
  ctx.moveTo(hx + hr * 0.5, 0);
  ctx.lineTo(hx + hr * 1.5, 0);
  ctx.stroke();

  // 눈
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#111";
    ellipse(ctx, hx + hr * 0.25, side * hr * 0.55, hr * 0.2, hr * 0.2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ellipse(ctx, hx + hr * 0.3, side * hr * 0.6, hr * 0.07, hr * 0.07);
    ctx.fill();
  }

  // 헬멧
  if (o.helmet) {
    const hdef = ITEMS[o.helmet];
    ctx.fillStyle = hdef.color ?? "#555";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(hx - hr * 0.15, 0, hr * 0.92, hr * 1.02, 0, Math.PI * 0.5, Math.PI * 1.5);
    ctx.lineTo(hx + hr * 0.05, -hr * 0.6);
    ctx.quadraticCurveTo(hx + hr * 0.25, 0, hx + hr * 0.05, hr * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ellipse(ctx, hx - hr * 0.35, -hr * 0.3, hr * 0.3, hr * 0.18);
    ctx.fill();
  }

  // 피격 플래시 (몸통과 머리만 붉게)
  if (o.hurt) {
    ctx.fillStyle = "rgba(255,70,50,0.5)";
    ellipse(ctx, -r * 0.1, 0, r * 1.05, r * 0.88);
    ctx.fill();
    ellipse(ctx, hx, 0, hr, hr * 0.95);
    ctx.fill();
  }

  ctx.restore();
}

/** 쓰러진 오리 */
export function drawCorpse(ctx, x, y, angle, o) {
  const r = o.r ?? 14;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + 0.4);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ellipse(ctx, 2, 3, r * 1.2, r);
  ctx.fill();
  ctx.fillStyle = shade(o.body, -0.15);
  ctx.strokeStyle = shade(o.body, -0.45);
  ctx.lineWidth = 1.4;
  ellipse(ctx, 0, 0, r * 1.05, r * 0.82);
  ctx.fill();
  ctx.stroke();
  if (o.armor) {
    ctx.fillStyle = shade(ITEMS[o.armor].color ?? "#444", -0.2);
    roundRect(ctx, -r * 0.65, -r * 0.55, r * 1.05, r * 1.1, 4);
    ctx.fill();
  }
  const hx = r * (o.boss ? 1.1 : 0.7);
  const hr = r * (o.boss ? 0.42 : 0.52);
  ctx.fillStyle = shade(o.head, -0.15);
  ellipse(ctx, hx, r * 0.25, hr, hr * 0.95);
  ctx.fill();
  ctx.fillStyle = shade(o.beak, -0.2);
  ellipse(ctx, hx + hr * 0.95, r * 0.35, hr * 0.6, hr * 0.4, 0.3);
  ctx.fill();
  // X 눈
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  const ex = hx + hr * 0.2;
  const ey = r * 0.25 - hr * 0.45;
  ctx.beginPath();
  ctx.moveTo(ex - 2.5, ey - 2.5);
  ctx.lineTo(ex + 2.5, ey + 2.5);
  ctx.moveTo(ex + 2.5, ey - 2.5);
  ctx.lineTo(ex - 2.5, ey + 2.5);
  ctx.stroke();
  // 위로 뻗은 발
  ctx.fillStyle = "#e09030";
  ellipse(ctx, -r * 0.6, -r * 0.9, 3.5, 4.5, 0.4);
  ctx.fill();
  ellipse(ctx, -r * 0.2, -r * 1.0, 3.5, 4.5, -0.2);
  ctx.fill();
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export const PLAYER_COLORS = { body: "#f6e7a8", head: "#f6e7a8", beak: "#f39a2b", ring: null };

export function playerDuckOpts(equip, extra = {}) {
  const w = extra.weaponSlot ? equip[extra.weaponSlot] : equip.primary ?? equip.secondary;
  return {
    r: 14,
    ...PLAYER_COLORS,
    armor: equip.armor?.id,
    helmet: equip.helmet?.id,
    backpack: equip.backpack?.id,
    weapon: w?.id,
    ...extra,
  };
}
