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

const sniperBulletCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 1000);
const sniperBulletCam = {
  active: false,
  phase: "idle",
  shot: null,
  hit: null,
  projectile: null,
  trail: null,
  trailPositions: null,
  origin: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  position: new THREE.Vector3(),
  cameraPosition: new THREE.Vector3(),
  lookTarget: new THREE.Vector3(),
  right: new THREE.Vector3(),
  orbitUp: new THREE.Vector3(),
  cameraUp: new THREE.Vector3(),
  impactPoint: new THREE.Vector3(),
  speed: 65,
  distance: 0,
  traveled: 0,
  chaseDistance: 0.9,
  chaseHeight: 0.18,
  sideOffset: 0.16,
  lookAhead: 2.5,
  trailLength: 1.8,

  // Flight camera.
  fovStart: 46,
  fovFlight: 55,
  fovImpact: 36,
  headshotFovImpact: 32,
  orbitAngle: 0,
  orbitSpeed: 0.45,
  orbitRadius: 0.22,
  orbitHeight: 0.08,
  maxRoll: 0.05,

  // Impact camera / slow motion.
  impactTimer: 0,
  impactDuration: 0,
  impactHold: 0.08,
  impactAngle: 0,
  impactDistance: 1.75,
  impactOrbitSpeed: 0.7,
  impactOrbitRadius: 0.5,
  impactOrbitHeight: 0.12,
  enemyImpact: false,
  enemyHitSlowMoScale: 0.18,
  enemyHitSlowMoDuration: 1.0
};
const sniperBulletAxis = new THREE.Vector3(0, 1, 0);
const sniperBulletWorldUp = new THREE.Vector3(0, 1, 0);
const sniperBulletRollQuat = new THREE.Quaternion();

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

  document.addEventListener("mousemove", e => {
    if (sniperBulletCam.active) return;
    player.onMouseMove(e);
  });
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

  cancelSniperBulletCamera();
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
  if (sniperBulletCam.active || state.isGameOver || state.isWaveComplete) return;

  if (state.isBuyMenuOpen) {
    closeBuyMenu(true);
  } else {
    openBuyMenu();
  }
}

