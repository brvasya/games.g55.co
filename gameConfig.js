import { PISTOL } from "./assets/pistol.js";
import { SMG } from "./assets/smg.js";
import { RIFLE } from "./assets/rifle.js";
import { SHOTGUN } from "./assets/shotgun.js";
import { SNIPER } from "./assets/sniper.js";
import { MINIGUN } from "./assets/minigun.js";
import { ENEMY } from "./assets/enemy.js";

export const GAME_CONFIG = {
gameTitle: "G55Game",

wave: {
baseEnemies: 16,
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
{ id: 2, asset: SMG, owned: false, price: 1800 },
{ id: 3, asset: RIFLE, owned: false, price: 2400 },
{ id: 4, asset: SHOTGUN, owned: false, price: 3600 },
{ id: 5, asset: SNIPER, owned: false, price: 4200 },
{ id: 6, asset: MINIGUN, owned: false, price: 4800 }
],

enemies: {
types: {
enemy: { asset: ENEMY }
}
}
};
