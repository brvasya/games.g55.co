import { bootGame } from "./engine/main.js";
import { GAME_CONFIG, GAME_ASSETS } from "./gameConfig.js";
import { renderGameTitle, controlsText } from "./engine/ui.js";
import { isTouchDevice } from "./engine/touchControls.js";

document.title = GAME_CONFIG.gameTitle;
renderGameTitle(document.querySelector("#panel h1"), GAME_CONFIG.gameTitle);
document.querySelector("#panel p").textContent = controlsText(isTouchDevice());
document.body.classList.add("main-menu-active");
document.getElementById("overlay").classList.add("main-menu");
bootGame({ GAME_CONFIG, GAME_ASSETS });