function openBuyMenu() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete) return;

  cancelSniperBulletCamera();
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

  if (headshot) {
    hud.showHeadshot();
    sounds.playHeadshot();
  }

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
  cancelSniperBulletCamera();
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
  if (sniperBulletCam.active || !state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

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
  if (sniperBulletCam.active || !state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

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
  if (!enemies || state.isWaveComplete || state.isBuyMenuOpen || sniperBulletCam.active) return;

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

  // Sniper bullet camera is scoped-only. Unscoped sniper shots stay hitscan.
  // Scoped shots use a delayed projectile/cinematic camera when there is
  // enough travel distance. The hit is resolved only when the bullet arrives.
  if (shot.isSniper && isZooming && pelletCount === 1) {
    const direction = getShotDirection(shot.spread);
    const bulletConfig = weapon.getCurrentAsset().bulletCamera ?? {};
    const maxDistance = Math.max(1, Number(bulletConfig.maxDistance) || 140);
    const hit = getBulletHit(direction, maxDistance);

    if (startSniperBulletCamera(shot, direction, hit, bulletConfig)) {
      updateHud();
      return;
    }

    spawnTracer(direction);
    const result = resolveBulletImpact(shot, hit);

    if (!state.isWaveComplete) refillActiveEnemies();
    if (result.enemyWasHit) sounds.playEnemyHit();
    updateHud();
    return;
  }

  let enemyWasHit = false;

  for (let i = 0; i < pelletCount; i++) {
    const direction = getShotDirection(shot.spread);

    spawnTracer(direction);

    const hit = getBulletHit(direction);
    const result = resolveBulletImpact(shot, hit);
    enemyWasHit ||= result.enemyWasHit;

    if (result.waveComplete) break;
  }

  if (!state.isWaveComplete) refillActiveEnemies();

  if (enemyWasHit) {
    sounds.playEnemyHit();
  }

  updateHud();
}

function resolveBulletImpact(shot, hit) {
  if (hit?.type === "enemy") {
    const headshot = Boolean(hit.headshot);
    const killed = enemies.damageEnemy(hit.enemy, shot.damage, {
      instantKill: shouldInstantKillHeadshot(hit),
      headshot
    });

    impacts.spawnBlood(hit.point, hit.normal.clone().multiplyScalar(-1));

    if (killed) {
      sounds.playEnemyDie();
      return {
        enemyWasHit: true,
        waveComplete: handleEnemyKilled({ headshot })
      };
    }

    return { enemyWasHit: true, waveComplete: false };
  }

  if (hit?.type === "surface") {
    impacts.spawnSurface(hit.point, hit.normal);
    bulletHoles.spawn(hit.point, hit.normal);
  }

  return { enemyWasHit: false, waveComplete: false };
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
  if (sniperBulletCam.active || !state.isPlaying || state.isGameOver || state.isWaveComplete) return;

  const result = weapon.reload();
  if (!result.started) return;

  sounds.playReload();
  updateHud();

  setTimeout(() => updateHud(), result.duration);
}

function getBulletHit(direction, maxDistance = Infinity) {
  impactRaycaster.set(camera.position, direction);
  impactRaycaster.near = 0;
  impactRaycaster.far = Number.isFinite(maxDistance) ? maxDistance : Infinity;

  const enemyHit = enemies ? enemies.getHit(impactRaycaster) : null;
  const surfaceHit = getSurfaceImpact();

  let result = null;

  if (enemyHit && surfaceHit) {
    result = enemyHit.distance <= surfaceHit.distance ? enemyHit : surfaceHit;
  } else {
    result = enemyHit || surfaceHit || null;
  }

  resetImpactRaycasterRange();
  return result;
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

function startSniperBulletCamera(shot, direction, hit, config = {}) {
  if (config.enabled === false || !hit) return false;

  const minDistance = Math.max(0, Number(config.minDistance) || 6);
  if (hit.distance < minDistance) return false;

  ensureSniperBulletVisuals();

  sniperBulletCam.active = true;
  sniperBulletCam.phase = "flight";
  sniperBulletCam.shot = shot;
  sniperBulletCam.hit = hit;
  sniperBulletCam.speed = Math.max(1, Number(config.speed) || 65);
  sniperBulletCam.distance = hit.distance;
  sniperBulletCam.traveled = Math.min(0.8, hit.distance * 0.08);
  sniperBulletCam.chaseDistance = Math.max(0.15, Number(config.chaseDistance) || 0.9);
  sniperBulletCam.chaseHeight = Number(config.chaseHeight) || 0.18;
  sniperBulletCam.sideOffset = Number(config.sideOffset) || 0.16;
  sniperBulletCam.lookAhead = Math.max(0.25, Number(config.lookAhead) || 2.5);
  sniperBulletCam.trailLength = Math.max(0.1, Number(config.trailLength) || 1.8);

  sniperBulletCam.fovStart = clampSniperFov(config.fovStart, 46);
  sniperBulletCam.fovFlight = clampSniperFov(config.fovFlight, 55);
  sniperBulletCam.fovImpact = clampSniperFov(config.fovImpact, 36);
  sniperBulletCam.headshotFovImpact = clampSniperFov(config.headshotFovImpact, 32);
  sniperBulletCam.orbitAngle = 0;
  sniperBulletCam.orbitSpeed = Math.max(0, Number(config.orbitSpeed) || 0.45);
  sniperBulletCam.orbitRadius = Math.max(0, Number(config.orbitRadius) || 0.22);
  sniperBulletCam.orbitHeight = Math.max(0, Number(config.orbitHeight) || 0.08);
  sniperBulletCam.maxRoll = Math.max(0, Math.min(0.18, Number(config.maxRoll) || 0.05));

  sniperBulletCam.impactHold = Math.max(0, Number(config.impactHold) || 0.08);
  sniperBulletCam.impactDistance = Math.max(0.75, Number(config.impactDistance) || 1.75);
  sniperBulletCam.impactOrbitSpeed = Math.max(0, Number(config.impactOrbitSpeed) || 0.7);
  sniperBulletCam.impactOrbitRadius = Math.max(0, Number(config.impactOrbitRadius) || 0.5);
  sniperBulletCam.impactOrbitHeight = Math.max(0, Number(config.impactOrbitHeight) || 0.12);
  sniperBulletCam.enemyHitSlowMoScale = Math.max(0.03, Math.min(1, Number(config.enemyHitSlowMoScale) || 0.18));
  sniperBulletCam.enemyHitSlowMoDuration = Math.max(0, Number(config.enemyHitSlowMoDuration) || 1.0);
  sniperBulletCam.enemyImpact = false;
  sniperBulletCam.impactTimer = 0;
  sniperBulletCam.impactDuration = 0;
  sniperBulletCam.impactAngle = 0;

  sniperBulletCam.origin.copy(camera.position);
  sniperBulletCam.direction.copy(direction).normalize();
  sniperBulletCam.position
    .copy(sniperBulletCam.origin)
    .addScaledVector(sniperBulletCam.direction, sniperBulletCam.traveled);

  sniperBulletCam.projectile.visible = true;
  sniperBulletCam.trail.visible = true;
  sniperBulletCam.projectile.position.copy(sniperBulletCam.position);
  sniperBulletCam.projectile.quaternion.setFromUnitVectors(sniperBulletAxis, sniperBulletCam.direction);

  sniperBulletCamera.fov = sniperBulletCam.fovStart;
  sniperBulletCamera.updateProjectionMatrix();

  positionSniperBulletCamera(true);
  updateSniperBulletTrail();
  hud.hideScope();

  return true;
}

function clampSniperFov(value, fallback) {
  const parsed = Number(value);
  return Math.max(20, Math.min(90, Number.isFinite(parsed) ? parsed : fallback));
}

function ensureSniperBulletVisuals() {
  if (sniperBulletCam.projectile) return;

  const geometry = new THREE.CylinderGeometry(0.028, 0.028, 0.22, 8, 1, false);
  const material = new THREE.MeshBasicMaterial({ color: 0xffd36a });
  const projectile = new THREE.Mesh(geometry, material);
  projectile.name = "SniperBulletProjectile";
  projectile.frustumCulled = false;
  projectile.visible = false;
  scene.add(projectile);

  const trailPositions = new Float32Array(6);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));

  const trailMaterial = new THREE.LineBasicMaterial({
    color: 0xffefb0,
    transparent: true,
    opacity: 0.75,
    depthWrite: false
  });

  const trail = new THREE.Line(trailGeometry, trailMaterial);
  trail.name = "SniperBulletTrail";
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);

  sniperBulletCam.projectile = projectile;
  sniperBulletCam.trail = trail;
  sniperBulletCam.trailPositions = trailPositions;
}

