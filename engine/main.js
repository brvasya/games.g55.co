import * as THREE from "three";
import { createPlayer } from "./player.js";
import { createTouchControls } from "./touchControls.js";
import { renderGameTitle, controlsText, focusMenu, clearMenuSelection, trapDialogFocus } from "./ui.js";
import { createWeaponSystem } from "./weapon.js";
import { createProjectiles } from "./projectiles.js";
import { createWorld } from "./world.js";
import { createEnemies } from "./enemies.js";
import { createHud } from "./hud.js";
import { createSounds } from "./sounds.js";
import { createImpactParticles } from "./impactParticles.js";
import { createBulletHoles } from "./bulletHoles.js";

const KILL_REWARD = 100;
const HEADSHOT_REWARD = 100;

function createLoadingButtonController() {
  const button = document.getElementById("startButton");
  let progress = 0;

  function setProgress(value) {
    progress = Math.max(progress, Math.max(0, Math.min(100, Math.round(value))));
    button.disabled = true;
    button.dataset.loading = "true";
    button.setAttribute("aria-busy", "true");
    button.style.setProperty("--load-progress", `${progress}%`);
    button.textContent = `Loading ${progress}%`;
  }

  function hide() {
    button.disabled = false;
    delete button.dataset.loading;
    button.removeAttribute("aria-busy");
    button.style.removeProperty("--load-progress");
    button.textContent = "Start Game";
  }

  function show() {
    setProgress(progress);
  }

  show();
  return { setProgress, hide, show };
}

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
  touchLookSensitivity: 0.72,
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

const loadingButton = createLoadingButtonController();
let bootLoadingActive = true;
let bootReady = false;
let startPending = false;
let mainMenuNeedsReset = false;
let gameOverOverlayTimer = null;
let noticeTimer = null;
let lastWheelSwitch = -Infinity;

THREE.DefaultLoadingManager.onStart = () => {
  if (!bootLoadingActive) return;
  loadingButton.show();
  loadingButton.setProgress(0);
};

THREE.DefaultLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  if (!bootLoadingActive || !itemsTotal) return;

  const progress = (itemsLoaded / itemsTotal) * 100;
  loadingButton.setProgress(progress);
};

THREE.DefaultLoadingManager.onLoad = () => {
  if (!bootLoadingActive) return;
  loadingButton.setProgress(100);
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
  mainMenuButton: document.getElementById("mainMenuButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  uiStatus: document.getElementById("uiStatus"),
  moreGamesButton: null
};

const clock = new THREE.Clock();
const scene = new THREE.Scene();
const weaponScene = new THREE.Scene();
// Keep the authored view-model framing, but place its geometry at the player
// in world meters so light distance, direction, and shadow sampling are correct.
const weaponWorldScale = 0.0254;
const weaponRoot = new THREE.Group();
weaponRoot.name = "FirstPersonWorldAnchor";
weaponRoot.scale.setScalar(weaponWorldScale);
weaponScene.add(weaponRoot);
const weaponLightLinks = [];

scene.background = new THREE.Color(0x87a7c7);
scene.fog = new THREE.Fog(0x87a7c7, 22, 75);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 20000);
const defaultFov = 75;
let isZooming = false;
camera.position.set(0, CONFIG.playerHeight, 8);
scene.add(camera);

const weaponCamera = new THREE.PerspectiveCamera(
  70, window.innerWidth / window.innerHeight,
  0.001 * weaponWorldScale, 100 * weaponWorldScale
);
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
const player = createPlayer({ THREE, camera, config: CONFIG, colliders: world.colliders,
  onFallbackLook: () => {
    document.body.classList.add("fallback-look");
    if (state.isPlaying) showNotice("Mouse capture unavailable. Hold left mouse and drag to aim and fire.");
  }
});
let enemies = null;

