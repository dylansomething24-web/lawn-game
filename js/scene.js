// Phase 1: the mowing feel. One yard, tap-to-route mower and trimmer, stripes, finish.
class YardScene extends Phaser.Scene {
    constructor() { super('yard'); }

    create() {
        this.yard = new Yard(WALT_YARD);
        this.finished = false;
        this.startTime = null;
        this.elapsed = 0;
        this.passes = 0;
        this.particles = [];
        this.blinkOn = false; this.blinkT = 0;

        this.drawBackground();

        if (this.textures.exists('grass')) this.textures.remove('grass');
        this.grassTex = this.textures.createCanvas('grass', this.yard.cols * CFG.cell, this.yard.rows * CFG.cell);
        this.gctx = this.grassTex.getContext();
        this.yard.paintAll(this.gctx);
        this.grassTex.refresh();
        this.add.image(this.yard.ox, this.yard.oy, 'grass').setOrigin(0).setDepth(2);

        this.missedG = this.add.graphics().setDepth(3);
        this.fxG = this.add.graphics().setDepth(8);
        this.drawObstacles();
        this.routeG = this.add.graphics().setDepth(7);
        this.ringG = this.add.graphics().setDepth(4);

        this.units = { mower: this.makeUnit('mower'), trimmer: this.makeUnit('trimmer') };
        this.active = 'mower';
        this.mstate = 'idle';          // mower: idle | drive | uturn | around | end | blocked
        this.units.mower.dir = null;

        const cam = this.cameras.main;
        cam.setBounds(0, 0, 400, 640);
        this.zoomed = UI.zoomed;
        cam.setZoom(this.zoomed ? CFG.zoom : 1);
        cam.startFollow(this.units.mower.c, true, 0.12, 0.12);

        this.down = null;
        this.input.on('pointerdown', p => { this.down = { x: p.x, y: p.y, wx: p.worldX, wy: p.worldY }; });
        this.input.on('pointerup', p => {
            const d = this.down; this.down = null;
            if (!d) return;
            const dx = p.x - d.x, dy = p.y - d.y;
            if (Math.hypot(dx, dy) >= CFG.swipeMin) this.onSwipe(dx, dy);
            else this.onTap(d.wx, d.wy);
        });
        UI.sceneReady(this);
        this.refreshActions();
        UI.hint('start', "Swipe on the yard to send the mower straight. It mows until it reaches the edge. Tap the yard to stop it.");
    }

    toggleZoom() {
        this.zoomed = !this.zoomed; UI.zoomed = this.zoomed;
        this.cameras.main.zoomTo(this.zoomed ? CFG.zoom : 1, 250);
        return this.zoomed;
    }

    startClock() {
        if (this.startTime === null) { this.startTime = this.time.now; Pacing.mark('first move'); }
    }

    // ---------- lane mowing ----------
    onSwipe(dx, dy) {
        if (this.finished || this.active !== 'mower') return;
        const d = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
        this.startLane(d);
    }

    startLane(d) {
        const u = this.units.mower;
        if (this.finished) return;
        Sound.init(); Sound.pullStart(); this.startClock();
        u.dir = d;
        const r = u.cfg.collideR, end = this.reach({ x: u.x, y: u.y }, { x: u.x + d.x * 2000, y: u.y + d.y * 2000 }, r);
        u.queue.length = 0;
        this.mstate = 'drive';
        this.laneStart = { x: u.x, y: u.y };
        if (Math.hypot(end.x - u.x, end.y - u.y) < 4) { this.mowerStopped(); return; }
        u.queue.push(end);
        this.refreshActions();
    }

