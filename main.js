import { bootGame } from "./engine/main.js";
import { GAME_CONFIG, GAME_ASSETS } from "./gameConfig.js";

document.title = GAME_CONFIG.gameTitle;

const overlay = document.getElementById("overlay");
const panelTitle = document.querySelector("#panel h1");
const panelText = document.querySelector("#panel p");
const startButton = document.getElementById("startButton");

panelTitle.textContent = GAME_CONFIG.gameTitle;
panelText.textContent = "WASD move  ·  Mouse aim  ·  LMB fire  ·  RMB scope  ·  R reload";

document.body.classList.add("main-menu-active");
overlay?.classList.add("main-menu");

startButton?.addEventListener("click", () => {
  document.body.classList.remove("main-menu-active");
  overlay?.classList.remove("main-menu");
}, { once: true });

bootGame({ GAME_CONFIG, GAME_ASSETS });