const weapon = createWeaponSystem({
  THREE,
  weaponScene: weaponRoot,
  worldScene: scene,
  weaponCamera,
  playerVelocity: player.velocity,
  weaponSlots: GAME_ASSETS.weaponSlots,
  onStateChange: () => updateHud()
});
const touchControls = createTouchControls({
  isActive: () => state.isPlaying && !state.isGameOver && !state.isWaveComplete && !state.isBuyMenuOpen && !sniperBulletCam.active,
  setMove: (x, y) => player.setTouchMove(x, y),
  setFire: active => {
    player.setFiring(active);
    if (active) {
      sounds.resume();
      // A quick tap must fire even when down/up arrive between render frames.
      shoot();
    }
  },
  look: (x, y) => {
    const zoomScale = isZooming ? Math.max(0.12, Math.tan(camera.fov * Math.PI / 360) / Math.tan(defaultFov * Math.PI / 360)) : 1;
    player.addLookDelta(x, y, CONFIG.touchLookSensitivity * zoomScale);
  },
  jump: () => player.queueJump(),
  reload: () => reload(),
  toggleScope: () => {
    if (weapon.hasScope()) {
      isZooming ? stopZoom() : startZoom();
      return;
    }
    if (weapon.hasFlashlightAttachment()) weapon.setFlashlight(!weapon.isFlashlightActive());
  },
  clearScope: () => stopSecondaryAction(),
  shop: () => { sounds.resume(); toggleBuyMenu(); },
  pause: () => { sounds.resume(); pauseGame(); },
  getWeapons: () => weapon.getShopState(),
  switchWeapon: slot => switchWeapon(slot),
  getStatus: () => {
    const hasScope = weapon.hasScope();
    const canScope = hasScope || weapon.hasFlashlightAttachment();
    return {
      ...weapon.getHudState(),
      canScope,
      scoped: hasScope ? isZooming : weapon.isFlashlightActive(),
      secondaryLabel: hasScope ? "Scope" : "Light"
    };
  }
});

const impacts = createImpactParticles({ THREE, scene, colliders: world.colliders });
const bulletHoles = createBulletHoles({ THREE, scene });
const projectiles = createProjectiles({
  THREE, scene, colliders: world.colliders,
  getEnemyHit: raycaster => enemies ? enemies.getHit(raycaster) : null,
  onExplode: handleProjectileExplosion
});

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
  renderer.render(scene, camera);

  try {
    await world.ready;
    createEnemySystemIfNeeded();
    await preloadAllAssets();
    await resetGame();
    loadingButton.setProgress(100);
    bootLoadingActive = false;
    bootReady = true;
    requestAnimationFrame(() => { loadingButton.hide(); focusMenu(dom.overlay); });
    animate();
  } catch (error) {
    console.error("Game failed to initialize:", error);
    bootLoadingActive = false;
    loadingButton.hide();

    showOverlay("Loading Error", "The game could not load. Check your connection and try again.", "Retry");
    dom.mainMenuButton.hidden = true;
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
    navigation: world.navigation,
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
  const lighting = world.lighting || {};
  scene.add(new THREE.HemisphereLight(
    lighting.hemisphereSky ?? 0xffffff,
    lighting.hemisphereGround ?? 0xffffff,
    lighting.hemisphereIntensity ?? 1.5
  ));

  const sun = new THREE.DirectionalLight(lighting.sunColor ?? 0xffffff, lighting.sunIntensity ?? 1.5);
  sun.position.set(...(lighting.sunPosition || [10, 18, 8]));
  sun.shadow.camera.left = -56;
  sun.shadow.camera.right = 56;
  sun.shadow.camera.top = 56;
  sun.shadow.camera.bottom = -56;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.06;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // The separate pass keeps weapons clear of nearby walls. Its lights mirror
  // the world, including the animated fire and police lights, instead of using
  // a permanent white light attached to the camera.
  scene.traverse(source => {
    if (!source.isLight) return;
    const light = source.clone(false);
    light.name = "ViewModel_" + (source.name || source.type);
    if (light.shadow) {
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = false;
    }
    weaponScene.add(light);
    if (light.target) weaponScene.add(light.target);
    weaponLightLinks.push({ source, light });
  });
}

