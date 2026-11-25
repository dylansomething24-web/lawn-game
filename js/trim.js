// Trimming by target (2026-11-24 rework): the player picks WHAT to trim, the trimmer walks
// there on its own and traces all the way around it. Nothing to aim.

// Grid pathfinding for the trimmer: A* on a 4px grid, then straightened with line-of-sight.
class TrimPather {
    constructor(yard, r) {
        this.yard = yard; this.r = r; this.s = 4;
        const B = yard.def.bounds;
        this.x0 = B.x0; this.y0 = B.y0;
        this.cols = Math.floor((B.x1 - B.x0) / this.s) + 1;
        this.rows = Math.floor((B.y1 - B.y0) / this.s) + 1;
        this.free = new Uint8Array(this.cols * this.rows);
        for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++)
            this.free[j * this.cols + i] = yard.collides(this.x0 + i * this.s, this.y0 + j * this.s, r) ? 0 : 1;
    }
    pos(n) { return { x: this.x0 + (n % this.cols) * this.s, y: this.y0 + ((n / this.cols) | 0) * this.s }; }
    // nearest free node that can see p in a straight line
    nodeNear(p, reach) {
        const ci = Math.round((p.x - this.x0) / this.s), cj = Math.round((p.y - this.y0) / this.s);
        let best = -1, bd = 1e9;
        for (let rad = 0; rad <= 6 && best < 0; rad++)
            for (let j = cj - rad; j <= cj + rad; j++) for (let i = ci - rad; i <= ci + rad; i++) {
                if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue;
                const n = j * this.cols + i; if (!this.free[n]) continue;
                const q = this.pos(n), d = Math.hypot(q.x - p.x, q.y - p.y);
                if (d < bd && reach(q, p)) { bd = d; best = n; }
            }
        return best;
    }
    // Path from a to b as a list of points (b included, a not). null if no way through.
    find(a, b, reach) {
        if (reach(a, b, true)) return [b];
        const s = this.nodeNear(a, reach), g = this.nodeNear(b, reach);
        if (s < 0 || g < 0) return null;
        const C = this.cols, N = this.free.length;
        const gs = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
        const open = [s]; gs[s] = 0;
        const gp = this.pos(g), h = n => { const p = this.pos(n); return Math.hypot(p.x - gp.x, p.y - gp.y); };
        const f = new Float32Array(N).fill(1e9); f[s] = h(s);
        const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
        let found = false;
        while (open.length) {
            let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
            const n = open[bi]; open[bi] = open[open.length - 1]; open.pop();
            if (n === g) { found = true; break; }
            if (closed[n]) continue; closed[n] = 1;
            const i = n % C, j = (n / C) | 0;
            for (const [di, dj, w] of D) {
                const ii = i + di, jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= C || jj >= this.rows) continue;
                const m = jj * C + ii;
                if (!this.free[m] || closed[m]) continue;
                if (di && dj && (!this.free[j * C + ii] || !this.free[jj * C + i])) continue;   // no corner cutting
                const ng = gs[n] + w * this.s;
                if (ng < gs[m]) { gs[m] = ng; from[m] = n; f[m] = ng + h(m); open.push(m); }
            }
        }
        if (!found) return null;
        const nodes = []; for (let n = g; n !== -1; n = from[n]) nodes.unshift(this.pos(n));
        nodes.push(b);
        // straighten: from each point jump to the furthest one in plain sight
        const out = []; let cur = a, k = 0;
        while (k < nodes.length) {
            let far = k;
            for (let t = nodes.length - 1; t > k; t--) if (reach(cur, nodes[t], true)) { far = t; break; }
            out.push(nodes[far]); cur = nodes[far]; k = far + 1;
        }
        return out;
    }
}

