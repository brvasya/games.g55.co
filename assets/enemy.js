export const ENEMY = {
animations: "./assets/anim.glb",
models: ["./assets/zombie1.glb", "./assets/zombie2.glb", "./assets/zombie3.glb", "./assets/zombie4.glb"],
attackSound: "./assets/enemy.ogg",
positionY: 1.2,
scale: [1.2, 1.2, -1.2],
enemyHealth: 100,
enemySpeed: 1,
enemyDamage: 10,
attackDistance: 2,
attackDamageDelay: 0.3,
anim: {
walk: ["WALK_drunk", "WALK_shuffle"],
attack: ["FightA_1", "FightA_2", "FightA_3"],
hit: ["HIT_L", "HIT_R", "HIT_back"],
death: ["KO_shot_front", "KO_spin_L", "KO_spin_R", "KO_skid_front", "KO_skid_back", "KO_shot_stom"]
},
};