function syncWeaponWorldAnchor() {
  camera.getWorldPosition(weaponCamera.position);
  camera.getWorldQuaternion(weaponCamera.quaternion);
  weaponRoot.position.copy(weaponCamera.position);
  weaponRoot.quaternion.copy(weaponCamera.quaternion);
  weaponRoot.updateMatrixWorld(true);
  weaponCamera.updateMatrixWorld(true);
}

function syncWeaponWorldLighting() {
  syncWeaponWorldAnchor();
  weaponScene.environment = scene.environment;

  for (const { source, light } of weaponLightLinks) {
    light.color.copy(source.color);
    light.intensity = source.intensity;
    light.visible = true;
    for (let parent = source; parent; parent = parent.parent) {
      if (!parent.visible) { light.visible = false; break; }
    }
    source.getWorldPosition(light.position);
    source.getWorldQuaternion(light.quaternion);
    if (source.groundColor) light.groundColor.copy(source.groundColor);
    for (const property of ["distance", "decay", "angle", "penumbra"]) {
      if (property in source) light[property] = source[property];
    }
    if (source.target) {
      source.target.getWorldPosition(light.target.position);
      light.target.updateMatrixWorld(true);
    }
    // The world has just rendered, so reuse its current shadow texture. Do not
    // render a second shadow pass containing only the view-model: that would
    // erase the building shadows. The source light owns this shared texture.
    light.castShadow = Boolean(source.castShadow && source.shadow?.map);
    if (light.castShadow) {
      light.shadow.map = source.shadow.map;
      light.shadow.matrix.copy(source.shadow.matrix);
      light.shadow.mapSize.copy(source.shadow.mapSize);
      light.shadow.bias = source.shadow.bias;
      light.shadow.normalBias = source.shadow.normalBias;
      light.shadow.radius = source.shadow.radius;
      light.shadow.camera.near = source.shadow.camera.near;
      light.shadow.camera.far = source.shadow.camera.far;
    }
  }
}

