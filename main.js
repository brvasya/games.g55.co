import { bootGame } from "./engine/main.js";
import { GAME_CONFIG, GAME_ASSETS } from "./gameConfig.js";

document.title = GAME_CONFIG.gameTitle;

const overlay = document.getElementById("overlay");
const panelTitle = document.querySelector("#panel h1");
const panelText = document.querySelector("#panel p");
const startButton = document.getElementById("startButton");

function renderMainMenuTitle(title) {
  if (!panelTitle) return;

  const value = String(title ?? "").trim();
  const colonIndex = value.indexOf(":");

  panelTitle.replaceChildren();

  if (colonIndex > 0 && colonIndex < value.length - 1) {
    const prefix = value.slice(0, colonIndex + 1).trim();
    const name = value.slice(colonIndex + 1).trim();

    const prefixElement = document.createElement("span");
    prefixElement.className = "main-title-prefix";
    prefixElement.textContent = prefix;

    const nameElement = document.createElement("span");
    nameElement.className = "main-title-name";
    nameElement.textContent = name;

    panelTitle.append(prefixElement, nameElement);
    return;
  }

  const nameElement = document.createElement("span");
  nameElement.className = "main-title-name";
  nameElement.textContent = value;
  panelTitle.append(nameElement);
}

renderMainMenuTitle(GAME_CONFIG.gameTitle);
const isTouchDevice = window.matchMedia?.("(pointer: coarse)")?.matches || navigator.maxTouchPoints > 0 || "ontouchstart" in window;
panelText.textContent = isTouchDevice
  ? "Left stick move  ·  Right stick look  ·  Fire / Scope / Reload / Shop"
  : "WASD move  ·  Mouse aim  ·  LMB fire  ·  RMB scope  ·  R reload";

document.body.classList.add("main-menu-active");
overlay?.classList.add("main-menu");

startButton?.addEventListener("click", () => {
  document.body.classList.remove("main-menu-active");
  overlay?.classList.remove("main-menu");
}, { once: true });

bootGame({ GAME_CONFIG, GAME_ASSETS });