    // The mower's route ran out: decide what happens next.
    mowerStopped() {
        const u = this.units.mower;
        if (this.mstate === 'uturn') { this.startLane(this.pendingDir); return; }
        if (this.mstate === 'around') { this.startLane(u.dir); return; }
        if (this.mstate === 'drive' && this.laneStart && Math.hypot(u.x - this.laneStart.x, u.y - this.laneStart.y) > 20) {
            this.passes++;
            if (this.passes === 3) UI.hint('passes', "Nice. Keep turning back and forth and the stripes line up on their own.");
        }
        const d = u.dir;
        if (!d) { this.mstate = 'idle'; this.refreshActions(); return; }
        const px = u.x + d.x * 3, py = u.y + d.y * 3, r = u.cfg.collideR, B = WALT_YARD.bounds;
        const edge = px < B.x0 + r || px > B.x1 - r || py < B.y0 + r || py > B.y1 - r;
        if (!edge && this.yard.collides(px, py, r)) {
            this.mstate = 'blocked';
            UI.hint('blocked', "Something's in the way. Go around it, or turn back here and start the next lane.");
        } else {
            this.mstate = 'end';
            UI.hint('end', "End of the lane. Pick which side the next lane goes. The mower lines itself up. Or swipe a new direction.");
        }
        this.refreshActions();
    }

    sides() {
        const d = this.units.mower.dir;
        return [{ x: -d.y, y: d.x }, { x: d.y, y: -d.x }].sort((a, b) => (a.x - b.x) || (a.y - b.y));
    }

    arrow(v) { return v.x < 0 ? '←' : v.x > 0 ? '→' : v.y < 0 ? '↑' : '↓'; }

    laneShift(s) {
        const u = this.units.mower, sp = u.cfg.lane;
        const t = this.reach({ x: u.x, y: u.y }, { x: u.x + s.x * sp, y: u.y + s.y * sp }, u.cfg.collideR);
        return Math.hypot(t.x - u.x, t.y - u.y) >= sp * 0.45 ? t : null;
    }

    uTurn(s) {
        const u = this.units.mower, t = this.laneShift(s);
        if (!t) return;
        u.queue.length = 0; u.queue.push(t);
        this.pendingDir = { x: -u.dir.x, y: -u.dir.y };
        this.mstate = 'uturn';
        this.refreshActions();
    }

    // Detour: step sideways, drive past the obstacle, step back onto the lane.
    aroundPath(s) {
        const u = this.units.mower, d = u.dir, r = u.cfg.collideR, here = { x: u.x, y: u.y };
        for (let back = 0; back <= 48; back += 6) {                       // back up a little if there's no room to step aside
            const from = { x: u.x - d.x * back, y: u.y - d.y * back };
            if (back && Math.hypot(this.reach(here, from, r).x - from.x, this.reach(here, from, r).y - from.y) > 0.5) break;
            for (let off = 6; off <= 100; off += 3) {
                const p1 = { x: from.x + s.x * off, y: from.y + s.y * off };
                const a = this.reach(from, p1, r);
                if (Math.hypot(a.x - p1.x, a.y - p1.y) > 0.5) break;      // can't step that far sideways from here
                for (let t = 6; t <= 180 + back; t += 3) {
                    const f = { x: p1.x + d.x * t, y: p1.y + d.y * t };
                    if (this.yard.collides(f.x, f.y, r)) break;           // this offset is blocked too; go wider
                    const q = { x: from.x + d.x * t, y: from.y + d.y * t };
                    if (t <= back + 3 || this.yard.collides(q.x, q.y, r)) continue;
                    const ret = this.reach(f, q, r);
                    if (Math.hypot(ret.x - q.x, ret.y - q.y) < 0.5) return back ? [from, p1, f, q] : [p1, f, q];
                }
            }
        }
        return null;
    }

    goAround(s) {
        const u = this.units.mower, path = this.aroundPath(s);
        if (!path) return;
        u.queue.length = 0; u.queue.push(...path);
        this.mstate = 'around';
        this.refreshActions();
    }

    goDir(d) { this.startLane(d); }

