import * as THREE from "three";
import { createPreloader } from "./preloader.js";
import { createPlayer } from "./player.js";
import { createWeaponSystem } from "./weapon.js";
import { createWorld } from "./world.js";
import { createEnemies } from "./enemies.js";
import { createHud } from "./hud.js";
import { createSounds } from "./sounds.js";
import { createImpactParticles } from "./impactParticles.js";
import { createBulletHoles } from "./bulletHoles.js";

const KILL_REWARD = 100;
const HEADSHOT_REWARD = 100;

export function bootGame({ GAME_CONFIG, GAME_ASSETS }) {
const CONFIG = {
  ...GAME_CONFIG,
  playerHeight: 1.75,
  gravity: 25,
  jumpPower: 10,
  playerSpeed: 8.5,
  groundAcceleration: 55,
  airAcceleration: 12,
  friction: 14,
  airFriction: 0.4,
  stopSpeed: 1.2,
  walkMultiplier: 0.55,
  mouseSensitivity: 0.0022,
  dragSensitivity: 0.006,
  enemyAttackCooldown: 900,
  arenaSize: 42,
  fallY: -50
};

const state = {
  health: 100,
  score: 0,
  wave: 1,
  enemiesLeft: 0,
  waveScore: 0,
  waveTargetScore: 0,
  enemyLimit: 0,
  isPlaying: false,
  isGameOver: false,
  isWaveComplete: false,
  isBuyMenuOpen: false
};

const preloader = createPreloader();
let bootLoadingActive = true;

THREE.DefaultLoadingManager.onStart = () => {
  if (!bootLoadingActive) return;
  preloader.show();
  preloader.setProgress(0);
};

THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  if (!bootLoadingActive || !itemsTotal) return;

  const progress = (itemsLoaded / itemsTotal) * 100;
  preloader.setProgress(progress);
};

THREE.DefaultLoadingManager.onLoad = () => {
  if (!bootLoadingActive) return;
  preloader.setProgress(100);
};

THREE.DefaultLoadingManager.onError = url => {
  console.warn("Asset failed to load:", url);
};

const sounds = createSounds();

const dom = {
  overlay: document.getElementById("overlay"),
  startButton: document.getElementById("startButton"),
  panel: document.getElementById("panel"),
  panelTitle: document.querySelector("#panel h1"),
  panelText: document.querySelector("#panel p"),
  damageFlash: document.getElementById("damageFlash"),
  moreGamesButton: null
};

const clock = new THREE.Clock();
const scene = new THREE.Scene();
const weaponScene = new THREE.Scene();

scene.background = new THREE.Color(0x87a7c7);
scene.fog = new THREE.Fog(0x87a7c7, 22, 75);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 20000);
const defaultFov = 75;
let isZooming = false;
camera.position.set(0, CONFIG.playerHeight, 8);
scene.add(camera);

const weaponCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.001, 100);
weaponScene.add(weaponCamera);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);

const hud = createHud();
hud.setBuyCallback(handleBuyMenuSlot);
hud.setBuyCloseCallback(() => closeBuyMenu(true));
const world = createWorld({ THREE, scene, worldConfig: GAME_ASSETS.world });
const player = createPlayer({ THREE, camera, config: CONFIG, colliders: world.colliders });
let enemies = null;

const weapon = createWeaponSystem({
  THREE,
  weaponScene,
  weaponCamera,
  playerVelocity: player.velocity,
  weaponSlots: GAME_ASSETS.weaponSlots
});
const impacts = createImpactParticles({ THREE, scene });
const bulletHoles = createBulletHoles({ THREE, scene });

const impactRaycaster = new THREE.Raycaster();

const cameraShake = {
  trauma: 0,
  time: 0,
  posAmp: 0.08,
  rotAmp: 0.035,
  decay: 4.8,
  positionOffset: new THREE.Vector3(),
  rotationOffsetZ: 0,
  deathShakeTime: 0,
  damageShakeTime: 0,
  impulsePos: new THREE.Vector3(),
  impulseRotZ: 0
};

