export const ENEMY = {
positionY: 1.2,
scale: [1.2, 1.2, -1.2],
enemyHealth: 100,
enemySpeed: 1.5,
enemyDamage: 10,
attackDistance: 2,
attackDamageDelay: 1.2,
anim: {
walk: ["WALK_drunk"],
attack: ["FightA_2", "FightA_3"],
hit: ["HIT_L", "HIT_R"],
death: ["KO_skid_front"]
},
model: "./assets/enemy.glb",
attackSound: "./assets/enemy.ogg"
};