function setupInput() {
  document.addEventListener("pointerdown", clearMenuSelection, true);
  dom.startButton.addEventListener("click", startGame);
  dom.mainMenuButton.addEventListener("click", returnToMainMenu);
  dom.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => {
    dom.fullscreenButton.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  });
  dom.fullscreenButton.hidden = typeof document.documentElement.requestFullscreen !== "function";
  window.addEventListener("resize", onResize);

  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyF") {
      e.preventDefault();
      if (!e.repeat) toggleFullscreen();
      return;
    }
    if (state.isBuyMenuOpen) {
      trapDialogFocus(document.getElementById("buyMenu"), e);
      if (e.repeat) return;
      if (/^(Digit|Numpad)[1-6]$/.test(e.code)) {
        e.preventDefault();
        handleBuyMenuSlot(Number(e.code.slice(-1)), "weapon");
      }
      if (e.code === "Escape" || e.code === "KeyB") { e.preventDefault(); closeBuyMenu(true); }
      return;
    }
    if (!state.isPlaying) {
      trapDialogFocus(dom.overlay, e);
      return;
    }
    if (e.code === "Escape" || e.code === "Tab") {
      e.preventDefault();
      if (!e.repeat) {
        pauseGame();
        if (e.code === "Tab") trapDialogFocus(dom.overlay, e);
      }
      return;
    }
    if (e.code === "KeyB") { e.preventDefault(); if (!e.repeat) toggleBuyMenu(); return; }
    if (sniperBulletCam.active || isTouchPortrait() || touchControls.isPickerOpen) return;
    if (/^(Digit|Numpad)[1-6]$/.test(e.code)) { e.preventDefault(); if (!e.repeat) switchWeapon(Number(e.code.slice(-1))); }
    if (e.code === "KeyR") { e.preventDefault(); if (!e.repeat) reload(); }
    player.onKeyDown(e);
  });

  document.addEventListener("keyup", e => player.onKeyUp(e));

  document.addEventListener("wheel", e => {
    if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;
    if (Math.abs(e.deltaY) < 1) return;

    e.preventDefault();
    if (sniperBulletCam.active || touchControls.isPickerOpen || performance.now() - lastWheelSwitch < 140) return;
    lastWheelSwitch = performance.now();
    switchWeaponByWheel(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener("mousedown", e => {
    if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen || sniperBulletCam.active || touchControls.isPickerOpen || isTouchPortrait()) return;
    if (e.target.closest?.("button, a, #overlay, #buyMenu, #touchControls")) return;
    if (e.button === 2) { e.preventDefault(); startSecondaryAction(); return; }
    if (e.button !== 0) return;
    sounds.resume();
    player.onMouseDown(e);
    shoot();
  });

  document.addEventListener("mouseup", e => {
    if (e.button === 2) {
      endSecondaryAction();
      return;
    }

    player.onMouseUp(e);
  });

  document.addEventListener("mousemove", e => {
    if (!state.isPlaying || sniperBulletCam.active || touchControls.isPickerOpen || isTouchPortrait()) return;
    const zoomScale = isZooming ? Math.max(0.12, Math.tan(camera.fov * Math.PI / 360) / Math.tan(defaultFov * Math.PI / 360)) : 1;
    player.onMouseMove(e, zoomScale);
  });
  document.addEventListener("contextmenu", e => e.preventDefault());
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("pointerlockerror", enableFallbackLook);
  const interruptInput = () => {
    stopSecondaryAction();
    player.clearMovement();
    touchControls.reset();
    pauseGame();
  };
  window.addEventListener("blur", interruptInput);
  window.addEventListener("pagehide", interruptInput);
  document.addEventListener("visibilitychange", () => { if (document.hidden) interruptInput(); });
}

function setupOverlayButtons() {
  if (dom.startButton && !dom.startButton.classList.contains("cs-button")) {
    dom.startButton.classList.add("cs-button");
  }

  if (!dom.startButton) return;

  dom.moreGamesButton = document.getElementById("moreGamesButton");
  if (!dom.moreGamesButton) {
    dom.moreGamesButton = document.createElement("a");
    dom.moreGamesButton.id = "moreGamesButton";
    dom.moreGamesButton.textContent = "More Games";
    dom.moreGamesButton.className = "cs-button";
    dom.startButton.insertAdjacentElement("afterend", dom.moreGamesButton);
  }

  dom.moreGamesButton.href = `https://g55.co/?utm_source=moreGamesButton&utm_medium=${encodeURIComponent(document.title)}`;
  dom.moreGamesButton.target = "_blank";
  dom.moreGamesButton.rel = "noopener";
}


function isTouchPortrait() {
  return touchControls.enabled && touchControls.isPortrait();
}

function showNotice(message) {
  clearTimeout(noticeTimer);
  dom.uiStatus.textContent = message;
  dom.uiStatus.classList.add("visible");
  noticeTimer = setTimeout(() => dom.uiStatus.classList.remove("visible"), 4000);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else showNotice("Fullscreen is unavailable in this browser.");
  } catch {
    showNotice("Fullscreen is unavailable here. You can continue in this window.");
  }
}

function showOverlay(title, text, action) {
  document.body.classList.remove("main-menu-active");
  dom.overlay.classList.remove("main-menu");
  dom.overlay.style.display = "grid";
  dom.panelTitle.textContent = title;
  dom.panelText.textContent = text;
  dom.startButton.textContent = action;
  dom.startButton.disabled = false;
  dom.mainMenuButton.hidden = false;
  focusMenu(dom.overlay);
}

