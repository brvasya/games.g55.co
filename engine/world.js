import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export function createWorld({ THREE, scene, worldConfig }) {
  const colliders = [];
  const tracers = [];
  const floorObjects = [];
  const skyObjects = [];

  const mapAsset = worldConfig.map;
  const skyConfig = worldConfig.sky;

  const SKY_COLOR_TOP = skyConfig.skyColorTop;
  const SKY_COLOR_MID = skyConfig.skyColorMid;
  const SKY_COLOR_HORIZON = skyConfig.skyColorHorizon;
  const FOG_COLOR = skyConfig.fogColor;

  createDaytimeSky();

  function resetPlayer(player) {
    if (!world.isLoaded || !world.spawn) return;

    player.reset({
      position: world.spawn.clone(),
      yaw: worldConfig.spawnYaw
    });
  }

  const world = {
    map: null,
    colliders,
    tracers,
    floorObjects,
    skyObjects,
    isLoaded: false,
    spawn: null,
    spawnObjectName: worldConfig.spawnObjectName,
    floorObjectPrefixes: worldConfig.floorObjectPrefixes,
    ready: null,
    resetPlayer,
    getRandomFloorPoint
  };

  world.ready = loadMap();

  function loadMap() {
    return new Promise(resolve => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      loader.load(
        mapAsset.model,
        gltf => {
          const map = gltf.scene;
          const mapScale = mapAsset.scale;

          map.scale.set(mapScale[0], mapScale[1], mapScale[2]);

          map.traverse(object => {
            if (!object.isMesh) return;

            object.castShadow = false;
            object.receiveShadow = false;
            object.frustumCulled = true;

            colliders.push(object);

            if (isFloorMesh(object)) {
              floorObjects.push(object);
            }
          });

          scene.add(map);

          world.map = map;
          world.isLoaded = true;

          const spawnObject = findSpawnObject(map);

          if (spawnObject) {
            const raw = new THREE.Vector3();
            spawnObject.getWorldPosition(raw);
            world.spawn = raw.clone();
          } else {
            console.warn(`Spawn object ${world.spawnObjectName} not found`);
          }

          resolve(world);
        },
        undefined,
        error => {
          console.error("Map GLB failed to load", error);
          world.isLoaded = true;
          resolve(world);
        }
      );
    });
  }

  function createDaytimeSky() {
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, skyConfig.fogNear, skyConfig.fogFar);

    createGradientSkyDome();
  }

  function createGradientSkyDome() {
    const radius = 1400;
    const geometry = new THREE.SphereGeometry(radius, 32, 16);
    const colors = [];
    const topColor = new THREE.Color(SKY_COLOR_TOP);
    const midColor = new THREE.Color(SKY_COLOR_MID);
    const horizonColor = new THREE.Color(SKY_COLOR_HORIZON);
    const position = geometry.attributes.position;

    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const t = THREE.MathUtils.clamp((y + radius * 0.15) / (radius * 1.15), 0, 1);
      const color = new THREE.Color();

      if (t < 0.45) {
        color.copy(horizonColor).lerp(midColor, t / 0.45);
      } else {
        color.copy(midColor).lerp(topColor, (t - 0.45) / 0.55);
      }

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      vertexColors: true,
      depthWrite: false,
      fog: false
    });

    const skyDome = new THREE.Mesh(geometry, material);
    skyDome.name = "DaytimeGradientSky";
    skyDome.renderOrder = -1000;
    scene.add(skyDome);
    skyObjects.push(skyDome);
  }

  function getRandomFloorPoint(maxTries = 20) {
    if (!floorObjects.length) return null;

    for (let i = 0; i < maxTries; i++) {
      const mesh = floorObjects[Math.floor(Math.random() * floorObjects.length)];

      mesh.updateWorldMatrix(true, false);

      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }

      const box = mesh.geometry.boundingBox.clone();
      box.applyMatrix4(mesh.matrixWorld);

      const x = THREE.MathUtils.lerp(box.min.x, box.max.x, Math.random());
      const z = THREE.MathUtils.lerp(box.min.z, box.max.z, Math.random());

      const rayOrigin = new THREE.Vector3(x, box.max.y + 50, z);
      const rayDirection = new THREE.Vector3(0, -1, 0);

      const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0, 200);
      const hits = raycaster.intersectObject(mesh, true);

      if (hits.length) {
        return hits[0].point.clone();
      }
    }

    return null;
  }

  function isFloorMesh(object) {
    const prefixes = Array.isArray(world.floorObjectPrefixes)
      ? world.floorObjectPrefixes
      : [world.floorObjectPrefixes];

    let current = object;

    while (current) {
      const name = (current.name || "").trim().toLowerCase();

      for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i].toLowerCase();

        if (name.startsWith(prefix)) {
          return true;
        }
      }

      current = current.parent;
    }

    return false;
  }

  function findSpawnObject(root) {
    let found = null;
    const targetName = world.spawnObjectName.toLowerCase();

    root.traverse(object => {
      if (found) return;

      const name = (object.name || "").trim().toLowerCase();

      if (name === targetName) {
        found = object;
      }
    });

    return found;
  }

  return world;
}