const viewPunch = {
  pitch: 0,
  yaw: 0,
  pitchVelocity: 0,
  yawVelocity: 0,
  pitchKick: 0.008,
  yawKick: 0.003,
  returnSpeed: 30,
  damping: 20
};

boot();

async function boot() {
  setupLights();
  setupInput();
  setupOverlayButtons();

  try {
    await world.ready;
    createEnemySystemIfNeeded();
    await preloadAllAssets();
    await resetGame();
    preloader.setProgress(100);
    bootLoadingActive = false;
    requestAnimationFrame(() => preloader.hide());
    animate();
  } catch (error) {
    console.error("Game failed to initialize:", error);
    bootLoadingActive = false;
    preloader.hide();

    dom.overlay.style.display = "grid";
    dom.panelTitle.textContent = "Loading Error";
    dom.panelText.textContent = "The game could not load correctly. Please refresh the page.";
    dom.startButton.textContent = "Refresh";
    dom.startButton.onclick = () => window.location.reload();
  }
}

function createEnemySystemIfNeeded() {
  if (enemies) return enemies;

  enemies = createEnemies({
    THREE,
    scene,
    camera,
    config: CONFIG,
    state,
    floorObjects: world.floorObjects,
    colliders: world.colliders,
    enemyTypes: GAME_ASSETS.enemies.types,
    defaultEnemyType: GAME_ASSETS.enemies.defaultType
  });

  return enemies;
}

async function preloadAllAssets() {
  const tasks = [];

  if (typeof weapon.preloadAll === "function") {
    tasks.push(weapon.preloadAll());
  }

  if (typeof sounds.preloadAll === "function") {
    tasks.push(sounds.preloadAll());
  }

  if (enemies && typeof enemies.preloadAll === "function") {
    tasks.push(enemies.preloadAll());
  }

  await Promise.all(tasks);
}

function setupLights() {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1.5));

  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  weaponScene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 2.5));

  const weaponLight = new THREE.PointLight(0xffffff, 2.0, 5);
  weaponLight.position.set(0.3, -0.25, 0.5);
  weaponCamera.add(weaponLight);
}

