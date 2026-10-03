export const gameConfig = {
  playerCar: {
    // Visual size after automatic GLB fitting. 1.30 keeps the current size.
    // Increasing this makes the car larger; collision dimensions stay unchanged.
    scale: 1.30
  },
  cockpitCamera: {
    // Offsets from the GLB's windscreen_dummy, measured in world units.
    // These distances stay the same when the car scale changes.
    position: {
      x: -0.41,   // Negative = left; positive = right.
      y: 0,       // Positive = up; negative = down.
      z: 1.1125   // Positive = backward into the cabin; negative = forward.
    }
  }
};
