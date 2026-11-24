// Walt's yard (L02 section 13, house 1): the phase-1 test yard.
// World is 400 x 640. Grass is tracked in a grid of CFG.cell-sized cells.
const WALT_YARD = {
    name: "Walt's yard",
    lawn:   { x0: 16, y0: 52, x1: 384, y1: 560 },
    bounds: { x0: 16, y0: 52, x1: 384, y1: 588 },   // where units can stand (sidewalk included)
    hard: [                                           // hard surfaces: no grass, mowers may cross
        { x: 300, y: 52,  w: 56,  h: 536, kind: 'driveway' },
        { x: 190, y: 64,  w: 20,  h: 496, kind: 'walk' },
        { x: 16,  y: 560, w: 368, h: 28,  kind: 'sidewalk' },
    ],
    solids: [                                         // nothing drives through these
        { type: 'rect',   x: 24,  y: 52, w: 126, h: 24, kind: 'bed' },
        { type: 'rect',   x: 226, y: 52, w: 70,  h: 20, kind: 'bed' },
        { type: 'rect',   x: 184, y: 52, w: 32,  h: 12, kind: 'steps' },
        { type: 'circle', x: 92,  y: 250, r: 24, kind: 'tree' },
        { type: 'circle', x: 252, y: 380, r: 10, kind: 'birdbath' },
        { type: 'circle', x: 40,  y: 548, r: 6,  kind: 'mailbox' },
    ],
    start: {
        mower:   { x: 328, y: 520, a: -Math.PI / 2 },
        trimmer: { x: 200, y: 96,  a: Math.PI / 2 },
    },
};

const STATE = { NONE: 0, UNCUT: 1, LIGHT: 2, DARK: 3, TRIM: 4 };

class Yard {
    constructor(def) {
        this.def = def;
        const L = def.lawn, c = CFG.cell;
        this.ox = L.x0; this.oy = L.y0;
        this.cols = Math.round((L.x1 - L.x0) / c);
        this.rows = Math.round((L.y1 - L.y0) / c);
        this.state = new Uint8Array(this.cols * this.rows);
        this.noise = new Float32Array(this.cols * this.rows);
        this.total = 0; this.cut = 0;
        for (let r = 0; r < this.rows; r++) for (let q = 0; q < this.cols; q++) {
            const i = r * this.cols + q;
            const x = this.ox + (q + 0.5) * c, y = this.oy + (r + 0.5) * c;
            this.noise[i] = Math.random();
            if (this.isLawn(x, y)) { this.state[i] = STATE.UNCUT; this.total++; }
        }
    }

    isLawn(x, y) {
        const L = this.def.lawn;
        if (x < L.x0 || x >= L.x1 || y < L.y0 || y >= L.y1) return false;
        for (const h of this.def.hard) if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return false;
        for (const s of this.def.solids) if (Yard.inSolid(s, x, y, 0)) return false;
        return true;
    }

    static inSolid(s, x, y, pad) {
        if (s.type === 'circle') { const dx = x - s.x, dy = y - s.y; return dx * dx + dy * dy < (s.r + pad) * (s.r + pad); }
        const cx = Math.max(s.x, Math.min(x, s.x + s.w)), cy = Math.max(s.y, Math.min(y, s.y + s.h));
        const dx = x - cx, dy = y - cy; return dx * dx + dy * dy < pad * pad || (pad === 0 && x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h);
    }

    collides(x, y, r) {
        const B = this.def.bounds;
        if (x < B.x0 + r || x > B.x1 - r || y < B.y0 + r || y > B.y1 - r) return true;
        for (const s of this.def.solids) if (Yard.inSolid(s, x, y, r)) return true;
        return false;
    }

    clamp(x, y, r) {
        const B = this.def.bounds;
        return { x: Math.max(B.x0 + r, Math.min(B.x1 - r, x)), y: Math.max(B.y0 + r, Math.min(B.y1 - r, y)) };
    }

    coverage() { return this.total ? this.cut / this.total : 0; }

    // Cut every cell within radius. Returns { fresh, changed: [indices] }.
    cutAround(x, y, radius, newState) {
        const c = CFG.cell, out = { fresh: 0, changed: [] };
        const q0 = Math.max(0, Math.floor((x - radius - this.ox) / c)), q1 = Math.min(this.cols - 1, Math.floor((x + radius - this.ox) / c));
        const r0 = Math.max(0, Math.floor((y - radius - this.oy) / c)), r1 = Math.min(this.rows - 1, Math.floor((y + radius - this.oy) / c));
        const rr = radius * radius;
        for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
            const i = r * this.cols + q, s = this.state[i];
            if (s === STATE.NONE) continue;
            const dx = this.ox + (q + 0.5) * c - x, dy = this.oy + (r + 0.5) * c - y;
            if (dx * dx + dy * dy > rr) continue;
            let ns = newState;
            if (newState === STATE.TRIM && s !== STATE.UNCUT) continue;   // the trimmer doesn't wipe out stripes
            if (s === ns) continue;
            if (s === STATE.UNCUT) { this.cut++; out.fresh++; }
            this.state[i] = ns; out.changed.push(i);
        }
        return out;
    }

    colorFor(i) {
        const s = this.state[i], n = this.noise[i], C = CFG.colors;
        let base;
        if (s === STATE.UNCUT) base = C.uncut[Math.floor(n * C.uncut.length)];
        else if (s === STATE.LIGHT) base = C.light;
        else if (s === STATE.DARK) base = C.dark;
        else base = C.trimmed;
        const k = s === STATE.UNCUT ? 1 : 0.94 + n * 0.1;   // a little texture in cut grass
        const r = Math.min(255, ((base >> 16) & 255) * k) | 0, g = Math.min(255, ((base >> 8) & 255) * k) | 0, b = Math.min(255, (base & 255) * k) | 0;
        return `rgb(${r},${g},${b})`;
    }

    paintCell(ctx, i) {
        const c = CFG.cell, q = i % this.cols, r = (i / this.cols) | 0;
        ctx.fillStyle = this.colorFor(i);
        ctx.fillRect(q * c, r * c, c, c);
        if (this.state[i] === STATE.UNCUT && this.noise[i] > 0.62) {   // shaggy tufts on uncut grass
            const t = CFG.colors.tuft;
            ctx.fillStyle = `rgb(${(t >> 16) & 255},${(t >> 8) & 255},${t & 255})`;
            const ox = Math.floor(this.noise[i] * 37) % c;
            ctx.fillRect(q * c + ox, r * c, 1, c - 1);
        }
    }

    paintAll(ctx) {
        ctx.clearRect(0, 0, this.cols * CFG.cell, this.rows * CFG.cell);
        for (let i = 0; i < this.state.length; i++) if (this.state[i] !== STATE.NONE) this.paintCell(ctx, i);
    }

    uncutCenters() {
        const c = CFG.cell, out = [];
        for (let i = 0; i < this.state.length; i++) if (this.state[i] === STATE.UNCUT)
            out.push({ x: this.ox + (i % this.cols) * c, y: this.oy + ((i / this.cols) | 0) * c });
        return out;
    }
}