function setupInput() {
  dom.startButton.addEventListener("click", startGame);
  window.addEventListener("resize", onResize);

  document.addEventListener("keydown", e => {
    if (e.code === "KeyB") {
      toggleBuyMenu();
      return;
    }

    if (e.code === "KeyF") {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
      return;
    }

    if (state.isBuyMenuOpen) {
      if (/^Digit[1-9]$/.test(e.code)) handleBuyMenuSlot(Number(e.code.replace("Digit", "")), "weapon");
      if (/^Numpad[1-9]$/.test(e.code)) handleBuyMenuSlot(Number(e.code.replace("Numpad", "")), "weapon");
      if (e.code === "Escape") closeBuyMenu(true);
      return;
    }

    if (/^Digit[1-9]$/.test(e.code)) switchWeapon(Number(e.code.replace("Digit", "")));
    if (/^Numpad[1-9]$/.test(e.code)) switchWeapon(Number(e.code.replace("Numpad", "")));
    if (e.code === "KeyR") reload();
    if (e.code === "Escape") pauseGame();
    player.onKeyDown(e);
  });

  document.addEventListener("keyup", e => player.onKeyUp(e));

  document.addEventListener("wheel", e => {
    if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;
    if (Math.abs(e.deltaY) < 1) return;

    e.preventDefault();
    switchWeaponByWheel(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener("mousedown", e => {
    if (e.button === 2) {
      startZoom();
      return;
    }

    if (e.button !== 0 || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;
    sounds.resume();
    player.onMouseDown(e);
  });

  document.addEventListener("mouseup", e => {
    if (e.button === 2) {
      stopZoom();
      return;
    }

    player.onMouseUp(e);
  });

  document.addEventListener("mousemove", e => player.onMouseMove(e));
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", enableFallbackLook);
  window.addEventListener("blur", () => {
    stopZoom();
    player.clearMovement();
  });
}

function setupOverlayButtons() {
  if (dom.startButton && !dom.startButton.classList.contains("cs-button")) {
    dom.startButton.classList.add("cs-button");
  }

  if (!dom.startButton || document.getElementById("moreGamesButton")) return;

  dom.moreGamesButton = document.createElement("a");
  dom.moreGamesButton.id = "moreGamesButton";
  dom.moreGamesButton.href = `https://g55.co/?utm_source=moreGamesButton&utm_medium=${encodeURIComponent(document.title)}`;
  dom.moreGamesButton.textContent = "More Games";
  dom.moreGamesButton.className = "cs-button";
  dom.moreGamesButton.target = "_blank";
  dom.moreGamesButton.rel = "noopener";
  dom.startButton.insertAdjacentElement("afterend", dom.moreGamesButton);
}

async function startGame() {
  sounds.resume();

  if (state.isWaveComplete) {
    continueWave();
    return;
  }

  if (state.isGameOver) await resetGame();

  state.isPlaying = true;
  dom.overlay.style.display = "none";
  document.body.classList.remove("fallback-look");

  player.lockCursor();
}

function pauseGame() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

  stopZoom();
  state.isPlaying = false;
  player.clearMovement();
  document.body.classList.remove("cursor-locked", "fallback-look");

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  dom.overlay.style.display = "grid";
  dom.panelTitle.textContent = "Paused";
  dom.panelText.textContent = "Click continue to lock the cursor again.";
  dom.startButton.textContent = "Continue";
}

function toggleBuyMenu() {
  if (state.isGameOver || state.isWaveComplete) return;

  if (state.isBuyMenuOpen) {
    closeBuyMenu(true);
  } else {
    openBuyMenu();
  }
}

function openBuyMenu() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete) return;

  stopZoom();
  state.isPlaying = false;
  state.isBuyMenuOpen = true;

  player.clearMovement();

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  document.body.classList.remove("cursor-locked", "fallback-look");

  updateBuyMenu();
  hud.showBuyMenu();
}

function closeBuyMenu(resumeGame = false) {
  if (!state.isBuyMenuOpen) return;

  state.isBuyMenuOpen = false;
  hud.hideBuyMenu();

  if (!resumeGame || state.isGameOver || state.isWaveComplete) return;

  state.isPlaying = true;
  player.lockCursor();
}

function updateBuyMenu() {
  if (!hud.updateBuyMenu || !weapon.getShopState) return;
  hud.updateBuyMenu({
    score: state.score,
    weapons: weapon.getShopState()
  });
}

function handleBuyMenuSlot(slotNumber, type = "weapon") {
  if (!weapon.getShopState) return;

  const slot = weapon.getShopState().find(item => item.id === slotNumber);
  if (!slot) return;

  if (type === "ammo") {
    if (!slot.owned || slot.isMelee) return;
    if (state.score < slot.ammoPrice) {
      updateBuyMenu();
      return;
    }

    const result = weapon.buyAmmo(slotNumber);
    if (!result.ok) return;

    state.score -= result.price;
    playBuyMenuWeaponSound();
    updateHud();
    updateBuyMenu();
    return;
  }

  if (slot.owned) {
    if (weapon.switchSlot(slotNumber)) {
      stopZoom();
      playBuyMenuWeaponSound();
      updateHud();
      updateBuyMenu();
      closeBuyMenu(true);
    }
    return;
  }

  if (state.score < slot.price) {
    updateBuyMenu();
    return;
  }

  const result = weapon.buySlot(slotNumber);
  if (!result.ok) return;

  state.score -= slot.price;
  weapon.switchSlot(slotNumber);
  stopZoom();
  playBuyMenuWeaponSound();

  updateHud();
  updateBuyMenu();
  closeBuyMenu(true);
}

function playBuyMenuWeaponSound() {
  sounds.resume();
  sounds.playReload();
}

function getWaveEnemyLimit() {
  const wave = CONFIG.wave;

  return Math.min(wave.baseEnemies + state.wave * wave.enemiesPerWave, wave.maxEnemies);
}

function getKillScore({ headshot = false } = {}) {
  return KILL_REWARD + (headshot ? HEADSHOT_REWARD : 0);
}

function shouldInstantKillHeadshot(hit) {
  return Boolean(hit?.headshot);
}

function startWave() {
  if (!enemies) return;

  state.waveScore = 0;
  state.waveTargetScore = getWaveEnemyLimit();
  state.enemyLimit = getWaveEnemyLimit();

  enemies.reset();
  enemies.spawnWave(state.wave);
  updateHud();
}

function refillActiveEnemies() {
  if (!enemies || typeof enemies.spawnOne !== "function") return;

  while (enemies.count < state.enemyLimit) {
    if (!enemies.spawnOne(state.wave)) break;
  }
}

function handleEnemyKilled({ headshot = false } = {}) {
  const points = getKillScore({ headshot });

  if (headshot) hud.showHeadshot();

  state.score += points;
  state.waveScore += 1;

  if (state.waveScore >= state.waveTargetScore) {
    enemies.reset();
    showWaveComplete();
    return true;
  }

  return false;
}

function showWaveComplete() {
  stopZoom();
  state.isPlaying = false;
  state.isWaveComplete = true;

  player.clearMovement();

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  document.body.classList.remove("cursor-locked", "fallback-look");

  updateHud();

  dom.overlay.style.display = "grid";
  dom.panelTitle.textContent = `Wave ${state.wave} Complete`;
  dom.panelText.textContent = `Continue to start wave ${state.wave + 1}`;
  dom.startButton.textContent = "Continue";
}

function continueWave() {
  if (!enemies) return;

  state.isWaveComplete = false;
  state.wave += 1;

  startWave();

  state.isPlaying = true;
  dom.overlay.style.display = "none";
  document.body.classList.remove("fallback-look");

  player.lockCursor();
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === document.body;

  player.setPointerLockActive(locked);
  document.body.classList.toggle("cursor-locked", locked);

  if (!locked && state.isPlaying && !state.isGameOver && !state.isWaveComplete && !state.isBuyMenuOpen && player.pointerLockSupported) {
    pauseGame();
  }

}

function enableFallbackLook() {
  player.enableFallbackLook();
  document.body.classList.remove("cursor-locked");
  document.body.classList.add("fallback-look");
}

function startZoom() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

  const asset = weapon.getCurrentAsset();
  if (!asset.behavior.isSniper) return;

  isZooming = true;
  const zoomFov = asset.behavior.zoomFov ?? 10;
  camera.fov = zoomFov;
  camera.updateProjectionMatrix();
  hud.showScope();
}