    refreshActions() {
        const A = [];
        if (this.finished) { UI.setActions(A); return; }
        if (this.active === 'trimmer') {
            A.push({ label: 'Undo', fn: () => this.undo() }, { label: 'Stop', fn: () => this.stop() });
        } else if (this.mstate === 'drive' || this.mstate === 'uturn' || this.mstate === 'around') {
            A.push({ label: 'Stop', fn: () => this.stop(), wide: true });
        } else if (this.mstate === 'end' || this.mstate === 'blocked') {
            const S = this.sides();
            if (this.mstate === 'blocked') for (const s of S) A.push({ label: 'Around ' + this.arrow(s), fn: () => this.goAround(s), off: !this.aroundPath(s) });
            for (const s of S) A.push({ label: (this.mstate === 'blocked' ? 'Turn ' : 'Next lane ') + this.arrow(s), fn: () => this.uTurn(s), off: !this.laneShift(s) });
        } else {
            for (const [lab, d] of [['Go ←', { x: -1, y: 0 }], ['Go ↑', { x: 0, y: -1 }], ['Go ↓', { x: 0, y: 1 }], ['Go →', { x: 1, y: 0 }]])
                A.push({ label: lab, fn: () => this.goDir(d) });
        }
        UI.setActions(A);
    }

    // ---------- drawing the world ----------
    drawBackground() {
        const g = this.add.graphics().setDepth(0), D = WALT_YARD;
        g.fillStyle(0x56585c).fillRect(0, 588, 400, 52);                 // street
        g.fillStyle(0xd9d4c4).fillRect(0, 586, 400, 4);                  // curb
        g.fillStyle(0xf2efe6).fillRect(0, 630, 400, 2);
        for (let x = 10; x < 400; x += 48) g.fillStyle(0xf1d24a).fillRect(x, 612, 24, 3);   // center line
        g.fillStyle(0x2f6b25).fillRect(0, 52, 400, 536);                 // yard base under everything
        for (const h of D.hard) {
            g.fillStyle(h.kind === 'driveway' ? 0xb9b6ad : 0xcfcbc0).fillRect(h.x, h.y, h.w, h.h);
            g.lineStyle(1, 0x9d998f, 0.6);
            const step = h.kind === 'sidewalk' ? 36 : 40;
            if (h.kind === 'sidewalk') for (let x = h.x + step; x < h.x + h.w; x += step) g.lineBetween(x, h.y, x, h.y + h.h);
            else for (let y = h.y + step; y < h.y + h.h; y += step) g.lineBetween(h.x, y, h.x + h.w, y);
        }
        // house
        g.fillStyle(0xe8dcc0).fillRect(0, 0, 400, 52);
        g.fillStyle(0xa54a3a).fillRect(0, 0, 400, 14);
        g.lineStyle(3, 0x1d1d1d).lineBetween(0, 52, 400, 52);
        g.fillStyle(0x7fb0d8); g.fillRect(60, 22, 34, 22); g.fillRect(250, 22, 34, 22);
        g.lineStyle(2, 0x1d1d1d); g.strokeRect(60, 22, 34, 22); g.strokeRect(250, 22, 34, 22);
        g.fillStyle(0x6b4a2e).fillRect(186, 18, 28, 34); g.strokeRect(186, 18, 28, 34);       // door
        g.fillStyle(0xd8d5cc).fillRect(300, 16, 56, 36); g.strokeRect(300, 16, 56, 36);       // garage
        for (let y = 22; y < 52; y += 7) g.lineStyle(1, 0xa9a59b).lineBetween(302, y, 354, y);
        // fences
        for (const fx of [0, 384]) {
            g.fillStyle(0xf4f1ea).fillRect(fx, 52, 16, 536);
            g.lineStyle(1, 0xb5b0a4);
            for (let y = 60; y < 588; y += 14) g.lineBetween(fx, y, fx + 16, y);
            g.lineStyle(2, 0x1d1d1d).lineBetween(fx === 0 ? 16 : 384, 52, fx === 0 ? 16 : 384, 560);
        }
    }

