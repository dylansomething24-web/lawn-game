// The grass grid for one yard. Yard layouts live in yards.js.
const STATE = { NONE: 0, UNCUT: 1, LIGHT: 2, DARK: 3, TRIM: 4 };

class Yard {
    // extraSolids: things found on earlier visits (sprinkler heads) that now get mowed around
    constructor(def, extraSolids) {
        this.def = Object.assign({}, def, { solids: def.solids.concat(extraSolids || []) });
        def = this.def;
        this.dynamic = [];   // moving things (a loose dog): { x, y, r }
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
        // which cells the mower itself can reach (the rest is trimmer work)
        this.reach = new Uint8Array(this.state.length);
        const m = CFG.mower, rr = m.cutR * m.cutR, B = def.bounds;
        for (let y = B.y0; y <= B.y1; y += 2) for (let x = B.x0; x <= B.x1; x += 2) {
            if (this.collides(x, y, m.collideR, true)) continue;
            const q0 = Math.max(0, Math.floor((x - m.cutR - this.ox) / c)), q1 = Math.min(this.cols - 1, Math.floor((x + m.cutR - this.ox) / c));
            const r0 = Math.max(0, Math.floor((y - m.cutR - this.oy) / c)), r1 = Math.min(this.rows - 1, Math.floor((y + m.cutR - this.oy) / c));
            for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) {
                const i = r * this.cols + q;
                if (this.state[i] === STATE.NONE || this.reach[i]) continue;
                const dx = this.ox + (q + 0.5) * c - x, dy = this.oy + (r + 0.5) * c - y;
                if (dx * dx + dy * dy <= rr) this.reach[i] = 1;
            }
        }
        this.reachTotal = 0; for (let i = 0; i < this.reach.length; i++) this.reachTotal += this.reach[i];
        this.reachCut = 0;
    }

    isHard(x, y) {
        for (const h of this.def.hard) if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
        return null;
    }

    // share of the mower's grass that's been cut (trimmer-only cells don't count against mowing)
    mowCoverage() { return this.reachTotal ? this.reachCut / this.reachTotal : 0; }

    // How clean the stripes are: share of mowed cells whose four neighbors are the same shade.
    // Clean even lanes score about 0.5 or more; wandering, criss-crossed mowing scores much lower.
    stripeQuality() {
        let n = 0, good = 0;
        const S = this.state, W = this.cols;
        for (let r = 1; r < this.rows - 1; r++) for (let q = 1; q < W - 1; q++) {
            const i = r * W + q, s = S[i];
            if (s !== STATE.LIGHT && s !== STATE.DARK) continue;
            n++;
            let same = true;
            for (const j of [i - 1, i + 1, i - W, i + W]) { const t = S[j]; if ((t === STATE.LIGHT || t === STATE.DARK) && t !== s) { same = false; break; } }
            if (same) good++;
        }
        return n ? good / n : 0;
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

    collides(x, y, r, staticOnly) {
        const B = this.def.bounds;
        if (x < B.x0 + r || x > B.x1 - r || y < B.y0 + r || y > B.y1 - r) return true;
        for (const s of this.def.solids) if (Yard.inSolid(s, x, y, r)) return true;
        if (!staticOnly) for (const d of this.dynamic) { const dx = x - d.x, dy = y - d.y; if (dx * dx + dy * dy < (d.r + r) * (d.r + r)) return true; }
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
            if (s === STATE.UNCUT) { this.cut++; out.fresh++; if (this.reach[i]) this.reachCut++; }
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
        if (this.state[i] === STATE.UNCUT && this.noise[i] > (this.overgrown ? 0.3 : 0.62)) {   // shaggy tufts on uncut grass
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

    uncutCenters(mowerOnly) {
        const c = CFG.cell, out = [];
        for (let i = 0; i < this.state.length; i++) if (this.state[i] === STATE.UNCUT && (!mowerOnly || this.reach[i]))
            out.push({ x: this.ox + (i % this.cols) * c, y: this.oy + ((i / this.cols) | 0) * c });
        return out;
    }
}
