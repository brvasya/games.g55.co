export const SHOTGUN = {
name: "Shotgun",
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
magazineSize: 5,
damage: 25,
fireCooldownMs: 1200,
reloadSpeed: 1,
pellets: 6,
spread: 0.1,
},
anim: {
idle: "a_idle_1",
shoot: "fire",
reload: ["reload", "reload_loop", "reload_end"]
},
model: "./assets/shotgun.glb",
fireSound: "./assets/shotgun.ogg"
};