    drawObstacles() {
        const g = this.add.graphics().setDepth(6);
        for (const s of WALT_YARD.solids) {
            if (s.kind === 'bed') {
                g.fillStyle(0x6e4b2c).fillRoundedRect(s.x, s.y, s.w, s.h, 4);
                g.lineStyle(2, 0x1d1d1d).strokeRoundedRect(s.x, s.y, s.w, s.h, 4);
                const cols = [0xff6fa0, 0xffd34d, 0xffffff, 0xb07cff];
                for (let x = s.x + 7; x < s.x + s.w - 4; x += 10) {
                    const y = s.y + 7 + ((x * 7) % (s.h - 12));
                    g.fillStyle(0x3d7a2b).fillCircle(x, y + 2, 4);
                    g.fillStyle(cols[(x / 10 | 0) % cols.length]).fillCircle(x, y, 2.6);
                }
            } else if (s.kind === 'steps') {
                g.fillStyle(0xbdb7a8).fillRect(s.x, s.y, s.w, s.h);
                g.lineStyle(1, 0x8c8678).lineBetween(s.x, s.y + 6, s.x + s.w, s.y + 6);
                g.lineStyle(2, 0x1d1d1d).strokeRect(s.x, s.y, s.w, s.h);
            } else if (s.kind === 'tree') {
                g.fillStyle(0x000000, 0.18).fillCircle(s.x + 5, s.y + 6, s.r);
                g.fillStyle(0x2c6a2a).fillCircle(s.x, s.y, s.r);
                g.fillStyle(0x3f8a36).fillCircle(s.x - 5, s.y - 6, s.r * 0.62);
                g.fillStyle(0x56a446).fillCircle(s.x - 8, s.y - 10, s.r * 0.3);
                g.lineStyle(3, 0x1d1d1d).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'birdbath') {
                g.fillStyle(0xbcbab2).fillCircle(s.x, s.y, s.r);
                g.fillStyle(0x7cc4e8).fillCircle(s.x, s.y, s.r - 3.5);
                g.lineStyle(2, 0x1d1d1d).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'mailbox') {
                g.fillStyle(0x6b4a2e).fillCircle(s.x, s.y, s.r);
                g.lineStyle(2, 0x1d1d1d).strokeCircle(s.x, s.y, s.r);
                g.fillStyle(0x3a5fa0).fillRoundedRect(s.x - 6, s.y - 18, 12, 14, 3);
                g.strokeRoundedRect(s.x - 6, s.y - 18, 12, 14, 3);
                g.fillStyle(0xd93a2a).fillRect(s.x + 5, s.y - 17, 3, 6);
            }
        }
    }

    makeUnit(kind) {
        const st = WALT_YARD.start[kind], cfg = CFG[kind];
        const c = this.add.container(st.x, st.y).setDepth(5);
        const g = this.add.graphics();
        const ink = 0x1d1d1d;
        if (kind === 'mower') {   // drawn facing +x
            g.fillStyle(0x000000, 0.2).fillEllipse(2, 4, 34, 30);
            g.fillStyle(ink); g.fillRect(-9, -14, 7, 4); g.fillRect(-9, 10, 7, 4); g.fillRect(9, -14, 7, 4); g.fillRect(9, 10, 7, 4);
            g.fillStyle(0xd94a3a).fillRoundedRect(-11, -12, 28, 24, 6);
            g.lineStyle(2, ink).strokeRoundedRect(-11, -12, 28, 24, 6);
            g.fillStyle(0x4a4a4a).fillCircle(3, 0, 6); g.strokeCircle(3, 0, 6);
            g.lineStyle(2.5, ink).lineBetween(-11, -7, -24, -7).lineBetween(-11, 7, -24, 7).lineBetween(-24, -8, -24, 8);
            g.fillStyle(0x3a6fd9).fillCircle(-30, 0, 7); g.lineStyle(2, ink).strokeCircle(-30, 0, 7);
            g.fillStyle(0xf1c27d).fillCircle(-31, 0, 4.5); g.strokeCircle(-31, 0, 4.5);
            g.fillStyle(0x2c4f9e).fillCircle(-32, 0, 2.6);   // cap
        } else {
            g.fillStyle(0x000000, 0.2).fillEllipse(1, 3, 18, 16);
            g.lineStyle(2.5, ink).lineBetween(0, 3, 13, 5);
            g.fillStyle(0xf0a830).fillCircle(14, 5, 3.2); g.lineStyle(1.5, ink).strokeCircle(14, 5, 3.2);
            g.fillStyle(0x3a6fd9).fillCircle(0, 0, 7); g.lineStyle(2, ink).strokeCircle(0, 0, 7);
            g.fillStyle(0xf1c27d).fillCircle(-1, 0, 4.5); g.strokeCircle(-1, 0, 4.5);
            g.fillStyle(0x2c4f9e).fillCircle(-2, 0, 2.6);
        }
        c.add(g);
        c.rotation = st.a;
        return { kind, cfg, x: st.x, y: st.y, a: st.a, queue: [], c, moving: false };
    }

