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
shellEject: {
boneName: "tag_ads",
},
anim: {
idle: "idle",
shoot: "shoot",
reload: "reload"
},
model: "./assets/sniper.glb",
fireSound: "./assets/sniper.ogg"
};
