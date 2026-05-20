import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#scene");
const hpEl = document.querySelector("#hp");
const stateEl = document.querySelector("#state");
const messageEl = document.querySelector("#message");

const world = {
  gravity: 28,
  groundY: 0,
  halfSize: 58,
  seaStartZ: 22,
};

const input = {
  keys: new Set(),
  mouseX: 0,
  mouseY: 0,
  attackQueued: false,
};

const player = {
  mesh: null,
  velocity: new THREE.Vector3(),
  direction: new THREE.Vector3(0, 0, -1),
  hp: 100,
  radius: 1,
  attackTimer: 0,
  attackCooldown: 0,
  respawnTimer: 0,
  grounded: true,
};

const enemies = [];
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();
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
  player: new THREE.MeshStandardMaterial({ color: 0xe9f1f3, roughness: 0.7 }),
  playerHead: new THREE.MeshStandardMaterial({ color: 0x22343a, roughness: 0.65 }),
  enemy: new THREE.MeshStandardMaterial({ color: 0xd9583f, roughness: 0.8 }),
  enemyHead: new THREE.MeshStandardMaterial({ color: 0x3a1712, roughness: 0.8 }),
  attack: new THREE.MeshStandardMaterial({
    color: 0xfff0a8,
    roughness: 0.4,
    emissive: 0x886c1b,
    emissiveIntensity: 0.25,
  }),
};

const aimMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.55, 0.74, 24),
  new THREE.MeshBasicMaterial({
    color: 0xfff0a8,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  }),
);
aimMarker.rotation.x = -Math.PI / 2;
aimMarker.position.set(0, 0.035, 6);
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
    mountain.rotation.y = Math.random() * Math.PI;
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    scene.add(mountain);
  }

  const borderMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d5146,
    roughness: 1,
  });
  const wallGeometry = new THREE.BoxGeometry(1, 3, world.halfSize * 2);
  const frontBackGeometry = new THREE.BoxGeometry(world.halfSize * 2, 3, 1);

  for (const x of [-world.halfSize, world.halfSize]) {
    const wall = new THREE.Mesh(wallGeometry, borderMaterial);
    wall.position.set(x, 1, 0);
    wall.receiveShadow = true;
    scene.add(wall);
  }

  for (const z of [-world.halfSize, world.halfSize]) {
    const wall = new THREE.Mesh(frontBackGeometry, borderMaterial);
    wall.position.set(0, 1, z);
    wall.receiveShadow = true;
    scene.add(wall);
  }
}

function createCharacter(bodyMaterial, headMaterial) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.3, 1.15), bodyMaterial);
  body.position.y = 1.25;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 1), headMaterial);
  head.position.y = 3.05;
  head.position.z = -0.06;
  head.castShadow = true;
  group.add(head);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.25, 0.24), headMaterial);
  nose.position.set(0, 3.05, -0.6);
  nose.castShadow = true;
  group.add(nose);

  return group;
}

function createPlayer() {
  player.mesh = createCharacter(materials.player, materials.playerHead);
  player.mesh.position.set(0, 0, 10);
  scene.add(player.mesh);
}

function createEnemies() {
  const starts = [
    [-12, 3],
    [12, -7],
    [23, 8],
    [-25, -8],
  ];

  starts.forEach(([x, z], index) => {
    const mesh = createCharacter(materials.enemy, materials.enemyHead);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    enemies.push({
      id: index,
      mesh,
      velocity: new THREE.Vector3(),
      target: randomGroundPoint(),
      hp: 60,
      radius: 1,
      attackTimer: 0,
      attackCooldown: 0.4 + Math.random(),
      retargetTimer: 1 + Math.random() * 2,
      respawnTimer: 0,
    });
  });
}

function randomGroundPoint() {
  return new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(76),
    0,
    THREE.MathUtils.randFloat(-38, 16),
  );
}

function getMoveVector() {
  const move = new THREE.Vector3();
  if (input.keys.has("KeyW") || input.keys.has("ArrowUp")) move.z -= 1;
  if (input.keys.has("KeyS") || input.keys.has("ArrowDown")) move.z += 1;
  if (input.keys.has("KeyA") || input.keys.has("ArrowLeft")) move.x -= 1;
  if (input.keys.has("KeyD") || input.keys.has("ArrowRight")) move.x += 1;
  return move.lengthSq() > 0 ? move.normalize() : move;
}

