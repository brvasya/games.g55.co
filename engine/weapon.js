import { createGLTFLoader } from "./gltfLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export function createWeaponSystem({ THREE, weaponScene, weaponCamera, playerVelocity, weaponSlots }) {
  const slots = createSlots(weaponSlots);

  const settings = {
    bobAmount: 0.018,
    bobSpeed: 10.5,
    swayAmount: 0.00085,
    swayMax: 0.035,
    tiltAmount: 0.045,
    lagAmount: 0.08,
    recoilKick: 0.075,
    recoilRotation: 0.12,
    returnSpeed: 12,
    motionBlend: 18
  };

  let currentSlotIndex = 0;
  let lastShotTime = 0;
  let isReloading = false;
  let reloadStartedAt = 0;
  let reloadDuration = 0;

  const rig = new THREE.Group();
  const modelCache = new Map();
  const audioCache = new Map();

  const actions = new Map();
  const targetPosition = new THREE.Vector3();
  const targetRotation = new THREE.Euler();
  const shellGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.8, 8);
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0xc89b3c, roughness: 0.42, metalness: 0.45
  });
  const shells = [];
  const tempShellPosition = new THREE.Vector3();
  const tempShellVelocity = new THREE.Vector3();

  let model = null;
  let mixer = null;
  let activeAction = null;
  let returnTimer = null;
  let reloadTimer = null;
  let recoil = 0;
  let bobTime = 0;
  let swayX = 0;
  let swayY = 0;
  let currentState = "idle";
  let currentStateTime = 0;
  let currentStateDuration = 0;
  let flashIntensity = 0;
  const flashMaterials = new Set();

  rig.name = "FirstPersonWeaponRig";
  resetRigTransform();
  weaponScene.add(rig);

  preloadWeaponAsset(currentModelConfig()).then(() => {
    attachCurrentModel();
    play("idle");
  });

  function getNameFromConfig(config) {
    return config.name.toString().toUpperCase();
  }

  function getBehaviorFromAsset(asset) {
    const behavior = asset.behavior;
    const isMelee = behavior.isMelee;

    return {
      magazineSize: isMelee ? 0 : behavior.magazineSize,
      reserveAmmo: isMelee ? 0 : behavior.reserveAmmo,
      damage: behavior.damage,
      fireCooldownMs: behavior.fireCooldownMs,
      spread: isMelee ? 0 : behavior.spread,
      pellets: isMelee ? 1 : behavior.pellets,
      isSniper: behavior.isSniper,
      isMelee,
      range: behavior.range
    };
  }

  function getPriceFromSlotConfig(slotConfig) {
    return slotConfig.price;
  }

  function getAmmoPrice(slot) {
    if (slot.isMelee) return 0;
    return slot.magazineSize;
  }

  function makeSlot(slotConfig) {
    const behavior = getBehaviorFromAsset(slotConfig.asset);
    const owned = Boolean(slotConfig.owned);
    const price = getPriceFromSlotConfig(slotConfig);
    const reserveAmmo = behavior.isMelee ? 0 : Math.max(behavior.magazineSize * 10, 50);

    return {
      id: slotConfig.id,
      asset: slotConfig.asset,
      name: getNameFromConfig(slotConfig.asset),
      price,
      owned,
      defaultOwned: owned,
      magazineSize: behavior.magazineSize,
      ammo: behavior.magazineSize,
      reserveAmmo,
      defaultReserveAmmo: reserveAmmo,
      damage: behavior.damage,
      fireCooldownMs: behavior.fireCooldownMs,
      spread: behavior.spread,
      pellets: behavior.pellets,
      isSniper: behavior.isSniper,
      isMelee: behavior.isMelee,
      range: behavior.range
    };
  }

  function createSlots(slotConfigs) {
    return slotConfigs.map(makeSlot);
  }

  function currentSlot() {
    return slots[currentSlotIndex];
  }

  function currentModelConfig() {
    return currentSlot().asset;
  }

  function getAssetCacheKey(asset) {
    return asset.name;
  }

  function preloadAll() {
    const tasks = [];
    const seenAssets = new Set();

    slots.forEach(slot => {
      const asset = slot.asset;
      const key = getAssetCacheKey(asset);

      if (seenAssets.has(key)) return;
      seenAssets.add(key);

      tasks.push(preloadWeaponAsset(asset));

      if (asset.fireSound) tasks.push(preloadSound(asset.fireSound));
      if (asset.shootSound) tasks.push(preloadSound(asset.shootSound));
      if (asset.reloadSound) tasks.push(preloadSound(asset.reloadSound));
    });

    return Promise.all(tasks).then(() => {
      attachCurrentModel();
      play("idle");
    });
  }

  function preloadWeaponAsset(asset) {

    const key = getAssetCacheKey(asset);
    let cached = modelCache.get(key);

    if (cached?.promise) return cached.promise;
    if (cached?.source || cached?.failed) return Promise.resolve(cached);

    cached = {
      source: null,
      animations: [],
      loading: true,
      failed: false,
      promise: null
    };

    modelCache.set(key, cached);

    const loader = createGLTFLoader();

    cached.promise = new Promise(resolve => {
      loader.load(
        asset.model,
        gltf => {
          cached.source = gltf.scene;
          cached.animations = gltf.animations;
          cached.loading = false;
          cached.failed = false;

          cached.source.traverse(object => {
            if (!object.isMesh) return;
            object.frustumCulled = false;
            object.castShadow = false;
            object.receiveShadow = true;
          });

          resolve(cached);
        },
        undefined,
        error => {
          cached.loading = false;
          cached.failed = true;
          console.warn("Weapon model failed to preload:", key, error);
          resolve(cached);
        }
      );
    });

    return cached.promise;
  }

  function preloadSound(src) {
    if (!src) return Promise.resolve(null);

    const cached = audioCache.get(src);
    if (cached?.promise) return cached.promise;
    if (cached?.audio || cached?.failed) return Promise.resolve(cached);

    const audio = new Audio();

    const entry = {
      audio,
      failed: false,
      promise: null
    };

    audioCache.set(src, entry);

    entry.promise = new Promise(resolve => {
      const done = () => resolve(entry);
      const fail = () => {
        entry.failed = true;
        resolve(entry);
      };

      audio.preload = "auto";
      audio.src = src;
      audio.volume = 1.0;
      audio.addEventListener("canplaythrough", done, { once: true });
      audio.addEventListener("error", fail, { once: true });
      audio.load();
    });

    return entry.promise;
  }

  function switchSlot(slotNumber) {
    const index = slotNumber - 1;
    const slot = slots[index];

    if (!slot || !slot.owned || index === currentSlotIndex || isReloading) return false;

    currentSlotIndex = index;
    lastShotTime = 0;
    recoil = 0;

    attachCurrentModel();
    play("idle");

    return true;
  }

  function buySlot(slotNumber) {
    const index = slotNumber - 1;
    const slot = slots[index];

    if (slot.owned) return { ok: false, reason: "owned", slot: getSlotShopState(slot) };

    slot.owned = true;
    slot.ammo = slot.magazineSize;
    slot.reserveAmmo = slot.defaultReserveAmmo;

    return { ok: true, slot: getSlotShopState(slot) };
  }

  function buyAmmo(slotNumber) {
    const index = slotNumber - 1;
    const slot = slots[index];

    if (!slot || !slot.owned || slot.isMelee) return { ok: false };

    const price = getAmmoPrice(slot);
    slot.reserveAmmo += slot.magazineSize;

    return {
      ok: true,
      price,
      amount: slot.magazineSize,
      slot: getSlotShopState(slot)
    };
  }

  function resetSlots() {
    slots.forEach(slot => {
      slot.owned = slot.defaultOwned;
      slot.ammo = slot.magazineSize;
      slot.reserveAmmo = slot.defaultReserveAmmo;
    });

    currentSlotIndex = 0;
    lastShotTime = 0;
    isReloading = false;
    clearTimeout(reloadTimer);
    attachCurrentModel();
    play("idle");
  }

  function shoot() {
    const slot = currentSlot();
    const now = performance.now();

    if (isReloading) return { ok: false, reason: "reloading" };
    if (now - lastShotTime < slot.fireCooldownMs) return { ok: false, reason: "cooldown" };

    lastShotTime = now;

    if (slot.isMelee) {
      play("shoot");
      addRecoil();

      return {
        ok: true,
        slot: slot.id,
        weaponName: slot.name,
        damage: slot.damage,
        isMelee: true,
        range: slot.range,
        ammo: slot.ammo,
        reserveAmmo: slot.reserveAmmo
      };
    }

    if (slot.ammo <= 0) return { ok: false, reason: "empty" };

    flashIntensity = getMuzzleFlashConfig().intensity;
    ejectShell();
    slot.ammo -= 1;
    play("shoot");
    addRecoil();

    return {
      ok: true,
      slot: slot.id,
      weaponName: slot.name,
      damage: slot.damage,
      spread: slot.spread,
      pellets: slot.pellets,
      isSniper: slot.isSniper,
      isMelee: false,
      range: slot.range,
      ammo: slot.ammo,
      reserveAmmo: slot.reserveAmmo
    };
  }

  function reload() {
    const slot = currentSlot();

    if (slot.isMelee) {
      return { started: false, duration: 0 };
    }

    if (isReloading || slot.ammo === slot.magazineSize || slot.reserveAmmo <= 0) {
      return { started: false, duration: 0 };
    }

    isReloading = true;
    const duration = play("reload");
    reloadStartedAt = performance.now();
    reloadDuration = duration;

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const needed = slot.magazineSize - slot.ammo;
      const loaded = Math.min(needed, slot.reserveAmmo);
      slot.ammo += loaded;
      slot.reserveAmmo -= loaded;
      isReloading = false;
      play("idle");
    }, duration);

    return { started: true, duration };
  }

  function addReserveAmmo(amount) {
    const slot = currentSlot();
    if (slot.id !== 9 && !slot.isMelee) slot.reserveAmmo += amount;
  }

  function addReserveAmmoToSlot(slotNumber, amount) {
    const index = slotNumber - 1;
    const slot = slots[index];
    if (!slot || slot.isMelee) return false;

    slot.reserveAmmo += amount;
    return true;
  }

  function getCurrentAsset() {
    return currentSlot().asset;
  }

  function getHudState() {
    const slot = currentSlot();
    return {
      weaponSlot: slot.id,
      weaponName: slot.name,
      ammo: slot.ammo,
      reserveAmmo: slot.reserveAmmo,
      isReloading,
      magazineSize: slot.magazineSize,
      reloadProgress: isReloading ? Math.min(1, (performance.now() - reloadStartedAt) / Math.max(1, reloadDuration)) : 0,
      isMelee: slot.isMelee
    };
  }

  function getSlotShopState(slot) {
    return {
      id: slot.id,
      name: slot.name,
      price: slot.price,
      ammoPrice: getAmmoPrice(slot),
      owned: slot.owned,
      active: slot.id === currentSlot().id,
      ammo: slot.ammo,
      reserveAmmo: slot.reserveAmmo,
      damage: slot.damage,
      magazineSize: slot.magazineSize,
      fireCooldownMs: slot.fireCooldownMs,
      spread: slot.spread,
      pellets: slot.pellets,
      isSniper: slot.isSniper,
      isMelee: slot.isMelee,
      range: slot.range
    };
  }

  function getShopState() {
    return slots.map(getSlotShopState);
  }

  function attachCurrentModel() {
    const config = currentModelConfig();

    const key = getAssetCacheKey(config);
    const cached = modelCache.get(key);

    if (!cached || !cached.source) {
      clearModel();
      preloadWeaponAsset(config).then(() => {
        if (currentModelConfig() === config) {
          attachCurrentModel();
          play("idle");
        }
      });
      return;
    }

    clearModel();

    model = SkeletonUtils.clone(cached.source);
    model.name = "WeaponGLB";

    model.traverse(object => {
      if (!object.isMesh) return;

      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = true;

      if (Array.isArray(object.material)) {
        object.material = object.material.map(material => material.clone());
      } else if (object.material) {
        object.material = object.material.clone();
      }

      registerFlashMaterial(object.material);
    });

    rig.add(model);
    resetRigTransform();
    setupAnimations(cached.animations);
  }

  function clearModel() {
    if (model) {
      rig.remove(model);
      disposeModel(model);
    }

    model = null;
    mixer = null;
    activeAction = null;
    actions.clear();
    flashMaterials.clear();
    clearTimeout(returnTimer);
  }

  function disposeModel(root) {
    root.traverse(object => {
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }

  function setupAnimations(clips) {
    const config = currentModelConfig();
    const assetAnim = config.anim || {};

    mixer = new THREE.AnimationMixer(model);

    Object.entries(assetAnim).forEach(([name, clipName]) => {
      if (typeof clipName !== "string" || !clipName.trim()) {
        console.warn(`Weapon animation action must be a clip name: ${name}`);
        return;
      }

      const clip = findAnimationClip(clips, clipName);

      if (!clip) {
        console.warn(`Missing weapon animation clip: ${clipName}`);
        return;
      }

      const action = mixer.clipAction(clip);
      const loop = isLoopingAnimation(name);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      actions.set(name, action);
    });
  }

  function findAnimationClip(animations, name) {
    const wanted = String(name).trim().toLowerCase();

    return animations.find(clip => {
      const clipName = String(clip.name || "").trim().toLowerCase();
      return clipName === wanted;
    }) || null;
  }

  function isLoopingAnimation(name) {
    return name === "idle";
  }

  function getAnimationSpeed(name) {
    const config = currentModelConfig();
    const behavior = config.behavior ?? {};

    const speed = name === "reload"
      ? (behavior.reloadSpeed ?? 1)
      : 1;

    return Math.max(Number(speed) || 1, 0.01);
  }

  function getEffectiveActionDuration(name) {
    const action = actions.get(name);
    if (!action) return 0;

    const rawDuration = action.getClip().duration * 1000;
    if (name === "shoot") return currentSlot().fireCooldownMs;
    return rawDuration / getAnimationSpeed(name);
  }

  function play(name) {
    currentState = name;
    currentStateTime = 0;

    const action = actions.get(name);
    if (!action) return 0;

    clearTimeout(returnTimer);
    if (activeAction && activeAction !== action) activeAction.fadeOut(0.06);

    const loop = isLoopingAnimation(name);
    const rawDuration = action.getClip().duration * 1000;
    const duration = getEffectiveActionDuration(name);

    action.reset();
    action.enabled = true;
    action.timeScale = name === "shoot" ? rawDuration / currentSlot().fireCooldownMs : getAnimationSpeed(name);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.fadeIn(0.04).play();
    activeAction = action;
    currentStateDuration = duration;

    if (!loop) {
      returnTimer = setTimeout(() => play("idle"), duration);
    }

    return duration;
  }

  function getDuration(name) {
    return getEffectiveActionDuration(name);
  }

  function addRecoil() {
    recoil = Math.min(1, recoil + 1);
  }

  function update(delta, isPlaying, inputState) {
    if (flashIntensity > 0.01) {
      const flash = getMuzzleFlashConfig();
      applyMuzzleIllumination(flashIntensity, flash.color);
      flashIntensity = THREE.MathUtils.lerp(flashIntensity, 0, 1 - Math.exp(-30 * delta));
    } else {
      flashIntensity = 0;
      applyMuzzleIllumination(0);
    }

    updateShells(delta);
    if (mixer) mixer.update(delta);

    currentStateTime += delta;
    recoil = THREE.MathUtils.lerp(recoil, 0, 1 - Math.exp(-settings.returnSpeed * delta));

    const horizontalSpeed = Math.hypot(playerVelocity.x, playerVelocity.z);
    const moveFactor = Math.min(horizontalSpeed / 8.5, 1);
    const moving = Boolean(inputState?.moving && isPlaying);
    const walking = Boolean(inputState?.walking);

    if (moving && inputState?.grounded) bobTime += delta * settings.bobSpeed * (walking ? 0.72 : 1);
    else bobTime = THREE.MathUtils.lerp(bobTime, 0, 1 - Math.exp(-8 * delta));

    const swayTargetX = THREE.MathUtils.clamp(-(inputState?.mouseDeltaX ?? 0) * settings.swayAmount, -settings.swayMax, settings.swayMax);
    const swayTargetY = THREE.MathUtils.clamp(-(inputState?.mouseDeltaY ?? 0) * settings.swayAmount, -settings.swayMax, settings.swayMax);

    swayX = THREE.MathUtils.lerp(swayX, swayTargetX, 1 - Math.exp(-18 * delta));
    swayY = THREE.MathUtils.lerp(swayY, swayTargetY, 1 - Math.exp(-18 * delta));

    applyMotion(delta, moveFactor, inputState);
  }

  function applyMotion(delta, moveFactor, inputState) {
    getBasePosition(targetPosition);
    getBaseRotation(targetRotation);

    const bobX = Math.sin(bobTime) * settings.bobAmount * moveFactor;
    const bobY = Math.abs(Math.cos(bobTime * 2)) * settings.bobAmount * moveFactor;
    const lag = THREE.MathUtils.clamp(Math.hypot(playerVelocity.x, playerVelocity.z) / 8.5, 0, 1) * settings.lagAmount;
    const strafeTilt = THREE.MathUtils.clamp(playerVelocity.x / 8.5, -1, 1) * settings.tiltAmount * moveFactor;

    targetPosition.x += bobX + swayX;
    targetPosition.y += bobY + swayY - recoil * settings.recoilKick;
    targetPosition.z += lag + recoil * 0.04;

    targetRotation.x += recoil * settings.recoilRotation;
    targetRotation.y += swayX * 0.55;
    targetRotation.z += strafeTilt + swayX * 0.4;

    if (currentState === "reload") {
      const reloadDuration = Math.max(currentStateDuration / 1000, 0.001);
      const k = Math.sin(Math.min(currentStateTime / reloadDuration, 1) * Math.PI);
      targetPosition.y -= 0.06 * k;
      targetRotation.z += 0.12 * k;
    }

    const blend = 1 - Math.exp(-settings.motionBlend * delta);
    rig.position.lerp(targetPosition, blend);
    rig.rotation.x = THREE.MathUtils.lerp(rig.rotation.x, targetRotation.x, blend);
    rig.rotation.y = THREE.MathUtils.lerp(rig.rotation.y, targetRotation.y, blend);
    rig.rotation.z = THREE.MathUtils.lerp(rig.rotation.z, targetRotation.z, blend);
  }

  function resetRigTransform() {
    getBasePosition(targetPosition);
    getBaseRotation(targetRotation);
    rig.position.copy(targetPosition);
    rig.rotation.copy(targetRotation);
    const view = getCurrentView();
    const scl = view.scl;
    rig.scale.set(
      scl[0],
      scl[1],
      scl[2]
    );
  }

  function getShellEjectConfig() {
    const config = currentModelConfig();
    const shell = config.shellEject ?? {};

    return {
      boneName: shell.boneName ?? null,
      gravity: shell.gravity ?? 15,
      life: shell.life ?? 1.5,
      spin: shell.spin ?? 5,
      scale: shell.scale ?? 1
    };
  }

  function findWeaponObjectByName(name) {
    if (!model || !name) return null;
    return model.getObjectByName(name) ?? null;
  }

  function getShellEjectLocalPosition(shellConfig, target) {
    const ejectObject = findWeaponObjectByName(shellConfig.boneName);
    if (!ejectObject) return null;

    ejectObject.getWorldPosition(target);
    // The view-model parent now follows the world camera. Shell simulation
    // still uses its original local coordinates, just like weapon animations.
    return weaponScene.worldToLocal(target);
  }

  function getShellEjectVelocity(target) {
    target.set(
      -(8.5 + Math.random() * 2.2),
      3.4 + Math.random() * 1.2,
      0.9 + Math.random() * 1.1
    );

    return target.applyQuaternion(rig.quaternion);
  }

  function ejectShell() {
    const shellConfig = getShellEjectConfig();
    const shellPosition = getShellEjectLocalPosition(shellConfig, tempShellPosition);

    if (!shellPosition) return;

    const shell = new THREE.Mesh(shellGeometry, shellMaterial.clone());
    shell.receiveShadow = true;
    shell.material.transparent = true;
    shell.material.opacity = 1;

    shell.position.copy(shellPosition);
    shell.position.add(
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08
      )
    );
    shell.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    shell.scale.setScalar(shellConfig.scale);
    shell.userData.velocity = getShellEjectVelocity(tempShellVelocity).clone();
    shell.userData.life = shellConfig.life;
    shell.userData.maxLife = shellConfig.life;
    shell.userData.gravity = shellConfig.gravity;
    shell.userData.spin = shellConfig.spin;

    weaponScene.add(shell);
    shells.push(shell);
  }

  function updateShells(delta) {
    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i];
      shell.userData.life -= delta;
      shell.userData.velocity.y -= shell.userData.gravity * delta;
      shell.position.addScaledVector(shell.userData.velocity, delta);
      shell.rotation.x += shell.userData.spin * delta;
      shell.rotation.z += shell.userData.spin * 0.55 * delta;

      const fadeStart = shell.userData.maxLife * 0.35;
      const alpha = shell.userData.life > fadeStart ? 1 : Math.max(0, shell.userData.life / fadeStart);
      shell.material.opacity = alpha;

      if (shell.userData.life <= 0) {
        weaponScene.remove(shell);
        shell.material.dispose();
        shells.splice(i, 1);
      }
    }
  }

  function getMuzzleFlashConfig() {
    const config = currentModelConfig();
    const flash = config.muzzleFlash ?? {};

    return {
      intensity: flash.intensity ?? 10,
      color: flash.color ?? 0xffdd66
    };
  }

  function getCurrentView() {
    const config = currentModelConfig();
    const assetView = config.view;

    return {
      posOffset: assetView.posOffset,
      rotOffset: assetView.rotOffset,
      scl: assetView.scl
    };
  }

  function getBasePosition(target) {
    const view = getCurrentView();
    return target.set(view.posOffset[0], view.posOffset[1], view.posOffset[2]);
  }

  function getBaseRotation(target) {
    const view = getCurrentView();
    return target.set(view.rotOffset[0], view.rotOffset[1], view.rotOffset[2]);
  }

  function registerFlashMaterial(material) {
    const materials = Array.isArray(material) ? material : [material];

    materials.forEach(item => {
      if (!item || !item.emissive) return;
      item.userData.baseEmissive = item.emissive.clone();
      item.userData.baseEmissiveIntensity = item.emissiveIntensity ?? 1;
      flashMaterials.add(item);
    });
  }

  function applyMuzzleIllumination(intensity, color = 0xffdd66) {
    const strength = Math.min(0.6, intensity * 0.06);

    flashMaterials.forEach(material => {
      if (!material.emissive) return;

      if (strength <= 0.01) {
        material.emissive.copy(material.userData.baseEmissive);
        material.emissiveIntensity = material.userData.baseEmissiveIntensity;
      } else {
        material.emissive.setHex(color);
        material.emissiveIntensity = strength;
      }

      material.needsUpdate = true;
    });
  }

  return {
    rig,
    preloadAll,
    play,
    update,
    shoot,
    reload,
    switchSlot,
    buySlot,
    buyAmmo,
    resetSlots,
    addReserveAmmo,
    addReserveAmmoToSlot,
    getHudState,
    getShopState,
    getCurrentAsset,
    addRecoil,
    getDuration
  };
}