function updateSniperBulletCamera(delta) {
  if (!sniperBulletCam.active) return;

  if (sniperBulletCam.phase === "impact") {
    updateSniperImpactCamera(delta);
    sniperBulletCam.impactTimer -= delta;

    if (sniperBulletCam.impactTimer <= 0) {
      finishSniperBulletCamera();
    }

    return;
  }

  sniperBulletCam.traveled = Math.min(
    sniperBulletCam.distance,
    sniperBulletCam.traveled + sniperBulletCam.speed * delta
  );

  sniperBulletCam.position
    .copy(sniperBulletCam.origin)
    .addScaledVector(sniperBulletCam.direction, sniperBulletCam.traveled);

  if (sniperBulletCam.traveled >= sniperBulletCam.distance - 0.0001 && sniperBulletCam.hit?.point) {
    sniperBulletCam.position.copy(sniperBulletCam.hit.point);
  }

  sniperBulletCam.projectile.position.copy(sniperBulletCam.position);
  updateSniperBulletTrail();
  positionSniperBulletCamera(false, delta);

  if (sniperBulletCam.traveled < sniperBulletCam.distance - 0.0001) return;

  // Hide the cinematic projectile immediately on impact while keeping the
  // camera active for the impact/slow-motion hold.
  if (sniperBulletCam.projectile) sniperBulletCam.projectile.visible = false;
  if (sniperBulletCam.trail) sniperBulletCam.trail.visible = false;

  const result = resolveBulletImpact(sniperBulletCam.shot, sniperBulletCam.hit);

  if (!state.isWaveComplete) refillActiveEnemies();
  if (result.enemyWasHit) sounds.playEnemyHit();
  updateHud();

  sniperBulletCam.phase = "impact";
  sniperBulletCam.enemyImpact = Boolean(result.enemyWasHit);
  sniperBulletCam.impactDuration = sniperBulletCam.enemyImpact
    ? Math.max(sniperBulletCam.impactHold, sniperBulletCam.enemyHitSlowMoDuration)
    : sniperBulletCam.impactHold;
  sniperBulletCam.impactTimer = sniperBulletCam.impactDuration;
  sniperBulletCam.impactAngle = sniperBulletCam.orbitAngle;
  sniperBulletCam.impactPoint.copy(sniperBulletCam.hit?.point ?? sniperBulletCam.position);

  if (sniperBulletCam.impactTimer <= 0) {
    finishSniperBulletCamera();
  }
}

