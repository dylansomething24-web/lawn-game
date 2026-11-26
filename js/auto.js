// Automatic mowing plans (2026-11-26 redesign). Nobody steers: the mower runs straight lanes that
// alternate direction, so the stripes come out light, dark, light. Then it cleans up what the lanes missed.

// orient 'v' = lanes run up and down, 'h' = side to side.
// Returns { segs: [{ lane, from, to, len }], lanes, passes, a0, gap, orient }.
function planLanes(yard, orient) {
    const m = CFG.mower, r = m.collideR, B = yard.def.bounds, v = orient === 'v';
    const a0 = (v ? B.x0 : B.y0) + r, a1 = (v ? B.x1 : B.y1) - r;   // across the lanes
    const b0 = (v ? B.y0 : B.x0) + r, b1 = (v ? B.y1 : B.x1) - r;   // along a lane
    const n = Math.max(2, Math.ceil((a1 - a0) / m.lane) + 1), gap = (a1 - a0) / (n - 1);
    const segs = [];
    for (let k = 0; k < n; k++) {
        const a = a0 + gap * k, runs = [];
        let start = null, last = null;
        for (let b = b0; b <= b1 + 0.01; b += 2) {
            const x = v ? a : b, y = v ? b : a;
            if (!yard.collides(x, y, r, true)) { if (start === null) start = b; last = b; }
            else if (start !== null) { runs.push([start, last]); start = null; }
        }
        if (start !== null) runs.push([start, last]);
        const fwd = k % 2 === 0;   // even lanes one way, odd lanes back the other way
        const p = t => v ? { x: a, y: t } : { x: t, y: a };
        for (const [s, e] of runs) {
            if (e - s < 4) continue;
            segs.push({ lane: k, from: p(fwd ? s : e), to: p(fwd ? e : s), len: e - s });
        }
    }
    return { segs, lanes: n, passes: segs.length, a0, gap, orient };
}

// Which shade a pass leaves, from the way it's heading (same rule as before: CFG.stripe).
function headingShade(dx, dy) { return (dx * CFG.stripe.ax + dy * CFG.stripe.ay) > 0 ? STATE.LIGHT : STATE.DARK; }
function segShade(s) { return headingShade(s.to.x - s.from.x, s.to.y - s.from.y); }

// The shade of whichever lane a point falls in, so touch-ups don't scuff the stripes.
function laneShadeAt(plan, x, y) {
    const a = plan.orient === 'v' ? x : y;
    const k = Math.max(0, Math.min(plan.lanes - 1, Math.round((a - plan.a0) / plan.gap)));
    const even = plan.orient === 'v' ? headingShade(0, 1) : headingShade(1, 0);
    return k % 2 === 0 ? even : (even === STATE.LIGHT ? STATE.DARK : STATE.LIGHT);
}

// A spot the mower can sit on that cuts the grass cell centered at (cx, cy), nearest to `from`.
function coverPoint(yard, cx, cy, from) {
    const r = CFG.mower.collideR, R = CFG.mower.cutR - 0.8;
    let best = null, bd = 1e9;
    for (let d = 0; d <= R; d += 1.2) for (let a = 0; a < 20; a++) {
        const x = cx + Math.cos(a / 20 * 6.2832) * d, y = cy + Math.sin(a / 20 * 6.2832) * d;
        if (yard.collides(x, y, r, true)) continue;
        const dd = (x - from.x) * (x - from.x) + (y - from.y) * (y - from.y);
        if (dd < bd) { bd = dd; best = { x, y }; }
        if (d === 0) break;
    }
    return best;
}

// Points along a lane with a little side-to-side wander (less competence, more wander).
function wobbleLane(yard, s, amp) {
    const L = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), n = Math.max(1, Math.round(L / 22));
    const dx = (s.to.x - s.from.x) / L, dy = (s.to.y - s.from.y) / L, nx = -dy, ny = dx;
    const ph = Math.random() * 6.28, out = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        let x = s.from.x + (s.to.x - s.from.x) * t, y = s.from.y + (s.to.y - s.from.y) * t;
        if (i < n && amp > 0) {
            const o = amp * (0.7 * Math.sin(ph + i * 0.9) + 0.3 * (Math.random() * 2 - 1));
            if (!yard.collides(x + nx * o, y + ny * o, CFG.mower.collideR, true)) { x += nx * o; y += ny * o; }
        }
        out.push({ x, y });
    }
    return out;
}
