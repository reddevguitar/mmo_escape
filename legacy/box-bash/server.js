import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { GAME_CONFIG } from "./config.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const { combat, chat } = GAME_CONFIG;
const world = {
  ...GAME_CONFIG.world,
  tickRate: GAME_CONFIG.tickRate,
  snapshotRate: GAME_CONFIG.snapshotRate,
};

const players = new Map();
const sockets = new Map();
const chatHistory = [];
let nextPlayerId = 1;
let lastTick = performance.now();
let lastSnapshot = 0;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = resolve(join(root, relativePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  if (players.size >= GAME_CONFIG.maxPlayers) {
    socket.send(JSON.stringify({ type: "error", message: "서버 정원이 가득 찼습니다." }));
    socket.close();
    return;
  }

  const player = createPlayer();
  players.set(player.id, player);
  sockets.set(socket, player.id);

  socket.send(
    JSON.stringify({
      type: "welcome",
      id: player.id,
      world,
      chatHistory,
      config: {
        maxPlayers: GAME_CONFIG.maxPlayers,
        chatMaxLength: chat.maxLength,
      },
    }),
  );
  broadcastChat("system", `${player.name} 접속`, "system");

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    if (message.type === "hello") {
      const previousName = player.name;
      player.name = sanitizeName(message.name, player.id);
      if (player.name !== previousName) {
        broadcastChat("system", `${previousName} -> ${player.name}`, "system");
      }
      return;
    }

    if (message.type === "chat") {
      const text = sanitizeChat(message.text);
      if (text) broadcastChat(player.id, text, "player");
      return;
    }

    if (message.type === "input") {
      player.input.moveX = clampNumber(message.moveX, -1, 1);
      player.input.moveZ = clampNumber(message.moveZ, -1, 1);
      player.input.aimX = clampNumber(message.aimX, -world.halfSize, world.halfSize);
      player.input.aimZ = clampNumber(message.aimZ, -world.halfSize, world.seaStartZ + 12);
      player.input.jump ||= Boolean(message.jump);
      player.input.attack ||= Boolean(message.attack);
    }
  });

  socket.on("close", () => {
    players.delete(player.id);
    sockets.delete(socket);
    broadcastChat("system", `${player.name} 퇴장`, "system");
  });

  socket.on("error", () => {
    players.delete(player.id);
    sockets.delete(socket);
  });
});

server.listen(GAME_CONFIG.port, "0.0.0.0", () => {
  console.log(`Box Bash Island server running on http://localhost:${GAME_CONFIG.port}`);
});

setInterval(gameTick, 1000 / world.tickRate);

function createPlayer() {
  const id = `p${nextPlayerId++}`;
  const spawn = spawnPoint(nextPlayerId);
  return {
    id,
    x: spawn.x,
    y: 0,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    directionX: 0,
    directionZ: -1,
    rotationY: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    grounded: true,
    attackTimer: 0,
    attackCooldown: 0,
    hitLock: 0,
    respawnTimer: 0,
    name: `Guest ${id.slice(1)}`,
    color: colorForId(nextPlayerId),
    input: {
      moveX: 0,
      moveZ: 0,
      aimX: spawn.x,
      aimZ: spawn.z - 6,
      jump: false,
      attack: false,
    },
  };
}

function spawnPoint(seed) {
  const angle = seed * 1.9;
  const radius = 7 + (seed % 5) * 1.8;
  return {
    x: Math.cos(angle) * radius,
    z: 8 + Math.sin(angle) * radius,
  };
}

function colorForId(seed) {
  const colors = ["#e9f1f3", "#f7c948", "#5cc8ff", "#f26d6d", "#9bdb70", "#d9a8ff"];
  return colors[seed % colors.length];
}

function gameTick() {
  const now = performance.now();
  const dt = Math.min((now - lastTick) / 1000, 1 / 15);
  lastTick = now;

  for (const player of players.values()) updatePlayer(player, dt);
  solvePlayerCollisions();

  if (now - lastSnapshot >= 1000 / world.snapshotRate) {
    lastSnapshot = now;
    broadcastSnapshot();
  }
}

function updatePlayer(player, dt) {
  if (player.respawnTimer > 0) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) respawnPlayer(player);
    return;
  }

  const aimX = player.input.aimX - player.x;
  const aimZ = player.input.aimZ - player.z;
  const aimLength = Math.hypot(aimX, aimZ);
  if (aimLength > 0.08) {
    player.directionX = aimX / aimLength;
    player.directionZ = aimZ / aimLength;
    player.rotationY = Math.atan2(player.directionX, player.directionZ);
  }

  const accel = player.grounded ? 55 : 24;
  player.vx += player.input.moveX * accel * dt;
  player.vz += player.input.moveZ * accel * dt;

  if (player.input.jump && player.grounded) {
    player.vy = 10.4;
    player.grounded = false;
  }

  if (player.input.attack) {
    startAttack(player);
  }

  player.input.jump = false;
  player.input.attack = false;

  integrate(player, dt);
  player.attackTimer = Math.max(0, player.attackTimer - dt);
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.hitLock = Math.max(0, player.hitLock - dt);
}