function updateSniperEnemyImpactSlowMotion(delta) {
  if (
    !sniperBulletCam.active ||
    sniperBulletCam.phase !== "impact" ||
    !sniperBulletCam.enemyImpact
  ) {
    return;
  }

  const enemy = sniperBulletCam.hit?.enemy;
  if (!enemy?.userData) return;

  const slowDelta = delta * sniperBulletCam.enemyHitSlowMoScale;

  // Advance only the struck enemy's animation while normal gameplay stays frozen.
  // This creates the impact slow-motion effect without running enemy AI/movement.
  if (enemy.userData.mixer) {
    enemy.userData.mixer.update(slowDelta);
  }

  // Keep animation-state timers roughly synchronized with the slowed mixer.
  if (enemy.userData.isDying && Number.isFinite(enemy.userData.deathTimer)) {
    enemy.userData.deathTimer = Math.max(0, enemy.userData.deathTimer - slowDelta);
  } else if (enemy.userData.isHitReacting && Number.isFinite(enemy.userData.hitTimer)) {
    enemy.userData.hitTimer = Math.max(0, enemy.userData.hitTimer - slowDelta);
  }
}

function positionSniperBulletCamera(immediate = false, delta = 0) {
  buildSniperCameraBasis();

  if (!immediate) {
    sniperBulletCam.orbitAngle += delta * sniperBulletCam.orbitSpeed;
  }

  const orbitSide = Math.cos(sniperBulletCam.orbitAngle) * sniperBulletCam.orbitRadius;
  const orbitLift = Math.sin(sniperBulletCam.orbitAngle) * sniperBulletCam.orbitHeight;

  sniperBulletCam.cameraPosition
    .copy(sniperBulletCam.position)
    .addScaledVector(sniperBulletCam.direction, -sniperBulletCam.chaseDistance)
    .addScaledVector(sniperBulletCam.orbitUp, sniperBulletCam.chaseHeight + orbitLift)
    .addScaledVector(sniperBulletCam.right, sniperBulletCam.sideOffset + orbitSide);

  if (immediate) {
    sniperBulletCamera.position.copy(sniperBulletCam.cameraPosition);
  } else {
    const blend = 1 - Math.exp(-12 * Math.max(delta, 0));
    sniperBulletCamera.position.lerp(sniperBulletCam.cameraPosition, blend);
  }

  sniperBulletCam.lookTarget
    .copy(sniperBulletCam.position)
    .addScaledVector(sniperBulletCam.direction, sniperBulletCam.lookAhead);

  const roll = Math.sin(sniperBulletCam.orbitAngle) * sniperBulletCam.maxRoll;
  sniperBulletRollQuat.setFromAxisAngle(sniperBulletCam.direction, roll);
  sniperBulletCam.cameraUp.copy(sniperBulletCam.orbitUp).applyQuaternion(sniperBulletRollQuat).normalize();

  sniperBulletCamera.up.copy(sniperBulletCam.cameraUp);
  sniperBulletCamera.lookAt(sniperBulletCam.lookTarget);

  updateSniperFlightFov(delta, immediate);
}