    // ---------- input ----------
    onTap(x, y) {
        if (this.finished) return;
        Sound.init();
        const u = this.units[this.active];
        if (u.kind === 'mower') {
            if (u.queue.length) this.stop();
            else UI.hint('swipe', "Swipe on the yard to send the mower in a direction, or use the Go buttons.");
            return;
        }
        this.startClock();
        const dx = x - u.x, dy = y - u.y;
        if (dx * dx + dy * dy < CFG.stopTapRadius * CFG.stopTapRadius) { this.stop(); return; }
        const want = this.yard.clamp(x, y, u.cfg.collideR);
        const from = u.queue.length ? u.queue[u.queue.length - 1] : { x: u.x, y: u.y };
        const p = this.reach(from, want, u.cfg.collideR);
        if (Math.hypot(p.x - from.x, p.y - from.y) < 4) {   // nothing reachable that way
            Sound.bump();
            UI.hint(u.kind === 'mower' ? 'nofit' : 'nowalk', u.kind === 'mower'
                ? "Mower won't fit there. Leave the tight spots for the trimmer."
                : "Can't walk through that.");
            return;
        }
        if (p.short) UI.hint('short', "Something's in the way, so the route stops short of it. Go around.");
        u.queue.push(p);
        Sound.tick();
    }

    // Furthest point along a straight line the unit can reach before hitting something.
    reach(from, to, r) {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (len < 0.5) return { x: from.x, y: from.y };
        const n = Math.ceil(len / 1.5);
        let last = { x: from.x, y: from.y };
        for (let k = 1; k <= n; k++) {
            const x = from.x + (to.x - from.x) * k / n, y = from.y + (to.y - from.y) * k / n;
            if (this.yard.collides(x, y, r)) return { x: last.x, y: last.y, short: true };
            last = { x, y };
        }
        return { x: to.x, y: to.y };
    }

    stop() {
        const u = this.units[this.active]; u.queue.length = 0;
        if (u.kind === 'mower') { this.mstate = 'idle'; this.refreshActions(); }
    }
    undo() { const u = this.units[this.active]; u.queue.pop(); }

    setTool(kind) {
        if (kind === this.active || this.finished) return;
        this.units[this.active].queue.length = 0;
        if (this.active === 'mower') this.mstate = 'idle';
        this.active = kind;
        this.cameras.main.startFollow(this.units[kind].c, true, 0.12, 0.12);
        if (kind === 'trimmer') UI.hint('trimtap', "Tap where you want to walk. The trimmer gets in close to everything.");
        UI.toolChanged(kind);
        this.refreshActions();
    }

    // ---------- loop ----------
    update(time, delta) {
        const dt = Math.min(0.05, delta / 1000);
        if (this.startTime !== null && !this.finished) this.elapsed = (time - this.startTime) / 1000;

        let anyMoving = false;
        for (const k in this.units) { const u = this.units[k]; this.stepUnit(u, dt); if (k === this.active) anyMoving = u.moving; }
        const m = this.units.mower;
        if (!this.finished && !m.queue.length && (this.mstate === 'drive' || this.mstate === 'uturn' || this.mstate === 'around')) this.mowerStopped();
        Sound.engine(this.finished ? 'off' : this.active, anyMoving);

        this.drawRoute();
        this.drawRing(time);
        this.updateMissed(dt);
        this.updateParticles(dt);
        UI.hud(this.yard.coverage(), this.elapsed);

        const cov = this.yard.coverage();
        if (!this.finished && cov >= CFG.trimHintAt) UI.hint('trim', "See the thin strips around the tree, the beds and the fences? Switch to the Trimmer for those.");
        if (!this.finished && cov >= CFG.finishAt) this.finish();
    }

