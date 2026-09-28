import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { makeMaterialCrisp } from "./materials.js";

export function createEnemies({
  THREE,
  scene,
  camera,
  config,
  state,
  floorObjects = [],
  enemyTypes
}) {
  const enemies = [];
  const toPlayer = new THREE.Vector3();

  const TERRAIN_TUNING = {
    rayExtraHeight: 2.0,
    rayLength: 8.0,
    stepHeight: 0.75,
    minWalkableNormalY: 0.45,
    enemyBaseOffset: 0
  };

  const NAV_TUNING = {
    targetReachDistance: 1.2,
    targetMaxAge: 3.0,
    maxTargetTries: 20
  };

  const terrainRaycaster = new THREE.Raycaster();
  const terrainRayOrigin = new THREE.Vector3();
  const terrainRayDirection = new THREE.Vector3(0, -1, 0);

  const modelCache = new Map();
  const audioCache = new Map();

  function preloadAll() {
    const tasks = [];

    Object.keys(enemyTypes).forEach(typeId => {
      tasks.push(preloadEnemyType(typeId));

      const asset = enemyTypes[typeId]?.asset;
      if (asset?.attackSound) tasks.push(preloadSound(asset.attackSound));
      if (asset?.hitSound) tasks.push(preloadSound(asset.hitSound));
      if (asset?.deathSound) tasks.push(preloadSound(asset.deathSound));
    });

    return Promise.all(tasks);
  }

  function preloadEnemyType(typeId) {
    const type = getEnemyType(typeId);
    const asset = type.asset;

    if (!asset || !asset.model) return Promise.resolve(null);

    let cached = modelCache.get(typeId);

    if (cached?.promise) return cached.promise;
    if (cached?.source || cached?.failed) return Promise.resolve(cached);

    cached = {
      source: null,
      animations: [],
      loading: true,
      failed: false,
      promise: null
    };

    modelCache.set(typeId, cached);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    cached.promise = new Promise(resolve => {
      loader.load(
        asset.model,
        gltf => {
          cached.source = gltf.scene;
          cached.animations = gltf.animations || [];
          cached.loading = false;
          cached.failed = false;

          cached.source.traverse(object => {
            if (!object.isMesh) return;

            object.castShadow = false;
            object.receiveShadow = false;
            object.frustumCulled = true;

            if (object.material) makeMaterialCrisp(THREE, object.material);
          });

          enemies.forEach(enemy => {
            if (enemy.userData.typeId === typeId && !enemy.userData.model) {
              attachEnemyModel(enemy);
            }
          });

          resolve(cached);
        },
        undefined,
        error => {
          cached.loading = false;
          cached.failed = true;
          console.warn(`Enemy model failed to preload: ${typeId}`, error);
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

  function getEnemyType(typeId) {
    return enemyTypes[typeId];
  }

  function chooseEnemyTypeForWave() {
    return config.enemySpawn.types[Math.floor(Math.random() * config.enemySpawn.types.length)];
  }

  function spawnOne() {
    if (!floorObjects || floorObjects.length === 0) {
      console.warn("No G55FLR floor objects found for enemy spawning");
      return false;
    }

    const point = getRandomFloorPoint();
    if (!point) return false;

    createEnemy(
      point.x,
      point.y,
      point.z,
      chooseEnemyTypeForWave()
    );

    return true;
  }

  function spawnWave() {
    const count = state.enemyLimit;

    if (!floorObjects || floorObjects.length === 0) {
      console.warn("No G55FLR floor objects found for enemy spawning");
      return;
    }

    for (let i = 0; i < count; i++) {
      spawnOne();
    }
  }

  function getRandomFloorPoint() {
    let point = null;
    let tries = NAV_TUNING.maxTargetTries;

    while (!point && tries-- > 0) {
      const mesh = floorObjects[Math.floor(Math.random() * floorObjects.length)];
      point = getRandomPointOnMesh(mesh);
    }

    return point;
  }

  function getRandomPointOnMesh(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;

    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;

    let a;
    let b;
    let c;

    if (index) {
      const triangleIndex = Math.floor(Math.random() * (index.count / 3)) * 3;

      a = index.getX(triangleIndex);
      b = index.getX(triangleIndex + 1);
      c = index.getX(triangleIndex + 2);
    } else {
      const triangleIndex = Math.floor(Math.random() * (position.count / 3)) * 3;

      a = triangleIndex;
      b = triangleIndex + 1;
      c = triangleIndex + 2;
    }

    const vA = new THREE.Vector3().fromBufferAttribute(position, a);
    const vB = new THREE.Vector3().fromBufferAttribute(position, b);
    const vC = new THREE.Vector3().fromBufferAttribute(position, c);

    const r1 = Math.random();
    const r2 = Math.random();
    const sqrtR1 = Math.sqrt(r1);

    const point = new THREE.Vector3()
      .addScaledVector(vA, 1 - sqrtR1)
      .addScaledVector(vB, sqrtR1 * (1 - r2))
      .addScaledVector(vC, sqrtR1 * r2);

    mesh.updateWorldMatrix(true, false);
    point.applyMatrix4(mesh.matrixWorld);

    const terrainY = getTerrainY(point.x, point.y + TERRAIN_TUNING.rayExtraHeight, point.z, null);

    if (terrainY === null) return null;

    point.y = terrainY + TERRAIN_TUNING.enemyBaseOffset;
    return point;
  }

  function createEnemy(x, y, z, typeId) {
    const type = getEnemyType(typeId);

    const group = new THREE.Group();
    group.position.set(x, y, z);

    const asset = type.asset || {};

    group.userData = {
      typeId: typeId,
      type,
      health: asset.enemyHealth,
      speed: asset.enemySpeed,
      damage: asset.enemyDamage,
      attackDistance: asset.attackDistance,
      attackDuration: 0,
      attackDamageDelay: asset.attackDamageDelay,
      lastAttack: 0,
      mixer: null,
      actions: {},
      currentAction: null,
      isAttacking: false,
      attackTimer: 0,
      attackElapsed: 0,
      pendingDamage: false,
      isHitReacting: false,
      hitTimer: 0,
      model: null,
      groundY: y,
      verticalVelocity: 0,
      navTarget: null,
      navTargetAge: 0
    };

    snapEnemyToTerrain(group, true);

    scene.add(group);
    enemies.push(group);

    attachEnemyModel(group);
    group.updateMatrixWorld(true);
    preloadEnemyType(typeId);
  }

  function attachEnemyModel(enemy) {
    const type = enemy.userData.type;
    const cached = modelCache.get(enemy.userData.typeId);

    if (!cached || !cached.source || enemy.userData.model) return;

    const model = SkeletonUtils.clone(cached.source);

    const assetScale = type.asset.scale || [1, 1, 1];
    model.scale.set(assetScale[0], assetScale[1], assetScale[2]);

    const assetRotation = type.asset.rotation || [0, 0, 0];
    const assetPositionY = Number(type.asset.positionY) || 0;

    model.rotation.set(assetRotation[0], assetRotation[1], assetRotation[2]);
    model.position.y += assetPositionY;

    model.traverse(object => {
      if (!object.isMesh || !object.material) return;

      if (Array.isArray(object.material)) {
        object.material = object.material.map(material => material.clone());
      } else {
        object.material = object.material.clone();
      }

      makeMaterialCrisp(THREE, object.material);
    });

    enemy.add(model);
    enemy.userData.model = model;
    enemy.updateMatrixWorld(true);

    if (cached.animations.length) {
      setupEnemyAnimations(enemy, model, cached.animations);
      if (!enemy.userData.isAttacking) playEnemyAnimation(enemy, "walk");
    }
  }

  function makeClipInPlace(clip, model) {
    const inPlaceClip = clip.clone();
    const nodeDepthByName = new Map();

    model.traverse(object => {
      if (!object.name) return;

      let depth = 0;
      let parent = object.parent;

      while (parent && parent !== model) {
        depth++;
        parent = parent.parent;
      }

      const key = object.name.trim().toLowerCase();
      const currentDepth = nodeDepthByName.get(key);

      if (currentDepth === undefined || depth < currentDepth) {
        nodeDepthByName.set(key, depth);
      }
    });

    const candidates = inPlaceClip.tracks
      .filter(track => track.name.toLowerCase().endsWith(".position"))
      .map(track => {
        const valueSize = track.getValueSize();
        const values = track.values;

        if (valueSize < 3 || values.length < valueSize) return null;

        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < values.length; i += valueSize) {
          minX = Math.min(minX, values[i]);
          maxX = Math.max(maxX, values[i]);
          minZ = Math.min(minZ, values[i + 2]);
          maxZ = Math.max(maxZ, values[i + 2]);
        }

        const horizontalMotion = Math.hypot(maxX - minX, maxZ - minZ);
        if (horizontalMotion <= 0.00001) return null;

        const targetPath = track.name.slice(0, -".position".length);
        const bonesMatch = targetPath.match(/bones\[([^\]]+)\]$/i);
        const targetName = (bonesMatch ? bonesMatch[1] : targetPath.split(/[/.]/).pop() || "")
          .trim()
          .toLowerCase();

        return {
          track,
          valueSize,
          targetName,
          depth: nodeDepthByName.get(targetName) ?? Number.MAX_SAFE_INTEGER,
          likelyRoot: /(root|hips|pelvis|armature)/i.test(targetName),
          horizontalMotion
        };
      })
      .filter(Boolean);

    if (!candidates.length) return inPlaceClip;

    candidates.sort((a, b) => {
      if (a.likelyRoot !== b.likelyRoot) return a.likelyRoot ? -1 : 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.horizontalMotion - a.horizontalMotion;
    });

    const rootTrack = candidates[0];
    const values = rootTrack.track.values;
    const startX = values[0];
    const startZ = values[2];

    for (let i = 0; i < values.length; i += rootTrack.valueSize) {
      values[i] = startX;
      values[i + 2] = startZ;
    }

    return inPlaceClip;
  }

  function setupEnemyAnimations(enemy, model, animations) {
    const mixer = new THREE.AnimationMixer(model);
    const assetAnim = enemy.userData.type.asset.anim || {};

    enemy.userData.mixer = mixer;
    enemy.userData.actions = {};
    enemy.userData.attackActions = [];
    enemy.userData.hitActions = [];
    enemy.userData.selectedAnimationClips = {};

    Object.entries(assetAnim).forEach(([name, clipNames]) => {
      if (!Array.isArray(clipNames)) {
        console.warn(`Enemy animation action must be a clip-name array: ${name}`);
        return;
      }

      // Empty arrays are allowed for optional actions such as hit reactions.
      if (clipNames.length === 0) return;

      const validClipNames = clipNames
        .filter(clipName => typeof clipName === "string" && clipName.trim())
        .map(clipName => clipName.trim());

      if (!validClipNames.length) {
        console.warn(`Enemy animation action has no valid clip names: ${name}`);
        return;
      }

      const availableClips = validClipNames
        .map(clipName => {
          const clip = findAnimationClip(animations, clipName);

          if (!clip) {
            console.warn(`Missing enemy animation clip: ${clipName}`);
            return null;
          }

          return clip;
        })
        .filter(Boolean);

      if (!availableClips.length) {
        console.warn(`No configured enemy animation clips were found for action: ${name}`);
        return;
      }

      // Attack and hit reactions keep every configured clip ready. A fresh
      // random action is chosen each time that state starts.
      if (name === "attack" || name === "hit") {
        const randomActions = availableClips.map(clip => {
          // Attacks use the same in-place treatment as walking so root-motion
          // X/Z translation cannot move the visual model independently of the
          // enemy group. Hit reactions keep their original motion.
          const actionClip = name === "attack"
            ? makeClipInPlace(clip, model)
            : clip;

          const action = mixer.clipAction(actionClip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          return action;
        });

        if (name === "attack") {
          enemy.userData.attackActions = randomActions;
        } else {
          enemy.userData.hitActions = randomActions;
        }
        return;
      }

      let clip = availableClips[Math.floor(Math.random() * availableClips.length)];
      enemy.userData.selectedAnimationClips[name] = clip.name;

      if (name === "walk") {
        clip = makeClipInPlace(clip, model);
      }

      const action = mixer.clipAction(clip);
      const loop = name === "walk";

      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;

      enemy.userData.actions[name] = action;
    });
  }

  function findAnimationClip(animations, name) {
    const wanted = String(name).trim().toLowerCase();

    return animations.find(clip => {
      const clipName = String(clip.name || "").trim().toLowerCase();
      return clipName === wanted;
    }) || null;
  }

  function playEnemyAnimation(enemy, name, restart = false) {
    const action = enemy.userData.actions[name];
    if (!action) return false;
    if (enemy.userData.currentAction === action && !restart) return true;

    if (enemy.userData.currentAction && enemy.userData.currentAction !== action) {
      enemy.userData.currentAction.fadeOut(0.08);
    }

    action.reset().fadeIn(0.08).play();
    enemy.userData.currentAction = action;
    return true;
  }

  function playEnemyAttack(enemy) {
    const attackActions = enemy.userData.attackActions || [];
    if (!attackActions.length) return 0;

    // Pick again for every attack so one enemy can use every configured attack
    // clip over its lifetime.
    const attackAction = attackActions[Math.floor(Math.random() * attackActions.length)];

    if (enemy.userData.currentAction && enemy.userData.currentAction !== attackAction) {
      enemy.userData.currentAction.fadeOut(0.08);
    }

    attackAction.reset().fadeIn(0.08).play();
    enemy.userData.currentAction = attackAction;
    enemy.userData.attackDuration = attackAction.getClip().duration;

    return enemy.userData.attackDuration;
  }

  function playEnemyHitReaction(enemy) {
    const hitActions = enemy.userData.hitActions || [];
    if (!hitActions.length) return false;

    // Pick again on every hit, so one enemy can alternate between all configured
    // hit reaction clips over its lifetime.
    const hitAction = hitActions[Math.floor(Math.random() * hitActions.length)];

    // A hit interrupts the current attack so damage cannot land after the enemy
    // has already been staggered by the player.
    enemy.userData.isAttacking = false;
    enemy.userData.pendingDamage = false;
    enemy.userData.attackTimer = 0;
    enemy.userData.attackElapsed = 0;

    if (enemy.userData.currentAction && enemy.userData.currentAction !== hitAction) {
      enemy.userData.currentAction.fadeOut(0.08);
    }

    hitAction.reset().fadeIn(0.08).play();
    enemy.userData.currentAction = hitAction;
    enemy.userData.isHitReacting = true;
    enemy.userData.hitTimer = hitAction.getClip().duration;

    return true;
  }

  function update(delta, isPlaying, takeDamage) {
    if (!isPlaying) return;

    const nowTime = performance.now();
    const playerPosition = camera.position;

    enemies.forEach(enemy => {
      if (enemy.userData.mixer) enemy.userData.mixer.update(delta);

      if (enemy.userData.isDying) {
        enemy.userData.deathTimer -= delta;

        if (enemy.userData.deathTimer <= 0) {
          removeEnemy(enemy);
        }

        return;
      }

      if (enemy.userData.isHitReacting) {
        enemy.userData.hitTimer = Math.max(0, enemy.userData.hitTimer - delta);

        toPlayer.set(
          playerPosition.x - enemy.position.x,
          0,
          playerPosition.z - enemy.position.z
        );

        if (toPlayer.lengthSq() > 0.0001) {
          enemy.lookAt(playerPosition.x, enemy.position.y, playerPosition.z);
        }

        if (enemy.userData.hitTimer <= 0) {
          enemy.userData.isHitReacting = false;
          playEnemyAnimation(enemy, "walk");
        }

        return;
      }

      if (enemy.userData.isAttacking) {
        enemy.userData.attackTimer = Math.max(0, enemy.userData.attackTimer - delta);
        enemy.userData.attackElapsed += delta;
      }

      toPlayer.set(
        playerPosition.x - enemy.position.x,
        0,
        playerPosition.z - enemy.position.z
      );

      const distance = Math.abs((playerPosition.y - config.playerHeight) - enemy.position.y) > enemy.userData.attackDistance ? Infinity : toPlayer.length();

      if (distance <= enemy.userData.attackDistance) {
        enemy.userData.navTarget = null;
        enemy.userData.navTargetAge = 0;
        enemy.lookAt(playerPosition.x, enemy.position.y, playerPosition.z);
      }

      if (distance > enemy.userData.attackDistance) {
        if (!enemy.userData.isAttacking) {
          moveEnemy(enemy, playerPosition, delta);
          playEnemyAnimation(enemy, "walk");
        }
      } else if (nowTime - enemy.userData.lastAttack > config.enemyAttackCooldown && !enemy.userData.isAttacking) {
        enemy.userData.lastAttack = nowTime;
        enemy.userData.isAttacking = true;
        enemy.userData.attackElapsed = 0;
        enemy.userData.pendingDamage = true;

        const attackDuration = playEnemyAttack(enemy);
        enemy.userData.attackTimer = Math.max(
          attackDuration || 0,
          enemy.userData.attackDamageDelay || 0
        );

        if (enemy.userData.type.asset.attackSound) {
          playAssetSound(enemy.userData.type.asset.attackSound, 1.0);
        }
      }

      if (
        enemy.userData.isAttacking &&
        enemy.userData.pendingDamage &&
        enemy.userData.attackElapsed >= enemy.userData.attackDamageDelay
      ) {
        enemy.userData.pendingDamage = false;

        const currentDistance = Math.abs((playerPosition.y - config.playerHeight) - enemy.position.y) > enemy.userData.attackDistance ? Infinity : getFlatDistance(enemy.position, playerPosition);

        if (currentDistance <= enemy.userData.attackDistance) {
          takeDamage(enemy.userData.damage);
        }
      }

      if (enemy.userData.isAttacking && enemy.userData.attackTimer <= 0) {
        enemy.userData.isAttacking = false;
        enemy.userData.pendingDamage = false;
        playEnemyAnimation(enemy, "walk");
      }
    });
  }

  function moveEnemy(enemy, playerPosition, delta) {
    enemy.userData.navTargetAge += delta;

    if (enemy.userData.navTarget && enemy.userData.navTargetAge > NAV_TUNING.targetMaxAge) {
      enemy.userData.navTarget = null;
      enemy.userData.navTargetAge = 0;
    }

    let moveTarget = playerPosition;

    if (enemy.userData.navTarget) {
      const navDistance = getFlatDistance(enemy.position, enemy.userData.navTarget);

      if (navDistance < NAV_TUNING.targetReachDistance) {
        enemy.userData.navTarget = null;
        enemy.userData.navTargetAge = 0;
      } else {
        moveTarget = enemy.userData.navTarget;
      }
    }

    const moveDirection = new THREE.Vector3(
      moveTarget.x - enemy.position.x,
      0,
      moveTarget.z - enemy.position.z
    );

    if (moveDirection.lengthSq() <= 0.0001) return;

    moveDirection.normalize();

    const oldX = enemy.position.x;
    const oldZ = enemy.position.z;

    const speed = enemy.userData.speed;

    enemy.position.x += moveDirection.x * speed * delta;
    enemy.position.z += moveDirection.z * speed * delta;

    if (!snapEnemyToTerrain(enemy, false)) {
      enemy.position.x = oldX;
      enemy.position.z = oldZ;

      enemy.userData.navTarget = getRandomFloorPoint();
      enemy.userData.navTargetAge = 0;
      return;
    }

    enemy.lookAt(moveTarget.x, enemy.position.y, moveTarget.z);
  }

  function getFlatDistance(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;

    return Math.sqrt(dx * dx + dz * dz);
  }

  function snapEnemyToTerrain(enemy, forceSnap) {
    const rayStartY = enemy.position.y + TERRAIN_TUNING.rayExtraHeight;
    const terrainY = getTerrainY(enemy.position.x, rayStartY, enemy.position.z, enemy);

    if (terrainY === null) return false;

    const targetY = terrainY + TERRAIN_TUNING.enemyBaseOffset;
    const deltaY = targetY - enemy.position.y;

    if (!forceSnap && deltaY > TERRAIN_TUNING.stepHeight) {
      return false;
    }

    enemy.position.y = targetY;
    enemy.userData.groundY = terrainY;
    enemy.userData.verticalVelocity = 0;

    return true;
  }

  function getTerrainY(x, y, z, enemy) {
    terrainRayOrigin.set(x, y, z);
    terrainRaycaster.set(terrainRayOrigin, terrainRayDirection);
    terrainRaycaster.far = TERRAIN_TUNING.rayLength;

    const hits = terrainRaycaster.intersectObjects(floorObjects, true);

    for (const hit of hits) {
      if (!hit.face) continue;

      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

      if (normal.y < TERRAIN_TUNING.minWalkableNormalY) continue;

      if (enemy && hit.point.y > enemy.position.y + TERRAIN_TUNING.stepHeight) continue;

      return hit.point.y;
    }

    return null;
  }

  function getHit(activeRaycaster) {
    const activeEnemies = enemies.filter(enemy => !enemy.userData.isDying);
    const hits = activeRaycaster.intersectObjects(activeEnemies, true);
    if (!hits.length) return null;

    const hit = hits[0];
    const enemy = findEnemyRoot(hit.object);

    if (!enemy) return null;

    return {
      type: "enemy",
      enemy,
      point: hit.point,
      normal: hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
        : new THREE.Vector3(0, 1, 0),
      distance: hit.distance
    };
  }

  function damageEnemy(enemy, damage) {
    if (!enemy || !enemies.includes(enemy)) return false;
    if (enemy.userData.isDying) return false;

    enemy.userData.health -= damage;

    if (enemy.userData.health <= 0) {
      enemy.userData.isDying = true;
      enemy.userData.isHitReacting = false;
      enemy.userData.hitTimer = 0;
      enemy.userData.isAttacking = false;
      enemy.userData.pendingDamage = false;

      if (enemy.userData.currentAction) {
        enemy.userData.currentAction.fadeOut(0.05);
      }

      const deathAction = enemy.userData.actions["death"];

      if (deathAction) {
        const deathSound = enemy.userData.type.asset.deathSound;

        if (deathSound) {
          playAssetSound(deathSound, 1.0);
        }

        deathAction.reset();
        deathAction.clampWhenFinished = true;
        deathAction.setLoop(THREE.LoopOnce, 1);
        deathAction.play();
        enemy.userData.currentAction = deathAction;

        enemy.userData.deathTimer = deathAction.getClip().duration;
      } else {
        removeEnemy(enemy);
        return true;
      }

      return true;
    }

    playEnemyHitReaction(enemy);
    return false;
  }

  function findEnemyRoot(object) {
    let current = object;

    while (current && !enemies.includes(current)) {
      current = current.parent;
    }

    return current;
  }

  function removeEnemy(enemy) {
    scene.remove(enemy);
    disposeObject(enemy);

    const index = enemies.indexOf(enemy);
    if (index !== -1) enemies.splice(index, 1);
  }

  function disposeObject(root) {
    root.traverse(object => {
      if (object.geometry) object.geometry.dispose();

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }

  function playAssetSound(src, volume = 1.0) {
    if (!src) return;

    const cached = audioCache.get(src);
    const audio = cached?.audio ? cached.audio.cloneNode(true) : new Audio(src);

    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  function reset() {
    while (enemies.length) removeEnemy(enemies[0]);
  }

  return {
    preloadAll,
    spawnWave,
    spawnOne,
    update,
    getHit,
    damageEnemy,
    reset,
    get count() {
      return enemies.filter(enemy => !enemy.userData.isDying).length;
    }
  };
}