function returnToMainMenu() {
  projectiles.clear();
  clearTimeout(gameOverOverlayTimer);
  state.isPlaying = false;
  state.isBuyMenuOpen = false;
  hud.hideBuyMenu();
  player.clearMovement();
  touchControls.reset();
  cancelSniperBulletCamera();
  stopSecondaryAction();
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove("cursor-locked", "fallback-look");
  document.body.classList.add("main-menu-active");
  dom.overlay.classList.add("main-menu");
  dom.overlay.style.display = "grid";
  dom.damageFlash.style.opacity = "0";
  renderGameTitle(dom.panelTitle, CONFIG.gameTitle);
  dom.panelText.textContent = controlsText(touchControls.enabled);
  dom.startButton.textContent = "Start Game";
  dom.mainMenuButton.hidden = true;
  mainMenuNeedsReset = true;
  focusMenu(dom.overlay);
}

async function startGame() {
  if (!bootReady || startPending) return;
  startPending = true;
  dom.startButton.disabled = true;
  sounds.resume();
  try {
    clearMenuSelection();
    player.clearMovement();
    touchControls.reset();
    if (state.isGameOver || mainMenuNeedsReset) {
      await resetGame();
      mainMenuNeedsReset = false;
    }
    if (state.isWaveComplete) { continueWave(); return; }
    state.isPlaying = true;
    dom.overlay.style.display = "none";
    document.body.classList.remove("fallback-look", "main-menu-active");
    dom.overlay.classList.remove("main-menu");
    document.activeElement?.blur();
    if (!touchControls.enabled) player.lockCursor();
  } finally {
    startPending = false;
    dom.startButton.disabled = false;
  }
}

