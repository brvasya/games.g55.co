export const WORLD_SETTINGS = {
  seed: 1337,
  size: 120,
  terrainSegments: 48,
  terrainHeight: 1.15,
  terrainFrequency: 0.032,
  flatCenterRadius: 32,
  spawn: [0, 1.75, 12],
  spawnYaw: Math.PI,
  wallHeight: 8,
  wallThickness: 1.2,
  sky: {
    skyColorTop: 0x6fb8ff,
    skyColorMid: 0xa8d8ff,
    skyColorHorizon: 0xd8f0ff,
    fogColor: 0xd8f0ff,
    fogNear: 45,
    fogFar: 185
  }
};

export function createWorld({ THREE, scene }) {
  const colliders = [];
  const tracers = [];
  const floorObjects = [];
  const skyObjects = [];
  const root = new THREE.Group();
  root.name = "ProceduralWorld";
  scene.add(root);

  const world = {
    map: root,
    colliders,
    tracers,
    floorObjects,
    skyObjects,
    isLoaded: false,
    spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    ready: null,
    resetPlayer,
    getRandomFloorPoint
  };

  createDaytimeSky();
  createTerrain();
  createRoadMarkings();
  createBoundaryWalls();
  createArenaMarkers();
  createSkyline();

  world.isLoaded = true;
  world.ready = Promise.resolve(world);

  function resetPlayer(player) {
    if (!world.isLoaded || !world.spawn) return;

    player.reset({
      position: world.spawn.clone(),
      yaw: WORLD_SETTINGS.spawnYaw
    });
  }

  function createTerrain() {
    const size = WORLD_SETTINGS.size;
    const segments = WORLD_SETTINGS.terrainSegments;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      positions.setY(i, terrainSurfaceHeightAt(x, z));
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: 0x6d735f,
      roughness: 0.96,
      metalness: 0
    });

    const terrain = new THREE.Mesh(geometry, material);
    terrain.name = "ProceduralTerrain";
    terrain.receiveShadow = true;
    terrain.castShadow = false;
    terrain.frustumCulled = true;

    root.add(terrain);
    colliders.push(terrain);
    floorObjects.push(terrain);
  }

  function createRoadMarkings() {
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: 0x363b3e,
      roughness: 0.92,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0xd7c972,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    const roadLength = 52;
    addGroundOverlay(10, roadLength, 0, 0.025, 0, roadMaterial);
    addGroundOverlay(roadLength, 10, 0, 0.028, 0, roadMaterial);

    const dashLength = 3;
    const dashGap = 4;
    const limit = roadLength * 0.5 - 2;

    for (let p = -limit; p <= limit; p += dashLength + dashGap) {
      addGroundOverlay(0.22, dashLength, 0, 0.05, p, lineMaterial);
      addGroundOverlay(dashLength, 0.22, p, 0.052, 0, lineMaterial);
    }
  }

  function addGroundOverlay(width, depth, x, yOffset, z, material) {
    const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, terrainSurfaceHeightAt(x, z) + yOffset, z);
    mesh.frustumCulled = true;
    root.add(mesh);
  }

  function createBoundaryWalls() {
    const half = WORLD_SETTINGS.size * 0.5;
    const thickness = WORLD_SETTINGS.wallThickness;
    const height = WORLD_SETTINGS.wallHeight;

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x3e474d,
      roughness: 0.9,
      metalness: 0.05
    });

    const wallY = height * 0.5 - 2.5;

    addWall(0, wallY, -half, WORLD_SETTINGS.size + thickness * 2, height, thickness, wallMaterial);
    addWall(0, wallY, half, WORLD_SETTINGS.size + thickness * 2, height, thickness, wallMaterial);
    addWall(-half, wallY, 0, thickness, height, WORLD_SETTINGS.size, wallMaterial);
    addWall(half, wallY, 0, thickness, height, WORLD_SETTINGS.size, wallMaterial);
  }

  function addWall(x, y, z, width, height, depth, material) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const wall = new THREE.Mesh(geometry, material);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.frustumCulled = true;

    root.add(wall);
    colliders.push(wall);
  }

  function createArenaMarkers() {
    const centerY = terrainSurfaceHeightAt(0, 0) + 0.04;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xbfc7c9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(8.5, 9, 64),
      ringMaterial
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = centerY;
    root.add(ring);

    const spawnRing = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 2.45, 40),
      new THREE.MeshBasicMaterial({
        color: 0x7dd6ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
      })
    );
    spawnRing.rotation.x = -Math.PI / 2;
    spawnRing.position.set(
      WORLD_SETTINGS.spawn[0],
      terrainSurfaceHeightAt(WORLD_SETTINGS.spawn[0], WORLD_SETTINGS.spawn[2]) + 0.045,
      WORLD_SETTINGS.spawn[2]
    );
    root.add(spawnRing);
  }

  function createSkyline() {
    const random = mulberry32(WORLD_SETTINGS.seed);
    const half = WORLD_SETTINGS.size * 0.5;
    const skylineRadius = half + 12;
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x59646c,
      roughness: 0.95,
      metalness: 0
    });

    const count = 42;

    for (let i = 0; i < count; i++) {
      const side = i % 4;
      const width = 5 + random() * 7;
      const depth = 5 + random() * 7;
      const height = 7 + random() * 22;
      const along = (random() * 2 - 1) * (half + 22);
      const offset = skylineRadius + random() * 18;

      let x = 0;
      let z = 0;

      if (side === 0) {
        x = along;
        z = -offset;
      } else if (side === 1) {
        x = offset;
        z = along;
      } else if (side === 2) {
        x = along;
        z = offset;
      } else {
        x = -offset;
        z = along;
      }

      const geometry = new THREE.BoxGeometry(width, height, depth);
      const building = new THREE.Mesh(geometry, buildingMaterial);
      building.position.set(x, height * 0.5 - 1.2, z);
      building.castShadow = false;
      building.receiveShadow = false;
      building.frustumCulled = true;
      root.add(building);
    }
  }

  function createDaytimeSky() {
    const sky = WORLD_SETTINGS.sky;
    scene.background = new THREE.Color(sky.fogColor);
    scene.fog = new THREE.Fog(sky.fogColor, sky.fogNear, sky.fogFar);

    const radius = 1400;
    const geometry = new THREE.SphereGeometry(radius, 32, 16);
    const colors = [];
    const topColor = new THREE.Color(sky.skyColorTop);
    const midColor = new THREE.Color(sky.skyColorMid);
    const horizonColor = new THREE.Color(sky.skyColorHorizon);
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

    const half = WORLD_SETTINGS.size * 0.5 - 4;

    for (let i = 0; i < maxTries; i++) {
      const x = THREE.MathUtils.lerp(-half, half, Math.random());
      const z = THREE.MathUtils.lerp(-half, half, Math.random());
      const rayOrigin = new THREE.Vector3(x, 40, z);
      const raycaster = new THREE.Raycaster(
        rayOrigin,
        new THREE.Vector3(0, -1, 0),
        0,
        100
      );
      const hits = raycaster.intersectObjects(floorObjects, true);

      if (hits.length) return hits[0].point.clone();
    }

    return null;
  }

  function terrainSurfaceHeightAt(x, z) {
    const distanceFromCenter = Math.hypot(x, z);
    const flatten = smoothstep(
      WORLD_SETTINGS.flatCenterRadius,
      WORLD_SETTINGS.flatCenterRadius + 18,
      distanceFromCenter
    );

    return terrainHeightAt(x, z) * flatten;
  }

  function terrainHeightAt(x, z) {
    const frequency = WORLD_SETTINGS.terrainFrequency;
    const amplitude = WORLD_SETTINGS.terrainHeight;
    const seed = WORLD_SETTINGS.seed * 0.0173;

    const broad = Math.sin((x + seed * 11) * frequency) * Math.cos((z - seed * 7) * frequency * 0.86);
    const detail = Math.sin((x + z + seed * 19) * frequency * 1.9) * 0.32;
    const cross = Math.cos((x - z - seed * 5) * frequency * 1.35) * 0.18;

    return (broad + detail + cross) * amplitude;
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function mulberry32(seed) {
    let value = seed >>> 0;

    return function random() {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return world;
}
