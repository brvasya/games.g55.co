export const SHOTGUN = {
name: "Shotgun",
view: {
posOffset: [0, -1, 2],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
attachment: "boneName",
attachmentRotation: [0, 0, 0],
muzzleFlash: "boneName",
shellEject: "tag_weapon",
behavior: {
magazineSize: 1,
damage: 25,
fireCooldownMs: 120,
reloadSpeed: 2,
pellets: 6,
spread: 0.1,
},
anim: {
idle: "idle",
shoot: "shoot",
reload: "reload"
},
model: "./assets/shotgun.glb",
fireSound: "./assets/shotgun.ogg"
};
