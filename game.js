import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#scene");
const hpEl = document.querySelector("#hp");
const stateEl = document.querySelector("#state");
const netEl = document.querySelector("#net");
const countEl = document.querySelector("#count");
const messageEl = document.querySelector("#message");

const world = {
  halfSize: 58,
  seaStartZ: 22,
};

const input = {
  keys: new Set(),
  jumpQueued: false,
  attackQueued: false,
  moveX: 0,
  moveZ: 0,
  aimX: 0,
  aimZ: 6,
};

const network = {
  socket: null,
  connected: false,
  connecting: false,
  offline: false,
  id: null,
  lastSend: 0,
};

const playerViews = new Map();
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3(0, 0, 6);

scene.background = new THREE.Color(0x92c8ec);
scene.fog = new THREE.Fog(0x92c8ec, 70, 160);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 240);
camera.position.set(0, 12, 18);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(20, 32, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xdcefff, 0x62715a, 1.45));

const materials = {
  ground: new THREE.MeshStandardMaterial({ color: 0x6ca657, roughness: 0.95 }),
  sea: new THREE.MeshStandardMaterial({
    color: 0x2876a7,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 0.88,
  }),
  mountain: new THREE.MeshStandardMaterial({ color: 0x596650, roughness: 1 }),
  playerHead: new THREE.MeshStandardMaterial({ color: 0x22343a, roughness: 0.65 }),
  remoteHead: new THREE.MeshStandardMaterial({ color: 0x2b1816, roughness: 0.7 }),
  aim: new THREE.MeshBasicMaterial({
    color: 0xfff0a8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  }),
};

const aimMarker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.74, 24), materials.aim);
aimMarker.rotation.x = -Math.PI / 2;
aimMarker.position.set(0, 0.04, 6);
scene.add(aimMarker);

function createMap() {
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(world.halfSize * 2, 1, world.halfSize * 2),
    materials.ground,
  );
  ground.position.set(0, -0.55, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const sea = new THREE.Mesh(
    new THREE.BoxGeometry(world.halfSize * 2.2, 0.35, world.halfSize * 1.15),
    materials.sea,
  );
  sea.name = "sea";
  sea.position.set(0, -0.22, world.seaStartZ + 28);
  sea.receiveShadow = true;
  scene.add(sea);

  const mountainData = [
    [-30, -28, 8, 13, 10],
    [-18, -36, 6, 9, 8],
    [26, -33, 9, 15, 12],
    [36, -18, 5, 8, 6],
    [-43, 6, 5, 8, 8],
  ];

  for (const [x, z, radius, height, segments] of mountainData) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, segments),
      materials.mountain,
    );
    mountain.position.set(x, height / 2 - 0.1, z);
    mountain.rotation.y = Math.sin(x * z) * Math.PI;
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    scene.add(mountain);
  }

  const borderMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d5146,
    roughness: 1,
  });
  const sideWall = new THREE.BoxGeometry(1, 3, world.halfSize * 2);
  const endWall = new THREE.BoxGeometry(world.halfSize * 2, 3, 1);

  for (const x of [-world.halfSize, world.halfSize]) {
    const wall = new THREE.Mesh(sideWall, borderMaterial);
    wall.position.set(x, 1, 0);
    wall.receiveShadow = true;
    scene.add(wall);
  }

  for (const z of [-world.halfSize, world.halfSize]) {
    const wall = new THREE.Mesh(endWall, borderMaterial);
    wall.position.set(0, 1, z);
    wall.receiveShadow = true;
    scene.add(wall);
  }
}

function createCharacter(color, isLocal) {
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
  });
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.3, 1.15), bodyMaterial);
  body.position.y = 1.25;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.9, 1),
    isLocal ? materials.playerHead : materials.remoteHead,
  );
  head.position.y = 3.05;
  head.position.z = -0.06;
  head.castShadow = true;
  group.add(head);

  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.25, 0.24),
    isLocal ? materials.playerHead : materials.remoteHead,
  );
  nose.position.set(0, 3.05, -0.6);
  nose.castShadow = true;
  group.add(nose);

  return group;
}

function ensurePlayerView(snapshot) {
  let view = playerViews.get(snapshot.id);
  const isLocal = snapshot.id === network.id;

  if (!view) {
    view = {
      mesh: createCharacter(snapshot.color ?? "#e9f1f3", isLocal),
      target: new THREE.Vector3(snapshot.x, snapshot.y, snapshot.z),
      hp: snapshot.hp,
      state: snapshot.state,
      lastSeen: performance.now(),
    };
    view.mesh.position.copy(view.target);
    scene.add(view.mesh);
    playerViews.set(snapshot.id, view);
  }

  view.target.set(snapshot.x, snapshot.y, snapshot.z);
  view.mesh.rotation.y = snapshot.ry;
  view.hp = snapshot.hp;
  view.state = snapshot.state;
  view.lastSeen = performance.now();
  view.mesh.visible = snapshot.state !== "respawn";
  return view;
}

