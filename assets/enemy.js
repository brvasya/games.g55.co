export const ENEMY = {
animations: "./assets/anim.glb",
models: ["./assets/enemy1.glb", "./assets/enemy2.glb"],
attackSound: "./assets/enemy.ogg",
positionY: 1.2,
scale: [1.2, 1.2, -1.2],
enemyHealth: 100,
enemySpeed: 1,
enemyDamage: 10,
attackDistance: 2,
attackDamageDelay: 0.4,
anim: {
walk: ["WALK_drunk"],
attack: ["FightA_2", "FightA_3"],
hit: ["HIT_L", "HIT_R"],
death: ["KO_skid_front", "KO_shot_front", "KO_shot_stom"]
},
};
