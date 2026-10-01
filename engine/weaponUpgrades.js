// Three paid upgrades above the fully usable, unlabelled base weapon.
// Every tier is relative to immutable base stats, never the previous tier.
export const WEAPON_UPGRADE_TIERS = Object.freeze([
  Object.freeze({ damageMultiplier: 1, fireRateMultiplier: 1, reloadDurationMultiplier: 1 }),
  Object.freeze({ damageMultiplier: 1.25, fireRateMultiplier: 1.1, reloadDurationMultiplier: 0.9 }),
  Object.freeze({ damageMultiplier: 1.5, fireRateMultiplier: 1.2, reloadDurationMultiplier: 0.8 }),
  Object.freeze({ damageMultiplier: 1.75, fireRateMultiplier: 1.3, reloadDurationMultiplier: 0.7 })
]);

export const MAX_WEAPON_UPGRADE_LEVEL = WEAPON_UPGRADE_TIERS.length - 1;

export function getWeaponUpgradeStats(baseStats, level) {
  const tier = WEAPON_UPGRADE_TIERS[level];
  if (!tier) throw new RangeError(`Invalid weapon upgrade level: ${level}`);
  return {
    ...tier,
    damage: baseStats.damage * tier.damageMultiplier,
    fireCooldownMs: baseStats.fireCooldownMs / tier.fireRateMultiplier
  };
}

export function getWeaponUpgradePrice(weaponPrice, level) {
  if (!Number.isInteger(level) || level < 0 || level >= MAX_WEAPON_UPGRADE_LEVEL) return null;
  const basePrice = Number.isFinite(weaponPrice) ? Math.max(0, weaponPrice) : 0;
  // Round the first upgrade up to $50; free starter weapons still cost $300.
  const firstUpgrade = Math.max(300, Math.ceil(basePrice / 100) * 50);
  return firstUpgrade * (2 ** level);
}