// Every thing in the yard that needs trimming: each obstacle, each fence, the house wall.
function buildTrimTargets(yard, scene) {
    const def = yard.def, r = CFG.trimmer.collideR, d = r + 0.6, step = 3, B = def.bounds;
    const ok = p => !yard.collides(p.x, p.y, r);
    const targets = [];
    const NAMES = { bed: 'Flower bed', tree: 'Tree', birdbath: 'Birdbath', mailbox: 'Mailbox', steps: 'Porch steps', shrub: 'Shrub',
        gnome: 'Garden gnome', swing: 'Swing set', doghouse: 'Doghouse', toy: 'Toy', sprinkler: 'Sprinkler head' };
    const nameOf = s => NAMES[s.kind] || s.kind;

    // a closed outline split wherever it runs into something (a bed against the house, etc.)
    const fromLoop = (name, pts) => {
        const valid = pts.map(ok);
        if (valid.every(v => v)) return { name, runs: [pts], closed: true };
        const first = valid.indexOf(false);
        const rot = pts.slice(first).concat(pts.slice(0, first)), rv = valid.slice(first).concat(valid.slice(0, first));
        return { name, runs: splitRuns(rot, rv), closed: false };
    };
    const splitRuns = (pts, valid) => {
        const runs = []; let cur = [];
        pts.forEach((p, i) => { if (valid[i]) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } });
        if (cur.length) runs.push(cur);
        return runs;
    };
    const line = (name, a, b) => {
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)), pts = [];
        for (let k = 0; k <= n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
        return { name, runs: splitRuns(pts, pts.map(ok)), closed: false };
    };

    for (const s of def.solids) {
        const pts = [];
        if (s.type === 'circle') {
            const R = s.r + d, n = Math.max(12, Math.ceil(2 * Math.PI * R / step));
            for (let k = 0; k < n; k++) { const t = k / n * 2 * Math.PI; pts.push({ x: s.x + Math.cos(t) * R, y: s.y + Math.sin(t) * R }); }
        } else {   // rectangle with rounded corners, clockwise from top-left
            const L = s.x, T = s.y, Rt = s.x + s.w, Bt = s.y + s.h;
            const side = (x0, y0, x1, y1) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)); for (let k = 0; k < n; k++) pts.push({ x: x0 + (x1 - x0) * k / n, y: y0 + (y1 - y0) * k / n }); };
            const arc = (cx, cy, a0) => { const n = Math.max(2, Math.ceil(Math.PI / 2 * d / step)); for (let k = 0; k < n; k++) { const t = a0 + k / n * Math.PI / 2; pts.push({ x: cx + Math.cos(t) * d, y: cy + Math.sin(t) * d }); } };
            side(L, T - d, Rt, T - d); arc(Rt, T, -Math.PI / 2);
            side(Rt + d, T, Rt + d, Bt); arc(Rt, Bt, 0);
            side(Rt, Bt + d, L, Bt + d); arc(L, Bt, Math.PI / 2);
            side(L - d, Bt, L - d, T); arc(L, T, Math.PI);
        }
        targets.push(fromLoop(nameOf(s), pts));
    }
    const L = def.lawn;
    const sideName = k => (def.sides || [])[k] === 'hedge' ? 'hedge' : 'fence';
    targets.push(line('Left ' + sideName(0), { x: B.x0 + d, y: B.y0 + d }, { x: B.x0 + d, y: L.y1 }));
    targets.push(line('Right ' + sideName(1), { x: B.x1 - d, y: B.y0 + d }, { x: B.x1 - d, y: L.y1 }));
    targets.push(line('House wall', { x: B.x0 + d, y: B.y0 + d }, { x: B.x1 - d, y: B.y0 + d }));

    // the grass each target is responsible for: every lawn cell its walk passes within cutting reach of
    const c = CFG.cell, cr = CFG.trimmer.cutR, rr = cr * cr;
    for (const t of targets) {
        t.runs = t.runs.filter(run => run.length);
        const set = new Set();
        for (const run of t.runs) for (const p of run) {
            const q0 = Math.max(0, Math.floor((p.x - cr - yard.ox) / c)), q1 = Math.min(yard.cols - 1, Math.floor((p.x + cr - yard.ox) / c));
            const r0 = Math.max(0, Math.floor((p.y - cr - yard.oy) / c)), r1 = Math.min(yard.rows - 1, Math.floor((p.y + cr - yard.oy) / c));
            for (let rw = r0; rw <= r1; rw++) for (let q = q0; q <= q1; q++) {
                const i = rw * yard.cols + q;
                if (yard.state[i] === STATE.NONE) continue;
                const dx = yard.ox + (q + 0.5) * c - p.x, dy = yard.oy + (rw + 0.5) * c - p.y;
                if (dx * dx + dy * dy <= rr) set.add(i);
            }
        }
        t.cells = [...set];
        t.left = t.cells.length;
    }
    return targets.filter(t => t.runs.length && t.cells.length);
}