function buildSniperCameraBasis() {
  sniperBulletCam.right.crossVectors(sniperBulletCam.direction, sniperBulletWorldUp);

  if (sniperBulletCam.right.lengthSq() < 0.0001) {
    sniperBulletCam.right.set(1, 0, 0);
  } else {
    sniperBulletCam.right.normalize();
  }

  sniperBulletCam.orbitUp.crossVectors(sniperBulletCam.right, sniperBulletCam.direction);

  if (sniperBulletCam.orbitUp.lengthSq() < 0.0001) {
    sniperBulletCam.orbitUp.copy(sniperBulletWorldUp);
  } else {
    sniperBulletCam.orbitUp.normalize();
  }
}

function updateSniperFlightFov(delta, immediate = false) {
  const progress = sniperBulletCam.distance > 0
    ? THREE.MathUtils.clamp(sniperBulletCam.traveled / sniperBulletCam.distance, 0, 1)
    : 1;

  let targetFov;

  if (progress < 0.7) {
    targetFov = THREE.MathUtils.lerp(
      sniperBulletCam.fovStart,
      sniperBulletCam.fovFlight,
      progress / 0.7
    );
  } else {
    targetFov = THREE.MathUtils.lerp(
      sniperBulletCam.fovFlight,
      sniperBulletCam.fovImpact,
      (progress - 0.7) / 0.3
    );
  }

  const nextFov = immediate
    ? targetFov
    : THREE.MathUtils.lerp(
        sniperBulletCamera.fov,
        targetFov,
        1 - Math.exp(-8 * Math.max(delta, 0))
      );

  if (Math.abs(nextFov - sniperBulletCamera.fov) > 0.01) {
    sniperBulletCamera.fov = nextFov;
    sniperBulletCamera.updateProjectionMatrix();
  }
}

function updateSniperImpactCamera(delta) {
  buildSniperCameraBasis();

  const duration = Math.max(0.0001, sniperBulletCam.impactDuration);
  const progress = THREE.MathUtils.clamp(
    1 - sniperBulletCam.impactTimer / duration,
    0,
    1
  );
  const eased = progress * progress * (3 - 2 * progress);

  sniperBulletCam.impactAngle += delta * sniperBulletCam.impactOrbitSpeed;

  // Pull the camera back on impact instead of pushing it into the enemy.
  const impactDistance = THREE.MathUtils.lerp(
    sniperBulletCam.chaseDistance,
    sniperBulletCam.impactDistance,
    0.35 + 0.65 * eased
  );
  const orbitRadius = sniperBulletCam.impactOrbitRadius * (0.75 + 0.25 * eased);
  const orbitSide = Math.cos(sniperBulletCam.impactAngle) * orbitRadius;
  const orbitLift = Math.sin(sniperBulletCam.impactAngle) * sniperBulletCam.impactOrbitHeight;

  sniperBulletCam.cameraPosition
    .copy(sniperBulletCam.impactPoint)
    .addScaledVector(sniperBulletCam.direction, -impactDistance)
    .addScaledVector(sniperBulletCam.orbitUp, sniperBulletCam.chaseHeight + orbitLift)
    .addScaledVector(sniperBulletCam.right, orbitSide);

  const blend = 1 - Math.exp(-7 * Math.max(delta, 0));
  sniperBulletCamera.position.lerp(sniperBulletCam.cameraPosition, blend);

  sniperBulletCam.lookTarget.copy(sniperBulletCam.impactPoint);

  const roll = Math.sin(sniperBulletCam.impactAngle) * sniperBulletCam.maxRoll * 0.45;
  sniperBulletRollQuat.setFromAxisAngle(sniperBulletCam.direction, roll);
  sniperBulletCam.cameraUp.copy(sniperBulletCam.orbitUp).applyQuaternion(sniperBulletRollQuat).normalize();

  sniperBulletCamera.up.copy(sniperBulletCam.cameraUp);
  sniperBulletCamera.lookAt(sniperBulletCam.lookTarget);

  const impactFov = sniperBulletCam.hit?.headshot
    ? sniperBulletCam.headshotFovImpact
    : sniperBulletCam.fovImpact;
  const targetFov = THREE.MathUtils.lerp(sniperBulletCam.fovImpact, impactFov, eased);
  const nextFov = THREE.MathUtils.lerp(
    sniperBulletCamera.fov,
    targetFov,
    1 - Math.exp(-7 * Math.max(delta, 0))
  );

  if (Math.abs(nextFov - sniperBulletCamera.fov) > 0.01) {
    sniperBulletCamera.fov = nextFov;
    sniperBulletCamera.updateProjectionMatrix();
  }
}

