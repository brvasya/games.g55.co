import { createGLTFLoader } from "./gltfLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export function createWeaponSystem({ THREE, weaponScene, worldScene, weaponCamera, playerVelocity, weaponSlots, onStateChange }) {
  const HANDS_MODEL_URL = "./assets/hands.glb";
  const VALVEBIPED_SOURCE_PREFIX = "ValveBiped.Bip01";
  const VALVEBIPED_MERGE_PREFIX = THREE.PropertyBinding.sanitizeNodeName(VALVEBIPED_SOURCE_PREFIX);
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
  let lastShotTime = Number.NEGATIVE_INFINITY;
  let isReloading = false;
  let reloadStartedAt = 0;
  let reloadDuration = 0;
  let reloadSequenceId = 0;

  const rig = new THREE.Group();
  const modelCache = new Map();
  const audioCache = new Map();

  const handsCache = {
    source: null,
    loading: false,
    failed: false,
    promise: null
  };

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
  let handsModel = null;
  let boneMergePairs = [];
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
  let attachmentBone = null;
  let muzzleFlashBone = null;
  let flashlightActive = false;
  let muzzleFlashTime = 0;
  const boneMergeLocalMatrix = new THREE.Matrix4();
  const boneMergeParentInverse = new THREE.Matrix4();
  const effectPosition = new THREE.Vector3();
  const effectQuaternion = new THREE.Quaternion();
  const attachmentRotationEuler = new THREE.Euler(0, 0, 0, "XYZ");
  const attachmentRotationQuaternion = new THREE.Quaternion();
  const effectDirection = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();

  const FLASHLIGHT_INTENSITY = 42;
  // Keep the spotlight registered in Three.js from startup at zero intensity.
  // Toggling .visible on the first use changes the active light set and can
  // force a world-material shader compile, causing a noticeable flashlight delay.
  const flashlight = new THREE.SpotLight(0xffffff, 0, 34, Math.PI / 7, 0.55, 1.35);
  flashlight.name = "WeaponFlashlight";
  flashlight.visible = true;
  flashlight.castShadow = false;
  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.name = "WeaponFlashlightTarget";

  // Keep the point light in the active Three.js light set from startup.
  // Toggling a light from invisible -> visible on the first shot can force
  // expensive world-material shader compilation in the firing frame.
  const muzzleLight = new THREE.PointLight(0xffc36a, 0, 6, 2);
  muzzleLight.name = "WeaponMuzzleFlashLight";
  muzzleLight.visible = true;
  muzzleLight.castShadow = false;

  if (worldScene) {
    worldScene.add(flashlight, flashlightTarget, muzzleLight);
    flashlight.target = flashlightTarget;
  }

  const muzzleFlashTexture = createMuzzleFlashTexture();
  const muzzleFlashMaterial = new THREE.SpriteMaterial({
    map: muzzleFlashTexture,
    color: 0xffd27a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });
  const muzzleFlashSprite = new THREE.Sprite(muzzleFlashMaterial);
  muzzleFlashSprite.name = "WeaponMuzzleFlash";
  // Keep the sprite renderable at zero opacity so its shader is compiled
  // before the player fires for the first time.
  muzzleFlashSprite.visible = true;
  muzzleFlashSprite.material.opacity = 0;
  muzzleFlashSprite.scale.set(5.2, 5.2, 1);

  rig.name = "FirstPersonWeaponRig";
  resetRigTransform();
  weaponScene.add(rig);

  Promise.all([
    preloadWeaponAsset(currentModelConfig()),
    preloadHandsAsset()
  ]).then(() => {
    attachCurrentModel();
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
      projectile: !isMelee && (behavior.projectile === "grenade" || behavior.projectile === "rocket")
        ? behavior.projectile : null,
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
      projectile: behavior.projectile,
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

    tasks.push(preloadHandsAsset());

    return Promise.all(tasks).then(() => {
      attachCurrentModel();
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

  function preloadHandsAsset() {
    if (handsCache.promise) return handsCache.promise;
    if (handsCache.source || handsCache.failed) return Promise.resolve(handsCache);

    handsCache.loading = true;
    const loader = createGLTFLoader();

    handsCache.promise = new Promise(resolve => {
      loader.load(
        HANDS_MODEL_URL,
        gltf => {
          handsCache.source = gltf.scene;
          handsCache.loading = false;
          handsCache.failed = false;
          resolve(handsCache);
        },
        undefined,
        error => {
          handsCache.loading = false;
          handsCache.failed = true;
          console.warn("Hands model failed to preload:", HANDS_MODEL_URL, error);
          resolve(handsCache);
        }
      );
    });

    return handsCache.promise;
  }

  function ensureHandsModel() {
    if (handsModel || !handsCache.source) return handsModel;

    handsModel = SkeletonUtils.clone(handsCache.source);
    handsModel.name = "GModHands";

    handsModel.traverse(object => {
      if (!object.isMesh) return;

      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = true;

      if (Array.isArray(object.material)) {
        object.material = object.material.map(material => material.clone());
      } else if (object.material) {
        object.material = object.material.clone();
      }
    });

    rig.add(handsModel);
    handsModel.visible = false;
    return handsModel;
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
    lastShotTime = Number.NEGATIVE_INFINITY;
    recoil = 0;

    attachCurrentModel();

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
    lastShotTime = Number.NEGATIVE_INFINITY;
    cancelReload();
    attachCurrentModel();
  }

  function shoot() {
    const slot = currentSlot();
    const now = performance.now();

    if (isReloading) return { ok: false, reason: "reloading" };
    if (now - lastShotTime < slot.fireCooldownMs) return { ok: false, reason: "cooldown" };

    if (slot.isMelee) {
      lastShotTime = now;
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

    lastShotTime = now;
    // Start the fire animation immediately, then trigger all shot effects in
    // the same accepted-shot call. This prevents effect timing from waiting
    // on a later animation/update frame.
    play("shoot");
    triggerMuzzleFlash();
    ejectShell();
    slot.ammo -= 1;
    addRecoil();

    return {
      ok: true,
      slot: slot.id,
      weaponName: slot.name,
      damage: slot.damage,
      spread: slot.spread,
      pellets: slot.pellets,
      projectile: slot.projectile,
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

    const reloadConfig = currentModelConfig().anim?.reload;
    if (Array.isArray(reloadConfig)) {
      const segmentedReload = getSegmentedReloadActions();
      if (!segmentedReload) return { started: false, duration: 0 };
      return startSegmentedReload(slot, segmentedReload);
    }

    isReloading = true;
    const sequenceId = ++reloadSequenceId;
    const duration = play("reload");
    reloadStartedAt = performance.now();
    reloadDuration = duration;

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      const needed = slot.magazineSize - slot.ammo;
      const loaded = Math.min(needed, slot.reserveAmmo);
      slot.ammo += loaded;
      slot.reserveAmmo -= loaded;
      finishReload(sequenceId);
    }, duration);

    return { started: true, duration };
  }

  function getSegmentedReloadActions() {
    const startAction = actions.get("reload:0");
    const loopAction = actions.get("reload:1");
    const endAction = actions.get("reload:2");

    if (!startAction || !loopAction || !endAction) {
      console.warn("Segmented reload requires reload_start, loop, and end animation clips.");
      return null;
    }

    return { startAction, loopAction, endAction };
  }

  function getActionDuration(action, stateName) {
    if (!action) return 0;

    const rawDuration = action.getClip().duration * 1000;
    if (stateName === "shoot") return currentSlot().fireCooldownMs;
    return rawDuration / getAnimationSpeed(stateName);
  }

  function startSegmentedReload(slot, segmentedReload) {
    const shellCount = Math.min(slot.magazineSize - slot.ammo, slot.reserveAmmo);
    if (shellCount <= 0) return { started: false, duration: 0 };

    isReloading = true;
    const sequenceId = ++reloadSequenceId;

    const startDuration = getActionDuration(segmentedReload.startAction, "reload");
    const loopDuration = getActionDuration(segmentedReload.loopAction, "reload");
    const endDuration = getActionDuration(segmentedReload.endAction, "reload");
    const loopCount = Math.max(0, shellCount - 1);
    const duration = startDuration + loopDuration * loopCount + endDuration;

    reloadStartedAt = performance.now();
    reloadDuration = duration;

    clearTimeout(reloadTimer);
    playAction(segmentedReload.startAction, "reload", false);

    reloadTimer = setTimeout(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      // reload_start inserts the first shell.
      if (slot.ammo < slot.magazineSize && slot.reserveAmmo > 0) {
        slot.ammo += 1;
        slot.reserveAmmo -= 1;
        notifyStateChange();
      }

      runReloadShellLoop(slot, segmentedReload, loopCount, sequenceId);
    }, startDuration);

    return { started: true, duration, shellCount };
  }

  function runReloadShellLoop(slot, segmentedReload, shellsRemaining, sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    if (shellsRemaining <= 0 || slot.ammo >= slot.magazineSize || slot.reserveAmmo <= 0) {
      playReloadEnd(segmentedReload, sequenceId);
      return;
    }

    const loopDuration = playAction(segmentedReload.loopAction, "reload", false);

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!isReloading || sequenceId !== reloadSequenceId) return;

      if (slot.ammo < slot.magazineSize && slot.reserveAmmo > 0) {
        slot.ammo += 1;
        slot.reserveAmmo -= 1;
        notifyStateChange();
      }

      runReloadShellLoop(slot, segmentedReload, shellsRemaining - 1, sequenceId);
    }, loopDuration);
  }

  function playReloadEnd(segmentedReload, sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    const endDuration = playAction(segmentedReload.endAction, "reload", false);

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => finishReload(sequenceId), endDuration);
  }

  function finishReload(sequenceId) {
    if (!isReloading || sequenceId !== reloadSequenceId) return;

    isReloading = false;
    reloadTimer = null;
    reloadDuration = 0;
    play("idle");
    notifyStateChange();
  }

  function cancelReload() {
    reloadSequenceId += 1;
    clearTimeout(reloadTimer);
    reloadTimer = null;
    isReloading = false;
    reloadStartedAt = 0;
    reloadDuration = 0;
  }

  function notifyStateChange() {
    if (typeof onStateChange === "function") onStateChange();
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
      projectile: slot.projectile,
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
        }
      });
      return;
    }

    clearModel();

    model = SkeletonUtils.clone(cached.source);
    model.name = "WeaponGLB";
    model.visible = false;

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

    });

    rig.add(model);
    resetRigTransform();
    setupAnimations(cached.animations);
    setupValveBipedBoneMerge();
    setupWeaponEffects();

    // Evaluate the first animated pose and merge the hands before either is
    // exposed. Callers must not restart idle after this synchronous setup.
    play("idle");
    if (!activeAction) syncValveBipedBoneMerge();
    model.visible = true;
    if (handsModel) handsModel.visible = boneMergePairs.length > 0;
  }

  function setupValveBipedBoneMerge() {
    boneMergePairs = [];

    const hands = ensureHandsModel();
    if (!model || !hands) return;

    const weaponBones = collectValveBipedBones(model);
    const handBones = collectValveBipedBones(hands);

    for (const [name, targetBone] of handBones) {
      const sourceBone = weaponBones.get(name);
      if (!sourceBone) continue;

      boneMergePairs.push({
        sourceBone,
        targetBone,
        depth: getObjectDepth(targetBone, hands)
      });
    }

    boneMergePairs.sort((a, b) => a.depth - b.depth);

    if (!boneMergePairs.length) {
      hands.visible = false;
      console.warn("No matching ValveBiped bones found for hands bone merge", {
        weaponBones: Array.from(weaponBones.keys()),
        handBones: Array.from(handBones.keys())
      });
      return;
    }

    const unmatchedHandBones = Array.from(handBones.keys()).filter(name => !weaponBones.has(name));
    console.info(`ValveBiped bone merge active: ${boneMergePairs.length}/${handBones.size} hands bones matched`,
      unmatchedHandBones.length ? { unmatchedHandBones } : "");

    // attachCurrentModel reveals the hands after the initial animated pose.
  }

  function collectValveBipedBones(root) {
    const bones = new Map();

    root.traverse(object => {
      if (!object.isBone) return;

      const canonicalName = getCanonicalValveBipedBoneName(object.name);
      if (!canonicalName) return;

      bones.set(canonicalName, object);
    });

    return bones;
  }

  function getCanonicalValveBipedBoneName(name) {
    if (!name) return null;

    // GLTFLoader sanitizes Object3D/Bone names with PropertyBinding rules.
    // Reserved characters such as the dot in `ValveBiped.Bip01_*` are
    // REMOVED (not replaced), so at runtime the same bone is typically named
    // `ValveBipedBip01_*`. Sanitizing again is idempotent and also supports
    // unsanitized names, making weapon and hands matching independent of how
    // the GLB was exported or cloned.
    const runtimeName = THREE.PropertyBinding.sanitizeNodeName(String(name));
    if (!runtimeName.startsWith(VALVEBIPED_MERGE_PREFIX)) return null;

    return runtimeName;
  }

  function getObjectDepth(object, root) {
    let depth = 0;
    let current = object;

    while (current && current !== root) {
      depth += 1;
      current = current.parent;
    }

    return depth;
  }

  function syncValveBipedBoneMerge() {
    if (!model || !handsModel || !boneMergePairs.length) return;

    // GMod-style bone merge: each c_hands ValveBiped bone is driven by the
    // matching animated view-model bone in world space. This deliberately
    // ignores the hands model's own hierarchy and uses no hand offsets.
    model.updateWorldMatrix(true, true);
    handsModel.updateWorldMatrix(true, true);

    for (const { sourceBone, targetBone } of boneMergePairs) {
      const parent = targetBone.parent;

      if (parent) {
        parent.updateWorldMatrix(true, false);
        boneMergeParentInverse.copy(parent.matrixWorld).invert();
        boneMergeLocalMatrix.multiplyMatrices(boneMergeParentInverse, sourceBone.matrixWorld);
      } else {
        boneMergeLocalMatrix.copy(sourceBone.matrixWorld);
      }

      boneMergeLocalMatrix.decompose(
        targetBone.position,
        targetBone.quaternion,
        targetBone.scale
      );

      targetBone.updateMatrix();
      targetBone.updateWorldMatrix(false, false);
    }

    handsModel.updateWorldMatrix(false, true);
  }

  function clearModel() {
    if (mixer) mixer.stopAllAction();

    // Detach the shared effect sprite before disposing the current weapon tree.
    // Otherwise disposeModel() would dispose the reusable muzzle flash material.
    if (muzzleFlashSprite.parent) muzzleFlashSprite.parent.remove(muzzleFlashSprite);

    if (model) {
      rig.remove(model);
      disposeModel(model);
    }

    muzzleFlashSprite.material.opacity = 0;
    muzzleLight.intensity = 0;
    muzzleFlashTime = 0;
    flashlightActive = false;
    flashlight.intensity = 0;
    attachmentBone = null;
    muzzleFlashBone = null;

    model = null;
    boneMergePairs = [];
    if (handsModel) handsModel.visible = false;
    mixer = null;
    activeAction = null;
    actions.clear();
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

    Object.entries(assetAnim).forEach(([name, clipSpec]) => {
      if (name === "reload" && Array.isArray(clipSpec)) {
        if (clipSpec.length !== 3) {
          console.warn("Segmented reload must use exactly 3 clips: [start, loop, end].");
          return;
        }

        clipSpec.forEach((clipName, index) => {
          if (typeof clipName !== "string" || !clipName.trim()) {
            console.warn(`Weapon reload animation at index ${index} must be a clip name.`);
            return;
          }

          const clip = findAnimationClip(clips, clipName);
          if (!clip) {
            console.warn(`Missing weapon animation clip: ${clipName}`);
            return;
          }

          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          actions.set(`reload:${index}`, action);
        });
        return;
      }

      if (typeof clipSpec !== "string" || !clipSpec.trim()) {
        console.warn(`Weapon animation action must be a clip name: ${name}`);
        return;
      }

      const clip = findAnimationClip(clips, clipSpec);

      if (!clip) {
        console.warn(`Missing weapon animation clip: ${clipSpec}`);
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
    return getActionDuration(actions.get(name), name);
  }

  function play(name) {
    return playAction(actions.get(name), name, true);
  }

  function playAction(action, stateName, autoReturnToIdle = true) {
    currentState = stateName;
    currentStateTime = 0;

    if (!action) return 0;

    clearTimeout(returnTimer);
    const previousAction = activeAction;
    const segmentedReload = stateName === "reload" && !autoReturnToIdle;
    // A first activation or a same-action restart has no outgoing pose to
    // fade from. Reload segments are authored to join directly at full weight.
    const canCrossFade = previousAction && previousAction !== action
      && previousAction.enabled && previousAction.isScheduled()
      && previousAction.getEffectiveWeight() >= 1 - 1e-6
      && stateName !== "shoot" && !segmentedReload;

    // Remove stale/clamped actions and interrupted fades. Only a valid
    // outgoing action may keep contributing alongside the incoming action.
    for (const otherAction of actions.values()) {
      if (otherAction !== action && (!canCrossFade || otherAction !== previousAction)) {
        otherAction.stop();
      }
    }

    const loop = isLoopingAnimation(stateName);
    const rawDuration = action.getClip().duration * 1000;
    const duration = getActionDuration(action, stateName);

    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.timeScale = stateName === "shoot" ? rawDuration / currentSlot().fireCooldownMs : getAnimationSpeed(stateName);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();
    if (canCrossFade) {
      // Equal fade durations keep total animation influence at one instead
      // of briefly mixing the GLB's default pose into a transition.
      previousAction.setEffectiveWeight(1).fadeOut(0.04);
      action.fadeIn(0.04);
    }
    activeAction = action;
    currentStateDuration = duration;

    // Prepare weapon AND hands in the same call, including timer-driven
    // reload boundaries that can occur between regular frame updates.
    mixer.update(0);
    syncValveBipedBoneMerge();

    if (!loop && autoReturnToIdle) {
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
    updateShells(delta);
    if (mixer) mixer.update(delta);
    syncValveBipedBoneMerge();
    updateMuzzleFlash(delta);

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

    return {
      boneName: config.shellEject ?? null,
      gravity: 15,
      life: 1.5,
      spin: 5,
      scale: 1
    };
  }

  function findWeaponObjectByName(name) {
    if (!model || !name) return null;

    const exact = model.getObjectByName(name);
    if (exact) return exact;

    const wanted = THREE.PropertyBinding.sanitizeNodeName(String(name)).toLowerCase();
    let match = null;

    model.traverse(object => {
      if (match || !object.name) return;
      const runtimeName = THREE.PropertyBinding.sanitizeNodeName(String(object.name)).toLowerCase();
      if (runtimeName === wanted) match = object;
    });

    return match;
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

  function createMuzzleFlashTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const center = 64;

    const glow = ctx.createRadialGradient(center, center, 2, center, center, 58);
    glow.addColorStop(0, "rgba(255,255,235,1)");
    glow.addColorStop(0.12, "rgba(255,225,135,1)");
    glow.addColorStop(0.42, "rgba(255,145,45,0.82)");
    glow.addColorStop(1, "rgba(255,90,15,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);

    ctx.save();
    ctx.translate(center, center);
    ctx.globalCompositeOperation = "lighter";
    for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      ctx.rotate(rotation);
      const streak = ctx.createLinearGradient(-58, 0, 58, 0);
      streak.addColorStop(0, "rgba(255,130,40,0)");
      streak.addColorStop(0.5, "rgba(255,245,200,0.9)");
      streak.addColorStop(1, "rgba(255,130,40,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(-58, -2.2, 116, 4.4);
      ctx.rotate(-rotation);
    }
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function setupWeaponEffects() {
    const config = currentModelConfig();
    attachmentBone = findWeaponObjectByName(config.attachment);
    muzzleFlashBone = findWeaponObjectByName(config.muzzleFlash);

    if (config.attachment && !attachmentBone) {
      console.warn(`Missing weapon flashlight attachment bone: ${config.attachment}`);
    }

    if (config.muzzleFlash && !muzzleFlashBone) {
      console.warn(`Missing weapon muzzle flash bone: ${config.muzzleFlash}`);
    }

    if (muzzleFlashSprite.parent) muzzleFlashSprite.parent.remove(muzzleFlashSprite);
    if (muzzleFlashBone) {
      muzzleFlashBone.add(muzzleFlashSprite);
      muzzleFlashSprite.position.set(0, 0, 0);
      muzzleFlashSprite.visible = true;
      muzzleFlashSprite.material.opacity = 0;
    }

    setFlashlight(false);
  }

  function triggerMuzzleFlash() {
    if (!muzzleFlashBone) return;

    muzzleFlashTime = 0.055;
    muzzleFlashSprite.material.opacity = 1;
    muzzleFlashSprite.material.rotation = Math.random() * Math.PI;
    const scale = 4.5 + Math.random() * 1.4;
    muzzleFlashSprite.scale.set(scale, scale, 1);
    muzzleLight.intensity = 32;
  }

  function updateMuzzleFlash(delta) {
    if (muzzleFlashTime <= 0 || !muzzleFlashBone) {
      muzzleFlashTime = 0;
      muzzleFlashSprite.material.opacity = 0;
      muzzleLight.intensity = 0;
      return;
    }

    muzzleFlashTime = Math.max(0, muzzleFlashTime - delta);
    const strength = Math.min(1, muzzleFlashTime / 0.055);
    muzzleFlashSprite.material.opacity = strength;
    muzzleLight.intensity = 10 + 22 * strength;
  }

  function setFlashlight(active) {
    flashlightActive = Boolean(active && attachmentBone);
    flashlight.intensity = flashlightActive ? FLASHLIGHT_INTENSITY : 0;

    // Apply the attachment transform immediately on activation instead of
    // waiting for the next animation/update pass. The normal render sync will
    // continue tracking the animated bone every frame after this.
    if (flashlightActive) syncFlashlightTransform();
  }

  function hasScope() {
    const behavior = currentModelConfig().behavior;
    // Existing snipers keep their scope; other weapons opt in independently.
    return !behavior.isMelee && Boolean(behavior.hasScope || behavior.isSniper);
  }

  function hasFlashlightAttachment() {
    return Boolean(currentModelConfig().attachment);
  }

  function isFlashlightActive() {
    return flashlightActive;
  }

  function syncFlashlightTransform() {
    if (!model || !attachmentBone) return;

    model.updateWorldMatrix(true, true);
    attachmentBone.getWorldPosition(effectPosition);
    attachmentBone.getWorldQuaternion(effectQuaternion);
    flashlight.position.copy(effectPosition);

    const attachmentRotation = currentModelConfig().attachmentRotation ?? [0, 0, 0];
    attachmentRotationEuler.set(
      attachmentRotation[0] ?? 0,
      attachmentRotation[1] ?? 0,
      attachmentRotation[2] ?? 0,
      "XYZ"
    );
    attachmentRotationQuaternion.setFromEuler(attachmentRotationEuler);
    effectQuaternion.multiply(attachmentRotationQuaternion);

    effectDirection.set(0, 0, 1).applyQuaternion(effectQuaternion).normalize();
    cameraForward.set(0, 0, -1).applyQuaternion(weaponCamera.quaternion).normalize();
    if (effectDirection.dot(cameraForward) < 0) effectDirection.negate();

    flashlightTarget.position.copy(effectPosition).addScaledVector(effectDirection, 24);
    flashlightTarget.updateMatrixWorld(true);
  }

  // Returns the animated helper origin in WORLD meters, not view-model units.
  // main.js refreshes the weapon world anchor before requesting this point.
  function getMuzzleWorldPosition(target) {
    if (!model || !muzzleFlashBone) return null;
    model.updateWorldMatrix(true, true);
    return muzzleFlashBone.getWorldPosition(target);
  }

  function syncWorldEffects() {
    if (!model) {
      flashlight.intensity = 0;
      muzzleLight.intensity = 0;
      return;
    }

    model.updateWorldMatrix(true, true);

    if (attachmentBone && flashlightActive) {
      syncFlashlightTransform();
      flashlight.intensity = FLASHLIGHT_INTENSITY;
    } else {
      flashlight.intensity = 0;
    }

    if (muzzleFlashBone) {
      // Keep the zero-intensity point light registered with the renderer so
      // first fire never changes the scene's light-count shader variant.
      muzzleFlashBone.getWorldPosition(muzzleLight.position);
    } else {
      muzzleLight.intensity = 0;
    }
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
    getDuration,
    setFlashlight,
    hasScope,
    hasFlashlightAttachment,
    isFlashlightActive,
    getMuzzleWorldPosition,
    syncWorldEffects
  };
}
