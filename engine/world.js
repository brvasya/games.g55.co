// Raccoon City street district. All map geometry and textures are procedural.
export const WORLD_SETTINGS = {
  seed: 19980928, size: 96, spawn: [0, 1.75, 24], spawnYaw: 0,
  sky: { top: 0x08131f, mid: 0x20333f, horizon: 0x655b53, fogColor: 0x293b43, fogNear: 34, fogFar: 116 },
  lighting: {
    hemisphereSky: 0xa6c7dc, hemisphereGround: 0x55534b, hemisphereIntensity: 1.15,
    sunColor: 0xb9d6ea, sunIntensity: 1.65, sunPosition: [-28, 45, -22]
  }
};

export function createWorld({ THREE, scene }) {
  const root = new THREE.Group();
  root.name = "RaccoonCity"; scene.add(root);
  const colliders = [], floorObjects = [], skyObjects = [], tracers = [];
  const obstacles = [], batches = new Map(), random = mulberry32(WORLD_SETTINGS.seed);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const planeGeo = new THREE.PlaneGeometry(1, 1), temp = new THREE.Object3D();
  const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const smoke = [], flames = [], emergencyLights = [];
  let elapsed = 0, fireLight, patrolLight, rain, navigation;
  const textures = {
    asphalt: surfaceTexture("asphalt"), brick: surfaceTexture("brick"),
    stone: surfaceTexture("stone"), concrete: surfaceTexture("concrete"),
    glow: glowTexture(), flame: flameTexture()
  };
  const mat = {
    asphalt: standard(0x697079, { map: textures.asphalt, roughness: 0.61, metalness: 0.18 }),
    brick: standard(0x72534b, { map: textures.brick }),
    brickDark: standard(0x575557, { map: textures.brick }),
    brickWarm: standard(0x937466, { map: textures.brick }),
    stone: standard(0xa4a49b, { map: textures.stone }),
    concrete: standard(0x97948a, { map: textures.concrete }),
    trim: standard(0xa2a99f), roof: standard(0x263139),
    metal: standard(0x39454a, { roughness: 0.65, metalness: 0.6 }),
    black: standard(0x121b21), glass: standard(0x15333d, { roughness: 0.25, metalness: 0.45 }),
    glassWarm: standard(0x866b42, { emissive: 0xdc9a43, emissiveIntensity: 0.5 }),
    glassBlue: standard(0x476775, { emissive: 0x6f9eab, emissiveIntensity: 0.26 }),
    shutter: standard(0x65716b, { metalness: 0.35 }),
    wood: standard(0x997a51, { map: textures.concrete }),
    yellow: standard(0xcbb775), white: standard(0xb4bdb5),
    red: standard(0x8b3832), rust: standard(0x6b4034),
    carBlue: standard(0x2e4f63, { roughness: 0.42, metalness: 0.4 }),
    carGreen: standard(0x496051, { roughness: 0.52, metalness: 0.35 }),
    carBrown: standard(0x705244, { roughness: 0.58, metalness: 0.3 }),
    redGlow: new THREE.MeshBasicMaterial({ color: 0xff3d30, toneMapped: false }),
    amberGlow: new THREE.MeshBasicMaterial({ color: 0xffd098, toneMapped: false }),
    headlight: new THREE.MeshBasicMaterial({ color: 0xffe6be, toneMapped: false })
  };
  const world = {
    map: root, colliders, tracers, floorObjects, skyObjects,
    isLoaded: false, spawn: new THREE.Vector3(...WORLD_SETTINGS.spawn),
    lighting: WORLD_SETTINGS.lighting, ready: null, navigation: null,
    resetPlayer, getRandomFloorPoint, update
  };
  createSky(); createGround(); createDistrict(); createPoliceStation();
  createStreetFurniture(); createQuarantine(); createTraffic();
  createStreetDressing(); createAtmosphere(); flushBatches();
  root.updateMatrixWorld(true);
  navigation = createNavigation(); world.navigation = navigation;
  world.isLoaded = true; world.ready = Promise.resolve(world);
  return world;

  function standard(color, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.04, ...extra });
  }
  function canvasTexture(width, height, draw) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function surfaceTexture(kind) {
    const texture = canvasTexture(256, 256, (ctx, w, h) => {
      const base = kind === "asphalt" ? 112 : 188, pixels = ctx.createImageData(w, h);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = base + (random() - 0.5) * (kind === "asphalt" ? 48 : 33);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      if (kind === "brick" || kind === "stone") {
        const row = kind === "brick" ? 24 : 64, col = kind === "brick" ? 64 : 128;
        ctx.strokeStyle = kind === "brick" ? "#777774" : "#92928b"; ctx.lineWidth = 2;
        for (let y = 0; y < h; y += row) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          for (let x = ((y / row) % 2) * col / 2; x <= w; x += col) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + row); ctx.stroke();
          }
        }
      } else if (kind === "concrete") {
        ctx.strokeStyle = "#969993"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
      }
      for (let i = 0; i < 24; i++) {
        ctx.fillStyle = "rgba(20,27,30," + (0.02 + random() * 0.08) + ")";
        ctx.fillRect(random() * w, random() * h, 3 + random() * 38, random() * 90);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === "asphalt" ? 22 : 3, kind === "asphalt" ? 22 : 3);
    return texture;
  }
  function instance(geo, material, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const key = geo.uuid + material.uuid;
    if (!batches.has(key)) batches.set(key, { geo, material, matrices: [] });
    temp.position.set(x, y, z); temp.rotation.set(rx, ry, rz); temp.scale.set(sx, sy, sz); temp.updateMatrix();
    batches.get(key).matrices.push(temp.matrix.clone());
  }
  function box(x, y, z, w, h, d, material, yaw = 0, solid = false, name = "Street obstacle") {
    instance(boxGeo, material, x, y, z, w, h, d, 0, yaw);
    if (solid) collider(x, y, z, w, h, d, yaw, name);
  }
  function collider(x, y, z, w, h, d, yaw = 0, name = "City collision", navigationBlock = true) {
    const mesh = new THREE.Mesh(boxGeo, hiddenMaterial);
    mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, d);
    root.add(mesh); colliders.push(mesh);
    if (navigationBlock) obstacles.push({ x, z, halfW: w / 2, halfD: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw) });
    return mesh;
  }
  function groundPlane(w, d, x, z, material, y = 0.018, angle = 0) {
    instance(planeGeo, material, x, y, z, w, d, 1, -Math.PI / 2, 0, angle);
  }
  function cylinder(x, y, z, radius, height, material, rx = 0, ry = 0, rz = 0) {
    instance(cylinderGeo, material, x, y, z, radius, height, radius, rx, ry, rz);
  }
  function localPosition(x, z, yaw, lx, lz) {
    return [x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z - Math.sin(yaw) * lx + Math.cos(yaw) * lz];
  }
  function localBox(x, z, yaw, lx, y, lz, w, h, d, material) {
    const p = localPosition(x, z, yaw, lx, lz); box(p[0], y, p[1], w, h, d, material, yaw);
  }
  function flushBatches() {
    for (const { geo, material, matrices } of batches.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
      matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.name = "City details";
      mesh.castShadow = geo !== planeGeo && !material.isMeshBasicMaterial;
      mesh.receiveShadow = !material.isMeshBasicMaterial; root.add(mesh);
    }
    batches.clear();
  }
  function createGround() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), mat.asphalt);
    ground.name = "G55FLR_RaccoonStreets"; ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    root.add(ground); colliders.push(ground); floorObjects.push(ground);
    // Curbs remain below the engine's automatic step height.
    for (const x of [-10.5, 10.5]) { sidewalk(x, -23, 3, 38); sidewalk(x, 28, 3, 30); }
    for (const x of [-29, 29]) { sidewalk(x, -5.5, 36, 3); sidewalk(x, 13.5, 36, 3); }
    sidewalk(0, -29, 30, 7);
    for (let z = -42; z < 44; z += 6) {
      if (z > -10 && z < 18) continue;
      groundPlane(0.14, 3.2, -0.22, z, mat.yellow); groundPlane(0.14, 3.2, 0.22, z, mat.yellow);
    }
    for (let x = -42; x < 44; x += 7) {
      if (Math.abs(x) < 13) continue;
      groundPlane(3.5, 0.15, x, 3.8, mat.yellow); groundPlane(3.5, 0.15, x, 4.2, mat.yellow);
    }
    for (const z of [-3, 11]) for (let x = -7.5; x <= 7.5; x += 1.8) groundPlane(0.9, 2.3, x, z, mat.white);
    for (const x of [-11, 11]) for (let z = -1.5; z < 10; z += 1.8) groundPlane(2.3, 0.85, x, z, mat.white);
    for (const z of [-12, 22, 37]) {
      box(-8.8, 0.04, z, 0.45, 0.06, 1.4, mat.metal);
      for (let d = -0.5; d <= 0.5; d += 0.2) box(-8.8, 0.08, z + d, 0.42, 0.01, 0.05, mat.black);
    }
    for (const p of [[4, 4], [-4, 30], [23, 2], [-21, 6]]) {
      cylinder(p[0], 0.022, p[1], 0.64, 0.025, mat.metal);
      for (let d = -0.4; d < 0.5; d += 0.14) groundPlane(0.95, 0.028, p[0], p[1] + d, mat.black, 0.038);
    }
  }
  function sidewalk(x, z, w, d) {
    box(x, 0.03, z, w, 0.18, d, mat.concrete);
    floorObjects.push(collider(x, 0.03, z, w, 0.18, d, 0, "Walkable sidewalk", false));
  }
  function building(x, z, w, d, h, material, label) {
    box(x, h / 2, z, w, h, d, material, 0, true, label);
    box(x, 0.35, z, w + 0.3, 0.7, d + 0.3, mat.stone);
    box(x, h - 0.3, z, w + 0.45, 0.45, d + 0.45, mat.trim);
    box(x, h + 0.1, z, w + 0.25, 0.25, d + 0.25, mat.roof);
    box(x, 4.1, z, w + 0.16, 0.22, d + 0.16, mat.trim);
    box(x - w * 0.23, h + 0.8, z, 2.6, 1.4, 2.1, mat.metal);
    for (let side = 0; side < 4; side++) {
      const yaw = side * Math.PI / 2, width = side % 2 ? d : w, depth = side % 2 ? w : d;
      const count = Math.max(2, Math.floor(width / 3));
      for (let y = 5.5; y < h - 1; y += 3.4) for (let i = 0; i < count; i++) {
        const lx = (i + 0.5) * width / count - width / 2;
        const glass = random() > 0.85 ? mat.glassWarm : random() > 0.86 ? mat.glassBlue : mat.glass;
        localBox(x, z, yaw, lx, y, depth / 2 + 0.025, 1.35, 2.05, 0.07, mat.black);
        localBox(x, z, yaw, lx, y, depth / 2 + 0.075, 1.08, 1.78, 0.04, glass);
        localBox(x, z, yaw, lx, y - 1.05, depth / 2 + 0.12, 1.6, 0.16, 0.26, mat.trim);
        localBox(x, z, yaw, lx, y, depth / 2 + 0.115, 0.06, 1.8, 0.04, mat.metal);
        localBox(x, z, yaw, lx, y - 0.1, depth / 2 + 0.115, 1.1, 0.07, 0.04, mat.metal);
      }
    }
    cylinder(x - w / 2 + 0.25, h / 2, z + d / 2 + 0.18, 0.085, h, mat.metal);
    for (let y = 5; y < h - 2; y += 3.4) {
      box(x + w / 2 - 3, y, z + d / 2 + 0.8, 3.8, 0.14, 1.7, mat.metal);
      box(x + w / 2 - 3, y + 0.9, z + d / 2 + 1.5, 3.8, 0.07, 0.07, mat.metal);
      for (let k = 0; k < 6; k++) box(x + w / 2 - 4.6 + k * 0.6, y + 0.45, z + d / 2 + 1.5, 0.055, 0.9, 0.055, mat.metal);
    }
  }
  function createDistrict() {
    building(-23, -16, 22, 18, 13, mat.brick, "Kendo block");
    building(-24, -32, 18, 10, 20, mat.brickDark, "North apartments");
    building(23, -15, 22, 16, 11, mat.brickWarm, "Diner block");
    building(27, -31, 12, 12, 23, mat.brickDark, "Hospital block");
    building(-24, 24, 22, 20, 18, mat.brickDark, "Cinema block");
    building(-24, 41, 22, 8, 11, mat.brick, "South warehouse");
    building(24, 24, 20, 20, 12, mat.brickWarm, "Stagla block");
    building(26, 41, 18, 8, 19, mat.brick, "South apartments");
    storefront(-11.94, -16, Math.PI / 2, "KENDO GUN SHOP", "HUNTING / AMMUNITION / REPAIRS", "#af8a4f", 14);
    storefront(11.94, -15, -Math.PI / 2, "MOON'S DINER", "OPEN LATE / COFFEE & DONUTS", "#559c9c", 13);
    storefront(-24, 13.94, Math.PI, "ARGO CINEMA", "LAST SHOW / 9:30 PM", "#a85242", 15);
    storefront(24, 13.94, Math.PI, "STAGLA SERVICE", "AUTO REPAIR / GASOLINE", "#6c9271", 14);
    storefront(20.94, -31, -Math.PI / 2, "RACCOON PHARMACY", "PRESCRIPTIONS / FIRST AID", "#61908c", 9);
    sign("EVACUATE", "THE CITY IS UNDER QUARANTINE", -12.94, 2.8, 23, 5.6, 1.5, Math.PI / 2, "#191e20", "#d9b282");
    sign("RACCOON CITY", "SEPTEMBER 1998", 34.05, 10.5, 23, 9, 2.6, Math.PI / 2, "#18262b", "#a5c3c3");
    for (const p of [[-35.8, -15], [35.7, -18], [-36, 27], [36.5, 27]]) dumpster(p[0], p[1]);
    for (const x of [-47, 47]) box(x, 1.7, 0, 1, 3.4, 96, mat.brickDark, 0, true, "District boundary");
    for (const z of [-47, 47]) box(0, 1.7, z, 96, 3.4, 1, mat.brickDark, 0, true, "District boundary");
    for (let i = 0; i < 38; i++) {
      const side = i % 4, along = (random() - 0.5) * 158, distance = 56 + random() * 20;
      const x = side % 2 ? (side === 1 ? distance : -distance) : along;
      const z = side % 2 ? along : (side === 0 ? -distance : distance), h = 17 + random() * 27;
      box(x, h / 2 - 1, z, 7 + random() * 10, h, 7 + random() * 9, i % 3 ? mat.brickDark : mat.brickWarm);
      box(x, h, z, 4, 1.2, 4, mat.roof);
    }
    for (const p of [[-24, -32, 21], [26, 41, 20]]) {
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(p[0] + dx, p[2] + 1.2, p[1] + dz, 0.15, 2.4, 0.15, mat.metal);
      cylinder(p[0], p[2] + 3.3, p[1], 1.7, 2.9, mat.wood); cylinder(p[0], p[2] + 4.8, p[1], 1.8, 0.2, mat.metal);
    }
  }
  function storefront(x, z, yaw, title, subtitle, color, width) {
    localBox(x, z, yaw, 0, 2, 0.1, width, 3.8, 0.22, mat.black);
    const bays = Math.floor(width / 3);
    for (let i = 0; i < bays; i++) {
      const lx = (i + 0.5) * width / bays - width / 2;
      localBox(x, z, yaw, lx, 1.85, 0.25, 2.4, 2.8, 0.1, i % 2 ? mat.glass : mat.shutter);
      for (let y = 0.8; y < 3.1; y += 0.38) localBox(x, z, yaw, lx, y, 0.32, 2.38, 0.035, 0.04, mat.metal);
      for (let plank = 0; plank < 2; plank++) {
        const p = localPosition(x, z, yaw, lx, 0.41);
        instance(boxGeo, mat.wood, p[0], 1.25 + plank * 0.9, p[1], 2.62, 0.26, 0.09, 0, yaw, (plank ? 1 : -1) * 0.13);
      }
    }
    const p = localPosition(x, z, yaw, 0, 0.35);
    sign(title, subtitle, p[0], 4.5, p[1], width + 0.3, 1.45, yaw, "#192226", color);
    localBox(x, z, yaw, 0, 3.63, 0.65, width + 0.65, 0.15, 1.3, mat.roof);
    localBox(x, z, yaw, 0, 3.55, 1.25, width + 0.65, 0.16, 0.08, mat.red);
  }
  function sign(title, subtitle, x, y, z, w, h, yaw, background = "#14242b", color = "#ccd5cc") {
    const texture = canvasTexture(1024, 256, ctx => {
      ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(12, 12, 1000, 232);
      ctx.textAlign = "center"; ctx.fillStyle = color;
      ctx.font = "bold " + (title.length > 19 ? 56 : 74) + "px Arial"; ctx.fillText(title, 512, subtitle ? 126 : 157, 938);
      if (subtitle) { ctx.font = "24px Arial"; ctx.fillText(subtitle, 512, 199, 918); }
      for (let i = 0; i < 80; i++) {
        ctx.fillStyle = "rgba(0,0,0," + random() * 0.16 + ")";
        ctx.fillRect(random() * 1024, random() * 256, 1 + random() * 18, random() * 4);
      }
    });
    const mesh = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.name = title; mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(w, h, 1); root.add(mesh); return mesh;
  }
  function createPoliceStation() {
    building(0, -39, 27, 12, 13.6, mat.stone, "Raccoon Police Department");
    box(-10.8, 7.2, -32.6, 4.3, 14.4, 1.4, mat.stone); box(10.8, 7.2, -32.6, 4.3, 14.4, 1.4, mat.stone);
    box(0, 7.25, -31.2, 15, 0.55, 4.2, mat.trim); box(0, 6.6, -31.2, 14.6, 0.8, 4, mat.stone);
    for (const x of [-6, -3.9, 3.9, 6]) {
      cylinder(x, 3.5, -30.7, 0.32, 5.7, mat.trim);
      box(x, 0.63, -30.7, 0.95, 0.4, 0.95, mat.stone); box(x, 6.15, -30.7, 0.9, 0.3, 0.9, mat.stone);
      collider(x, 3.25, -30.7, 0.7, 6.5, 0.7, 0, "RPD portico column");
    }
    for (let step = 0; step < 3; step++) {
      const z = -29.5 - step * 0.7, h = (step + 1) * 0.16;
      box(0, h / 2, z, 14, h, 0.7, mat.stone);
      floorObjects.push(collider(0, h / 2, z, 14, h, 0.7, 0, "RPD entrance step", false));
    }
    box(0, 2.2, -32.91, 4.4, 3.8, 0.14, mat.black);
    for (const x of [-1.05, 1.05]) {
      box(x, 2.2, -32.78, 1.9, 3.5, 0.18, mat.wood); box(x, 2.75, -32.66, 1.45, 1.65, 0.05, mat.glass);
    }
    sign("RACCOON POLICE", "DEPARTMENT", 0, 9.25, -32.87, 14, 2, 0, "#414d50", "#d8dbca");
    sign("R.P.D.", "SERVE AND PROTECT", 0, 6.68, -29.08, 8.1, 0.68, 0, "#1a303b", "#dac79a");
    sign("NO ENTRY", "EMERGENCY LOCKDOWN", 0, 2, -32.52, 2.8, 0.75, 0, "#4c2823", "#e6c49c");
    const shape = new THREE.Shape(); shape.moveTo(-7.4, 0); shape.lineTo(0, 3.1); shape.lineTo(7.4, 0); shape.closePath();
    const pediment = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.48, bevelEnabled: false }), mat.trim);
    pediment.position.set(0, 10.7, -32.7); root.add(pediment);
    cylinder(0, 11.65, -32.13, 0.67, 0.09, mat.metal, Math.PI / 2);
    sign("R.P.D.", "", 0, 11.65, -32.06, 1.05, 0.42, 0, "#25363b", "#d4c5a0");
    for (const x of [-9.5, 9.5]) {
      sign("R.P.D.", "POLICE", x, 5.4, -31.86, 1.9, 3.3, 0, "#142d40", "#b7c4c9");
      box(x, 7.1, -31.85, 2.15, 0.08, 0.09, mat.metal);
      box(x, 1.6, -26.4, 0.72, 3.2, 0.72, mat.stone, 0, true, "RPD gate pillar");
    }
    for (const side of [-1, 1]) {
      box(side * 12.2, 0.4, -26.4, 4.5, 0.8, 0.45, mat.stone, 0, true, "RPD courtyard fence");
      box(side * 12.2, 1.1, -26.4, 4.5, 0.07, 0.1, mat.metal); box(side * 12.2, 2, -26.4, 4.5, 0.07, 0.1, mat.metal);
      for (let x = 10.2; x < 14.4; x += 0.42) box(side * x, 1.45, -26.4, 0.055, 2.1, 0.055, mat.metal);
    }
    streetLamp(-7.4, -25, 1); streetLamp(7.4, -25, -1);
  }
  function dumpster(x, z) {
    box(x, 0.72, z, 2.5, 1.4, 1.55, mat.carGreen, 0, true, "Dumpster"); box(x, 1.47, z, 2.65, 0.18, 1.7, mat.black);
    for (const dx of [-0.9, 0.9]) box(x + dx, 0.2, z, 0.2, 0.4, 1.65, mat.metal);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), mat.black);
      mesh.position.set(x + 1.5 + random() * 0.5, 0.25, z - 0.7 + i * 0.4); mesh.scale.set(1, 0.85, 1); root.add(mesh);
    }
  }
  function createStreetFurniture() {
    for (const z of [-15, 19, 35]) { streetLamp(-9.7, z, 1); streetLamp(9.7, z, -1); }
    for (const p of [[-28, -5.8], [27, 13.7]]) streetLamp(p[0], p[1], p[0] < 0 ? 1 : -1);
    for (const p of [[-9.6, -4.7], [9.6, 12.7]]) {
      cylinder(p[0], 3.2, p[1], 0.1, 6.4, mat.metal); box(p[0] * 0.65, 6.35, p[1], 7, 0.11, 0.11, mat.metal);
      box(p[0] * 0.3, 5.8, p[1], 0.48, 1.3, 0.4, mat.black);
      for (let i = 0; i < 3; i++) {
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.135, 12), i === 0 ? mat.redGlow : mat.glass);
        mesh.position.set(p[0] * 0.3, 6.2 - i * 0.36, p[1] + 0.22); root.add(mesh);
      }
      sign("RACCOON ST", "", p[0], 3.8, p[1] + 0.12, 2.9, 0.45, 0, "#19382f", "#ccdbcc");
    }
    for (const p of [[-9.6, 27], [9.7, -20]]) {
      cylinder(p[0], 0.46, p[1], 0.19, 0.8, mat.red); cylinder(p[0], 0.91, p[1], 0.24, 0.18, mat.red);
      box(p[0], 0.62, p[1], 0.63, 0.21, 0.24, mat.red); collider(p[0], 0.5, p[1], 0.5, 1, 0.5, 0, "Fire hydrant");
    }
    for (const p of [[-10.3, 32], [10.4, -10]]) {
      cylinder(p[0], 0.8, p[1], 0.06, 1.6, mat.metal);
      box(p[0], 1.6, p[1], 0.36, 0.6, 0.24, mat.metal); box(p[0], 1.69, p[1] + 0.13, 0.23, 0.16, 0.03, mat.glass);
    }
    box(35.9, 1.25, 8, 0.95, 2.5, 0.9, mat.red, 0, true, "Emergency call box");
    sign("EMERGENCY", "NO SIGNAL", 35.9, 1.8, 8.46, 0.76, 0.58, 0, "#2b3331", "#d2af85");
    const points = [];
    for (const z of [-11, 20, 36]) for (let i = 0; i < 14; i++) {
      for (const t of [i / 14, (i + 1) / 14]) points.push(-13 + 26 * t, 10.5 - Math.sin(t * Math.PI) * 1.5, z);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    root.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x151d24 })));
  }
  function streetLamp(x, z, direction) {
    cylinder(x, 3.3, z, 0.095, 6.6, mat.metal); cylinder(x, 0.3, z, 0.19, 0.6, mat.metal);
    box(x + direction * 0.65, 6.55, z, 1.4, 0.11, 0.11, mat.metal);
    const lampX = x + direction * 1.3;
    box(lampX, 6.38, z, 0.64, 0.24, 0.36, mat.black); box(lampX, 6.24, z, 0.58, 0.035, 0.31, mat.amberGlow);
    glow(lampX, 6.2, z, 1.8, 0xffc98b, 0.3); lightPool(lampX, z, 6.5, 0xd6a675, 0.1);
    if (z === 19 && direction === 1 || z === -15 && direction === -1) {
      const light = new THREE.PointLight(0xffce92, 20, 13, 2); light.position.set(lampX, 5.4, z); root.add(light);
    }
    collider(x, 3.2, z, 0.25, 6.4, 0.25, 0, "Streetlamp");
  }
  function createQuarantine() {
    for (const x of [-5.8, 5.8]) barrier(x, 40.5, 0, 4.6);
    for (const z of [0, 8]) barrier(-42, z, Math.PI / 2, 4.2);
    for (const z of [-1, 9]) barrier(42, z, Math.PI / 2, 4.2);
    barrier(-5.7, -19.5, -0.14, 3.4); barrier(6.2, 15.3, 0.2, 3.2);
    sign("RACCOON CITY", "EVACUATION CHECKPOINT / R.P.D. AHEAD", 0, 5.4, 41.8, 15.8, 2, Math.PI, "#1d353c", "#c7d2c5");
    for (const x of [-8, 8]) cylinder(x, 3, 41.8, 0.12, 6, mat.metal);
    for (const p of [[-5.8, 40.2, 4.6], [-5.7, -19.7, 3.4]]) sign("POLICE LINE / DO NOT CROSS", "", p[0], 1.25, p[1], p[2], 0.23, 0, "#ceb65c", "#292d27");
  }
  function barrier(x, z, yaw, width) {
    box(x, 0.55, z, width, 1.1, 0.9, mat.concrete, yaw, true, "Police roadblock"); box(x, 1.12, z, width, 0.1, 0.6, mat.trim, yaw);
    for (let offset = -width / 2 + 0.22; offset < width / 2; offset += 0.52) {
      const p = localPosition(x, z, yaw, offset, 0.46); instance(boxGeo, mat.yellow, p[0], 0.72, p[1], 0.22, 0.5, 0.018, 0, yaw, -0.37);
    }
  }
  function createTraffic() {
    car(-4.3, -10.5, -0.25, mat.white, true); car(4.8, 29, 0.2, mat.carBlue);
    car(-4.7, 18.3, -0.13, mat.carBrown, false, true);
    car(23, 6.8, Math.PI / 2 + 0.12, mat.carGreen); car(-23, 1, Math.PI / 2 - 0.16, mat.white, true);
    car(5.1, -24, 0.16, mat.carBlue); car(39.5, -29, -0.05, mat.carBrown); truck(-25.5, 8.8, Math.PI / 2);
  }
  function car(x, z, yaw, paint, police = false, burned = false) {
    const body = burned ? mat.rust : paint;
    localBox(x, z, yaw, 0, 0.59, 0, 2.05, 0.66, 4.65, body);
    localBox(x, z, yaw, 0, 0.94, 1.43, 1.98, 0.12, 1.7, body); localBox(x, z, yaw, 0, 0.94, -1.65, 2, 0.16, 1.2, body);
    localBox(x, z, yaw, 0, 1.2, -0.22, 1.75, 0.62, 2.15, mat.glass); localBox(x, z, yaw, 0, 1.56, -0.32, 1.76, 0.12, 1.78, body);
    for (const dx of [-0.92, 0.92]) {
      localBox(x, z, yaw, dx, 1.2, -0.28, 0.09, 0.68, 0.16, body);
      localBox(x, z, yaw, dx, 1.19, 0.7, 0.09, 0.6, 0.11, body); localBox(x, z, yaw, dx, 1.16, -1.22, 0.09, 0.63, 0.11, body);
      if (police) localBox(x, z, yaw, dx * 1.12, 0.72, -0.1, 0.025, 0.28, 3.7, mat.carBlue);
      for (const dz of [-1.5, 1.45]) {
        const p = localPosition(x, z, yaw, dx * 1.12, dz); cylinder(p[0], 0.41, p[1], 0.41, 0.23, mat.black, 0, yaw, Math.PI / 2);
        const hub = localPosition(x, z, yaw, dx * 1.27, dz); cylinder(hub[0], 0.41, hub[1], 0.21, 0.025, mat.metal, 0, yaw, Math.PI / 2);
      }
    }
    localBox(x, z, yaw, 0, 0.49, 2.37, 2.05, 0.15, 0.12, mat.metal); localBox(x, z, yaw, 0, 0.49, -2.37, 2.05, 0.15, 0.12, mat.metal);
    for (const dx of [-0.72, 0.72]) {
      localBox(x, z, yaw, dx, 0.8, 2.34, 0.45, 0.24, 0.035, burned ? mat.black : mat.headlight);
      localBox(x, z, yaw, dx, 0.8, -2.34, 0.38, 0.2, 0.04, mat.red);
    }
    collider(x, 0.8, z, 2.22, 1.6, 4.85, yaw, police ? "Abandoned RPD cruiser" : "Abandoned car");
    if (police) {
      localBox(x, z, yaw, 0, 1.72, -0.27, 1.35, 0.14, 0.34, mat.black);
      for (const dx of [-0.43, 0.43]) {
        const p = localPosition(x, z, yaw, dx, -0.27), material = new THREE.MeshBasicMaterial({ color: dx < 0 ? 0xff4230 : 0x418aff, toneMapped: false });
        const lamp = new THREE.Mesh(boxGeo, material);
        lamp.position.set(p[0], 1.85, p[1]); lamp.scale.set(0.55, 0.18, 0.3); lamp.rotation.y = yaw; root.add(lamp);
        emergencyLights.push({ material, phase: dx < 0 ? 0 : Math.PI });
      }
      for (const side of [-1, 1]) {
        const p = localPosition(x, z, yaw, side * 1.044, -0.23);
        sign("R.P.D.", "POLICE", p[0], 0.8, p[1], 1.4, 0.42, yaw + side * Math.PI / 2, "#c1c6ba", "#183247");
      }
      if (!patrolLight) { patrolLight = new THREE.PointLight(0xff3020, 6, 8, 2); patrolLight.position.set(x, 2.2, z); root.add(patrolLight); }
    }
    if (burned) fire(x, z + 1.2);
  }
  function truck(x, z, yaw) {
    localBox(x, z, yaw, 0, 0.62, 0, 2.6, 0.4, 6.4, mat.black); localBox(x, z, yaw, 0, 1.9, -0.85, 2.6, 2.6, 4.5, mat.white);
    localBox(x, z, yaw, 0, 1.2, 2.2, 2.6, 1.55, 1.65, mat.white); localBox(x, z, yaw, 0, 1.97, 2.35, 2.2, 0.65, 0.9, mat.glass);
    for (const dx of [-1.3, 1.3]) for (const dz of [-2, 2]) {
      const p = localPosition(x, z, yaw, dx, dz); cylinder(p[0], 0.5, p[1], 0.5, 0.26, mat.black, 0, yaw, Math.PI / 2);
    }
    for (const side of [-1, 1]) {
      const p = localPosition(x, z, yaw, side * 1.31, -0.8);
      sign("UMBRELLA", "MEDICAL LOGISTICS", p[0], 2.15, p[1], 3.7, 1.4, yaw + side * Math.PI / 2, "#bfc7bd", "#78302b");
    }
    collider(x, 1.6, z, 2.8, 3.2, 6.7, yaw, "Abandoned medical truck");
  }
  function createStreetDressing() {
    const puddle = new THREE.MeshStandardMaterial({ color: 0x65818b, roughness: 0.13, metalness: 0.48, transparent: true, opacity: 0.25, depthWrite: false });
    const puddleGeo = new THREE.CircleGeometry(1, 14);
    for (let i = 0; i < 42; i++) {
      const x = (random() - 0.5) * 86, z = (random() - 0.5) * 88;
      if (blocked(x, z, 0)) continue;
      const mesh = new THREE.Mesh(puddleGeo, puddle); mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = random() * 6; mesh.position.set(x, 0.025, z);
      mesh.scale.set(0.7 + random() * 2.7, 0.25 + random(), 1); root.add(mesh);
    }
    const paper = standard(0xb2ad92);
    for (let i = 0; i < 135; i++) {
      const x = (random() - 0.5) * 87, z = (random() - 0.5) * 87;
      if (!blocked(x, z, 0)) groundPlane(0.12 + random() * 0.3, 0.18 + random() * 0.25, x, z, i % 5 ? paper : mat.rust, 0.028, random() * 6);
    }
    for (const p of [[-8, 35], [8, -28], [38.5, 15], [-39, -26]]) for (let i = 0; i < 4; i++) {
      box(p[0] + (random() - 0.5) * 1.5, 0.1, p[1] + (random() - 0.5) * 1.5, 0.2 + random() * 0.35, 0.2, 0.3, mat.rust, random() * 6);
    }
    sign("HELP", "WE ARE STILL HERE", 13.95, 2.3, 29.5, 4.5, 1.4, -Math.PI / 2, "#53423c", "#b7b1a3");
    sign("MISSING", "RACCOON CITY EMERGENCY NOTICE", -11.87, 2.7, -23.5, 0.9, 1.2, Math.PI / 2, "#b8b19c", "#333c3c");
    sign("DANGER", "BIOHAZARD / RESTRICTED AREA", 0, 2, 46.45, 5.6, 1.35, Math.PI, "#544a2c", "#d6c174");
  }
  function glowTexture() {
    return canvasTexture(128, 128, ctx => {
      const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 63);
      gradient.addColorStop(0, "rgba(255,255,255,0.8)"); gradient.addColorStop(0.2, "rgba(255,255,255,0.32)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    });
  }
  function flameTexture() {
    return canvasTexture(128, 256, ctx => {
      for (let i = 0; i < 7; i++) {
        const x = 25 + random() * 78, top = 15 + random() * 85, grad = ctx.createLinearGradient(0, top, 0, 246);
        grad.addColorStop(0, "rgba(204,45,9,0)"); grad.addColorStop(0.35, "rgba(255,116,22,0.68)");
        grad.addColorStop(0.8, "rgba(255,205,83,0.9)"); grad.addColorStop(1, "rgba(255,244,191,0.94)");
        ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(x, top);
        ctx.bezierCurveTo(x + 20, top + 80, x + 40, 160, x + 10, 247); ctx.lineTo(x - 20, 247);
        ctx.bezierCurveTo(x - 36, 175, x - 15, 95, x, top); ctx.fill();
      }
    });
  }
  function glow(x, y, z, size, color, opacity) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.set(x, y, z); sprite.scale.set(size, size, 1); root.add(sprite); return sprite;
  }
  function lightPool(x, z, size, color, opacity) {
    const material = new THREE.MeshBasicMaterial({ map: textures.glow, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(planeGeo, material); mesh.position.set(x, 0.034, z); mesh.rotation.x = -Math.PI / 2; mesh.scale.set(size, size, 1); root.add(mesh);
  }
  function fire(x, z) {
    for (let i = 0; i < 3; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.flame, color: 0xffca88, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
      sprite.position.set(x + (i - 1) * 0.3, 1.7, z); sprite.scale.set(1.2, 2.1, 1); root.add(sprite); flames.push({ sprite, phase: i * 2 });
    }
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: 0x43484b, transparent: true, opacity: 0.45, depthWrite: false }));
      root.add(sprite); smoke.push({ sprite, x, z, phase: i / 10 });
    }
    fireLight = new THREE.PointLight(0xff862b, 15, 12, 2); fireLight.position.set(x, 2.1, z); root.add(fireLight); lightPool(x, z, 9, 0xff772b, 0.22);
  }
  function createSky() {
    const settings = WORLD_SETTINGS.sky;
    scene.background = new THREE.Color(settings.fogColor); scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    const geometry = new THREE.SphereGeometry(450, 24, 16), colors = [];
    const top = new THREE.Color(settings.top), mid = new THREE.Color(settings.mid), horizon = new THREE.Color(settings.horizon);
    const position = geometry.attributes.position, color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = Math.max(0, position.getY(i) / 450);
      color.copy(t < 0.22 ? horizon : mid).lerp(t < 0.22 ? mid : top, t < 0.22 ? t / 0.22 : (t - 0.22) / 0.78); colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    dome.name = "Raccoon City night sky"; dome.renderOrder = -1000; scene.add(dome); skyObjects.push(dome);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb6c9cb, fog: false }));
    moon.position.set(-90, 130, -210); scene.add(moon); skyObjects.push(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.glow, color: 0x6a9eaa, opacity: 0.25, transparent: true, depthWrite: false, fog: false }));
    halo.position.copy(moon.position); halo.scale.set(45, 45, 1); scene.add(halo); skyObjects.push(halo);
  }
  function createAtmosphere() {
    const positions = new Float32Array(180 * 6);
    for (let i = 0; i < positions.length; i += 6) {
      positions[i] = (random() - 0.5) * 90; positions[i + 1] = 3 + random() * 23; positions[i + 2] = (random() - 0.5) * 90;
      positions[i + 3] = positions[i] - 0.08; positions[i + 4] = positions[i + 1] + 0.6; positions[i + 5] = positions[i + 2] + 0.04;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xabc0cb, transparent: true, opacity: 0.2, depthWrite: false }));
    rain.frustumCulled = false; rain.name = "Light rain"; root.add(rain);
  }
  function update(delta, camera) {
    elapsed += Math.min(delta, 0.05);
    for (const item of emergencyLights) item.material.color.setHex(item.phase ? 0x489dff : 0xff3d30).multiplyScalar(Math.sin(elapsed * 8 + item.phase) > 0.35 ? 1 : 0.12);
    if (patrolLight) { patrolLight.color.setHex(Math.sin(elapsed * 8) > 0 ? 0xff3925 : 0x3979ff); patrolLight.intensity = 5 + Math.abs(Math.sin(elapsed * 8)) * 5; }
    if (fireLight) fireLight.intensity = 13 + Math.sin(elapsed * 13) * 2 + Math.sin(elapsed * 21) * 1.4;
    for (const { sprite, phase } of flames) {
      sprite.scale.set(1.15 + Math.sin(elapsed * 12 + phase) * 0.13, 2.05 + Math.sin(elapsed * 16 + phase) * 0.25, 1);
      sprite.material.opacity = 0.75 + Math.sin(elapsed * 17 + phase) * 0.13;
    }
    for (const item of smoke) {
      const life = (elapsed * 0.12 + item.phase) % 1;
      item.sprite.position.set(item.x + life * 1.8 + Math.sin(life * 8 + item.phase) * 0.2, 2.4 + life * 7, item.z - life * 0.8);
      item.sprite.scale.setScalar(1.4 + life * 4.5); item.sprite.material.opacity = Math.sin(life * Math.PI) * 0.4;
    }
    const a = rain.geometry.attributes.position;
    for (let i = 0; i < a.array.length; i += 6) {
      a.array[i + 1] -= delta * 10; if (a.array[i + 1] < 0.3) a.array[i + 1] += 24; a.array[i + 4] = a.array[i + 1] + 0.6;
    }
    a.needsUpdate = true; if (camera) navigation.updateTarget(camera.position);
  }
  function blocked(x, z, margin = 0.55) {
    if (Math.abs(x) > 46.2 - margin || Math.abs(z) > 46.2 - margin) return true;
    for (const b of obstacles) {
      const dx = x - b.x, dz = z - b.z, lx = b.cos * dx - b.sin * dz, lz = b.sin * dx + b.cos * dz;
      if (Math.abs(lx) < b.halfW + margin && Math.abs(lz) < b.halfD + margin) return true;
    }
    return false;
  }
  function createNavigation() {
    // A shared flood field routes the horde around the same solid footprints.
    const cellSize = 1, width = 94, origin = -47, count = width * width;
    const walkable = new Uint8Array(count), distance = new Int32Array(count), queue = new Int32Array(count);
    const directionTarget = new THREE.Vector3(), ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 30);
    let lastCell = -1, lastUpdate = -10;
    const cellX = i => origin + (i % width + 0.5) * cellSize, cellZ = i => origin + (Math.floor(i / width) + 0.5) * cellSize;
    for (let i = 0; i < count; i++) walkable[i] = blocked(cellX(i), cellZ(i), 0.62) ? 0 : 1;
    function cellAt(x, z) {
      const gx = Math.floor((x - origin) / cellSize), gz = Math.floor((z - origin) / cellSize);
      return gx < 0 || gz < 0 || gx >= width || gz >= width ? -1 : gz * width + gx;
    }
    function nearestCell(point) {
      const direct = cellAt(point.x, point.z);
      if (direct >= 0 && walkable[direct]) return direct;
      let best = -1, bestDistance = Infinity;
      for (let i = 0; i < count; i++) {
        if (!walkable[i]) continue;
        const d = (cellX(i) - point.x) ** 2 + (cellZ(i) - point.z) ** 2;
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
      return best;
    }
    function updateTarget(point) {
      const cell = nearestCell(point);
      if (cell === lastCell || elapsed - lastUpdate < 0.2 && lastCell >= 0) return;
      lastCell = cell; lastUpdate = elapsed; distance.fill(-1);
      if (cell < 0) return;
      let head = 0, tail = 1; queue[0] = cell; distance[cell] = 0;
      while (head < tail) {
        const current = queue[head++], cx = current % width, cz = Math.floor(current / width);
        for (const offset of [-1, 1, -width, width]) {
          if (offset === -1 && cx === 0 || offset === 1 && cx === width - 1 || offset === -width && cz === 0 || offset === width && cz === width - 1) continue;
          const next = current + offset;
          if (!walkable[next] || distance[next] >= 0) continue;
          distance[next] = distance[current] + 1; queue[tail++] = next;
        }
      }
    }
    function hasLineOfSight(a, b, margin = 0.12) {
      if (Math.abs(b.x) > 46.2 - margin || Math.abs(b.z) > 46.2 - margin) return false;
      // Exact segment/expanded-box tests avoid clipping small corners between
      // samples, especially around diagonally parked vehicles.
      for (const block of obstacles) {
        const ax = a.x - block.x, az = a.z - block.z;
        const bx = b.x - block.x, bz = b.z - block.z;
        const ox = block.cos * ax - block.sin * az;
        const oz = block.sin * ax + block.cos * az;
        const dx = block.cos * bx - block.sin * bz - ox;
        const dz = block.sin * bx + block.cos * bz - oz;
        let near = 0, far = 1, misses = false;
        for (const axis of [[ox, dx, block.halfW + margin], [oz, dz, block.halfD + margin]]) {
          const [start, delta, half] = axis;
          if (Math.abs(delta) < 1e-9) {
            if (Math.abs(start) >= half) { misses = true; break; }
            continue;
          }
          const first = (-half - start) / delta, second = (half - start) / delta;
          near = Math.max(near, Math.min(first, second));
          far = Math.min(far, Math.max(first, second));
          if (near >= far) { misses = true; break; }
        }
        if (!misses) return false;
      }
      return true;
    }
    function getMoveTarget(position, playerPosition) {
      updateTarget(playerPosition);
      if (hasLineOfSight(position, playerPosition, 0.58)) return playerPosition;
      let current = nearestCell(position);
      if (current < 0 || distance[current] < 0) return position;
      directionTarget.set(cellX(current), position.y, cellZ(current));
      for (let n = 0; n < 7; n++) {
        let next = current, best = distance[current]; const cx = current % width;
        for (const offset of [-1, 1, -width, width]) {
          if (offset === -1 && cx === 0 || offset === 1 && cx === width - 1) continue;
          const i = current + offset;
          if (i >= 0 && i < count && distance[i] >= 0 && distance[i] < best) { next = i; best = distance[i]; }
        }
        if (next === current) break;
        const candidate = { x: cellX(next), z: cellZ(next) };
        if (!hasLineOfSight(position, candidate, 0.58)) break;
        directionTarget.set(candidate.x, position.y, candidate.z); current = next;
      }
      return directionTarget;
    }
    function getSpawnPoint(playerPosition = world.spawn) {
      updateTarget(playerPosition);
      const start = Math.floor(Math.random() * count);
      for (let k = 0; k < count; k++) {
        const i = (start + k * 1543) % count;
        if (!walkable[i] || distance[i] < 0) continue;
        const x = cellX(i), z = cellZ(i), d = Math.hypot(x - playerPosition.x, z - playerPosition.z);
        if (d < 18 || d > 58) continue;
        ray.ray.origin.set(x, 16, z); const hits = ray.intersectObjects(floorObjects, false);
        if (hits.length) return hits[0].point.clone();
      }
      return null;
    }
    updateTarget(world.spawn);
    return {
      updateTarget, getMoveTarget, getSpawnPoint, hasLineOfSight,
      isWalkable: (x, z, margin = 0.58) => !blocked(x, z, margin),
      grid: { width, cellSize, origin, walkable, distance }
    };
  }
  function getRandomFloorPoint() { return navigation.getSpawnPoint(world.spawn); }
  function resetPlayer(player) { if (world.isLoaded) player.reset({ position: world.spawn.clone(), yaw: WORLD_SETTINGS.spawnYaw }); }
  function mulberry32(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5; let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
}