function stopZoom() {
  if (!isZooming) {
    hud.hideScope();
    return;
  }

  isZooming = false;
  camera.fov = defaultFov;
  camera.updateProjectionMatrix();
  hud.hideScope();
}

function switchWeapon(slotNumber) {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

  const slot = weapon.getShopState().find(item => item.id === slotNumber);

  if (slot && !slot.owned) return;

  if (weapon.switchSlot(slotNumber)) {
    stopZoom();
    updateHud();
    playBuyMenuWeaponSound();
  }
}

function switchWeaponByWheel(direction) {
  if (!weapon.getShopState) return;

  const slots = weapon.getShopState();
  const ownedSlots = slots.filter(slot => slot.owned);
  if (ownedSlots.length <= 1) return;

  const currentIndex = ownedSlots.findIndex(slot => slot.active);
  if (currentIndex === -1) return;

  const nextIndex = (currentIndex + direction + ownedSlots.length) % ownedSlots.length;
  switchWeapon(ownedSlots[nextIndex].id);
}

function updateHud() {
  state.enemiesLeft = enemies ? enemies.count : 0;
  hud.update({ ...state, ...weapon.getHudState() });
  updateBuyMenu();
}

function shoot() {
  if (!enemies || state.isWaveComplete || state.isBuyMenuOpen) return;

  const shot = weapon.shoot();

  if (!shot.ok) {
    if (shot.reason === "empty") {
      sounds.playEmpty();
      reload();
    }
    return;
  }

  addViewPunch();
  sounds.playShoot(weapon.getCurrentAsset());
  if (!shot.isMelee && shot.ammo === 0) reload();

  if (shot.isMelee) {
    handleMeleeHit(shot);
    updateHud();
    return;
  }

  if (!isZooming) hud.setCrosshairFire();

  const pelletCount = Math.max(1, shot.pellets ?? 1);
  let enemyWasHit = false;

  for (let i = 0; i < pelletCount; i++) {
    const direction = getShotDirection(shot.spread);

    spawnTracer(direction);

    const hit = getBulletHit(direction);

    if (hit?.type === "enemy") {
      const headshot = Boolean(hit.headshot);
      const killed = enemies.damageEnemy(hit.enemy, shot.damage, {
        instantKill: shouldInstantKillHeadshot(hit),
        headshot
      });

      impacts.spawnBlood(hit.point, hit.normal.clone().multiplyScalar(-1));
      enemyWasHit = true;

      if (killed) {
        sounds.playEnemyDie();

        if (handleEnemyKilled({ headshot })) break;
      }
    } else if (hit?.type === "surface") {
      impacts.spawnSurface(hit.point, hit.normal);
      bulletHoles.spawn(hit.point, hit.normal);
    }
  }

  if (!state.isWaveComplete) refillActiveEnemies();

  if (enemyWasHit) {
    sounds.playEnemyHit();
  }

  updateHud();
}

