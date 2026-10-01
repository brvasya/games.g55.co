export const RIFLE = {
name: "Assault Rifle",
view: {
posOffset: [0, -1, 6],
rotOffset: [0, -Math.PI, 0],
scl: [1, 1, 1]
},
attachment: "flashlight",
attachmentRotation: [0, Math.PI/2, 0],
muzzleFlash: "muzzle_flash",
shellEject: "shell",
behavior: {
magazineSize: 30,
damage: 35,
fireCooldownMs: 120,
reloadSpeed: 1,
pellets: 1,
spread: 0.05,
hasScope: true
},
anim: {
idle: "idling",
shoot: "shoot1",
reload: "reload"
},
model: "./assets/rifle.glb",
fireSound: "./assets/rifle.ogg"
};