function connect() {
  if (!location.protocol.startsWith("http")) {
    startOfflineMode("파일로 직접 열었습니다. 네트워크 테스트는 `npm start` 후 http://localhost:8080 으로 접속하세요.");
    return;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  network.connecting = true;
  network.socket = new WebSocket(`${protocol}//${location.host}`);
  showMessage("서버에 접속 중입니다.");

  network.socket.addEventListener("open", () => {
    network.connected = true;
    network.connecting = false;
    network.offline = false;
    showMessage("서버 접속 완료. 다른 브라우저에서 같은 주소를 열면 같이 보입니다.");
  });

  network.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "welcome") {
      network.id = message.id;
      return;
    }
    if (message.type === "snapshot") {
      applySnapshot(message.players);
    }
  });

  network.socket.addEventListener("close", () => {
    network.connected = false;
    network.connecting = false;
    if (!network.offline) {
      startOfflineMode("서버 연결이 끊어졌습니다. 현재 화면은 오프라인 미리보기입니다.");
    }
  });

  network.socket.addEventListener("error", () => {
    network.connected = false;
    if (!network.offline) {
      startOfflineMode("WebSocket 서버가 없습니다. 맥미니에서 `npm start`로 서버를 실행하세요.");
    }
  });
}

function applySnapshot(players) {
  const liveIds = new Set();
  for (const player of players) {
    liveIds.add(player.id);
    ensurePlayerView(player);
  }

  for (const [id, view] of playerViews) {
    if (!liveIds.has(id) && performance.now() - view.lastSeen > 800) {
      scene.remove(view.mesh);
      playerViews.delete(id);
    }
  }
}

function startOfflineMode(text) {
  if (network.offline) return;
  network.offline = true;
  network.id = "offline";
  network.connected = false;
  showMessage(text);
  applySnapshot([
    {
      id: "offline",
      x: 0,
      y: 0,
      z: 10,
      ry: 0,
      hp: 100,
      state: "offline",
      color: "#e9f1f3",
    },
  ]);
}

function updateOfflinePlayer(dt) {
  const view = playerViews.get("offline");
  if (!view) return;

  updateAimDirection();
  const speed = input.attackQueued ? 15 : 8;
  view.target.x += input.moveX * speed * dt;
  view.target.z += input.moveZ * speed * dt;
  view.target.x = THREE.MathUtils.clamp(view.target.x, -world.halfSize + 2, world.halfSize - 2);
  view.target.z = THREE.MathUtils.clamp(view.target.z, -world.halfSize + 2, world.seaStartZ + 12);

  const look = new THREE.Vector3(input.aimX - view.target.x, 0, input.aimZ - view.target.z);
  if (look.lengthSq() > 0.08) {
    view.mesh.rotation.y = Math.atan2(look.x, look.z);
  }

  input.attackQueued = false;
  input.jumpQueued = false;
}

function sendInput(now) {
  if (!network.connected || network.socket.readyState !== WebSocket.OPEN) return;
  if (now - network.lastSend < 33) return;
  network.lastSend = now;

  network.socket.send(
    JSON.stringify({
      type: "input",
      moveX: input.moveX,
      moveZ: input.moveZ,
      jump: input.jumpQueued,
      attack: input.attackQueued,
      aimX: input.aimX,
      aimZ: input.aimZ,
    }),
  );

  input.jumpQueued = false;
  input.attackQueued = false;
}

function updateInputVector() {
  let x = 0;
  let z = 0;
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) z -= 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) z += 1;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) x -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) x += 1;

  const length = Math.hypot(x, z);
  input.moveX = length > 0 ? x / length : 0;
  input.moveZ = length > 0 ? z / length : 0;
}

function updateAimDirection() {
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, aimPoint)) return;

  aimPoint.x = THREE.MathUtils.clamp(aimPoint.x, -world.halfSize + 2, world.halfSize - 2);
  aimPoint.z = THREE.MathUtils.clamp(aimPoint.z, -world.halfSize + 2, world.seaStartZ + 12);

  input.aimX = aimPoint.x;
  input.aimZ = aimPoint.z;
  aimMarker.position.set(aimPoint.x, 0.04, aimPoint.z);
}

function updatePlayerViews(dt) {
  for (const view of playerViews.values()) {
    view.mesh.position.lerp(view.target, 1 - Math.pow(0.0001, dt));
    view.mesh.scale.setScalar(view.state === "bash" ? 1.08 : 1);
  }
}

function updateCamera(dt) {
  const local = playerViews.get(network.id) ?? playerViews.values().next().value;
  if (!local) return;

  const target = local.mesh.position.clone().add(new THREE.Vector3(0, 3.6, 0));
  const desired = local.mesh.position.clone().add(new THREE.Vector3(0, 12, 18));
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(target);
}

function updateHud() {
  const local = playerViews.get(network.id);
  hpEl.textContent = `HP ${Math.round(local?.hp ?? 100)}`;
  stateEl.textContent = (local?.state ?? "WAIT").toUpperCase();
  netEl.textContent = network.connected ? "ONLINE" : network.offline ? "OFFLINE" : "CONNECT";
  countEl.textContent = `${playerViews.size}명`;
}

function updateWorldVisuals() {
  const sea = scene.getObjectByName("sea");
  if (sea) sea.position.y = -0.2 + Math.sin(performance.now() * 0.0012) * 0.06;
  materials.aim.opacity = network.connected || network.offline ? 0.95 : 0.35;
}

function showMessage(text) {
  messageEl.textContent = text;
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const now = performance.now();

  updateInputVector();
  updateAimDirection();
  sendInput(now);
  if (network.offline) updateOfflinePlayer(dt);
  updatePlayerViews(dt);
  updateCamera(dt);
  updateWorldVisuals();
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);

window.addEventListener("keydown", (event) => {
  input.keys.add(event.code);
  if (event.code === "Space") {
    input.jumpQueued = true;
    event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  input.keys.delete(event.code);
});

window.addEventListener("mousedown", (event) => {
  if (event.button === 0) input.attackQueued = true;
});

window.addEventListener("mousemove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

createMap();
resize();
connect();
tick();
