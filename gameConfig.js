import { WORLD } from "./assets/world/gm_office_cso2_night.js";
//weapon tier1
import { PISTOL } from "./assets/weapon/bo2/c_bo2_57.js";
import { BURST_PISTOL } from "./assets/weapon/bo2/c_bo2_kard.js";
import { MAGNUM } from "./assets/weapon/bo2/c_bo2_executioner1.js";
//weapon tier2
import { SMG } from "./assets/weapon/bo2/c_bo2_pdw57.js";
import { ASSAULT_RIFLE } from "./assets/weapon/bo2/c_bo2_an94.js";
import { HEAVY_RIFLE } from "./assets/weapon/bo2/c_bo2_scarh.js";
//weapon tier3
import { SHOTGUN } from "./assets/weapon/bo2/c_bo2_ksg12.js";
import { SNIPER_RIFLE } from "./assets/weapon/bo2/c_bo2_xpr50.js";
import { MACHINE_GUN } from "./assets/weapon/bo2/c_bo2_deathmachine1.js";
//enemies
import { HUGGY_FN } from "./assets/enemies/huggy_fn.js";

export const GAME_CONFIG = {
gameTitle: "G55Game",

wave: {
baseEnemies: 6,
enemiesPerWave: 3,
maxEnemies: 20
},
enemySpawn: {
types: [
"huggy_fn"
]
}
};

export const GAME_ASSETS = {
world: WORLD,

weaponSlots: [
{ id: 1, asset: PISTOL, owned: true, price: 0 },
{ id: 2, asset: BURST_PISTOL, owned: false, price: 600 },
{ id: 3, asset: MAGNUM, owned: false, price: 1200 },

{ id: 4, asset: SMG, owned: true, price: 1800 },
{ id: 5, asset: ASSAULT_RIFLE, owned: false, price: 2400 },
{ id: 6, asset: HEAVY_RIFLE, owned: false, price: 3000 },

{ id: 7, asset: SHOTGUN, owned: true, price: 3600 },
{ id: 8, asset: SNIPER_RIFLE, owned: false, price: 4200 },
{ id: 9, asset: MACHINE_GUN, owned: false, price: 4800 }
],

enemies: {
types: {
huggy_fn: { asset: HUGGY_FN }
}
}
};