function handleMeleeHit(shot) {
  if (!enemies) return;

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  impactRaycaster.set(camera.position, direction);
  impactRaycaster.near = 0;
  impactRaycaster.far = shot.range ?? 2;

  const enemyHit = enemies.getHit(impactRaycaster);
  const surfaceHit = getSurfaceImpact();

  if (enemyHit && surfaceHit && surfaceHit.distance < enemyHit.distance) {
    impacts.spawnSurface(surfaceHit.point, surfaceHit.normal);
    resetImpactRaycasterRange();
    return;
  }

  if (!enemyHit) {
    if (surfaceHit) impacts.spawnSurface(surfaceHit.point, surfaceHit.normal);
    resetImpactRaycasterRange();
    return;
  }

  const killed = enemies.damageEnemy(enemyHit.enemy, shot.damage);

  impacts.spawnBlood(enemyHit.point, enemyHit.normal.clone().multiplyScalar(-1));
  sounds.playEnemyHit();

  if (killed) {
    sounds.playEnemyDie();
    handleEnemyKilled();
    if (!state.isWaveComplete) refillActiveEnemies();
  }

  resetImpactRaycasterRange();
}

function resetImpactRaycasterRange() {
  impactRaycaster.near = 0;
  impactRaycaster.far = Infinity;
}

function getShotDirection(spread) {
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  camera.getWorldDirection(direction);
  right.crossVectors(direction, up).normalize();
  up.crossVectors(right, direction).normalize();

  if (spread > 0) {
    const spreadX = (Math.random() - 0.5) * spread;
    const spreadY = (Math.random() - 0.5) * spread;

    direction
      .addScaledVector(right, spreadX)
      .addScaledVector(up, spreadY)
      .normalize();
  }

  return direction;
}

function reload() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete) return;

  const result = weapon.reload();
  if (!result.started) return;

  sounds.playReload();
  updateHud();

  setTimeout(() => updateHud(), result.duration);
}

function getBulletHit(direction) {
  impactRaycaster.set(camera.position, direction);
  resetImpactRaycasterRange();

  const enemyHit = enemies ? enemies.getHit(impactRaycaster) : null;
  const surfaceHit = getSurfaceImpact();

  if (enemyHit && surfaceHit) {
    return enemyHit.distance <= surfaceHit.distance ? enemyHit : surfaceHit;
  }

  return enemyHit || surfaceHit || null;
}

function getSurfaceImpact() {
  const hits = impactRaycaster.intersectObjects(world.colliders, true);
  if (!hits.length) return null;

  const hit = hits[0];

  return {
    type: "surface",
    point: hit.point,
    normal: hit.face?.normal?.clone()?.transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0),
    distance: hit.distance
  };
}

