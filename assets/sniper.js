export const SNIPER = {
name: "Sniper Rifle",
view: {
posOffset: [3, -3, -8],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
behavior: {
magazineSize: 8,
damage: 240,
fireCooldownMs: 600,
reloadSpeed: 3,
pellets: 1,
spread: 0,
isSniper: true
},
bulletCamera: {
enabled: true,
speed: 65,
minDistance: 6,
maxDistance: 140,
fov: 58,
chaseDistance: 0.9,
chaseHeight: 0.18,
sideOffset: 0.16,
lookAhead: 2.5,
trailLength: 1.8,
impactHold: 0.08,
enemyHitSlowMoScale: 0.18,
enemyHitSlowMoDuration: 1.0
},
shellEject: {
boneName: "tag_ads",
},
anim: {
idle: [0, 0],
shoot: [0, 27],
reload: [30, 275]
},
model: "./assets/sniper.glb",
fireSound: "./assets/sniper.ogg"
};
