export const PISTOL = {
name: "Pistol",
view: {
posOffset: [0, -1, 2],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
behavior: {
magazineSize: 20,
damage: 25,
fireCooldownMs: 200,
reloadSpeed: 3,
pellets: 1,
spread: 0.025,
},
shellEject: {
boneName: "j_bolt",
},
anim: {
idle: [0, 0],
shoot: [0, 17],
reload: [20, 145]
},
model: "./assets/pistol.glb",
fireSound: "./assets/pistol.ogg"
};
