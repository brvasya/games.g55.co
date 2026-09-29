import { createGLTFLoader } from "./gltfLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

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

  const HIT_TUNING = {
    // Hitboxes are generated once from the bind-pose skin weights. Each vertex
    // belongs to its strongest influencing bone, which keeps boxes tight and
    // prevents low-weight root/helper influences from creating huge hitboxes.
    minDominantWeight: 0.05,
    paddingRatio: 0.08,
    minPadding: 0.004,
    broadPhaseScale: 1.2
  };

  // Reused scratch objects keep bullet tests allocation-free.
  const broadHitSphere = new THREE.Sphere();
  const broadHitCenter = new THREE.Vector3();
  const hitInverseMatrix = new THREE.Matrix4();
  const hitLocalRay = new THREE.Ray();
  const hitLocalPoint = new THREE.Vector3();
  const hitWorldPoint = new THREE.Vector3();
  const hitLocalNormal = new THREE.Vector3();
  const hitWorldNormal = new THREE.Vector3();
  const hitBoxSize = new THREE.Vector3();
  const hitBoxPadding = new THREE.Vector3();
  const hitBuildVertex = new THREE.Vector3();
  const hitBuildWorldVertex = new THREE.Vector3();
  const hitBuildBoneVertex = new THREE.Vector3();
  const hitBroadBounds = new THREE.Box3();
  const hitTransformedBox = new THREE.Box3();
  const hitBroadSphereBuild = new THREE.Sphere();
  const bestHitPoint = new THREE.Vector3();
  const bestHitNormal = new THREE.Vector3();

  const terrainRaycaster = new THREE.Raycaster();
  const terrainRayOrigin = new THREE.Vector3();
  const terrainRayDirection = new THREE.Vector3(0, -1, 0);

  const modelCache = new Map();
  const animationCache = new Map();
  const audioCache = new Map();
  const hitboxTemplateCache = new Map();

  function getEnemyModelSources(asset) {
    const configured = Array.isArray(asset?.models)
      ? asset.models
      : (typeof asset?.model === "string" ? [asset.model] : []);
    const animationSrc = getEnemyAnimationSource(asset);

    return [...new Set(
      configured
        .filter(src => typeof src === "string" && src.trim())
        .map(src => src.trim())
        // The shared animation GLB is never a visual enemy model.
        .filter(src => src !== animationSrc)
    )];
  }

  function getEnemyAnimationSource(asset) {
    if (typeof asset?.animations !== "string") return null;
    const src = asset.animations.trim();
    return src || null;
  }

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
    const asset = type?.asset;
    if (!asset) return Promise.resolve(null);

    const tasks = getEnemyModelSources(asset).map(preloadEnemyModel);
    const animationSrc = getEnemyAnimationSource(asset);

    if (animationSrc) {
      tasks.push(preloadEnemyAnimationLibrary(animationSrc));
    }

    return tasks.length ? Promise.all(tasks) : Promise.resolve(null);
  }

  function preloadEnemyModel(src) {
    let cached = modelCache.get(src);

    if (cached?.promise) return cached.promise;
    if (cached?.source || cached?.failed) return Promise.resolve(cached);

    cached = {
      source: null,
      loading: true,
      failed: false,
      promise: null
    };

    modelCache.set(src, cached);

    const loader = createGLTFLoader();

    cached.promise = new Promise(resolve => {
      loader.load(
        src,
        gltf => {
          cached.source = gltf.scene;
          cached.loading = false;
          cached.failed = false;

          cached.source.traverse(object => {
            if (!object.isMesh) return;
            object.castShadow = false;
            object.receiveShadow = false;
            object.frustumCulled = true;
          });

          enemies.forEach(enemy => {
            if (enemy.userData.modelSrc === src && !enemy.userData.model) {
              attachEnemyModel(enemy);
            }
          });

          resolve(cached);
        },
        undefined,
        error => {
          cached.loading = false;
          cached.failed = true;
          console.warn(`Enemy model failed to preload: ${src}`, error);
          resolve(cached);
        }
      );
    });

    return cached.promise;
  }

  function discardAnimationLibraryScenes(gltf) {
    // anim.glb is data-only at runtime. Keep AnimationClips, then immediately
    // release any skeleton/mesh/material payload that happened to be exported
    // with the animation library so it can never become a visible enemy.
    const scenes = Array.isArray(gltf?.scenes) && gltf.scenes.length
      ? gltf.scenes
      : (gltf?.scene ? [gltf.scene] : []);

    const disposedTextures = new Set();
    const disposedMaterials = new Set();
    const disposedGeometries = new Set();

    const disposeMaterial = material => {
      if (!material || disposedMaterials.has(material)) return;
      disposedMaterials.add(material);

      Object.values(material).forEach(value => {
        if (!value || !value.isTexture || disposedTextures.has(value)) return;
        disposedTextures.add(value);
        value.dispose?.();
      });

      material.dispose?.();
    };

    scenes.forEach(animationScene => {
      animationScene.traverse(object => {
        if (object.geometry && !disposedGeometries.has(object.geometry)) {
          disposedGeometries.add(object.geometry);
          object.geometry.dispose?.();
        }

        if (Array.isArray(object.material)) {
          object.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(object.material);
        }
      });

      animationScene.clear();
    });
  }

  function preloadEnemyAnimationLibrary(src) {
    let cached = animationCache.get(src);

    if (cached?.promise) return cached.promise;
    if (cached?.animations || cached?.failed) return Promise.resolve(cached);

    cached = {
      animations: null,
      loading: true,
      failed: false,
      promise: null
    };

    animationCache.set(src, cached);

    const loader = createGLTFLoader();

    cached.promise = new Promise(resolve => {
      loader.load(
        src,
        gltf => {
          // Keep clips only. No scene, skeleton, mesh, material, or texture from
          // anim.glb is retained or attached to an enemy.
          cached.animations = (gltf.animations || []).map(clip => clip.clone());
          discardAnimationLibraryScenes(gltf);
          cached.loading = false;
          cached.failed = false;

          if (!cached.animations.length) {
            console.warn(`Enemy animation library contains no clips: ${src}`);
          }

          enemies.forEach(enemy => {
            if (enemy.userData.animationSrc === src) {
              setupEnemyAnimationsIfReady(enemy);
            }
          });

          resolve(cached);
        },
        undefined,
        error => {
          cached.loading = false;
          cached.failed = true;
          console.warn(`Enemy animation library failed to preload: ${src}`, error);
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
    const modelSources = getEnemyModelSources(asset);
    const modelSrc = modelSources.length
      ? modelSources[Math.floor(Math.random() * modelSources.length)]
      : null;
    const animationSrc = getEnemyAnimationSource(asset);

    group.userData = {
      typeId: typeId,
      type,
      modelSrc,
      animationSrc,
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
      hitboxes: [],
      broadHitVolume: null,
      model: null,
      groundY: y,
      verticalVelocity: 0,
      navTarget: null,
      navTargetAge: 0
    };

    if (!modelSrc) {
      console.warn(`Enemy type has no configured model: ${typeId}`);
    }

    snapEnemyToTerrain(group, true);

    scene.add(group);
    enemies.push(group);

    attachEnemyModel(group);
    group.updateMatrixWorld(true);
    preloadEnemyType(typeId);
  }

  function getEnemyAnimationClips(enemy) {
    const animationSrc = enemy.userData.animationSrc;
    if (!animationSrc) return [];

    const cachedAnimations = animationCache.get(animationSrc);
    return cachedAnimations?.animations || [];
  }

  function setupEnemyAnimationsIfReady(enemy) {
    if (!enemy.userData.model || enemy.userData.mixer) return;

    const animations = getEnemyAnimationClips(enemy);
    if (!animations.length) return;

    setupEnemyAnimations(enemy, enemy.userData.model, animations);

    if (!enemy.userData.isAttacking && !enemy.userData.isHitReacting) {
      playEnemyAnimation(enemy, "walk");
    }
  }

  function attachEnemyModel(enemy) {
    const type = enemy.userData.type;
    const cached = modelCache.get(enemy.userData.modelSrc);

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
    });

    enemy.add(model);
    enemy.userData.model = model;
    enemy.updateMatrixWorld(true);

    setupEnemyBoneHitboxes(enemy);
    setupEnemyAnimationsIfReady(enemy);
  }

  function setupEnemyBoneHitboxes(enemy) {
    const model = enemy?.userData?.model;
    if (!model) return;

    // Skin-weight analysis is cached per visual GLB. Only the first enemy using
    // a model scans its vertices; later clones reuse the local bone-box template.
    const cacheKey = enemy.userData.modelSrc || null;
    let template = cacheKey ? hitboxTemplateCache.get(cacheKey) : null;

    enemy.updateWorldMatrix(true, true);

    if (!template) {
      template = buildEnemyBoneHitboxTemplate(model);
      if (cacheKey) hitboxTemplateCache.set(cacheKey, template);
    }

    const hitboxes = [];

    for (const entry of template) {
      const bone = resolveNodeIndexPath(model, entry.path);
      if (!bone?.isBone) continue;

      hitboxes.push({
        bone,
        name: entry.name,
        vertexCount: entry.vertexCount,
        box: new THREE.Box3(
          new THREE.Vector3(entry.min[0], entry.min[1], entry.min[2]),
          new THREE.Vector3(entry.max[0], entry.max[1], entry.max[2])
        )
      });
    }

    enemy.userData.hitboxes = hitboxes;

    // Build one cheap broad-phase sphere from the bone boxes. This uses only a
    // handful of boxes, not the skinned vertices, and is done once per enemy.
    hitBroadBounds.makeEmpty();

    for (const hitbox of hitboxes) {
      hitTransformedBox.copy(hitbox.box).applyMatrix4(hitbox.bone.matrixWorld);
      hitBroadBounds.union(hitTransformedBox);
    }

    if (!hitBroadBounds.isEmpty()) {
      hitBroadBounds.getBoundingSphere(hitBroadSphereBuild);
      const localCenter = enemy.worldToLocal(hitBroadSphereBuild.center.clone());

      enemy.userData.broadHitVolume = {
        center: localCenter,
        radius: hitBroadSphereBuild.radius * HIT_TUNING.broadPhaseScale
      };
    } else {
      enemy.userData.broadHitVolume = null;
    }

    if (hitboxes.length === 0) {
      console.warn("Enemy skinned model produced no automatic bone hitboxes");
    }
  }

  function buildEnemyBoneHitboxTemplate(model) {
    const boneBounds = new Map();
    let skinnedMeshCount = 0;

    model.traverse(object => {
      if (!object.isSkinnedMesh || !object.geometry || !object.skeleton) return;

      const geometry = object.geometry;
      const position = geometry.attributes.position;
      const skinIndex = geometry.attributes.skinIndex;
      const skinWeight = geometry.attributes.skinWeight;
      const bones = object.skeleton.bones || [];

      if (!position || !skinIndex || !skinWeight || !bones.length) return;

      skinnedMeshCount++;
      object.updateWorldMatrix(true, false);

      const inverseByBone = new Map();
      for (const bone of bones) {
        if (!bone) continue;
        bone.updateWorldMatrix(true, false);
        inverseByBone.set(bone, bone.matrixWorld.clone().invert());
      }

      const influenceCount = Math.min(4, skinWeight.itemSize, skinIndex.itemSize);

      for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
        let strongestWeight = -Infinity;
        let strongestBoneIndex = -1;

        for (let component = 0; component < influenceCount; component++) {
          const weight = getAttributeComponent(skinWeight, vertexIndex, component);
          if (weight <= strongestWeight) continue;

          strongestWeight = weight;
          strongestBoneIndex = Math.round(
            getAttributeComponent(skinIndex, vertexIndex, component)
          );
        }

        if (
          strongestWeight < HIT_TUNING.minDominantWeight ||
          strongestBoneIndex < 0 ||
          strongestBoneIndex >= bones.length
        ) {
          continue;
        }

        const bone = bones[strongestBoneIndex];
        const boneInverse = inverseByBone.get(bone);
        if (!bone || !boneInverse) continue;

        let entry = boneBounds.get(bone);
        if (!entry) {
          const path = getNodeIndexPath(bone, model);
          if (!path) continue;

          entry = {
            bone,
            path,
            box: new THREE.Box3().makeEmpty(),
            vertexCount: 0,
            name: bone.name || `bone_${strongestBoneIndex}`
          };
          boneBounds.set(bone, entry);
        }

        hitBuildVertex.fromBufferAttribute(position, vertexIndex);
        hitBuildWorldVertex.copy(hitBuildVertex).applyMatrix4(object.matrixWorld);
        hitBuildBoneVertex.copy(hitBuildWorldVertex).applyMatrix4(boneInverse);

        entry.box.expandByPoint(hitBuildBoneVertex);
        entry.vertexCount++;
      }
    });

    const template = [];

    for (const entry of boneBounds.values()) {
      if (entry.box.isEmpty() || entry.vertexCount === 0) continue;

      entry.box.getSize(hitBoxSize);
      const maxDimension = Math.max(hitBoxSize.x, hitBoxSize.y, hitBoxSize.z);
      if (!Number.isFinite(maxDimension) || maxDimension <= 0.00001) continue;

      const padding = Math.max(
        maxDimension * HIT_TUNING.paddingRatio,
        HIT_TUNING.minPadding
      );

      hitBoxPadding.set(padding, padding, padding);
      entry.box.min.sub(hitBoxPadding);
      entry.box.max.add(hitBoxPadding);

      template.push({
        path: entry.path,
        name: entry.name,
        vertexCount: entry.vertexCount,
        min: [entry.box.min.x, entry.box.min.y, entry.box.min.z],
        max: [entry.box.max.x, entry.box.max.y, entry.box.max.z]
      });
    }

    if (skinnedMeshCount > 0 && template.length === 0) {
      console.warn("Enemy model has skinning data but no usable weighted bone vertices");
    }

    return template;
  }

  function getNodeIndexPath(node, root) {
    const path = [];
    let current = node;

    while (current && current !== root) {
      const parent = current.parent;
      if (!parent) return null;

      const childIndex = parent.children.indexOf(current);
      if (childIndex < 0) return null;

      path.push(childIndex);
      current = parent;
    }

    if (current !== root) return null;
    path.reverse();
    return path;
  }

  function resolveNodeIndexPath(root, path) {
    let current = root;

    for (const childIndex of path) {
      current = current?.children?.[childIndex];
      if (!current) return null;
    }

    return current;
  }

  function getAttributeComponent(attribute, index, component) {
    switch (component) {
      case 0: return attribute.getX(index);
      case 1: return attribute.getY(index);
      case 2: return attribute.getZ(index);
      case 3: return attribute.getW(index);
      default: return 0;
    }
  }

  function getLocalBoxHitNormal(box, point, target) {
    const minX = Math.abs(point.x - box.min.x);
    const maxX = Math.abs(box.max.x - point.x);
    const minY = Math.abs(point.y - box.min.y);
    const maxY = Math.abs(box.max.y - point.y);
    const minZ = Math.abs(point.z - box.min.z);
    const maxZ = Math.abs(box.max.z - point.z);

    let distance = minX;
    target.set(-1, 0, 0);

    if (maxX < distance) {
      distance = maxX;
      target.set(1, 0, 0);
    }
    if (minY < distance) {
      distance = minY;
      target.set(0, -1, 0);
    }
    if (maxY < distance) {
      distance = maxY;
      target.set(0, 1, 0);
    }
    if (minZ < distance) {
      distance = minZ;
      target.set(0, 0, -1);
    }
    if (maxZ < distance) {
      target.set(0, 0, 1);
    }

    return target;
  }

  function findRootMotionTrack(clip, model) {
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

    const candidates = clip.tracks
      .filter(track => track.name.toLowerCase().endsWith(".position"))
      .map(track => {
        const valueSize = track.getValueSize();
        const values = track.values;

        if (valueSize < 3 || values.length < valueSize * 2) return null;

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

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
      if (a.likelyRoot !== b.likelyRoot) return a.likelyRoot ? -1 : 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.horizontalMotion - a.horizontalMotion;
    });

    return candidates[0];
  }

  function getRootMotionSpeed(clip, model) {
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) return 0;

    const rootMotion = findRootMotionTrack(clip, model);
    if (!rootMotion) return 0;

    const values = rootMotion.track.values;
    const valueSize = rootMotion.valueSize;
    const last = values.length - valueSize;

    let scaleX = Math.abs(model.scale.x) || 1;
    let scaleZ = Math.abs(model.scale.z) || 1;

    // Root-position keys are transformed by the animated node's parent scale.
    // Use that world scale when the target node can be resolved; otherwise the
    // model scale is a good fallback for normal GLB skeletons.
    let targetObject = null;
    model.traverse(object => {
      if (targetObject || !object.name) return;
      if (object.name.trim().toLowerCase() === rootMotion.targetName) {
        targetObject = object;
      }
    });

    const scaleObject = targetObject?.parent || model;
    if (scaleObject) {
      scaleObject.updateWorldMatrix(true, false);
      const worldScale = new THREE.Vector3();
      scaleObject.getWorldScale(worldScale);
      scaleX = Math.abs(worldScale.x) || scaleX;
      scaleZ = Math.abs(worldScale.z) || scaleZ;
    }

    const startX = values[0];
    const startZ = values[2];
    let strideDistance = 0;

    // Use the farthest horizontal displacement from the first key rather than
    // only first-to-last. Some looping GLB clips snap the root back to its start
    // position on the final key, which would otherwise look like zero motion.
    for (let i = 0; i < values.length; i += valueSize) {
      const dx = (values[i] - startX) * scaleX;
      const dz = (values[i + 2] - startZ) * scaleZ;
      strideDistance = Math.max(strideDistance, Math.hypot(dx, dz));
    }

    // Ignore tiny root/pelvis sway from animations that are already authored
    // in-place. There is no reliable stride distance to synchronize in that case.
    if (strideDistance < 0.05) return 0;
    return strideDistance / clip.duration;
  }

  function makeClipInPlace(clip, model) {
    const inPlaceClip = clip.clone();
    const rootMotion = findRootMotionTrack(inPlaceClip, model);

    if (!rootMotion) return inPlaceClip;

    const values = rootMotion.track.values;
    const startX = values[0];
    const startZ = values[2];

    for (let i = 0; i < values.length; i += rootMotion.valueSize) {
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

      let walkNaturalSpeed = 0;

      if (name === "walk") {
        // Measure the original root motion before converting the clip to in-place.
        // The resulting playback multiplier keeps the feet synchronized with the
        // actual movement speed controlled by enemySpeed.
        walkNaturalSpeed = getRootMotionSpeed(clip, model);
        clip = makeClipInPlace(clip, model);
      }

      const action = mixer.clipAction(clip);
      const loop = name === "walk";

      if (loop && walkNaturalSpeed > 0) {
        const movementSpeed = Number(enemy.userData.speed) || 0;
        action.timeScale = movementSpeed > 0
          ? movementSpeed / walkNaturalSpeed
          : 0;

        enemy.userData.walkNaturalSpeed = walkNaturalSpeed;
        enemy.userData.walkTimeScale = action.timeScale;
      } else if (loop) {
        // A walk clip with no measurable root translation cannot be auto-synced.
        // Keep its authored playback rate rather than guessing a stride length.
        enemy.userData.walkNaturalSpeed = 0;
        enemy.userData.walkTimeScale = 1;
        console.warn(`Enemy walk clip has no measurable root motion for speed sync: ${clip.name}`);
      }

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
    let bestEnemy = null;
    let bestBoneName = null;
    let bestDistance = Infinity;

    const ray = activeRaycaster.ray;
    const near = Number.isFinite(activeRaycaster.near) ? activeRaycaster.near : 0;
    const far = Number.isFinite(activeRaycaster.far) ? activeRaycaster.far : Infinity;

    for (const enemy of enemies) {
      if (enemy.userData.isDying) continue;

      const hitboxes = enemy.userData.hitboxes;
      if (!hitboxes || hitboxes.length === 0) continue;

      // Update only the enemy root first. Most enemies are rejected by this
      // broad-phase sphere without touching any animated bone matrices.
      enemy.updateWorldMatrix(true, false);

      const broad = enemy.userData.broadHitVolume;
      if (broad) {
        broadHitCenter.copy(broad.center).applyMatrix4(enemy.matrixWorld);
        broadHitSphere.center.copy(broadHitCenter);
        broadHitSphere.radius = broad.radius;

        if (!ray.intersectsSphere(broadHitSphere)) continue;
      }

      // A likely target passed the broad phase. Refresh its animated hierarchy
      // once for this shot, then ray-test bone-local boxes directly.
      enemy.updateMatrixWorld(true);

      for (const hitbox of hitboxes) {
        const bone = hitbox.bone;
        if (!bone) continue;

        hitInverseMatrix.copy(bone.matrixWorld).invert();
        hitLocalRay.copy(ray).applyMatrix4(hitInverseMatrix);

        const localIntersection = hitLocalRay.intersectBox(hitbox.box, hitLocalPoint);
        if (!localIntersection) continue;

        hitWorldPoint.copy(localIntersection).applyMatrix4(bone.matrixWorld);

        const distance = ray.origin.distanceTo(hitWorldPoint);
        if (distance < near || distance > far || distance >= bestDistance) continue;

        getLocalBoxHitNormal(hitbox.box, localIntersection, hitLocalNormal);
        hitWorldNormal.copy(hitLocalNormal).transformDirection(bone.matrixWorld);

        bestDistance = distance;
        bestEnemy = enemy;
        bestBoneName = hitbox.name;
        bestHitPoint.copy(hitWorldPoint);
        bestHitNormal.copy(hitWorldNormal);
      }
    }

    if (!bestEnemy) return null;

    return {
      type: "enemy",
      enemy: bestEnemy,
      bone: bestBoneName,
      headshot: isHeadshotBone(bestBoneName),
      point: bestHitPoint.clone(),
      normal: bestHitNormal.clone(),
      distance: bestDistance
    };
  }

  function isHeadshotBone(boneName) {
    if (!boneName) return false;
    return String(boneName).toLowerCase().includes("head");
  }

  function damageEnemy(enemy, damage, { instantKill = false, headshot = false } = {}) {
    if (!enemy || !enemies.includes(enemy)) return false;
    if (enemy.userData.isDying) return false;

    if (instantKill) {
      enemy.userData.health = 0;
    } else {
      enemy.userData.health -= damage;
    }

    if (enemy.userData.health <= 0) {
      enemy.userData.isDying = true;
      enemy.userData.isHitReacting = false;
      enemy.userData.hitTimer = 0;
      enemy.userData.isAttacking = false;
      enemy.userData.pendingDamage = false;

      if (enemy.userData.currentAction) {
        enemy.userData.currentAction.fadeOut(0.05);
      }

      // Headshot kills get their own death animation. If the configured
      // headshot clip is missing, fall back to the normal death action.
      const deathAction = headshot
        ? (enemy.userData.actions["headshot"] || enemy.userData.actions["death"])
        : enemy.userData.actions["death"];

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