function startAttack(actor, speed, duration, cooldown) {
  if (actor.attackCooldown > 0 || actor.respawnTimer > 0) return;
  actor.attackTimer = duration;
  actor.attackCooldown = cooldown;
  actor.velocity.x += actor.direction.x * speed;
  actor.velocity.z += actor.direction.z * speed;
}

function updatePlayer(dt) {
  if (player.respawnTimer > 0) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) respawnPlayer();
    return;
  }

  const move = getMoveVector();
  const accel = player.grounded ? 55 : 24;
  player.velocity.x += move.x * accel * dt;
  player.velocity.z += move.z * accel * dt;

  updateAimDirection();

  if (input.keys.has("Space") && player.grounded) {
    player.velocity.y = 10.4;
    player.grounded = false;
  }

  if (input.attackQueued) {
    startAttack(player, 17, 0.24, 0.72);
    input.attackQueued = false;
  }

  integrateActor(player, dt, 7.8);
  updateAttackTimers(player, dt);
}

function updateAimDirection() {
  raycaster.setFromCamera(pointer, camera);

  if (!raycaster.ray.intersectPlane(groundPlane, aimPoint)) return;

  aimPoint.x = THREE.MathUtils.clamp(
    aimPoint.x,
    -world.halfSize + 2,
    world.halfSize - 2,
  );
  aimPoint.z = THREE.MathUtils.clamp(
    aimPoint.z,
    -world.halfSize + 2,
    world.seaStartZ + 12,
  );

  aimMarker.position.set(aimPoint.x, 0.04, aimPoint.z);

  const look = aimPoint.clone().sub(player.mesh.position);
  look.y = 0;
  if (look.lengthSq() > 0.08) {
    player.direction.copy(look.normalize());
    player.mesh.rotation.y = Math.atan2(player.direction.x, player.direction.z);
  }
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    if (enemy.respawnTimer > 0) {
      enemy.respawnTimer -= dt;
      enemy.mesh.visible = Math.floor(enemy.respawnTimer * 8) % 2 === 0;
      if (enemy.respawnTimer <= 0) {
        enemy.mesh.visible = true;
        enemy.hp = 60;
        enemy.mesh.position.copy(randomGroundPoint());
      }
      continue;
    }

    enemy.retargetTimer -= dt;
    const toPlayer = player.mesh.position.clone().sub(enemy.mesh.position);
    const playerDistance = toPlayer.length();

    if (playerDistance < 13 && player.respawnTimer <= 0) {
      enemy.target.copy(player.mesh.position);
    } else if (enemy.retargetTimer <= 0 || enemy.mesh.position.distanceTo(enemy.target) < 2) {
      enemy.target.copy(randomGroundPoint());
      enemy.retargetTimer = 1.4 + Math.random() * 2.6;
    }

    const desired = enemy.target.clone().sub(enemy.mesh.position);
    desired.y = 0;
    if (desired.lengthSq() > 0.001) {
      desired.normalize();
      enemy.direction = desired;
      enemy.velocity.x += desired.x * 25 * dt;
      enemy.velocity.z += desired.z * 25 * dt;
      enemy.mesh.rotation.y = Math.atan2(desired.x, desired.z);
    }

    if (playerDistance < 5.5 && enemy.attackCooldown <= 0 && player.respawnTimer <= 0) {
      enemy.direction = toPlayer.setY(0).normalize();
      startAttack(enemy, 12, 0.22, 1.35);
    }

    integrateActor(enemy, dt, 5.1);
    updateAttackTimers(enemy, dt);
  }
}

function integrateActor(actor, dt, maxPlanarSpeed) {
  actor.velocity.y -= world.gravity * dt;

  const planarSpeed = Math.hypot(actor.velocity.x, actor.velocity.z);
  if (planarSpeed > maxPlanarSpeed && actor.attackTimer <= 0) {
    const scale = maxPlanarSpeed / planarSpeed;
    actor.velocity.x *= scale;
    actor.velocity.z *= scale;
  }

  actor.mesh.position.addScaledVector(actor.velocity, dt);
  actor.velocity.x *= Math.pow(0.0008, dt);
  actor.velocity.z *= Math.pow(0.0008, dt);

  if (actor.mesh.position.y <= world.groundY) {
    actor.mesh.position.y = world.groundY;
    actor.velocity.y = Math.max(0, actor.velocity.y);
    actor.grounded = true;
  }

  actor.mesh.position.x = THREE.MathUtils.clamp(
    actor.mesh.position.x,
    -world.halfSize + 2,
    world.halfSize - 2,
  );
  actor.mesh.position.z = THREE.MathUtils.clamp(
    actor.mesh.position.z,
    -world.halfSize + 2,
    world.seaStartZ + 12,
  );
}

