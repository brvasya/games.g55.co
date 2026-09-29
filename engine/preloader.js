export function createPreloader() {
  const root = document.getElementById("preloader");
  const fill = document.getElementById("preloaderFill");
  const text = document.getElementById("preloaderText");
  const bar = root.querySelector(".preloader-bar");
  const menu = document.getElementById("overlay");
  const button = document.getElementById("startButton");
  let progress = 0;
  function setProgress(value) {
    progress = Math.max(progress, Math.max(0, Math.min(100, Math.round(value))));
    fill.style.width = `${progress}%`;
    text.textContent = `${progress}%`;
    bar.setAttribute("aria-valuenow", String(progress));
    button.disabled = true;
    button.dataset.loading = "true";
    button.setAttribute("aria-busy", "true");
    button.style.setProperty("--load-progress", `${progress}%`);
    button.textContent = `Loading ${progress}%`;
  }
  function hide() {
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
    menu.inert = false;
    button.disabled = false;
    delete button.dataset.loading;
    button.removeAttribute("aria-busy");
    button.textContent = "Start Game";
  }
  function show() {
    root.classList.remove("hidden");
    root.removeAttribute("aria-hidden");
    menu.inert = true;
    setProgress(progress);
  }
  show();
  return { setProgress, hide, show };
}