function updateSniperBulletTrail() {
  if (!sniperBulletCam.trailPositions || !sniperBulletCam.trail) return;

  const tailX = sniperBulletCam.position.x - sniperBulletCam.direction.x * sniperBulletCam.trailLength;
  const tailY = sniperBulletCam.position.y - sniperBulletCam.direction.y * sniperBulletCam.trailLength;
  const tailZ = sniperBulletCam.position.z - sniperBulletCam.direction.z * sniperBulletCam.trailLength;
  const positions = sniperBulletCam.trailPositions;

  positions[0] = tailX;
  positions[1] = tailY;
  positions[2] = tailZ;
  positions[3] = sniperBulletCam.position.x;
  positions[4] = sniperBulletCam.position.y;
  positions[5] = sniperBulletCam.position.z;

  sniperBulletCam.trail.geometry.attributes.position.needsUpdate = true;
}

function finishSniperBulletCamera() {
  if (!sniperBulletCam.active) return;

  sniperBulletCam.active = false;
  sniperBulletCam.phase = "idle";
  sniperBulletCam.shot = null;
  sniperBulletCam.hit = null;
  sniperBulletCam.impactTimer = 0;
  sniperBulletCam.impactDuration = 0;
  sniperBulletCam.enemyImpact = false;

  if (sniperBulletCam.projectile) sniperBulletCam.projectile.visible = false;
  if (sniperBulletCam.trail) sniperBulletCam.trail.visible = false;

  if (isZooming) hud.showScope();
}

function cancelSniperBulletCamera() {
  if (!sniperBulletCam.active) return;

  sniperBulletCam.active = false;
  sniperBulletCam.phase = "idle";
  sniperBulletCam.shot = null;
  sniperBulletCam.hit = null;
  sniperBulletCam.impactTimer = 0;
  sniperBulletCam.impactDuration = 0;
  sniperBulletCam.enemyImpact = false;

  if (sniperBulletCam.projectile) sniperBulletCam.projectile.visible = false;
  if (sniperBulletCam.trail) sniperBulletCam.trail.visible = false;
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
  cancelSniperBulletCamera();
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

  cancelSniperBulletCamera();
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

  sniperBulletCamera.aspect = window.innerWidth / window.innerHeight;
  sniperBulletCamera.updateProjectionMatrix();

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
  if (sniperBulletCam.active) {
    renderer.clear();
    renderer.render(scene, sniperBulletCamera);
    return;
  }

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
  const gameplayActive = state.isPlaying && !sniperBulletCam.active;

  player.update(delta, gameplayActive);
  recoverPlayerFall();

  if (state.isPlaying && player.inputState.jumped) {
    sounds.playJump();
  }

  if (state.isPlaying && player.inputState.footstep) {
    sounds.playFootstep(player.inputState.walking, player.inputState.speed01);
  }

  if (gameplayActive && !state.isGameOver && !state.isWaveComplete && player.inputState.mouseDown) {
    shoot();
  }

  if (enemies) {
    enemies.update(delta, gameplayActive, takeDamage);
  }

  weapon.update(delta, state.isPlaying, player.inputState);
  updateSniperBulletCamera(delta);
  updateSniperEnemyImpactSlowMotion(delta);

  const impactTimeScale = (
    sniperBulletCam.active &&
    sniperBulletCam.phase === "impact" &&
    sniperBulletCam.enemyImpact
  ) ? sniperBulletCam.enemyHitSlowMoScale : 1;

  updateTracers(delta);
  impacts.update(delta * impactTimeScale);
  bulletHoles.update(delta);
  updateViewPunch(delta);
  updateCameraShake(delta);
  renderWithCameraShake();
}
}
