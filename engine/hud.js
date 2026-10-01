import { focusControl, focusMenu } from "./ui.js";
import { isTouchDevice as detectTouch } from "./touchControls.js";

export function createHud() {
  // Scoped shop additions; existing site styles and asset definitions stay intact.
  if (!document.getElementById("weaponUpgradeStyles")) {
    const link = document.createElement("link");
    link.id = "weaponUpgradeStyles";
    link.rel = "stylesheet";
    link.href = new URL("./weaponUpgrades.css", import.meta.url).href;
    document.head.appendChild(link);
  }
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

  const weaponLevel = document.createElement("span");
  weaponLevel.className = "cs-upgrade-level cs-hud-weapon-level";
  weaponLevel.hidden = true;

  let buyCallback = null;
  let buyCloseCallback = null;

  const sniperScope = document.createElement("div");
  sniperScope.id = "sniperScope";
  document.body.appendChild(sniperScope);

  const isTouchDevice = detectTouch();

  const buyMenu = document.createElement("div");
  buyMenu.id = "buyMenu";
  buyMenu.className = "cs-buy-menu";
  buyMenu.innerHTML = `
    <div class="cs-buy-panel" role="dialog" aria-modal="true" aria-labelledby="buyMenuTitle">
      <div class="cs-buy-head">
        <div>
          <div id="buyMenuTitle" class="cs-buy-title">Weapons &amp; Upgrades</div>
          <div class="cs-buy-subtitle">${isTouchDevice ? "Tap × to close" : "1–6 select · Tab navigate · B / Esc close"}</div>
        </div>
        <button id="buyMenuClose" class="cs-buy-close" type="button" aria-label="Close weapon shop">×</button>
      </div>
      <div class="cs-buy-score">$<span id="buyMenuScore">0</span></div>
      <div id="buyMenuGrid" class="cs-buy-grid"></div>
      <div id="buyMenuAnnouncement" class="cs-upgrade-announcement" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
  document.body.appendChild(buyMenu);

  const buyHint = document.createElement("div");
  buyHint.id = "buyHint";
  buyHint.textContent = isTouchDevice ? "TAP SHOP TO BUY WEAPONS" : "PRESS B TO BUY WEAPONS";
  document.body.appendChild(buyHint);

  const reloadStatus = document.createElement("div");
  reloadStatus.id = "reloadStatus";
  reloadStatus.setAttribute("role", "status");
  document.body.appendChild(reloadStatus);

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
    const upgradeButton = event.target.closest("[data-buy-upgrade]");
    if (upgradeButton) {
      event.stopPropagation();
      if (!upgradeButton.disabled && buyCallback) buyCallback(Number(upgradeButton.dataset.buyUpgrade), "upgrade");
      return;
    }
    const ammoButton = event.target.closest("[data-buy-ammo]");
    if (ammoButton && buyCallback) {
      event.stopPropagation();
      if (!ammoButton.disabled) buyCallback(Number(ammoButton.dataset.buyAmmo), "ammo");
      return;
    }

    const button = event.target.closest("[data-buy-slot]");
    if (!button || !buyCallback || button.classList.contains("locked")) return;
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
    reloadStatus.textContent = state.isReloading ? "Reloading…" : state.ammo === 0 ? (state.reserveAmmo > 0 ? "Press R to reload" : "Out of ammo · Press B for the shop") : "";
    reloadStatus.classList.toggle("visible", Boolean(reloadStatus.textContent));
    refs.score.textContent = state.score;
    refs.wave.textContent = state.wave;
    const waveScore = state.waveScore ?? 0;
    const waveTargetScore = state.waveTargetScore ?? 0;

    refs.enemiesLeft.textContent = waveTargetScore ? `${Math.min(waveScore, waveTargetScore)} / ${waveTargetScore}` : "0 / 0";
    refs.weaponSlot.textContent = state.weaponSlot ?? 1;
    refs.weaponName.textContent = state.weaponName ?? "WEAPON";
    const level = state.weaponUpgradeLevel ?? 0;
    weaponLevel.hidden = level === 0;
    weaponLevel.textContent = level > 0 ? `LV ${level}${level === 3 ? " · MAX" : ""}` : "";
    refs.weaponName.appendChild(weaponLevel);

    refs.health.closest(".cs-bottom-left").classList.toggle("danger", state.health <= 30);
    refs.ammo.closest(".cs-bottom-right").classList.toggle("danger", state.ammo <= 5);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function formatStat(value) {
    return Number.isFinite(value) ? String(Number(value.toFixed(2))) : "—";
  }

  function updateBuyMenu({ score, weapons, isReloading = false, betweenWaves = false }) {
    const focused = document.activeElement;
    const focusSlot = focused?.dataset?.buySelect;
    const focusAmmo = focused?.dataset?.buyAmmo;
    const focusUpgrade = focused?.dataset?.buyUpgrade;
    const focusPurchase = focused?.dataset?.buyPurchase;
    buyMenuScore.textContent = score;
    buyMenu.querySelector(".cs-buy-subtitle").textContent = isReloading
      ? "Active reload paused. Resume play to finish it."
      : betweenWaves ? "Prepare for the next wave · Close to return"
      : isTouchDevice ? "Tap × to close" : "1–6 select · Tab navigate · B / Esc close";

    buyMenuGrid.innerHTML = weapons.map(weapon => {
      const safeName = escapeHtml(weapon.name);
      const selectionLabel = weapon.active ? `${safeName}, equipped. Close shop` : weapon.owned ? `Equip ${safeName}` : `Buy ${safeName} for $${weapon.price}`;
      const canBuy = !weapon.owned && score >= weapon.price;
      const canSelect = (weapon.owned || canBuy) && (!isReloading || weapon.active);
      const priceClass = canBuy ? "affordable" : "expensive";
      const ammoPrice = weapon.ammoPrice;
      const canBuyAmmo = weapon.owned && !weapon.isMelee && score >= ammoPrice;
      const ammoPriceClass = canBuyAmmo ? "affordable" : "expensive";
      const status = weapon.active
        ? '<span class="cs-buy-owned-text">ACTIVE</span>'
        : weapon.owned
          ? '<span class="cs-buy-owned-text">EQUIP</span>'
          : `<span class="cs-buy-price ${priceClass}">${canBuy ? "BUY" : `NEED $${weapon.price - score}`}</span>`;
      const stateClass = weapon.active ? "active" : weapon.owned ? "owned" : canBuy ? "available" : "locked";
      const level = weapon.upgradeLevel ?? 0;
      const maxed = level >= weapon.maxUpgradeLevel;
      const next = weapon.nextUpgrade;
      const upgradePrice = weapon.upgradePrice;
      const canUpgrade = weapon.owned && next && !weapon.upgradeBlocked && score >= upgradePrice;
      const upgradePriceClass = canUpgrade ? "affordable" : "expensive";
      const upgradeLabel = maxed ? "MAXED" : weapon.upgradeBlocked ? "RELOAD PAUSED" : `UPGRADE → LV ${level + 1}`;
      const upgradeCost = maxed ? "LV 3" : score < upgradePrice ? `NEED $${upgradePrice - score}` : `$${upgradePrice}`;
      const levelBadge = weapon.owned && level > 0
        ? `<span class="cs-upgrade-level">LV ${level}${maxed ? " · MAX" : ""}</span>` : "";
      const bonusDescription = next
        ? `LV ${next.level}, bonuses versus base: +${Math.round((next.damageMultiplier - 1) * 100)}% damage, +${Math.round((next.fireRateMultiplier - 1) * 100)}% fire rate${weapon.isMelee ? "" : `, −${Math.round((1 - next.reloadDurationMultiplier) * 100)}% reload time`}.`
        : "All three upgrades purchased.";
      const preview = !weapon.owned
        ? '<span class="cs-upgrade-preview"><span>3 upgrade levels</span><small>Available after purchase</small></span>'
        : `<span class="cs-upgrade-preview" title="${escapeHtml(bonusDescription)}"><span>${maxed ? "Fully upgraded" : `Next: ${formatStat(weapon.damage)} → <b>${formatStat(next.damage)} DMG</b>`}</span><small>${maxed ? "Maximum weapon power" : weapon.isMelee ? "Faster attacks" : "Faster fire + reload"}</small></span>`;
      const upgradeAction = `<button class="cs-buy-action cs-buy-upgrade ${upgradePriceClass}${maxed ? " maxed" : ""}" data-buy-upgrade="${weapon.id}" aria-label="${maxed ? `${safeName}, maximum upgrade level` : weapon.upgradeBlocked ? `Resume play to finish reloading ${safeName} before upgrading` : `Upgrade ${safeName} to level ${level + 1} for $${upgradePrice}. ${escapeHtml(bonusDescription)}`}" type="button" ${canUpgrade ? "" : "disabled"}>
          <span>${upgradeLabel}</span><span class="cs-buy-price ${upgradePriceClass}">${upgradeCost}</span>
        </button>`;
      const ammoAction = `<button class="cs-buy-action ${ammoPriceClass}" data-buy-ammo="${weapon.id}" aria-label="Buy ${weapon.magazineSize} rounds for ${safeName}, $${ammoPrice}" type="button" ${canBuyAmmo ? "" : "disabled"}>
          <span>+ AMMO</span><span class="cs-buy-price ${ammoPriceClass}">$${ammoPrice}</span>
        </button>`;
      const bottomAction = weapon.owned
        ? upgradeAction + (weapon.isMelee ? "" : ammoAction)
        : `<button class="cs-buy-action cs-buy-purchase ${priceClass}" data-buy-purchase="${weapon.id}" type="button" aria-label="Buy ${safeName} for $${weapon.price}" ${canSelect ? "" : "disabled"}>
            <span>BUY WEAPON</span><span class="cs-buy-price ${priceClass}">$${weapon.price}</span>
           </button>`;

      return `
        <div class="cs-buy-card ${stateClass}" data-buy-slot="${weapon.id}">
          <button type="button" class="cs-buy-select" data-buy-select="${weapon.id}" aria-label="${selectionLabel}" ${canSelect ? "" : "disabled"}></button>
          <span class="cs-buy-key">${weapon.id}</span>
          <span class="cs-buy-name">${safeName}${levelBadge}</span>
          <span class="cs-buy-stats">${formatStat(weapon.damage)} DMG${weapon.isMelee ? " · MELEE" : ` · ${weapon.magazineSize} MAG`}</span>
          <span class="cs-buy-status">${status}</span>
          ${preview}
          <div class="cs-buy-actions${!weapon.owned || weapon.isMelee ? " single" : ""}">${bottomAction}</div>
        </div>
      `;
    }).join("");
    if (buyMenu.classList.contains("open") && (focusSlot || focusAmmo || focusUpgrade || focusPurchase)) {
      const id = focusUpgrade || focusAmmo || focusPurchase || focusSlot;
      const kind = focusUpgrade ? "upgrade" : focusAmmo ? "ammo" : focusPurchase ? "purchase" : "select";
      const target = buyMenuGrid.querySelector(`[data-buy-${kind}="${id}"]:not(:disabled)`)
        || buyMenuGrid.querySelector(`[data-buy-select="${id}"]:not(:disabled)`);
      focusControl(target || buyMenuClose);
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function showUpgrade(weapon) {
    const card = buyMenuGrid.querySelector(`[data-buy-slot="${weapon.id}"]`);
    if (card) {
      card.classList.remove("upgrade-flash");
      void card.offsetWidth;
      card.classList.add("upgrade-flash");
    }
    buyMenu.querySelector("#buyMenuAnnouncement").textContent = `${weapon.name} upgraded to LV ${weapon.upgradeLevel}${weapon.upgradeLevel === weapon.maxUpgradeLevel ? ", maximum level" : ""}.`;
  }

  function showBuyMenu() {
    hideScope();
    buyMenu.classList.add("open");
    buyHint.classList.add("hidden");
    focusMenu(buyMenu.querySelector(".cs-buy-panel"));
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
    showUpgrade,
    hideBuyMenu,
    isBuyMenuOpen
  };
}
