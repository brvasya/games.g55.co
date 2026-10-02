import { bootGame } from "./engine/main.js";
import { GAME_CONFIG, GAME_ASSETS } from "./gameConfig.js";
import { renderGameTitle, controlsText } from "./engine/ui.js";
import { isTouchDevice } from "./engine/touchControls.js";

document.title = GAME_CONFIG.gameTitle;
renderGameTitle(document.querySelector("#panel h1"), GAME_CONFIG.gameTitle);
// Preserve the head-selected HTML controls instead of replacing text after paint.
const touch = isTouchDevice();
const description = document.querySelector("#panel p");
const initialCopy = description.querySelector(touch ? ".controls-touch" : ".controls-desktop");
if (!initialCopy || initialCopy.textContent !== controlsText(touch)) {
  description.textContent = controlsText(touch);
}
document.body.classList.add("main-menu-active");
document.getElementById("overlay").classList.add("main-menu");
bootGame({ GAME_CONFIG, GAME_ASSETS });