const HARD_NAMES = { driveway: 'Driveway', walk: 'Front walk', sidewalk: 'Sidewalk' };

// Edging: the line where grass meets each hard surface. The edger walks right along it.
function buildEdgeTargets(yard) {
    const r = CFG.trimmer.collideR, step = 3, out = [];
    for (const h of yard.def.hard) {
        const sides = [
            { a: { x: h.x, y: h.y }, b: { x: h.x + h.w, y: h.y }, n: { x: 0, y: -1 } },
            { a: { x: h.x + h.w, y: h.y }, b: { x: h.x + h.w, y: h.y + h.h }, n: { x: 1, y: 0 } },
            { a: { x: h.x + h.w, y: h.y + h.h }, b: { x: h.x, y: h.y + h.h }, n: { x: 0, y: 1 } },
            { a: { x: h.x, y: h.y + h.h }, b: { x: h.x, y: h.y }, n: { x: -1, y: 0 } },
        ];
        const runs = [];
        for (const s of sides) {
            const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), n = Math.ceil(len / step);
            let cur = [];
            for (let k = 0; k <= n; k++) {
                const p = { x: s.a.x + (s.b.x - s.a.x) * k / n, y: s.a.y + (s.b.y - s.a.y) * k / n };
                const good = yard.isLawn(p.x + s.n.x * 3, p.y + s.n.y * 3) && !yard.collides(p.x, p.y, r, true);
                if (good) cur.push(p); else if (cur.length) { if (cur.length > 2) runs.push(cur); cur = []; }
            }
            if (cur.length > 2) runs.push(cur);
        }
        if (!runs.length) continue;
        const total = runs.reduce((s, run) => s + run.length, 0);
        out.push({ name: HARD_NAMES[h.kind] + ' edge', kind: 'edge', hard: h, runs, closed: false, hit: runs.map(run => new Uint8Array(run.length)), total, done: 0, left: total });
    }
    return out;
}

// Blowing: back and forth along each hard surface, clearing clippings within reach.
function buildBlowTargets(yard) {
    const r = CFG.trimmer.collideR, out = [], lane = 36, step = 4;
    for (const h of yard.def.hard) {
        const long = h.w >= h.h, across = long ? h.h : h.w, n = Math.max(1, Math.ceil(across / lane));
        const pts = [];
        for (let k = 0; k < n; k++) {
            const off = across * (k + 0.5) / n, forward = k % 2 === 0;
            const L = long ? h.w : h.h, m = Math.ceil(L / step);
            for (let j = 0; j <= m; j++) {
                const t = (forward ? j : m - j) / m * L;
                const p = long ? { x: h.x + t, y: h.y + off } : { x: h.x + off, y: h.y + t };
                if (!yard.collides(p.x, p.y, r, true)) pts.push(p);
            }
        }
        // split wherever consecutive points jump (something was in the way)
        const runs = []; let cur = [];
        for (const p of pts) {
            const last = cur[cur.length - 1];
            if (last && Math.hypot(p.x - last.x, p.y - last.y) > step * 2.5 && cur.length) { runs.push(cur); cur = []; }
            cur.push(p);
        }
        if (cur.length) runs.push(cur);
        out.push({ name: HARD_NAMES[h.kind], kind: 'blow', hard: h, runs: runs.filter(x => x.length > 1), closed: false, left: 0 });
    }
    return out.filter(t => t.runs.length);
}
