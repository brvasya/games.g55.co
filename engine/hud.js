export function createHud() {
  const hud = document.getElementById("hud");
  const stats = document.getElementById("stats");
  const crosshair = document.getElementById("crosshair");

  const refs = {
    health: document.getElementById("health"),
    ammo: document.getElementById("ammo"),
    reserve: document.getElementById("reserve"),
    score: document.getElementById("score"),
    wave: document.getElementById("wave"),
    enemiesLeft: document.getElementById("enemiesLeft"),
    weaponSlot: document.getElementById("weaponSlot"),
    weaponName: document.getElementById("weaponName")
  };

  let buyCallback = null;
  let buyCloseCallback = null;

  const sniperScope = document.createElement("div");
  sniperScope.id = "sniperScope";
  document.body.appendChild(sniperScope);

  const buyMenu = document.createElement("div");
  buyMenu.id = "buyMenu";
  buyMenu.className = "cs-buy-menu";
  buyMenu.innerHTML = `
    <div class="cs-buy-panel">
      <div class="cs-buy-head">
        <div>
          <div class="cs-buy-title">Buy Weapons</div>
          <div class="cs-buy-subtitle">Press B to close</div>
        </div>
        <button id="buyMenuClose" class="cs-buy-close" type="button">×</button>
      </div>
      <div class="cs-buy-score">$<span id="buyMenuScore">0</span></div>
      <div id="buyMenuGrid" class="cs-buy-grid"></div>
    </div>
  `;
  document.body.appendChild(buyMenu);

  const buyHint = document.createElement("div");
  buyHint.id = "buyHint";
  buyHint.textContent = "PRESS B TO BUY WEAPONS";
  document.body.appendChild(buyHint);

  const headshotMessage = document.createElement("div");
  headshotMessage.id = "headshotMessage";
  headshotMessage.textContent = "HEADSHOT!";
  document.body.appendChild(headshotMessage);

  const buyMenuGrid = buyMenu.querySelector("#buyMenuGrid");
  const buyMenuScore = buyMenu.querySelector("#buyMenuScore");
  const buyMenuClose = buyMenu.querySelector("#buyMenuClose");

  hud.classList.add("cs-hud");

  buyMenu.addEventListener("click", event => {
    if (event.target === buyMenu) requestBuyMenuClose();
  });

  buyMenuClose.addEventListener("click", requestBuyMenuClose);

  buyMenuGrid.addEventListener("click", event => {
    const ammoButton = event.target.closest("[data-buy-ammo]");
    if (ammoButton && buyCallback) {
      event.stopPropagation();
      buyCallback(Number(ammoButton.dataset.buyAmmo), "ammo");
      return;
    }

    const button = event.target.closest("[data-buy-slot]");
    if (!button || !buyCallback) return;
    buyCallback(Number(button.dataset.buySlot), "weapon");
  });

  function setBuyCallback(callback) {
    buyCallback = callback;
  }

  function setBuyCloseCallback(callback) {
    buyCloseCallback = callback;
  }

  function requestBuyMenuClose() {
    if (buyCloseCallback) {
      buyCloseCallback();
      return;
    }

    hideBuyMenu();
  }

  function setCrosshairFire() {
    crosshair.classList.remove("fire");
    void crosshair.offsetWidth;
    crosshair.classList.add("fire");
    setTimeout(() => crosshair.classList.remove("fire"), 120);
  }

  function setCrosshairVisible(visible) {
    crosshair.style.visibility = visible ? "" : "hidden";
  }

  function showHeadshot() {
    headshotMessage.classList.remove("show");
    void headshotMessage.offsetWidth;
    headshotMessage.classList.add("show");
  }

  function showScope() {
    sniperScope.classList.add("active");
    hud.classList.add("scoped");
    document.body.classList.add("scoped");
  }

  function hideScope() {
    sniperScope.classList.remove("active");
    hud.classList.remove("scoped");
    document.body.classList.remove("scoped");
  }

  function setScope(active) {
    if (active) {
      showScope();
      return;
    }

    hideScope();
  }

  function update(state) {
    refs.health.textContent = state.health;
    refs.ammo.textContent = state.ammo;
    refs.reserve.textContent = state.reserveAmmo;
    refs.score.textContent = state.score;
    refs.wave.textContent = state.wave;
    const waveScore = state.waveScore ?? 0;
    const waveTargetScore = state.waveTargetScore ?? 0;

    refs.enemiesLeft.textContent = waveTargetScore ? `${Math.min(waveScore, waveTargetScore)} / ${waveTargetScore}` : "0 / 0";
    refs.weaponSlot.textContent = state.weaponSlot ?? 1;
    refs.weaponName.textContent = state.weaponName ?? "WEAPON";

    refs.health.closest(".cs-bottom-left").classList.toggle("danger", state.health <= 30);
    refs.ammo.closest(".cs-bottom-right").classList.toggle("danger", state.ammo <= 5);
  }

  function updateBuyMenu({ score, weapons }) {
    buyMenuScore.textContent = score;

    buyMenuGrid.innerHTML = weapons.map(weapon => {
      const canBuy = !weapon.owned && score >= weapon.price;
      const priceClass = canBuy ? "affordable" : "expensive";
      const ammoPrice = weapon.ammoPrice;
      const canBuyAmmo = weapon.owned && !weapon.isMelee && score >= ammoPrice;
      const ammoPriceClass = canBuyAmmo ? "affordable" : "expensive";
      const status = weapon.active
        ? '<span class="cs-buy-owned-text">ACTIVE</span>'
        : weapon.owned
          ? '<span class="cs-buy-owned-text">OWNED</span>'
          : `<span class="cs-buy-price ${priceClass}">$${weapon.price}</span>`;
      const actionText = weapon.owned ? "Select" : "Buy";
      const disabled = weapon.active || (!weapon.owned && !canBuy) ? "disabled" : "";
      const stateClass = weapon.active ? "active" : weapon.owned ? "owned" : canBuy ? "available" : "locked";
      const ammoButton = weapon.owned && !weapon.isMelee
        ? `<button class="cs-buy-action ${ammoPriceClass}" data-buy-ammo="${weapon.id}" type="button" ${canBuyAmmo ? "" : "disabled"}>
              <span class="cs-buy-price ${ammoPriceClass}">+ AMMO $${ammoPrice}</span>
           </button>`
        : "";

      return `
        <div class="cs-buy-card ${stateClass}" data-buy-slot="${weapon.id}" type="button" ${disabled}>
          <span class="cs-buy-key">${weapon.id}</span>
          <span class="cs-buy-name">${weapon.name}</span>
          <span class="cs-buy-stats">${weapon.damage} DMG · ${weapon.magazineSize} MAG</span>
          <span class="cs-buy-status">${status}</span>
          <span class="cs-buy-action">${actionText}</span>
          ${ammoButton}
        </div>
      `;
    }).join("");
  }

  function showBuyMenu() {
    hideScope();
    buyMenu.classList.add("open");
    buyHint.classList.add("hidden");
  }

  function hideBuyMenu() {
    buyMenu.classList.remove("open");
    buyHint.classList.remove("hidden");
  }

  function isBuyMenuOpen() {
    return buyMenu.classList.contains("open");
  }

  return {
    update,
    setCrosshairFire,
    setCrosshairVisible,
    showHeadshot,
    showScope,
    hideScope,
    setScope,
    setBuyCallback,
    setBuyCloseCallback,
    updateBuyMenu,
    showBuyMenu,
    hideBuyMenu,
    isBuyMenuOpen
  };
}
