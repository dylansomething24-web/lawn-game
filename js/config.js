// Every tunable number lives here (L06 rule: balancing never means digging through code).
const CFG = {
    cell: 4,                 // grass cell size in pixels
    mower:   { speed: 85, turnRate: 9.4, cutR: 10, collideR: 15 },   // turnRate in radians per second
    trimmer: { speed: 60, turnRate: 16,  cutR: 7,  collideR: 3 },
    moveWhileTurningUnder: 0.35,   // radians; sharper turns pivot in place first
    stopTapRadius: 22,             // tap this close to the active unit to stop it
    finishAt: 0.995,               // coverage that counts as a finished yard
    showMissedAt: 0.95,            // missed spots start blinking at this coverage
    trimHintAt: 0.85,
    colors: {
        uncut:   [0x2f6326, 0x336828, 0x2d5f24, 0x376d2a, 0x31652a],
        tuft:    0x234d1c,
        light:   0x9edb72,
        dark:    0x6cb24c,
        trimmed: 0x84c45e,
        missed:  0xffe14d,
    },
    stripe: { ax: 0.38, ay: -0.92 },  // a pass heading this way leaves a light stripe; the opposite way, dark
};
