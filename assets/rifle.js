export const RIFLE = {
name: "Assault Rifle",
view: {
posOffset: [0, -1, 5],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
attachment: "flashlight",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "muzzle_flash",
shellEject: "shell",
behavior: {
magazineSize: 20,
damage: 35,
fireCooldownMs: 120,
reloadSpeed: 1,
pellets: 1,
spread: 0.05,
},
anim: {
idle: "ta_rifle_run_trans_idle",
shoot: "fire",
reload: "reload"
},
model: "./assets/minigun.glb",
fireSound: "./assets/minigun.ogg"
};