function updateAttackTimers(actor, dt) {
  actor.attackTimer = Math.max(0, actor.attackTimer - dt);
  actor.attackCooldown = Math.max(0, actor.attackCooldown - dt);
}

function solveCollisions() {
  for (const enemy of enemies) {
    if (enemy.respawnTimer > 0 || player.respawnTimer > 0) continue;

    const delta = enemy.mesh.position.clone().sub(player.mesh.position);
    delta.y = 0;
    const distance = delta.length();
    const minDistance = player.radius + enemy.radius;

    if (distance > 0.001 && distance < minDistance) {
      const normal = delta.multiplyScalar(1 / distance);
      const overlap = minDistance - distance;
      enemy.mesh.position.addScaledVector(normal, overlap * 0.55);
      player.mesh.position.addScaledVector(normal, -overlap * 0.45);

      if (player.attackTimer > 0) damageEnemy(enemy, normal);
      if (enemy.attackTimer > 0) damagePlayer(normal.clone().multiplyScalar(-1));
    }
  }
}

function damageEnemy(enemy, normal) {
  if (enemy.hitLock > 0) return;
  enemy.hp -= 24;
  enemy.hitLock = 0.45;
  enemy.velocity.addScaledVector(normal, 13);
  enemy.velocity.y = 5.2;

  if (enemy.hp <= 0) {
    enemy.respawnTimer = 1.8;
    enemy.velocity.set(0, 0, 0);
  }
}

function damagePlayer(normal) {
  if (player.hitLock > 0) return;
  player.hp -= 14;
  player.hitLock = 0.55;
  player.velocity.addScaledVector(normal, 11);
  player.velocity.y = Math.max(player.velocity.y, 4.5);

  if (player.hp <= 0) {
    player.hp = 0;
    player.respawnTimer = 2;
    player.velocity.set(0, 0, 0);
    showMessage("쓰러졌습니다. 곧 시작 위치에서 다시 등장합니다.");
  }
}

function updateHitLocks(dt) {
  player.hitLock = Math.max(0, (player.hitLock ?? 0) - dt);
  for (const enemy of enemies) {
    enemy.hitLock = Math.max(0, (enemy.hitLock ?? 0) - dt);
  }
}

function respawnPlayer() {
  player.hp = 100;
  player.mesh.position.set(0, 0, 10);
  player.velocity.set(0, 0, 0);
  player.attackTimer = 0;
  player.attackCooldown = 0;
  showMessage("다시 등장했습니다.");
}

function updateCamera(dt) {
  const target = player.mesh.position.clone().add(new THREE.Vector3(0, 3.6, 0));
  const desired = player.mesh.position
    .clone()
    .add(new THREE.Vector3(0, 12, 18));
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  camera.lookAt(target);
}

function updateHud() {
  hpEl.textContent = `HP ${Math.round(player.hp)}`;

  if (player.respawnTimer > 0) {
    stateEl.textContent = "RESPAWN";
  } else if (player.attackTimer > 0) {
    stateEl.textContent = "BASH";
  } else if (player.attackCooldown > 0) {
    stateEl.textContent = "COOLDOWN";
  } else {
    stateEl.textContent = "READY";
  }
}

function updateVisuals(dt) {
  const pulse = player.attackTimer > 0 ? 1 + Math.sin(performance.now() * 0.035) * 0.045 : 1;
  player.mesh.scale.setScalar(pulse);
  aimMarker.material.opacity = player.attackCooldown > 0 ? 0.45 : 0.95;

  for (const enemy of enemies) {
    const attacking = enemy.attackTimer > 0 ? 1.08 : 1;
    enemy.mesh.scale.setScalar(attacking);
  }

  const sea = scene.children.find(
    (child) => child.isMesh && child.material === materials.sea,
  );
  if (sea) sea.position.y = -0.2 + Math.sin(performance.now() * 0.0012) * 0.06;

  updateHitLocks(dt);
}

function showMessage(text) {
  messageEl.textContent = text;
}

function resize() {
  const { innerWidth, innerHeight } = window;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  updatePlayer(dt);
  updateEnemies(dt);
  solveCollisions();
  updateCamera(dt);
  updateVisuals(dt);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);

window.addEventListener("keydown", (event) => {
  input.keys.add(event.code);
  if (event.code === "Space") event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  input.keys.delete(event.code);
});

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  input.attackQueued = true;
});

window.addEventListener("mousemove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
});

createMap();
createPlayer();
createEnemies();
resize();
tick();
