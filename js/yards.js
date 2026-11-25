// Maple Street yards as data (L06: adding a yard is adding data, not code).
// Every yard is 400 wide. House along the top (y 0-52), lawn below, sidewalk, then the street.
function makeYard(o) {
    const H = o.H, y1 = H - 80, left = o.drive === 'left';
    const drive = { x: left ? 44 : 300, y: 52, w: 56, h: H - 104, kind: 'driveway' };
    const door = o.door;
    return {
        id: o.id, name: o.name, size: o.size, H,
        house: Object.assign({ wall: 0xe8dcc0, roof: 0xa54a3a, trim: 0x6b4a2e, windows: [] }, o.house, { door, garage: drive.x }),
        sides: o.sides || ['picket', 'picket'],
        lawn: { x0: 16, y0: 52, x1: 384, y1 },
        bounds: { x0: 16, y0: 52, x1: 384, y1: H - 52 },
        hard: [
            drive,
            { x: door - 10, y: 64, w: 20, h: y1 - 64, kind: 'walk' },
            { x: 16, y: y1, w: 368, h: 28, kind: 'sidewalk' },
        ],
        solids: [
            { type: 'rect', x: door - 16, y: 52, w: 32, h: 12, kind: 'steps' },
            { type: 'circle', x: left ? 360 : 40, y: y1 - 12, r: 6, kind: 'mailbox' },
            ...o.solids,
        ],
        hidden: o.hidden || [],
        start: {
            mower: { x: drive.x + 28, y: y1 - 40, a: -Math.PI / 2 },
            trimmer: { x: door, y: 96, a: Math.PI / 2 },
        },
        dogHome: o.dogHome || null,
    };
}

const R = (x, y, w, h, kind) => ({ type: 'rect', x, y, w, h, kind });
const C = (x, y, r, kind) => ({ type: 'circle', x, y, r, kind });

const YARDS = {
    walt: makeYard({ id: 'walt', name: "Walt's yard", size: 'small', H: 640, drive: 'right', door: 200,
        house: { windows: [60, 250] },
        solids: [R(24, 52, 126, 24, 'bed'), R(226, 52, 70, 20, 'bed'), C(92, 250, 24, 'tree'), C(252, 380, 10, 'birdbath')],
        hidden: [{ x: 150, y: 470 }] }),
    okafor: makeYard({ id: 'okafor', name: "Mrs. Okafor's yard", size: 'small', H: 600, drive: 'left', door: 250,
        house: { wall: 0xf3e2b3, roof: 0x5b7fb5, windows: [140, 320] },
        solids: [R(110, 52, 110, 22, 'bed'), C(300, 60, 12, 'shrub'), C(352, 60, 12, 'shrub'), R(130, 290, 80, 34, 'bed'), C(320, 400, 20, 'tree')],
        hidden: [{ x: 200, y: 200 }] }),
    feldman: makeYard({ id: 'feldman', name: "Gus Feldman's yard", size: 'small', H: 620, drive: 'right', door: 160,
        house: { wall: 0xd7dde2, roof: 0x4a4f57, windows: [60, 230] }, sides: ['wood', 'wood'],
        solids: [R(24, 52, 110, 20, 'bed'), C(220, 60, 10, 'shrub'), C(262, 60, 10, 'shrub'), C(90, 330, 5, 'gnome'), C(240, 380, 5, 'gnome')],
        hidden: [{ x: 100, y: 450 }] }),
    henderson: makeYard({ id: 'henderson', name: "The Hendersons' yard", size: 'medium', H: 800, drive: 'left', door: 230,
        house: { wall: 0xf0d6c8, roof: 0x8a5a3a, windows: [140, 310] },
        solids: [R(120, 52, 84, 20, 'bed'), R(270, 300, 70, 40, 'swing'), C(160, 330, 26, 'tree'), C(310, 560, 22, 'tree'), C(180, 620, 5, 'toy')],
        hidden: [{ x: 300, y: 180 }, { x: 130, y: 500 }] }),
    brandt: makeYard({ id: 'brandt', name: "Kyle Brandt's yard", size: 'medium', H: 780, drive: 'right', door: 120,
        house: { wall: 0xcfe0c4, roof: 0x3f5f3a, windows: [40, 200] }, sides: ['wood', 'hedge'],
        solids: [R(150, 52, 120, 20, 'bed'), R(30, 420, 36, 30, 'doghouse'), C(220, 260, 24, 'tree'), C(60, 200, 14, 'shrub')],
        hidden: [{ x: 250, y: 520 }], dogHome: { x: 48, y: 470 } }),
    moretti: makeYard({ id: 'moretti', name: "Vince Moretti's yard", size: 'small', H: 600, drive: 'right', door: 200,
        house: { wall: 0xe9e4da, roof: 0x9b2f2f, windows: [110, 240] }, sides: ['hedge', 'hedge'],
        solids: [C(40, 60, 12, 'shrub'), C(276, 60, 12, 'shrub'), R(100, 52, 70, 18, 'bed'), C(120, 300, 10, 'birdbath')] }),
    ditmore: makeYard({ id: 'ditmore', name: "The Ditmores' yard", size: 'medium', H: 800, drive: 'left', door: 260,
        house: { wall: 0xfaf6ee, roof: 0x2f3a4a, windows: [160, 330] },
        solids: [R(110, 52, 124, 22, 'bed'), R(290, 52, 60, 22, 'bed'), R(140, 380, 96, 30, 'bed'), C(300, 280, 18, 'tree'), C(330, 560, 22, 'tree'), C(170, 600, 9, 'birdbath')],
        hidden: [{ x: 200, y: 250 }] }),
};
const WALT_YARD = YARDS.walt;

// A yard by key. "name~m" is the same layout flipped left to right (one-time jobs around the block).
function yardOf(key) {
    if (YARDS[key]) return YARDS[key];
    const [base, flag] = key.split('~'), b = YARDS[base];
    if (!b || flag !== 'm') return null;
    const fx = s => s.type === 'circle' ? Object.assign({}, s, { x: 400 - s.x }) : Object.assign({}, s, { x: 400 - s.x - s.w });
    const y = JSON.parse(JSON.stringify(b));
    Object.assign(y, { id: key, sides: b.sides.slice().reverse(), hard: b.hard.map(fx), solids: b.solids.map(fx),
        hidden: b.hidden.map(h => ({ x: 400 - h.x, y: h.y })),
        house: Object.assign({}, b.house, { door: 400 - b.house.door, garage: 400 - b.house.garage - 56, windows: b.house.windows.map(w => 400 - w - 34) }),
        start: { mower: Object.assign({}, b.start.mower, { x: 400 - b.start.mower.x }), trimmer: Object.assign({}, b.start.trimmer, { x: 400 - b.start.trimmer.x }) },
        dogHome: b.dogHome ? { x: 400 - b.dogHome.x, y: b.dogHome.y } : null });
    YARDS[key] = y;
    return y;
}