function pauseGame() {
  if (!state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

  cancelSniperBulletCamera();
  stopSecondaryAction();
  state.isPlaying = false;
  player.clearMovement();
  document.body.classList.remove("cursor-locked", "fallback-look");

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  showOverlay("Paused", "Resume when you’re ready. Your progress is kept.", "Resume");
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
  stopSecondaryAction();
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

  player.clearMovement();
  clearMenuSelection();
  state.isPlaying = true;
  document.activeElement?.blur();
  if (!touchControls.enabled) player.lockCursor();
}

function updateBuyMenu() {
  if (!hud.updateBuyMenu || !weapon.getShopState) return;
  hud.updateBuyMenu({
    score: state.score,
    weapons: weapon.getShopState(),
    isReloading: weapon.getHudState().isReloading
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

  if (weapon.getHudState().isReloading && !slot.active) return;

  if (slot.owned) {
    if (slot.active) { closeBuyMenu(true); return; }
    if (weapon.switchSlot(slotNumber)) {
      stopSecondaryAction();
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
  stopSecondaryAction();
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

  projectiles.clear();
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

function handleEnemyKilled({ headshot = false, count = 1 } = {}) {
  const points = getKillScore({ headshot }) * count;

  if (headshot) {
    hud.showHeadshot();
    sounds.playHeadshot();
  }

  state.score += points;
  state.waveScore += count;

  if (state.waveScore >= state.waveTargetScore) {
    enemies.reset();
    showWaveComplete();
    return true;
  }

  return false;
}

function showWaveComplete() {
  projectiles.clear({ effects: false });
  cancelSniperBulletCamera();
  stopSecondaryAction();
  state.isPlaying = false;
  state.isWaveComplete = true;

  player.clearMovement();

  if (document.pointerLockElement === document.body) document.exitPointerLock();

  document.body.classList.remove("cursor-locked", "fallback-look");

  updateHud();

  showOverlay(`Wave ${state.wave} Complete`, `Ready for wave ${state.wave + 1}?`, "Next Wave");
}

function continueWave() {
  if (!enemies) return;

  state.isWaveComplete = false;
  state.wave += 1;

  startWave();

  state.isPlaying = true;
  dom.overlay.style.display = "none";
  document.body.classList.remove("fallback-look");

  if (!touchControls.enabled) player.lockCursor();
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === document.body;
  if (locked && !state.isPlaying) { document.exitPointerLock(); return; }

  player.setPointerLockActive(locked);
  document.body.classList.toggle("cursor-locked", locked);
  if (locked) {
    document.body.classList.remove("fallback-look");
    dom.uiStatus.classList.remove("visible");
  }

  if (!locked && state.isPlaying && !state.isGameOver && !state.isWaveComplete && !state.isBuyMenuOpen && player.pointerLockSupported && !player.fallbackLookEnabled) {
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
  if (!weapon.hasScope()) return;

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

function startSecondaryAction() {
  if (sniperBulletCam.active || !state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return;

  if (weapon.hasScope()) {
    startZoom();
    return;
  }

  if (weapon.hasFlashlightAttachment()) {
    weapon.setFlashlight(!weapon.isFlashlightActive());
  }
}

function stopSecondaryAction() {
  stopZoom();
  weapon.setFlashlight(false);
}

function endSecondaryAction() {
  if (weapon.hasScope()) stopZoom();
}

function switchWeapon(slotNumber) {
  if (sniperBulletCam.active || !state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen) return false;

  const slot = weapon.getShopState().find(item => item.id === slotNumber);

  if (!slot || !slot.owned) return false;

  if (weapon.switchSlot(slotNumber)) {
    stopSecondaryAction();
    updateHud();
    playBuyMenuWeaponSound();
    return true;
  }
  return false;
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
  if (!enemies || !state.isPlaying || state.isGameOver || state.isWaveComplete || state.isBuyMenuOpen || sniperBulletCam.active) return;

  const shot = weapon.shoot();

  if (!shot.ok) {
    if (shot.reason === "empty") {
      sounds.playEmpty();
      reload();
    }
    return;
  }

  const asset = weapon.getCurrentAsset();
  let projectileOrigin = null;
  if (shot.projectile) {
    // Capture the fire pose BEFORE a one-round launcher starts auto-reload.
    syncWeaponWorldAnchor();
    projectileOrigin = weapon.getMuzzleWorldPosition(new THREE.Vector3());
  }
  addViewPunch();
  sounds.playShoot(asset);
  if (!shot.isMelee && shot.ammo === 0) reload();

  if (shot.isMelee) {
    handleMeleeHit(shot);
    updateHud();
    return;
  }

  if (!isZooming) hud.setCrosshairFire();

  const pelletCount = Math.max(1, shot.pellets ?? 1);

  // Launchers bypass BOTH hitscan and the sniper bullet camera. Damage
  // belongs to the projectile snapshot and is resolved only on explosion.
  if (shot.projectile) {
    for (let i = 0; i < pelletCount && state.isPlaying; i++) {
      projectiles.spawn({
        shot, behavior: asset.behavior, origin: projectileOrigin,
        aimOrigin: camera.position, direction: getShotDirection(shot.spread)
      });
    }
    updateHud();
    return;
  }

  // Only scoped sniper shots can use the bullet camera. Non-sniper scoped
  // weapons and unscoped sniper shots stay on the normal hitscan path.
  // The cinematic hit is resolved only when the bullet arrives.
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

function handleProjectileExplosion({ position, hit, damage, radius, direction }) {
  if (!enemies || !state.isPlaying || state.isGameOver || state.isWaveComplete) return;

  const distanceToPlayer = position.distanceTo(camera.position);
  sounds.playExplosion(distanceToPlayer);
  const shake = Math.max(0, 1 - distanceToPlayer / 18);
  if (shake > 0) {
    cameraShake.damageShakeTime = Math.max(cameraShake.damageShakeTime, 0.16);
    cameraShake.impulsePos.x += (Math.random() - 0.5) * 0.07 * shake;
    cameraShake.impulsePos.y += 0.035 * shake;
    cameraShake.impulseRotZ += (Math.random() - 0.5) * 0.025 * shake;
  }

  const targets = enemies.getExplosionHits(position, radius, projectiles.hasLineOfSight);
  const directEnemy = hit?.type === "enemy" ? hit.enemy : null;
  // A direct hit always takes full damage, including explosionRadius: 0.
  // It is still an ordinary damage event, never an instant-kill headshot.
  if (directEnemy && !targets.some(target => target.enemy === directEnemy)) {
    targets.unshift({ enemy: directEnemy, point: hit.point.clone(), distance: 0 });
  }

  let kills = 0;
  let enemyWasHit = false;
  for (const target of targets) {
    if (target.enemy.userData.isDying) continue;
    const amount = target.enemy === directEnemy
      ? damage : damage * Math.max(0, 1 - target.distance / radius);
    if (!(amount > 0)) continue;
    const blastDirection = target.point.clone().sub(position);
    if (blastDirection.lengthSq() > 1e-8) blastDirection.normalize();
    else blastDirection.copy(direction);
    const killed = enemies.damageEnemy(target.enemy, amount);
    impacts.spawnBlood(target.point, blastDirection, { direction: blastDirection, damage: amount });
    enemyWasHit = true;
    if (killed) kills += 1;
  }

  // Resolve all victims first. Refilling inside the loop would let the same
  // explosion damage newly spawned enemies, or reset references mid-blast.
  if (kills > 0) {
    sounds.playEnemyDie();
    handleEnemyKilled({ count: kills });
  }
  if (!state.isWaveComplete) refillActiveEnemies();
  if (enemyWasHit) sounds.playEnemyHit();
  updateHud();
}

function resolveBulletImpact(shot, hit) {
  if (hit?.type === "enemy") {
    const headshot = Boolean(hit.headshot);
    const killed = enemies.damageEnemy(hit.enemy, shot.damage, {
      instantKill: shouldInstantKillHeadshot(hit),
      headshot
    });

    impacts.spawnBlood(hit.point, hit.normal, {
      direction: hit.direction, damage: shot.damage, headshot, pellets: shot.pellets
    });

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

  impacts.spawnBlood(enemyHit.point, enemyHit.normal, { direction, damage: shot.damage, melee: true });
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

  // Keep the exact shot direction, including during the delayed sniper impact.
  if (result) result.direction = direction.clone();
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
  hud.setCrosshairVisible(false);

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

  hud.setCrosshairVisible(true);
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

  hud.setCrosshairVisible(true);
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
  projectiles.clear({ effects: false });
  cancelSniperBulletCamera();
  stopSecondaryAction();
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

  clearTimeout(gameOverOverlayTimer);
  gameOverOverlayTimer = setTimeout(() => {
    showOverlay("Game Over", `Wave reached: ${state.wave}`, "Restart");
  }, 650);
}

async function resetGame() {
  clearTimeout(gameOverOverlayTimer);
  player.clearMovement();
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
  stopSecondaryAction();

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

  syncWeaponWorldAnchor();
  weapon.syncWorldEffects();

  renderer.clear();
  renderer.render(scene, camera);
  if (!isZooming) {
    syncWeaponWorldLighting();
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
  touchControls.update(delta);
  const gameplayActive = state.isPlaying && !sniperBulletCam.active && !isTouchPortrait() && !touchControls.isPickerOpen && !document.hidden;

  player.update(delta, gameplayActive);
  recoverPlayerFall();
  world.update?.(delta, camera);

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

  weapon.update(delta, state.isPlaying && !isTouchPortrait() && !touchControls.isPickerOpen && !document.hidden, player.inputState);
  updateSniperBulletCamera(delta);
  updateSniperEnemyImpactSlowMotion(delta);

  const impactTimeScale = (
    sniperBulletCam.active &&
    sniperBulletCam.phase === "impact" &&
    sniperBulletCam.enemyImpact
  ) ? sniperBulletCam.enemyHitSlowMoScale : 1;

  projectiles.update(document.hidden ? 0 : delta * impactTimeScale,
    gameplayActive && state.isPlaying && !state.isGameOver && !state.isWaveComplete);
  updateTracers(delta);
  impacts.update(delta * impactTimeScale, sniperBulletCam.active ? sniperBulletCamera : camera);
  bulletHoles.update(delta);
  updateViewPunch(delta);
  updateCameraShake(delta);
  renderWithCameraShake();
}
}
