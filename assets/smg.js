export const SMG = {
name: "SMG",
view: {
posOffset: [0, -1, 2],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
attachment: "boneName",
attachmentRotation: [0, 0, 0],
muzzleFlash: "boneName",
shellEject: "j_bolt",
behavior: {
magazineSize: 50,
damage: 25,
fireCooldownMs: 90,
reloadSpeed: 3,
pellets: 1,
spread: 0.05,
},
anim: {
idle: "idle",
shoot: "shoot",
reload: "reload"
},
model: "./assets/smg.glb",
fireSound: "./assets/smg.ogg"
};