function startAttack(player) {
  if (player.attackCooldown > 0 || player.respawnTimer > 0) return;
  player.attackTimer = combat.bashDuration;
  player.attackCooldown = combat.bashCooldown;
  player.vx += player.directionX * combat.bashImpulse;
  player.vz += player.directionZ * combat.bashImpulse;
}

function integrate(player, dt) {
  player.vy -= world.gravity * dt;

  const maxPlanarSpeed = player.attackTimer > 0 ? 24 : 7.8;
  const planarSpeed = Math.hypot(player.vx, player.vz);
  if (planarSpeed > maxPlanarSpeed) {
    const scale = maxPlanarSpeed / planarSpeed;
    player.vx *= scale;
    player.vz *= scale;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.z += player.vz * dt;

  player.vx *= Math.pow(0.0008, dt);
  player.vz *= Math.pow(0.0008, dt);

  if (player.y <= 0) {
    player.y = 0;
    player.vy = Math.max(0, player.vy);
    player.grounded = true;
  }

  player.x = clampNumber(player.x, -world.halfSize + 2, world.halfSize - 2);
  player.z = clampNumber(player.z, -world.halfSize + 2, world.seaStartZ + 12);
}

function solvePlayerCollisions() {
  const activePlayers = [...players.values()].filter((player) => player.respawnTimer <= 0);

  for (let i = 0; i < activePlayers.length; i++) {
    for (let j = i + 1; j < activePlayers.length; j++) {
      const a = activePlayers[i];
      const b = activePlayers[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      const minDistance = 2;
      if (distance <= 0.001 || distance >= minDistance) continue;

      const nx = dx / distance;
      const nz = dz / distance;
      const overlap = minDistance - distance;
      a.x -= nx * overlap * 0.5;
      a.z -= nz * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.z += nz * overlap * 0.5;

      if (a.attackTimer > 0) damagePlayer(b, a, nx, nz);
      if (b.attackTimer > 0) damagePlayer(a, b, -nx, -nz);
    }
  }
}

function damagePlayer(player, attacker, nx, nz) {
  if (player.hitLock > 0 || player.respawnTimer > 0 || attacker.id === player.id) return;
  player.hp -= combat.bashDamage;
  player.hitLock = 0.55;
  player.vx += nx * combat.knockback;
  player.vz += nz * combat.knockback;
  player.vy = Math.max(player.vy, 4.8);
  broadcastEvent({
    type: "hit",
    attackerId: attacker.id,
    victimId: player.id,
    x: round(player.x),
    y: round(player.y),
    z: round(player.z),
    damage: combat.bashDamage,
  });

  if (player.hp <= 0) {
    player.hp = 0;
    player.deaths += 1;
    attacker.kills += 1;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.respawnTimer = combat.respawnSeconds;
    broadcastChat("system", `${attacker.name} defeated ${player.name}`, "system");
  }
}

function respawnPlayer(player) {
  const spawn = spawnPoint(Number(player.id.slice(1)) + Date.now() * 0.001);
  player.x = spawn.x;
  player.y = 0;
  player.z = spawn.z;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.hp = 100;
  player.attackTimer = 0;
  player.attackCooldown = 0;
  player.hitLock = 0;
}

function broadcastSnapshot() {
  const payload = JSON.stringify({
    type: "snapshot",
    players: [...players.values()].map((player) => ({
      id: player.id,
      x: round(player.x),
      y: round(player.y),
      z: round(player.z),
      ry: round(player.rotationY),
      hp: player.hp,
      name: player.name,
      kills: player.kills,
      deaths: player.deaths,
      state: stateForPlayer(player),
      color: player.color,
    })),
  });

  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function broadcastChat(senderId, text, kind) {
  const sender = players.get(senderId);
  const message = {
    type: "chat",
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    senderId,
    name: sender?.name ?? "System",
    text,
    time: Date.now(),
  };
  chatHistory.push(message);
  if (chatHistory.length > chat.historyLimit) chatHistory.shift();
  broadcastEvent(message);
}

function broadcastEvent(event) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function sanitizeName(value, fallbackId) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);
  return cleaned || `Guest ${fallbackId.slice(1)}`;
}

function sanitizeChat(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, chat.maxLength);
}

function stateForPlayer(player) {
  if (player.respawnTimer > 0) return "respawn";
  if (player.attackTimer > 0) return "bash";
  if (player.attackCooldown > 0) return "cooldown";
  return "ready";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