    stepUnit(u, dt) {
        u.moving = false;
        if (!u.queue.length) return;
        const t = u.queue[0];
        const dx = t.x - u.x, dy = t.y - u.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5) { u.queue.shift(); this.arrived(u); return; }
        const want = Math.atan2(dy, dx);
        let diff = Phaser.Math.Angle.Wrap(want - u.a);
        if (Math.abs(diff) > 2.6 && dist < 50) {   // short move straight behind: back up instead of spinning around
            const step = Math.min(dist, u.cfg.speed * 0.6 * dt);
            const nx = u.x + Math.cos(want) * step, ny = u.y + Math.sin(want) * step;
            if (this.yard.collides(nx, ny, u.cfg.collideR)) { u.queue.length = 0; return; }
            u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
            this.cutAt(u, true);
            if (step >= dist - 0.01) { u.queue.shift(); this.arrived(u); }
            return;
        }
        const maxTurn = u.cfg.turnRate * dt;
        if (Math.abs(diff) > maxTurn) u.a += Math.sign(diff) * maxTurn; else u.a = want;
        u.c.rotation = u.a;
        diff = Phaser.Math.Angle.Wrap(want - u.a);
        if (Math.abs(diff) > CFG.moveWhileTurningUnder) return;   // pivot first

        const step = Math.min(dist, u.cfg.speed * dt);
        const nx = u.x + Math.cos(want) * step, ny = u.y + Math.sin(want) * step;
        if (this.yard.collides(nx, ny, u.cfg.collideR) && !this.yard.collides(u.x, u.y, u.cfg.collideR)) {
            u.queue.length = 0;   // safety net: routes are checked when tapped, so this should be rare
            Sound.bump();
            this.cameras.main.shake(90, 0.003);
            return;
        }
        u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
        this.cutAt(u);
        if (step >= dist - 0.01) { u.queue.shift(); this.arrived(u); }
    }

    arrived(u) { }

    cutAt(u, reversing) {
        let ns;
        if (u.kind === 'trimmer') ns = STATE.TRIM;
        else {
            const k = reversing ? -1 : 1, hx = Math.cos(u.a) * k, hy = Math.sin(u.a) * k;
            ns = (hx * CFG.stripe.ax + hy * CFG.stripe.ay) > 0 ? STATE.LIGHT : STATE.DARK;
        }
        const res = this.yard.cutAround(u.x, u.y, u.cfg.cutR, ns);
        if (res.changed.length) {
            for (const i of res.changed) this.yard.paintCell(this.gctx, i);
            this.grassTex.refresh();
        }
        if (res.fresh > 0) {
            if (this.yard.cut === res.fresh) Pacing.mark('first grass cut');
            this.spray(u, Math.min(4, 1 + (res.fresh >> 1)));
        }
    }

    // ---------- effects ----------
    spray(u, n) {
        if (this.particles.length > 220) return;
        const side = u.kind === 'mower' ? u.a + Math.PI / 2 : u.a;
        const ox = u.kind === 'mower' ? 14 : 13;
        const bx = u.x + Math.cos(side) * ox + Math.cos(u.a) * 3, by = u.y + Math.sin(side) * ox + Math.sin(u.a) * 3;
        for (let i = 0; i < n; i++) {
            const ang = side + (Math.random() - 0.5) * 0.9, sp = 40 + Math.random() * 70;
            this.particles.push({ x: bx, y: by, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.45 + Math.random() * 0.3, max: 0.75,
                col: Math.random() < 0.5 ? 0x9bd873 : 0x6fb04c, kind: 'clip' });
        }
    }

    sparkle() {
        for (let i = 0; i < 80; i++) {
            const x = this.yard.ox + Math.random() * (this.yard.cols * CFG.cell), y = this.yard.oy + Math.random() * (this.yard.rows * CFG.cell);
            if (!this.yard.isLawn(x, y)) continue;
            this.particles.push({ x, y, vx: 0, vy: -8, life: 0.6 + Math.random() * 1.4, max: 2, delay: Math.random() * 0.9, kind: 'star', s: 3 + Math.random() * 4 });
        }
    }

    updateParticles(dt) {
        const g = this.fxG; g.clear();
        if (!this.particles.length) return;
        const keep = [];
        for (const p of this.particles) {
            if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
            p.life -= dt; if (p.life <= 0) continue;
            p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
            const a = Math.min(1, p.life / 0.3);
            if (p.kind === 'clip') { g.fillStyle(p.col, a).fillRect(p.x - 1, p.y - 1, 2.5, 2); }
            else {
                const s = p.s * (0.6 + 0.4 * Math.sin(p.life * 9));
                g.lineStyle(2, 0xffffff, a).lineBetween(p.x - s, p.y, p.x + s, p.y).lineBetween(p.x, p.y - s, p.x, p.y + s);
                g.fillStyle(0xfff3a0, a).fillCircle(p.x, p.y, 1.6);
            }
            keep.push(p);
        }
        this.particles = keep;
    }

    drawRoute() {
        const g = this.routeG; g.clear();
        for (const k in this.units) {
            const u = this.units[k];
            if (!u.queue.length) continue;
            const col = k === 'mower' ? 0xffffff : 0xffc24a;
            let px = u.x, py = u.y;
            for (const p of u.queue) { this.dashed(g, px, py, p.x, p.y, col); px = p.x; py = p.y; }
            u.queue.forEach((p, i) => {
                const last = i === u.queue.length - 1;
                g.fillStyle(col, 0.95).fillCircle(p.x, p.y, last ? 6 : 4.5);
                g.lineStyle(2, 0x1d1d1d, 0.9).strokeCircle(p.x, p.y, last ? 6 : 4.5);
            });
        }
    }

    dashed(g, x0, y0, x1, y1, col) {
        const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 10);
        g.lineStyle(2, col, 0.75);
        for (let i = 0; i < n; i += 2) {
            const a = i / n, b = Math.min(1, (i + 1) / n);
            g.lineBetween(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
        }
    }

    drawRing(time) {
        const g = this.ringG; g.clear();
        if (this.finished) return;
        const u = this.units[this.active];
        const r = (u.kind === 'mower' ? 20 : 12) + Math.sin(time / 260) * 1.5;
        g.lineStyle(2, 0xffffff, 0.5).strokeCircle(u.x, u.y, r);
    }

    updateMissed(dt) {
        const cov = this.yard.coverage(), g = this.missedG;
        if (this.finished || cov < CFG.showMissedAt) { if (this.blinkOn) { g.clear(); this.blinkOn = false; } return; }
        UI.hint('missed', "Almost there. The spots you missed are blinking yellow.");
        this.blinkT -= dt;
        if (this.blinkT > 0) return;
        this.blinkT = 0.45; this.blinkOn = !this.blinkOn;
        g.clear();
        if (!this.blinkOn) return;
        g.fillStyle(CFG.colors.missed, 0.85);
        for (const p of this.yard.uncutCenters()) g.fillRect(p.x, p.y, CFG.cell, CFG.cell);
    }

    finish() {
        this.finished = true;
        for (const k in this.units) this.units[k].queue.length = 0;
        this.refreshActions();
        this.cameras.main.stopFollow();
        this.cameras.main.zoomTo(1, 600);
        this.cameras.main.pan(200, 320, 600);
        this.missedG.clear();
        Pacing.mark('first yard finished');
        Sound.ding();
        this.sparkle();
        this.time.delayedCall(1300, () => UI.showDone(this.elapsed, this.yard.coverage(), this.passes));
    }

    // Debug only: cut everything the mower could reach, leaving the trim ring.
    debugMowAll() {
        for (let i = 0; i < this.yard.state.length; i++) {
            if (this.yard.state[i] !== STATE.UNCUT) continue;
            const c = CFG.cell, x = this.yard.ox + (i % this.yard.cols + 0.5) * c, y = this.yard.oy + (((i / this.yard.cols) | 0) + 0.5) * c;
            let near = false;
            for (const s of WALT_YARD.solids) if (Yard.inSolid(s, x, y, 6)) { near = true; break; }
            const L = WALT_YARD.lawn;
            if (x < L.x0 + 6 || x > L.x1 - 6) near = true;
            if (near) continue;
            this.yard.state[i] = ((x / 24) | 0) % 2 ? STATE.LIGHT : STATE.DARK; this.yard.cut++;
        }
        this.yard.paintAll(this.gctx); this.grassTex.refresh();
        if (this.startTime === null) this.startTime = this.time.now;
    }
}
