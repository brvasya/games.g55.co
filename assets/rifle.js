export const RIFLE = {
name: "Assault Rifle",
view: {
posOffset: [0, -1, 2],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
behavior: {
magazineSize: 30,
damage: 35,
fireCooldownMs: 120,
reloadSpeed: 3,
pellets: 1,
spread: 0.05,
},
shellEject: {
boneName: "tag_bullet",
},
anim: {
idle: "idle",
shoot: "shoot",
reload: "reload"
},
model: "./assets/rifle.glb",
fireSound: "./assets/rifle.ogg"
};
