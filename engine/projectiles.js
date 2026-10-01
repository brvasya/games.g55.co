// World-space launcher projectiles. No external models, textures or physics library.
// Asset behavior.projectile selects "grenade" or "rocket"; other weapons stay hitscan.
export function getProjectileSettings(behavior = {}) {
  const type = behavior.projectile;
  if (type !== "grenade" && type !== "rocket") return null;
  const number = (value, fallback, min, max) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

  return {
    type,
    speed: number(behavior.projectileSpeed, type === "rocket" ? 50 : 28, 1, 300),
    // Rockets deliberately have no gravity. Grenades may override their drop.
    gravity: type === "rocket" ? 0 : number(behavior.projectileGravity, 18, 0, 100),
    lifetime: number(behavior.projectileLifetime, 6, 0.1, 30),
    radius: number(behavior.explosionRadius, type === "rocket" ? 5 : 4.5, 0, 30)
  };
}

export function createProjectiles({ THREE, scene, colliders = [], getEnemyHit, onExplode }) {
  const MAX_PROJECTILES = 48;
  const MAX_PARTICLES = 240;
  const EPSILON = 0.002;
  const projectiles = new Set();
  const particles = [];
  const particlePool = [];
  const root = new THREE.Group();
  root.name = "LauncherProjectiles";
  scene.add(root);

  const raycaster = new THREE.Raycaster();
  const intersections = [];
  const rayDirection = new THREE.Vector3();
  const nextPosition = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const up = new THREE.Vector3(0, 1, 0);
  const glowTexture = makeGlowTexture();
  const geometries = [];
  const materials = [];
  const templates = { grenade: makeGrenade(), rocket: makeRocket() };
  // Registered before the first render: explosions never add/remove scene lights.
  const light = new THREE.PointLight(0xff9a42, 0, 12, 2);
  light.name = "ProjectileExplosionLight";
  light.castShadow = false;
  scene.add(light);
  let lightLife = 0;
  let disposed = false;

  function geometry(value) { geometries.push(value); return value; }
  function material(value) { materials.push(value); return value; }

  function makeGrenade() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.085, 0.095, 0.22, 8)),
      material(new THREE.MeshStandardMaterial({ color: 0x596644, roughness: 0.65 }))
    );
    const band = new THREE.Mesh(
      geometry(new THREE.CylinderGeometry(0.098, 0.098, 0.05, 8)),
      material(new THREE.MeshStandardMaterial({ color: 0xc99b4c, metalness: 0.45, roughness: 0.45 }))
    );
    band.position.y = -0.06;
    group.add(body, band);
    return group;
  }

  function makeRocket() {
    const group = new THREE.Group();
    const bodyMaterial = material(new THREE.MeshStandardMaterial({ color: 0x737d67, metalness: 0.3, roughness: 0.5 }));
    const body = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8)), bodyMaterial);
    const nose = new THREE.Mesh(geometry(new THREE.ConeGeometry(0.06, 0.15, 8)), bodyMaterial);
    nose.position.y = 0.245;
    const finGeometry = geometry(new THREE.BoxGeometry(0.24, 0.1, 0.015));
    const fin = new THREE.Mesh(finGeometry, bodyMaterial);
    fin.position.y = -0.13;
    const otherFin = fin.clone();
    otherFin.rotation.y = Math.PI / 2;
    const flame = new THREE.Sprite(material(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffaa44, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    })));
    flame.position.y = -0.25;
    flame.scale.setScalar(0.4);
    group.add(body, nose, fin, otherFin, flame);
    return group;
  }

  function makeGlowTexture() {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const r = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
        const i = (y * size + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = Math.round(Math.pow(Math.max(0, 1 - r), 1.6) * 255);
      }
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  // A ray covers the entire movement segment, rather than testing only its end.
  // This also catches thin colliders at high projectile speeds / low frame rates.
  function trace(origin, direction, distance, includeEnemies = true) {
    if (!(distance > 0)) return null;
    raycaster.set(origin, direction);
    raycaster.near = 0;
    raycaster.far = distance;
    intersections.length = 0;
    raycaster.intersectObjects(colliders, true, intersections);
    const surface = intersections[0];
    const enemy = includeEnemies && getEnemyHit ? getEnemyHit(raycaster) : null;
    if (enemy && (!surface || enemy.distance < surface.distance - EPSILON)) return enemy;
    if (!surface) return null;
    const normal = surface.face?.normal?.clone() || up.clone();
    normalMatrix.getNormalMatrix(surface.object.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
    if (normal.dot(direction) > 0) normal.negate();
    return { type: "surface", point: surface.point.clone(), normal, distance: surface.distance };
  }

  function traceSegment(from, to, includeEnemies = true) {
    rayDirection.subVectors(to, from);
    const distance = rayDirection.length();
    if (distance < 1e-8) return null;
    rayDirection.divideScalar(distance);
    return trace(from, rayDirection, distance, includeEnemies);
  }

  // Uses only world colliders: another enemy must not act as a blast-proof wall.
  function hasLineOfSight(from, to) {
    rayDirection.subVectors(to, from);
    const distance = rayDirection.length();
    if (distance <= EPSILON * 2) return true;
    rayDirection.divideScalar(distance);
    return !trace(from, rayDirection, distance - EPSILON, false);
  }

  function spawn({ shot, behavior = {}, origin, aimOrigin, direction }) {
    if (disposed) return false;
    const settings = getProjectileSettings({ ...behavior, projectile: shot.projectile });
    if (!settings || !aimOrigin || !direction || direction.lengthSq() < 1e-8) return false;
    if (![aimOrigin.x, aimOrigin.y, aimOrigin.z, direction.x, direction.y, direction.z].every(Number.isFinite)) return false;
    const forward = direction.clone().normalize();
    const start = origin?.clone() || aimOrigin.clone().addScaledVector(forward, 0.2);
    if (![start.x, start.y, start.z].every(Number.isFinite)) start.copy(aimOrigin);
    // A malformed / very distant view-model helper must not teleport a shot.
    if (start.distanceToSquared(aimOrigin) > 9) start.copy(aimOrigin);

    const projectile = {
      settings,
      damage: Number.isFinite(shot.damage) ? Math.max(0, shot.damage) : 0,
      selfDamage: Number.isFinite(shot.selfDamage) ? Math.max(0, shot.selfDamage)
        : Number.isFinite(shot.damage) ? Math.max(0, shot.damage) : 0,
      position: start,
      velocity: forward.clone().multiplyScalar(settings.speed),
      age: 0,
      trailDistance: 0,
      mesh: null
    };
    // View-models can overlap walls. Sweep from the eye to the muzzle first;
    // otherwise a muzzle on the far side of a wall would launch through it.
    const muzzleBlock = traceSegment(aimOrigin, start);
    if (muzzleBlock) {
      explode(projectile, muzzleBlock);
      return true;
    }

    // Converge on the camera's aim point while retaining a real muzzle origin.
    // Grenade drop is NOT auto-compensated: players aim above distant targets.
    const aimDistance = Math.min(300, settings.speed * settings.lifetime);
    const aimHit = trace(aimOrigin, forward, aimDistance);
    const aimPoint = aimHit?.point || aimOrigin.clone().addScaledVector(forward, aimDistance);
    const launchDirection = aimPoint.clone().sub(start);
    if (launchDirection.lengthSq() > 1e-8 && launchDirection.dot(forward) > 0) {
      projectile.velocity.copy(launchDirection.normalize()).multiplyScalar(settings.speed);
    }

    if (projectiles.size >= MAX_PROJECTILES) removeProjectile(projectiles.values().next().value);
    projectile.mesh = templates[settings.type].clone(true);
    projectile.mesh.name = settings.type === "rocket" ? "LauncherRocket" : "LauncherGrenade";
    root.add(projectile.mesh);
    projectiles.add(projectile);
    syncMesh(projectile);
    return true;
  }

  function syncMesh(projectile) {
    const mesh = projectile.mesh;
    mesh.position.copy(projectile.position);
    rayDirection.copy(projectile.velocity).normalize();
    if (rayDirection.lengthSq() > 0) mesh.quaternion.setFromUnitVectors(up, rayDirection);
    if (projectile.settings.type === "grenade") mesh.rotateX(projectile.age * 9);
  }

  function removeProjectile(projectile) {
    if (!projectile) return;
    projectiles.delete(projectile);
    if (projectile.mesh) root.remove(projectile.mesh);
    // Mesh clones share template geometry/materials. Do not dispose them here.
  }

  function explode(projectile, hit = null) {
    removeProjectile(projectile); // Callbacks may clear the wave and all other shots.
    const normal = hit?.normal?.clone() || up.clone();
    const position = hit?.point?.clone() || projectile.position.clone();
    // Start visibility rays just OUTSIDE the impacted surface, not inside it.
    if (hit) position.addScaledVector(normal, EPSILON * 4);
    spawnExplosion(position, projectile.settings.radius);
    if (onExplode) onExplode({
      position, normal, hit,
      damage: projectile.damage,
      selfDamage: projectile.selfDamage,
      radius: projectile.settings.radius,
      projectile: projectile.settings.type,
      direction: projectile.velocity.clone().normalize()
    });
  }

  function update(delta, isPlaying = true) {
    if (disposed || !Number.isFinite(delta) || delta <= 0) return;
    delta = Math.min(delta, 0.1);
    updateParticles(delta);
    lightLife = Math.max(0, lightLife - delta);
    light.intensity = lightLife > 0 ? 95 * Math.pow(lightLife / 0.18, 2) : 0;
    if (!isPlaying) return;

    for (const projectile of projectiles) {
      const remaining = Math.min(delta, projectile.settings.lifetime - projectile.age);
      // Gravity uses short analytical steps; straight rockets need only one sweep.
      const steps = projectile.settings.gravity > 0 ? Math.max(1, Math.ceil(remaining * 60)) : 1;
      const step = remaining / steps;
      for (let i = 0; i < steps && projectiles.has(projectile); i++) {
        nextPosition.copy(projectile.position).addScaledVector(projectile.velocity, step);
        nextPosition.y -= 0.5 * projectile.settings.gravity * step * step;
        const hit = traceSegment(projectile.position, nextPosition);
        const destination = hit?.point || nextPosition;
        emitTrail(projectile, destination);
        projectile.velocity.y -= projectile.settings.gravity * step;
        projectile.position.copy(destination);
        projectile.age += step;
        if (hit || projectile.age >= projectile.settings.lifetime - 1e-8) {
          explode(projectile, hit);
          break;
        }
      }
      if (projectiles.has(projectile)) syncMesh(projectile);
    }
  }

  function emitTrail(projectile, destination) {
    const rocket = projectile.settings.type === "rocket";
    const distance = projectile.position.distanceTo(destination);
    if (distance < 1e-8) return;
    const spacing = rocket ? 0.55 : 0.75;
    let offset = spacing - projectile.trailDistance;
    // Limit cosmetic work for extreme custom speeds without limiting collision.
    for (let count = 0; offset <= distance && count < 12; offset += spacing, count++) {
      const position = projectile.position.clone().lerp(destination, offset / distance);
      addParticle(position, new THREE.Vector3(0, 0.15, 0), rocket ? 0.6 : 0.35,
        rocket ? 0.14 : 0.07, rocket ? 0.7 : 0.3, rocket ? 0xa8a49b : 0xb8b3a1, rocket ? 0.45 : 0.2, false);
    }
    projectile.trailDistance = (projectile.trailDistance + distance) % spacing;
  }

  function addParticle(position, velocity, life, startSize, endSize, color, opacity, additive) {
    if (particles.length >= MAX_PARTICLES) recycleParticle(0);
    let particle = particlePool.pop();
    if (!particle) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false
      }));
      sprite.name = "LauncherParticle";
      root.add(sprite);
      particle = { sprite, velocity: new THREE.Vector3() };
    }
    Object.assign(particle, { life, maxLife: life, startSize, endSize, opacity, additive });
    particle.velocity.copy(velocity);
    particle.sprite.position.copy(position);
    particle.sprite.scale.setScalar(startSize);
    particle.sprite.material.color.setHex(color);
    particle.sprite.material.opacity = opacity;
    particle.sprite.material.rotation = Math.random() * Math.PI * 2;
    particle.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    particle.sprite.visible = true;
    particles.push(particle);
  }

  function recycleParticle(index) {
    const particle = particles[index];
    particle.sprite.visible = false;
    particle.sprite.material.opacity = 0;
    particles.splice(index, 1);
    particlePool.push(particle);
  }

  function spawnExplosion(position, radius) {
    const size = Math.max(1.2, Math.min(radius, 6));
    addParticle(position, new THREE.Vector3(), 0.2, size * 0.4, size * 1.8, 0xffd68c, 1, true);
    for (let i = 0; i < 10; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(size * 2);
      addParticle(position, velocity, 0.3 + Math.random() * 0.25, size * 0.3, size * 0.75, i % 2 ? 0xff6a19 : 0xffbc52, 0.9, true);
    }
    for (let i = 0; i < 8; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, 0.5 + Math.random(), Math.random() - 0.5).multiplyScalar(size * 0.75);
      addParticle(position, velocity, 0.85 + Math.random() * 0.5, size * 0.2, size, 0x656160, 0.65, false);
    }
    for (let i = 0; i < 12; i++) {
      const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.15, Math.random() - 0.5).normalize().multiplyScalar(size * 3);
      addParticle(position, velocity, 0.25 + Math.random() * 0.2, 0.12, 0.02, 0xffc263, 1, true);
    }
    light.position.copy(position);
    light.distance = size * 3;
    lightLife = 0.18;
    light.intensity = 95;
  }

  function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.life -= delta;
      if (particle.life <= 0) { recycleParticle(i); continue; }
      const progress = 1 - particle.life / particle.maxLife;
      particle.sprite.position.addScaledVector(particle.velocity, delta);
      particle.velocity.multiplyScalar(Math.exp(-2.5 * delta));
      particle.sprite.scale.setScalar(THREE.MathUtils.lerp(particle.startSize, particle.endSize, progress));
      particle.sprite.material.opacity = particle.opacity * Math.pow(1 - progress, particle.additive ? 1.5 : 0.8);
    }
  }

  function clear({ effects = true } = {}) {
    for (const projectile of projectiles) removeProjectile(projectile);
    if (effects) {
      while (particles.length) recycleParticle(particles.length - 1);
      lightLife = 0;
      light.intensity = 0;
    }
  }

  function dispose() {
    if (disposed) return;
    clear();
    for (const particle of particlePool) particle.sprite.material.dispose();
    for (const item of geometries) item.dispose();
    for (const item of materials) item.dispose();
    glowTexture.dispose();
    scene.remove(root, light);
    particlePool.length = 0;
    disposed = true;
  }

  return { spawn, update, clear, dispose, hasLineOfSight, get count() { return projectiles.size; } };
}
