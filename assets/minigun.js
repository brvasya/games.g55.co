export const MINIGUN = {
name: "Minigun",
view: {
posOffset: [0, -1, 1],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
behavior: {
magazineSize: 200,
damage: 35,
fireCooldownMs: 90,
reloadSpeed: 3,
pellets: 1,
spread: 0.05,
},
shellEject: {
boneName: "tag_clip",
},
anim: {
idle: [0, 0],
shoot: [0, 7],
reload: [10, 260]
},
model: "./assets/minigun.glb",
fireSound: "./assets/minigun.ogg"
};
