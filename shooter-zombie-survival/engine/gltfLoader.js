import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// Keep the Draco decoder version aligned with the Three.js version used by
// index.html's import map.
const DRACO_DECODER_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/libs/draco/";

export function createGLTFLoader() {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  return loader;
}
