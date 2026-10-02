import { PISTOL } from "./assets/pistol.js";
import { SMG } from "./assets/smg.js";
import { RIFLE } from "./assets/rifle.js";
import { SHOTGUN } from "./assets/shotgun.js";
import { SNIPER } from "./assets/sniper.js";
import { LAUNCHER } from "./assets/launcher.js";
import { ENEMY } from "./assets/enemy.js";

export const GAME_CONFIG = {
gameTitle: "Shooter: Zombie Survival",

wave: {
baseEnemies: 6,
enemiesPerWave: 3,
maxEnemies: 20
},
enemySpawn: {
types: ["enemy"]
}
};

export const GAME_ASSETS = {
weaponSlots: [
{ id: 1, asset: PISTOL, owned: true, price: 0 },
{ id: 2, asset: SMG, owned: false, price: 1500 },
{ id: 3, asset: RIFLE, owned: false, price: 2500 },
{ id: 4, asset: SHOTGUN, owned: false, price: 3500 },
{ id: 5, asset: SNIPER, owned: false, price: 4500 },
{ id: 6, asset: LAUNCHER, owned: false, price: 6000 }
],

enemies: {
types: {
enemy: { asset: ENEMY }
}
}
};
