export function createPlayer({ THREE, camera, config, colliders }) {
  const MOVE_TUNING = {
    maxGroundSpeed: config.playerSpeed,
    maxWalkSpeed: config.playerSpeed * config.walkMultiplier,
    groundAcceleration: config.groundAcceleration * 1.12,
    airAcceleration: config.airAcceleration * 0.72,
    friction: config.friction * 1.18,
    stopSpeed: config.stopSpeed,
    counterStrafeBoost: 1.45,
    stepRunInterval: 0.34,
    stepWalkInterval: 0.5,
    runBobAmount: 0.007,
    walkBobAmount: 0.0035,
    runRollAmount: 0.0014,
    walkRollAmount: 0.0008,
    stepDipAmount: 0.006,
    stepHeight: 0.48,
    groundSnapDistance: 0.28,
    groundRayExtraHeight: 0.35,
    groundRayLength: 4,
    playerRadius: 0.38
  };

  const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    walking: false,
    jumpQueued: false
  };

  const touchInput = {
    moveX: 0,
    moveY: 0
  };

  const inputState = {
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    mouseDown: false,
    moving: false,
    walking: false,
    grounded: true,
    footstep: false,
    jumped: false,
    speed01: 0
  };

  const velocity = new THREE.Vector3();
  const wishDirection = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();
  const oldPosition = new THREE.Vector3();

  const groundRaycaster = new THREE.Raycaster();
  const groundRayOrigin = new THREE.Vector3();
  const groundRayDirection = new THREE.Vector3(0, -1, 0);

  const ceilingRaycaster = new THREE.Raycaster();
  const ceilingRayOrigin = new THREE.Vector3();
  const ceilingRayDirection = new THREE.Vector3(0, 1, 0);

  const wallRaycaster = new THREE.Raycaster();
  const wallRayOrigin = new THREE.Vector3();
  const wallMove = new THREE.Vector3();

  let yaw = 0;
  let pitch = 0;
  let verticalVelocity = 0;
  let canJump = true;
  let pointerLockSupported = hasPointerLockSupport();
  let pointerLockActive = false;
  let dragLookActive = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let stepDistance = 0;
  let stepTimer = 0;
  let bobTime = 0;
  let cameraBobOffset = 0;
  let cameraRollOffset = 0;
  let cameraRollApplied = 0;
  let cameraYawOffset = 0;
  let cameraYawApplied = 0;
  let stepDip = 0;
  let baseCameraY = config.playerHeight;
  let groundY = null;

  applyCameraRotation();

  function hasPointerLockSupport() {
    return typeof document.body.requestPointerLock === "function" && typeof document.exitPointerLock === "function";
  }

  function lockCursor() {
    if (!pointerLockSupported || document.pointerLockElement === document.body) {
      if (!pointerLockSupported) enableFallbackLook();
      return;
    }

    try {
      const result = document.body.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.catch === "function") result.catch(requestBasicPointerLock);
    } catch {
      requestBasicPointerLock();
    }
  }

  function requestBasicPointerLock() {
    try {
      const result = document.body.requestPointerLock();
      if (result && typeof result.catch === "function") result.catch(enableFallbackLook);
    } catch {
      enableFallbackLook();
    }
  }

  function enableFallbackLook() {
    pointerLockSupported = false;
    pointerLockActive = false;
  }

  function setPointerLockActive(value) {
    pointerLockActive = value;
  }

  function onKeyDown(event) {
    switch (event.code) {
      case "KeyW": keys.forward = true; break;
      case "KeyS": keys.backward = true; break;
      case "KeyA": keys.left = true; break;
      case "KeyD": keys.right = true; break;
      case "ShiftLeft":
      case "ShiftRight": keys.walking = true; break;
      case "Space":
        event.preventDefault();
        if (!event.repeat) keys.jumpQueued = true;
        break;
    }
  }

  function onKeyUp(event) {
    switch (event.code) {
      case "KeyW": keys.forward = false; break;
      case "KeyS": keys.backward = false; break;
      case "KeyA": keys.left = false; break;
      case "KeyD": keys.right = false; break;
      case "ShiftLeft":
      case "ShiftRight": keys.walking = false; break;
    }
  }

  function onMouseDown(event) {
    if (event.button === 0) inputState.mouseDown = true;

    if (!pointerLockActive && !pointerLockSupported && event.button === 0) {
      dragLookActive = true;
      lastDragX = event.clientX;
      lastDragY = event.clientY;
    }
  }

  function onMouseUp(event) {
    if (event.button === 0) {
      inputState.mouseDown = false;
      dragLookActive = false;
    }
  }

  function onMouseMove(event) {
    if (pointerLockActive) {
      rotateView(event.movementX, event.movementY, config.mouseSensitivity);
      return;
    }

    if (dragLookActive) {
      const deltaX = event.clientX - lastDragX;
      const deltaY = event.clientY - lastDragY;
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      rotateView(deltaX, deltaY, config.dragSensitivity);
    }
  }

  function rotateView(deltaX, deltaY, sensitivity) {
    inputState.mouseDeltaX += deltaX;
    inputState.mouseDeltaY += deltaY;
    yaw -= deltaX * sensitivity;
    pitch -= deltaY * sensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
    applyCameraRotation();
  }

  function applyCameraRotation() {
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function addLookDelta(deltaX, deltaY, sensitivityMultiplier = 1) {
    rotateView(deltaX, deltaY, config.dragSensitivity * sensitivityMultiplier);
  }

  function setFiring(active) {
    inputState.mouseDown = Boolean(active);
  }

  function setTouchMove(x = 0, y = 0) {
    touchInput.moveX = THREE.MathUtils.clamp(x, -1, 1);
    touchInput.moveY = THREE.MathUtils.clamp(y, -1, 1);
  }

  function queueJump() {
    keys.jumpQueued = true;
  }

  function clearMovement() {
    keys.forward = false;
    keys.backward = false;
    keys.left = false;
    keys.right = false;
    keys.walking = false;
    keys.jumpQueued = false;
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    dragLookActive = false;
    inputState.mouseDown = false;
  }

  function reset(options = {}) {
    const position = options.position ?? null;
    const nextYaw = options.yaw ?? 0;

    yaw = nextYaw;
    pitch = 0;
    verticalVelocity = 0;
    canJump = true;
    stepDistance = 0;
    stepTimer = 0;
    bobTime = 0;
    cameraBobOffset = 0;
    cameraRollOffset = 0;
    cameraRollApplied = 0;
    cameraYawOffset = 0;
    cameraYawApplied = 0;
    stepDip = 0;
    groundY = null;

    if (position) camera.position.copy(position);

    baseCameraY = camera.position.y;
    velocity.set(0, 0, 0);
    applyCameraRotation();
    clearMovement();

    inputState.footstep = false;
    inputState.jumped = false;
    inputState.moving = false;
    inputState.walking = false;
    inputState.grounded = true;
    inputState.speed01 = 0;
  }

  function update(delta, isPlaying) {
    inputState.footstep = false;
    inputState.jumped = false;
    inputState.mouseDeltaX = THREE.MathUtils.lerp(inputState.mouseDeltaX, 0, 1 - Math.exp(-30 * delta));
    inputState.mouseDeltaY = THREE.MathUtils.lerp(inputState.mouseDeltaY, 0, 1 - Math.exp(-30 * delta));

    groundY = getGroundY();

    if (groundY !== null && !isPlaying) {
      baseCameraY = groundY + config.playerHeight;
      camera.position.y = baseCameraY;
    }

    if (!isPlaying) return;

    const hasGround = groundY !== null;
    const targetGroundCameraY = hasGround ? groundY + config.playerHeight : baseCameraY;
    const grounded = hasGround && baseCameraY <= targetGroundCameraY + MOVE_TUNING.groundSnapDistance && verticalVelocity <= 0;

    if (grounded) {
      baseCameraY = targetGroundCameraY;
      verticalVelocity = 0;
      canJump = true;
    } else {
      canJump = false;
    }

    if (keys.jumpQueued) {
      if (grounded && canJump) {
        verticalVelocity = config.jumpPower;
        canJump = false;
        inputState.jumped = true;
      }

      keys.jumpQueued = false;
    }

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    side.crossVectors(camera.up, forward).normalize();
    wishDirection.set(0, 0, 0);

    const moveForward = (keys.forward ? 1 : 0) - (keys.backward ? 1 : 0) - touchInput.moveY;
    const moveRight = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + touchInput.moveX;

    if (moveForward !== 0) wishDirection.addScaledVector(forward, moveForward);
    if (moveRight !== 0) wishDirection.addScaledVector(side, -moveRight);

    const inputStrength = Math.min(1, wishDirection.length());
    const hasInput = inputStrength > 0;
    if (hasInput) wishDirection.normalize();

    const maxSpeed = (keys.walking ? MOVE_TUNING.maxWalkSpeed : MOVE_TUNING.maxGroundSpeed) * inputStrength;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);

    if (grounded) {
      const inputOpposesVelocity = hasInput && horizontalSpeed > 0.1 && velocity.dot(wishDirection) < -0.1;
      const frictionBoost = inputOpposesVelocity ? MOVE_TUNING.counterStrafeBoost : 1;
      const drop = Math.max(horizontalSpeed, MOVE_TUNING.stopSpeed) * MOVE_TUNING.friction * frictionBoost * delta;
      const newSpeed = Math.max(0, horizontalSpeed - drop);

      if (horizontalSpeed > 0) {
        velocity.x *= newSpeed / horizontalSpeed;
        velocity.z *= newSpeed / horizontalSpeed;
      }
    } else {
      velocity.x *= Math.max(0, 1 - config.airFriction * delta);
      velocity.z *= Math.max(0, 1 - config.airFriction * delta);
    }

    if (hasInput) {
      const acceleration = grounded ? MOVE_TUNING.groundAcceleration : MOVE_TUNING.airAcceleration;
      const currentSpeed = velocity.dot(wishDirection);
      const addSpeed = maxSpeed - currentSpeed;

      if (addSpeed > 0) {
        const accelSpeed = Math.min(acceleration * maxSpeed * delta, addSpeed);
        velocity.addScaledVector(wishDirection, accelSpeed);
      }
    }

    oldPosition.copy(camera.position);

    camera.position.x += velocity.x * delta;
    if (hitsWall(camera.position)) {
      camera.position.x = oldPosition.x;
      velocity.x = 0;
    }

    oldPosition.copy(camera.position);

    camera.position.z += velocity.z * delta;
    if (hitsWall(camera.position)) {
      camera.position.z = oldPosition.z;
      velocity.z = 0;
    }

    const oldBaseCameraY = baseCameraY;

    verticalVelocity -= config.gravity * delta;
    baseCameraY += verticalVelocity * delta;

    if (verticalVelocity > 0 && hitsCeiling(oldBaseCameraY, baseCameraY)) {
      verticalVelocity = 0;
    }

    groundY = getGroundY();

    if (groundY !== null) {
      const nextGroundCameraY = groundY + config.playerHeight;

      if (baseCameraY <= nextGroundCameraY && verticalVelocity <= 0) {
        baseCameraY = nextGroundCameraY;
        verticalVelocity = 0;
        canJump = true;
      } else {
        canJump = false;
      }
    } else {
      canJump = false;
    }

    const currentMoveSpeed = Math.hypot(velocity.x, velocity.z);
    inputState.moving = hasInput && currentMoveSpeed > 0.35;
    inputState.walking = keys.walking;
    inputState.grounded = canJump;
    inputState.speed01 = Math.min(currentMoveSpeed / config.playerSpeed, 1);

    if (inputState.moving && inputState.grounded) {
      const speedFactor = Math.max(0.45, inputState.speed01);
      const stepInterval = (keys.walking ? MOVE_TUNING.stepWalkInterval : MOVE_TUNING.stepRunInterval) / speedFactor;

      stepTimer -= delta;

      if (stepTimer <= 0) {
        stepTimer = stepInterval;
        inputState.footstep = true;
        stepDip = MOVE_TUNING.stepDipAmount * inputState.speed01;
      }
    } else {
      stepTimer = 0;
      stepDistance = 0;
    }

    updateCameraBob(delta);

    camera.position.y = baseCameraY + cameraBobOffset;

    camera.rotation.y -= cameraYawApplied;
    camera.rotation.y += cameraYawOffset;
    cameraYawApplied = cameraYawOffset;

    camera.rotation.z -= cameraRollApplied;
    camera.rotation.z += cameraRollOffset;
    cameraRollApplied = cameraRollOffset;
  }

  function hitsCeiling(fromY, toY) {
    const moveDistance = Math.max(0, toY - fromY);

    ceilingRayOrigin.set(
      camera.position.x,
      fromY - 0.1,
      camera.position.z
    );

    ceilingRaycaster.set(ceilingRayOrigin, ceilingRayDirection);
    ceilingRaycaster.far = moveDistance + 0.22;

    const hits = ceilingRaycaster.intersectObjects(colliders, true);

    for (const hit of hits) {
      if (!hit.face) continue;

      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

      if (normal.y > -0.45) continue;

      baseCameraY = hit.point.y - 0.12;
      return true;
    }

    return false;
  }

  function getGroundY() {
    groundRayOrigin.set(
      camera.position.x,
      baseCameraY + MOVE_TUNING.groundRayExtraHeight,
      camera.position.z
    );

    groundRaycaster.set(groundRayOrigin, groundRayDirection);
    groundRaycaster.far = MOVE_TUNING.groundRayLength;

    const hits = groundRaycaster.intersectObjects(colliders, true);

    for (const hit of hits) {
      if (!hit.face) continue;

      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

      if (normal.y < 0.45) continue;
      if (hit.point.y > baseCameraY + MOVE_TUNING.stepHeight) continue;

      return hit.point.y;
    }

    return null;
  }

  function hitsWall(position) {
    wallMove.copy(position).sub(oldPosition);
    wallMove.y = 0;

    const distance = wallMove.length();
    if (distance <= 0.0001) return false;

    const direction = wallMove.normalize();

    const rayHeights = [
      baseCameraY - config.playerHeight + 0.35,
      baseCameraY - config.playerHeight * 0.5,
      baseCameraY - 0.25
    ];

    for (const y of rayHeights) {
      wallRayOrigin.set(oldPosition.x, y, oldPosition.z);

      wallRaycaster.set(wallRayOrigin, direction);
      wallRaycaster.far = distance + MOVE_TUNING.playerRadius;

      const hits = wallRaycaster.intersectObjects(colliders, true);

      for (const hit of hits) {
        if (!hit.face) continue;

        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);

        if (normal.y > 0.45) continue;

        return true;
      }
    }

    return false;
  }

  function updateCameraBob(delta) {
    const moving = inputState.moving && inputState.grounded;

    if (moving) {
      bobTime += delta * (keys.walking ? 7.8 : 11.2) * Math.max(0.45, inputState.speed01);

      const bobAmount = keys.walking ? MOVE_TUNING.walkBobAmount : MOVE_TUNING.runBobAmount;
      const rollAmount = keys.walking ? MOVE_TUNING.walkRollAmount : MOVE_TUNING.runRollAmount;
      const yawAmount = keys.walking ? 0.0007 : 0.0011;

      const baseBob = Math.abs(Math.sin(bobTime)) * bobAmount * inputState.speed01 - bobAmount * 0.45 * inputState.speed01;
      const subtleVertical = Math.sin(bobTime * 2) * (bobAmount * 0.35) * inputState.speed01;

      cameraBobOffset = baseBob + subtleVertical - stepDip;
      cameraRollOffset = Math.sin(bobTime) * rollAmount * inputState.speed01;
      cameraYawOffset = Math.sin(bobTime) * yawAmount * inputState.speed01;
    } else {
      cameraBobOffset = THREE.MathUtils.lerp(cameraBobOffset, 0, 1 - Math.exp(-16 * delta));
      cameraRollOffset = THREE.MathUtils.lerp(cameraRollOffset, 0, 1 - Math.exp(-16 * delta));
      cameraYawOffset = THREE.MathUtils.lerp(cameraYawOffset, 0, 1 - Math.exp(-16 * delta));
    }

    stepDip = THREE.MathUtils.lerp(stepDip, 0, 1 - Math.exp(-28 * delta));
  }

  return {
    velocity,
    inputState,

    get pointerLockSupported() {
      return pointerLockSupported;
    },

    get pointerLockActive() {
      return pointerLockActive;
    },

    lockCursor,
    enableFallbackLook,
    setPointerLockActive,
    onKeyDown,
    onKeyUp,
    onMouseDown,
    onMouseUp,
    onMouseMove,
    addLookDelta,
    setTouchMove,
    setFiring,
    queueJump,
    clearMovement,
    reset,
    update
  };
}
