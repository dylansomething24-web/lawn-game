// Every balance number in one place (L06 ground rule). Values from L02 and L05 unless noted.
const N = {
    startMoney: 200,
    startRep: 10,                         // Maple Street starts at 10 thanks to Walt's name
    dayStart: 7 * 60, dayEnd: 18 * 60,    // 7 a.m. to 6 p.m.
    gameMinPerSec: 1.5,                   // one in-game hour is 40 real seconds; a day is about 7 minutes (L02: 5 to 8)
    driveMin: 10,                         // driving between houses on the same street
    knockMin: 30,                         // door-to-door
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

    price: { small: 30, medium: 45, large: 65 },
    addon: { trim: 5, edge: 5, blow: 5 },  // L02: trim and edge together +$10; blow +$5 (my number)
    gasPerYard: 2,

    // score (L02 section 5)
    starsAt: [90, 75, 60, 45],            // 5, 4, 3, 2 stars; below is 1
    coverageFull: 0.995, coverageZero: 0.85,
    sprinklerPts: 5, sprinklerCost: 10,

    // block reputation per job (L05 section 10)
    repStars: { 5: 3, 4: 2, 3: 1, 2: -2, 1: -4 },
    repMissed: -4,
    unlockMarks: [25, 50, 75],

    // one-time jobs: offered by phone each morning, today only
    oddPerDay: [1, 2],                    // min and max offers a day (week 1 gets the min)
    oddPremium: 1.4,                      // overgrown yards pay 40% more (L02: +25 to 50%)
    oddExpiry: 12 * 60,                   // answer by noon
    overgrownSpeed: 0.8,                  // tall grass slows the mower

    // customer relationship: good jobs needed to move up from each level
    relUp: { 1: 2, 2: 3, 3: 4, 4: 6 },
    tipChance: 0.35, tip: [3, 10],

    // equipment (L05 section 7 and 8)
    gear: {
        push:     { name: "Walt's push mower", price: 0,   speed: 135, wear: 2, kind: 'mower' },
        selfprop: { name: 'Self-propelled mower', price: 400, speed: 165, wear: 1, kind: 'mower' },
        trimmer:  { name: 'String trimmer', price: 150, kind: 'tool' },
        edger:    { name: 'Edger', price: 200, kind: 'tool' },
        blower:   { name: 'Leaf blower', price: 180, kind: 'tool' },
    },
    startCondition: 40,
    maintenanceCost: 5, maintenanceGain: 10,
    breakdownPct: cond => (100 - cond) / 10,   // percent chance per job
    fixSelfMin: 20, rosaCost: 40, rosaMin: 60, rosaGain: 20, waltSpareChance: 0.2,

    // workers (L03, L05)
    wages: { Rookie: 12, Hand: 14, Pro: 16, Veteran: 18, Master: 21 },
    minPaidHours: 4,
    maxWorkers: 2,
    hireUnlockWeek: 2,
    workerMin: { small: 100, medium: 140, large: 190 },   // game minutes to mow, average worker
    workerTaskMin: { trim: 25, edge: 20, blow: 12 },
    noPlanSlowdown: 1.15,
    knowledgeVisits: [0, 1, 3, 6],         // visits needed for levels 0..3
    knowledgeSpeed: [1, 0.9, 0.8, 0.7],

    // experience (L05 section 9)
    xpBase: 10, xpSize: { small: 1, medium: 1.5, large: 2 },
    levels: [0, 200, 500, 900, 1500, 2300, 3300, 4600, 6200, 8200],

    // chaos, Maple Street gentle (L04)
    dogOutChance: 0.5,
    maxOpenProblems: 2,
};