function spawnTracer(direction) {
  const start = camera.position.clone().add(direction.clone().multiplyScalar(0.8));
  const end = camera.position.clone().add(direction.clone().multiplyScalar(28));
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({
    color: 0xfff2a0,
    transparent: true,
    opacity: 0.85
  });

  const line = new THREE.Line(geometry, material);
  line.userData.life = 0.06;

  scene.add(line);
  world.tracers.push(line);
}

function updateTracers(delta) {
  for (let i = world.tracers.length - 1; i >= 0; i--) {
    const tracer = world.tracers[i];

    tracer.userData.life -= delta;
    tracer.material.opacity = Math.max(0, tracer.userData.life / 0.06);

    if (tracer.userData.life <= 0) {
      scene.remove(tracer);
      tracer.geometry.dispose();
      tracer.material.dispose();
      world.tracers.splice(i, 1);
    }
  }
}

function recoverPlayerFall() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;
  if (camera.position.y > CONFIG.fallY) return;

  player.clearMovement();
  player.velocity.set(0, 0, 0);
  world.resetPlayer(player);
}

function takeDamage(amount) {
  if (state.isGameOver || state.isWaveComplete) return;

  state.health = Math.max(0, state.health - amount);

  cameraShake.damageShakeTime = 0.14;
  cameraShake.impulsePos.set(
    (Math.random() - 0.5) * 0.08,
    (Math.random() - 0.5) * 0.055,
    (Math.random() - 0.5) * 0.035
  );
  cameraShake.impulseRotZ = (Math.random() - 0.5) * 0.035;

  viewPunch.pitchVelocity += 0.045;
  viewPunch.yawVelocity += (Math.random() - 0.5) * 0.035;

  if (state.health <= 0) {
    endGame();
    updateHud();
    return;
  }

  dom.damageFlash.style.transition = "opacity 0.12s ease";
  dom.damageFlash.style.background = "rgba(255, 0, 0, 0.35)";
  dom.damageFlash.style.opacity = "1";
  setTimeout(() => {
    if (!state.isGameOver && !state.isWaveComplete) dom.damageFlash.style.opacity = "0";
  }, 120);

  sounds.playPlayerHit();
  updateHud();
}

function endGame() {
  stopZoom();
  state.isGameOver = true;
  state.isPlaying = false;
  state.isWaveComplete = false;

  player.clearMovement();

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  document.body.classList.remove("cursor-locked", "fallback-look");

  viewPunch.pitchVelocity += 0.18;
  viewPunch.yawVelocity += (Math.random() - 0.5) * 0.12;

  cameraShake.impulsePos.set(
    (Math.random() - 0.5) * 0.12,
    (Math.random() - 0.5) * 0.08,
    (Math.random() - 0.5) * 0.06
  );
  cameraShake.impulseRotZ = (Math.random() - 0.5) * 0.05;
  cameraShake.deathShakeTime = 0.2;

  dom.damageFlash.style.display = "block";
  dom.damageFlash.style.position = "fixed";
  dom.damageFlash.style.left = "0";
  dom.damageFlash.style.top = "0";
  dom.damageFlash.style.width = "100vw";
  dom.damageFlash.style.height = "100vh";
  dom.damageFlash.style.pointerEvents = "none";
  dom.damageFlash.style.zIndex = "2";
  dom.damageFlash.style.transition = "opacity 1.0s ease";
  dom.damageFlash.style.background = "rgba(160, 0, 0, 0.45)";
  dom.damageFlash.style.opacity = "0";

  requestAnimationFrame(() => {
    dom.damageFlash.style.opacity = "1";
  });

  sounds.playPlayerDie();

  setTimeout(() => {
    dom.overlay.style.display = "grid";
    dom.panelTitle.textContent = "Game Over";
    dom.panelText.textContent = `Wave reached: ${state.wave}`;
    dom.startButton.textContent = "Restart";
  }, 650);
}

async function resetGame() {
  state.health = 100;
  state.score = 0;
  state.wave = 1;
  state.waveScore = 0;
  state.waveTargetScore = 0;
  state.enemyLimit = 0;
  state.isGameOver = false;
  state.isWaveComplete = false;
  state.isBuyMenuOpen = false;
  hud.hideBuyMenu();

  cameraShake.trauma = 0;
  cameraShake.posAmp = 0.08;
  cameraShake.rotAmp = 0.035;
  cameraShake.decay = 4.8;
  cameraShake.deathShakeTime = 0;
  dom.damageFlash.style.transition = "opacity 0.12s ease";
  dom.damageFlash.style.background = "rgba(255, 0, 0, 0.35)";
  dom.damageFlash.style.opacity = "0";

  stopZoom();

  await world.ready;
  world.resetPlayer(player);

  createEnemySystemIfNeeded();

  startWave();
  weapon.resetSlots();
  impacts.clear();
  bulletHoles.clear();
  weapon.play("idle");

  updateHud();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  weaponCamera.aspect = window.innerWidth / window.innerHeight;
  weaponCamera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function addViewPunch() {
  viewPunch.pitchVelocity += viewPunch.pitchKick;
  viewPunch.yawVelocity += (Math.random() - 0.5) * viewPunch.yawKick;
}

function updateViewPunch(delta) {
  viewPunch.pitchVelocity += -viewPunch.pitch * viewPunch.returnSpeed * delta;
  viewPunch.yawVelocity += -viewPunch.yaw * viewPunch.returnSpeed * delta;

  viewPunch.pitchVelocity *= Math.exp(-viewPunch.damping * delta);
  viewPunch.yawVelocity *= Math.exp(-viewPunch.damping * delta);

  viewPunch.pitch += viewPunch.pitchVelocity;
  viewPunch.yaw += viewPunch.yawVelocity;
}

function updateCameraShake(delta) {
  cameraShake.time += delta;

  if (cameraShake.deathShakeTime > 0) {
    cameraShake.deathShakeTime = Math.max(0, cameraShake.deathShakeTime - delta);

    const decay = Math.exp(-20 * delta);
    cameraShake.impulsePos.multiplyScalar(decay);
    cameraShake.impulseRotZ *= decay;

    cameraShake.positionOffset.copy(cameraShake.impulsePos);
    cameraShake.rotationOffsetZ = cameraShake.impulseRotZ;
    return;
  }

  if (cameraShake.damageShakeTime > 0) {
    cameraShake.damageShakeTime = Math.max(0, cameraShake.damageShakeTime - delta);

    const decay = Math.exp(-28 * delta);
    cameraShake.impulsePos.multiplyScalar(decay);
    cameraShake.impulseRotZ *= decay;

    cameraShake.positionOffset.copy(cameraShake.impulsePos);
    cameraShake.rotationOffsetZ = cameraShake.impulseRotZ;
    return;
  }

  cameraShake.positionOffset.set(0, 0, 0);
  cameraShake.rotationOffsetZ = 0;
}

function renderWithCameraShake() {
  camera.position.add(cameraShake.positionOffset);
  camera.rotation.x += viewPunch.pitch;
  camera.rotation.y += viewPunch.yaw;
  camera.rotation.z += cameraShake.rotationOffsetZ;

  renderer.clear();
  renderer.render(scene, camera);
  if (!isZooming) {
    renderer.clearDepth();
    renderer.render(weaponScene, weaponCamera);
  }

  camera.rotation.z -= cameraShake.rotationOffsetZ;
  camera.rotation.y -= viewPunch.yaw;
  camera.rotation.x -= viewPunch.pitch;
  camera.position.sub(cameraShake.positionOffset);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  player.update(delta, state.isPlaying);
  recoverPlayerFall();

  if (state.isPlaying && player.inputState.jumped) {
    sounds.playJump();
  }

  if (state.isPlaying && player.inputState.footstep) {
    sounds.playFootstep(player.inputState.walking, player.inputState.speed01);
  }

  if (state.isPlaying && !state.isGameOver && !state.isWaveComplete && player.inputState.mouseDown) {
    shoot();
  }

  if (enemies) {
    enemies.update(delta, state.isPlaying, takeDamage);
  }

  weapon.update(delta, state.isPlaying, player.inputState);
  updateTracers(delta);
  impacts.update(delta);
  bulletHoles.update(delta);
  updateViewPunch(delta);
  updateCameraShake(delta);
  renderWithCameraShake();
}
}
