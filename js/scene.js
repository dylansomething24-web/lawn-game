// One visit to one yard: lane-mowing mower, tap-a-target trimmer, edger and blower, stripes, the job's clock.
const WALKERS = ['trimmer', 'edger', 'blower'];
const TOOL_LABEL = { mower: 'Mower', trimmer: 'Trimmer', edger: 'Edger', blower: 'Blower' };

class YardScene extends Phaser.Scene {
    constructor() { super('yard'); }

    init(data) { this.visit = data && data.yard ? data : YardScene.practiceVisit(); }

    static practiceVisit() {
        return { practice: true, yard: YARDS.walt, tasks: ['mow', 'trim'], known: [], hidden: [], tools: { trimmer: true, edger: false, blower: false },
            mowerSpeed: CFG.mower.speed, breakdownAt: null, dogOut: false, cust: { name: 'Walt' } };
    }

    create() {
        const V = this.visit;
        this.def = V.yard;
        this.yard = new Yard(this.def, V.known);
        if (V.overgrown) this.yard.overgrown = true;
        this.finished = false; this.paused = false;
        this.passes = 0; this.hits = 0; this.found = [];
        this.particles = [];
        this.blinkOn = false; this.blinkT = 0;
        this.broke = false; this.debris = []; this.debrisMade = 0; this.debrisDirty = true;
        this.hiddenLeft = (V.hidden || []).slice();

        this.drawBackground();
        if (this.textures.exists('grass')) this.textures.remove('grass');
        this.grassTex = this.textures.createCanvas('grass', this.yard.cols * CFG.cell, this.yard.rows * CFG.cell);
        this.gctx = this.grassTex.getContext();
        this.yard.paintAll(this.gctx);
        this.grassTex.refresh();
        this.add.image(this.yard.ox, this.yard.oy, 'grass').setOrigin(0).setDepth(2);

        this.debrisG = this.add.graphics().setDepth(2.5);
        this.edgeG = this.add.graphics().setDepth(2.6);
        this.missedG = this.add.graphics().setDepth(3);
        this.fxG = this.add.graphics().setDepth(8);
        this.drawObstacles();
        this.routeG = this.add.graphics().setDepth(7);
        this.ringG = this.add.graphics().setDepth(4);
        this.targetG = this.add.graphics().setDepth(4);
        this.dogG = this.add.graphics().setDepth(5.5);

        // the tools you own come with you; the mower always does
        this.toolList = ['mower', ...WALKERS.filter(k => V.tools[k])];
        this.units = {};
        for (const k of this.toolList) this.units[k] = this.makeUnit(k);
        this.active = 'mower';
        this.mstate = 'idle';          // mower: idle | drive | uturn | around | end | blocked | hold
        this.units.mower.dir = null;
        this.pather = new TrimPather(this.yard, CFG.trimmer.collideR);
        this.targets = {
            trimmer: V.tools.trimmer ? buildTrimTargets(this.yard) : [],
            edger: V.tools.edger ? buildEdgeTargets(this.yard) : [],
            blower: V.tools.blower ? buildBlowTargets(this.yard) : [],
        };
        this.trimCells = [...new Set(this.targets.trimmer.flatMap(t => t.cells))];
        if (!V.tools.trimmer) this.trimCells = [...new Set(buildTrimTargets(this.yard).flatMap(t => t.cells))];
        this.edgeTotal = this.targets.edger.reduce((s, t) => s + t.total, 0);
        if (!V.tools.edger) this.edgeTotal = buildEdgeTargets(this.yard).reduce((s, t) => s + t.total, 0);
        this.tjob = null;
        this.targetCheckT = 0;
        this.pendingCount = {};
        this.edgeDirty = true;
        this.holdDir = null; this.engineStarted = false;

        const cam = this.cameras.main;
        cam.setBounds(0, 0, 400, this.def.H);
        this.zoomed = UI.zoomed;
        cam.setZoom(this.zoomed ? CFG.zoom : this.fitZoom());
        cam.startFollow(this.units.mower.c, true, 0.12, 0.12);

        this.down = null;
        this.input.on('pointerdown', p => { this.down = { x: p.x, y: p.y, wx: p.worldX, wy: p.worldY }; });
        this.input.on('pointerup', p => {
            const d = this.down; this.down = null;
            if (!d || this.paused) return;
            if (Math.hypot(p.x - d.x, p.y - d.y) < CFG.swipeMin) this.onTap(d.wx, d.wy);   // drags and swipes do nothing
        });
        UI.sceneReady(this);
        this.refreshActions();
        this.updateTargets(0, true);
        UI.hint('start', UI.auto
            ? "Press an arrow and the mower drives straight until it reaches the edge. Then it lines up the next lane for you."
            : "Hold an arrow to drive the mower. Let go to stop.");
        if (V.tutorial) UI.hint('tutorial', "This is Walt's yard. Mow it in lanes, then trim. Finish job when it looks good.");
        if (V.overgrown) UI.hint('overgrown', "This one's overgrown. The mower goes slower in tall grass.");
        if (V.dogOut && this.def.dogHome) this.spawnDog();
    }

    fitZoom() { return Math.min(1, 640 / this.def.H); }
    toggleZoom() {
        this.zoomed = !this.zoomed; UI.zoomed = this.zoomed;
        this.cameras.main.zoomTo(this.zoomed ? CFG.zoom : this.fitZoom(), 250);
        return this.zoomed;
    }

    modeChanged() {
        const u = this.units.mower;
        this.holdDir = null;
        if (this.active === 'mower') { u.queue.length = 0; this.mstate = 'idle'; }
        this.refreshActions();
        UI.shown.mode = false;
        UI.hint('mode', UI.auto
            ? "Auto: press an arrow and the mower drives the whole lane, then lines up the next one for you."
            : "Manual: hold an arrow to drive. The mower only moves while you hold it.");
    }

    // ---------- manual: hold an arrow to drive ----------
    holdStart(d) {
        if (this.finished || this.paused || this.active !== 'mower' || this.broke) return;
        const u = this.units.mower;
        if (!this.engineStarted) { Sound.pullStart(); this.engineStarted = true; }
        this.holdDir = d; u.dir = d; this.holdFrom = { x: u.x, y: u.y }; this.holdBumped = false;
        this.mstate = 'hold';
    }

    holdEnd() {
        const u = this.units.mower;
        if (this.holdDir && this.holdFrom && Math.hypot(u.x - this.holdFrom.x, u.y - this.holdFrom.y) > 20) this.passes++;
        this.holdDir = null;
        if (this.mstate === 'hold') { u.queue.length = 0; this.mstate = 'idle'; }
    }

    holdDrive() {
        const u = this.units.mower, d = this.holdDir;
        if (!d || this.finished || this.paused || this.active !== 'mower') return;
        const t = this.reach({ x: u.x, y: u.y }, { x: u.x + d.x * 40, y: u.y + d.y * 40 }, u.cfg.collideR);
        if (Math.hypot(t.x - u.x, t.y - u.y) < 1) {
            u.queue.length = 0;
            if (!this.holdBumped) { this.holdBumped = true; Sound.bump(); }
            return;
        }
        this.holdBumped = false;
        u.queue.length = 0; u.queue.push({ x: t.x, y: t.y, turn: true });
    }

    // ---------- auto: lane mowing ----------
    startLane(d) {
        const u = this.units.mower;
        if (this.finished || this.paused || this.broke) return;
        Sound.init();
        if (!this.engineStarted) { Sound.pullStart(); this.engineStarted = true; }
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
        const px = u.x + d.x * 3, py = u.y + d.y * 3, r = u.cfg.collideR, B = this.def.bounds;
        const edge = px < B.x0 + r || px > B.x1 - r || py < B.y0 + r || py > B.y1 - r;
        if (!edge && this.yard.collides(px, py, r)) {
            this.mstate = 'blocked';
            if (this.dog && Math.hypot(this.dog.x - px, this.dog.y - py) < 40) UI.hint('dogblock', `${this.visit.cust.dog} is in the way. Go around him, or text Kyle to call him in.`);
            else UI.hint('blocked', "Something's in the way. Go around it, or turn back here and start the next lane.");
        } else {
            this.mstate = 'end';
            UI.hint('end', "End of the lane. Pick which side the next lane goes, and the mower lines itself up. Or press New way to aim somewhere else.");
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
        for (let back = 0; back <= 48; back += 6) {
            const from = { x: u.x - d.x * back, y: u.y - d.y * back };
            if (back) { const b = this.reach(here, from, r); if (Math.hypot(b.x - from.x, b.y - from.y) > 0.5) break; }
            for (let off = 6; off <= 100; off += 3) {
                const p1 = { x: from.x + s.x * off, y: from.y + s.y * off };
                const a = this.reach(from, p1, r);
                if (Math.hypot(a.x - p1.x, a.y - p1.y) > 0.5) break;
                for (let t = 6; t <= 180 + back; t += 3) {
                    const f = { x: p1.x + d.x * t, y: p1.y + d.y * t };
                    if (this.yard.collides(f.x, f.y, r)) break;
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

    refreshActions() {
        const A = [];
        if (this.finished || this.paused) { UI.setActions(A); return; }
        if (this.active !== 'mower') {
            if (this.tjob) A.push({ label: 'Stop', fn: () => this.stop() });
            else {
                const n = this.pendingCount[this.active] || 0;
                const verb = { trimmer: 'Trim', edger: 'Edge', blower: 'Blow' }[this.active];
                A.push({ label: n ? `${verb} nearest (${n} left)` : 'All done here', fn: () => this.workNearest(), off: !n });
            }
        } else if (this.broke) {
            A.push({ label: 'Mower is broken', fn: () => {}, off: true });
        } else if (!UI.auto) {
            for (const [lab, d] of [['←', { x: -1, y: 0 }], ['↑', { x: 0, y: -1 }], ['↓', { x: 0, y: 1 }], ['→', { x: 1, y: 0 }]])
                A.push({ label: lab, hold: true, down: () => this.holdStart(d), up: () => this.holdEnd() });
        } else if (this.mstate === 'drive' || this.mstate === 'uturn' || this.mstate === 'around') {
            A.push({ label: 'Stop', fn: () => this.stop() });
        } else if (this.mstate === 'end' || this.mstate === 'blocked') {
            const S = this.sides();
            if (this.mstate === 'blocked') for (const s of S) A.push({ label: 'Around ' + this.arrow(s), fn: () => this.goAround(s), off: !this.aroundPath(s) });
            for (const s of S) A.push({ label: (this.mstate === 'blocked' ? 'Turn ' : 'Next lane ') + this.arrow(s), fn: () => this.uTurn(s), off: !this.laneShift(s) });
            A.push({ label: 'New way', fn: () => this.stop() });
        } else {
            for (const [lab, d] of [['Go ←', { x: -1, y: 0 }], ['Go ↑', { x: 0, y: -1 }], ['Go ↓', { x: 0, y: 1 }], ['Go →', { x: 1, y: 0 }]])
                A.push({ label: lab, fn: () => this.startLane(d) });
        }
        UI.setActions(A);
    }

    // ---------- drawing the world ----------
    drawBackground() {
        const g = this.add.graphics().setDepth(0), D = this.def, H = D.H, h = D.house, y1 = D.lawn.y1;
        g.fillStyle(0x56585c).fillRect(0, H - 52, 400, 52);                   // street
        g.fillStyle(0xd9d4c4).fillRect(0, H - 54, 400, 4);                    // curb
        for (let x = 10; x < 400; x += 48) g.fillStyle(0xf1d24a).fillRect(x, H - 28, 24, 3);
        g.fillStyle(0x2f6b25).fillRect(0, 52, 400, H - 104);
        for (const hs of D.hard) {
            g.fillStyle(hs.kind === 'driveway' ? 0xb9b6ad : 0xcfcbc0).fillRect(hs.x, hs.y, hs.w, hs.h);
            g.lineStyle(1, 0x9d998f, 0.6);
            const step = hs.kind === 'sidewalk' ? 36 : 40;
            if (hs.kind === 'sidewalk') for (let x = hs.x + step; x < hs.x + hs.w; x += step) g.lineBetween(x, hs.y, x, hs.y + hs.h);
            else for (let y = hs.y + step; y < hs.y + hs.h; y += step) g.lineBetween(hs.x, y, hs.x + hs.w, y);
        }
        // house
        g.fillStyle(h.wall).fillRect(0, 0, 400, 52);
        g.fillStyle(h.roof).fillRect(0, 0, 400, 14);
        g.lineStyle(3, 0x1d1d1d).lineBetween(0, 52, 400, 52);
        for (const wx of h.windows) { g.fillStyle(0x7fb0d8).fillRect(wx, 22, 34, 22); g.lineStyle(2, 0x1d1d1d).strokeRect(wx, 22, 34, 22); }
        g.fillStyle(h.trim).fillRect(h.door - 14, 18, 28, 34); g.lineStyle(2, 0x1d1d1d).strokeRect(h.door - 14, 18, 28, 34);
        g.fillStyle(0xd8d5cc).fillRect(h.garage, 16, 56, 36); g.strokeRect(h.garage, 16, 56, 36);
        for (let y = 22; y < 52; y += 7) g.lineStyle(1, 0xa9a59b).lineBetween(h.garage + 2, y, h.garage + 54, y);
        // fences or hedges on each side
        D.sides.forEach((kind, i) => {
            const fx = i === 0 ? 0 : 384, inner = i === 0 ? 16 : 384;
            if (kind === 'hedge') {
                g.fillStyle(0x2c5e22).fillRect(fx, 52, 16, H - 104);
                for (let y = 58; y < H - 52; y += 12) g.fillStyle(0x3a7a2c).fillCircle(fx + 8, y, 7);
            } else {
                g.fillStyle(kind === 'wood' ? 0xb8875a : 0xf4f1ea).fillRect(fx, 52, 16, H - 104);
                g.lineStyle(1, kind === 'wood' ? 0x8a6038 : 0xb5b0a4);
                for (let y = 60; y < H - 52; y += 14) g.lineBetween(fx, y, fx + 16, y);
            }
            g.lineStyle(2, 0x1d1d1d).lineBetween(inner, 52, inner, y1);
        });
    }

    drawObstacles() {
        const g = this.add.graphics().setDepth(6), ink = 0x1d1d1d;
        for (const s of this.yard.def.solids) {
            if (s.kind === 'bed') {
                g.fillStyle(0x6e4b2c).fillRoundedRect(s.x, s.y, s.w, s.h, 4);
                g.lineStyle(2, ink).strokeRoundedRect(s.x, s.y, s.w, s.h, 4);
                const cols = [0xff6fa0, 0xffd34d, 0xffffff, 0xb07cff];
                for (let x = s.x + 7; x < s.x + s.w - 4; x += 10) {
                    const y = s.y + 7 + ((x * 7) % Math.max(1, s.h - 12));
                    g.fillStyle(0x3d7a2b).fillCircle(x, y + 2, 4);
                    g.fillStyle(cols[(x / 10 | 0) % cols.length]).fillCircle(x, y, 2.6);
                }
            } else if (s.kind === 'steps') {
                g.fillStyle(0xbdb7a8).fillRect(s.x, s.y, s.w, s.h);
                g.lineStyle(1, 0x8c8678).lineBetween(s.x, s.y + 6, s.x + s.w, s.y + 6);
                g.lineStyle(2, ink).strokeRect(s.x, s.y, s.w, s.h);
            } else if (s.kind === 'tree') {
                g.fillStyle(0x000000, 0.18).fillCircle(s.x + 5, s.y + 6, s.r);
                g.fillStyle(0x2c6a2a).fillCircle(s.x, s.y, s.r);
                g.fillStyle(0x3f8a36).fillCircle(s.x - 5, s.y - 6, s.r * 0.62);
                g.fillStyle(0x56a446).fillCircle(s.x - 8, s.y - 10, s.r * 0.3);
                g.lineStyle(3, ink).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'shrub') {
                g.fillStyle(0x2f6f2c).fillCircle(s.x, s.y, s.r);
                g.fillStyle(0x4b9440).fillCircle(s.x - 3, s.y - 3, s.r * 0.55);
                g.lineStyle(2, ink).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'birdbath') {
                g.fillStyle(0xbcbab2).fillCircle(s.x, s.y, s.r);
                g.fillStyle(0x7cc4e8).fillCircle(s.x, s.y, s.r - 3.5);
                g.lineStyle(2, ink).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'mailbox') {
                g.fillStyle(0x6b4a2e).fillCircle(s.x, s.y, s.r);
                g.lineStyle(2, ink).strokeCircle(s.x, s.y, s.r);
                g.fillStyle(0x3a5fa0).fillRoundedRect(s.x - 6, s.y - 18, 12, 14, 3);
                g.strokeRoundedRect(s.x - 6, s.y - 18, 12, 14, 3);
                g.fillStyle(0xd93a2a).fillRect(s.x + 5, s.y - 17, 3, 6);
            } else if (s.kind === 'gnome') {
                g.fillStyle(0x3a6fd9).fillCircle(s.x, s.y + 1, s.r);
                g.fillStyle(0xd93a2a).fillTriangle(s.x - s.r, s.y, s.x + s.r, s.y, s.x, s.y - s.r * 2.4);
                g.lineStyle(1.5, ink).strokeCircle(s.x, s.y + 1, s.r);
            } else if (s.kind === 'toy') {
                g.fillStyle(0xffd34d).fillCircle(s.x, s.y, s.r); g.fillStyle(0xd94a3a).fillCircle(s.x, s.y, s.r * 0.5);
                g.lineStyle(1.5, ink).strokeCircle(s.x, s.y, s.r);
            } else if (s.kind === 'sprinkler') {
                g.fillStyle(0x4a4a4a).fillCircle(s.x, s.y, s.r); g.lineStyle(1.5, 0xffe14d).strokeCircle(s.x, s.y, s.r + 2);
            } else if (s.kind === 'swing') {
                g.fillStyle(0xe0c08a).fillRect(s.x, s.y + s.h / 2 - 4, s.w, 8);
                g.lineStyle(3, 0xc0392b).strokeRect(s.x + 2, s.y + 2, s.w - 4, s.h - 4);
                g.fillStyle(0x3a3a3a).fillRect(s.x + s.w * 0.3, s.y + s.h / 2 - 3, 8, 6).fillRect(s.x + s.w * 0.6, s.y + s.h / 2 - 3, 8, 6);
                g.lineStyle(2, ink).strokeRect(s.x, s.y, s.w, s.h);
            } else if (s.kind === 'doghouse') {
                g.fillStyle(0xb5562e).fillRect(s.x, s.y, s.w, s.h);
                g.fillStyle(0x7a3a1e).fillTriangle(s.x - 3, s.y + 2, s.x + s.w + 3, s.y + 2, s.x + s.w / 2, s.y - 10);
                g.fillStyle(0x1d1d1d).fillRoundedRect(s.x + s.w / 2 - 6, s.y + s.h - 14, 12, 14, 5);
                g.lineStyle(2, ink).strokeRect(s.x, s.y, s.w, s.h);
            } else {
                if (s.type === 'circle') g.fillStyle(0x888888).fillCircle(s.x, s.y, s.r); else g.fillStyle(0x888888).fillRect(s.x, s.y, s.w, s.h);
            }
        }
    }

    makeUnit(kind) {
        const st = kind === 'mower' ? this.def.start.mower : this.def.start.trimmer, cfg = Object.assign({}, CFG[kind === 'mower' ? 'mower' : 'trimmer']);
        if (kind === 'mower') cfg.speed = (this.visit.mowerSpeed || cfg.speed) * (this.visit.overgrown ? N.overgrownSpeed : 1);
        if (kind === 'edger') cfg.speed *= 1.7;     // walking a straight line along concrete
        if (kind === 'blower') cfg.speed *= 1.9;
        const ox = kind === 'edger' ? -16 : kind === 'blower' ? 16 : 0;
        const c = this.add.container(st.x + ox, st.y).setDepth(5);
        const g = this.add.graphics(), ink = 0x1d1d1d;
        if (kind === 'mower') {   // drawn facing +x
            g.fillStyle(0x000000, 0.2).fillEllipse(2, 4, 34, 30);
            g.fillStyle(ink); g.fillRect(-9, -14, 7, 4); g.fillRect(-9, 10, 7, 4); g.fillRect(9, -14, 7, 4); g.fillRect(9, 10, 7, 4);
            g.fillStyle(this.visit.mowerSpeed > 100 ? 0x2f8f4a : 0xd94a3a).fillRoundedRect(-11, -12, 28, 24, 6);
            g.lineStyle(2, ink).strokeRoundedRect(-11, -12, 28, 24, 6);
            g.fillStyle(0x4a4a4a).fillCircle(3, 0, 6); g.strokeCircle(3, 0, 6);
            g.lineStyle(2.5, ink).lineBetween(-11, -7, -24, -7).lineBetween(-11, 7, -24, 7).lineBetween(-24, -8, -24, 8);
            g.fillStyle(0x3a6fd9).fillCircle(-30, 0, 7); g.lineStyle(2, ink).strokeCircle(-30, 0, 7);
            g.fillStyle(0xf1c27d).fillCircle(-31, 0, 4.5); g.strokeCircle(-31, 0, 4.5);
            g.fillStyle(0x2c4f9e).fillCircle(-32, 0, 2.6);
        } else {
            g.fillStyle(0x000000, 0.2).fillEllipse(1, 3, 18, 16);
            if (kind === 'trimmer') { g.lineStyle(2.5, ink).lineBetween(0, 3, 13, 5); g.fillStyle(0xf0a830).fillCircle(14, 5, 3.2); g.lineStyle(1.5, ink).strokeCircle(14, 5, 3.2); }
            if (kind === 'edger') { g.lineStyle(2.5, ink).lineBetween(0, 3, 12, 3); g.fillStyle(0xcfcfcf).fillCircle(14, 3, 4); g.lineStyle(1.5, ink).strokeCircle(14, 3, 4); }
            if (kind === 'blower') { g.fillStyle(0xd94a3a).fillRoundedRect(-6, -10, 9, 7, 2); g.lineStyle(2.5, ink).lineBetween(2, 4, 15, 6); g.lineStyle(1.5, ink).strokeRoundedRect(-6, -10, 9, 7, 2); }
            g.fillStyle(0x3a6fd9).fillCircle(0, 0, 7); g.lineStyle(2, ink).strokeCircle(0, 0, 7);
            g.fillStyle(0xf1c27d).fillCircle(-1, 0, 4.5); g.strokeCircle(-1, 0, 4.5);
            g.fillStyle(0x2c4f9e).fillCircle(-2, 0, 2.6);
        }
        c.add(g);
        c.rotation = st.a;
        if (kind !== 'mower' && kind !== this.toolList[1]) c.setAlpha(0.55);
        return { kind, cfg, x: st.x + ox, y: st.y, a: st.a, queue: [], c, moving: false };
    }

    // ---------- input ----------
    onTap(x, y) {
        if (this.finished) return;
        Sound.init();
        const u = this.units[this.active];
        if (u.kind === 'mower') {
            if (u.queue.length) this.stop();
            else UI.hint('arrows', UI.auto ? "Use the arrow buttons below to send the mower." : "Hold an arrow button below to drive.");
            return;
        }
        const hit = this.targetAt(x, y, true);
        if (hit) { if (hit !== this.tjob) this.workTarget(hit); return; }
        if (this.tjob) { this.stop(); return; }
        const done = this.targetAt(x, y, false);
        if (done) { UI.shown.workdone = false; UI.hint('workdone', done.name + " is already done."); }
        else UI.hint('tapoutline', "Tap something outlined in yellow, or press the button below for the nearest one.");
    }

    // ---------- trimming, edging, blowing by target ----------
    distTo(t, x, y) {
        let best = 1e9;
        for (const run of t.runs) for (const p of run) { const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < best) best = d; }
        return Math.sqrt(best);
    }

    targetAt(x, y, pending) {
        let best = null, bd = 44;
        for (const t of this.targets[this.active] || []) {
            if ((t.left > 0) !== pending) continue;
            const d = this.distTo(t, x, y);
            if (d < bd) { bd = d; best = t; }
        }
        return best;
    }

    seeFn() {
        const r = CFG.trimmer.collideR;
        return (a, b) => { const p = this.reach(a, b, r, true); return Math.hypot(p.x - b.x, p.y - b.y) < 0.5; };
    }

    // Walk there, then trace every piece of the outline, nearest piece first.
    workPlan(t) {
        const u = this.units[this.active], see = this.seeFn(), out = [];
        let cur = { x: u.x, y: u.y };
        const runs = t.runs.map(r => r.slice());
        while (runs.length) {
            let bi = 0, bk = 0, bd = 1e9;
            runs.forEach((run, i) => {
                const idx = t.closed ? run.map((_, k) => k) : [0, run.length - 1];
                for (const k of idx) { const d = Math.hypot(run[k].x - cur.x, run[k].y - cur.y); if (d < bd) { bd = d; bi = i; bk = k; } }
            });
            let run = runs.splice(bi, 1)[0];
            if (t.closed) run = run.slice(bk).concat(run.slice(0, bk + 1));
            else if (bk) run = run.reverse();
            const path = this.pather.find(cur, run[0], see);
            if (!path) continue;
            out.push(...path, ...run.slice(1));
            cur = run[run.length - 1];
        }
        return out;
    }

    workTarget(t) {
        const u = this.units[this.active], plan = this.workPlan(t);
        if (!plan.length) { Sound.bump(); UI.hint('nowalk', "Can't get there from here."); return; }
        u.queue.length = 0; u.queue.push(...plan);
        this.tjob = t;
        Sound.tick();
        this.refreshActions();
    }

    workNearest() {
        const u = this.units[this.active];
        let best = null, bd = 1e9;
        for (const t of this.targets[this.active]) if (t.left > 0) { const d = this.distTo(t, u.x, u.y); if (d < bd) { bd = d; best = t; } }
        if (best) this.workTarget(best);
    }

    updateTargets(dt, force) {
        this.targetCheckT -= dt;
        if (this.targetCheckT > 0 && !force) return;
        this.targetCheckT = 0.2;
        let changed = false;
        for (const k of WALKERS) {
            let n = 0;
            for (const t of this.targets[k]) {
                if (k === 'trimmer') { let left = 0; for (const i of t.cells) if (this.yard.state[i] === STATE.UNCUT) left++; t.left = left; }
                else if (k === 'edger') t.left = t.total - t.done;
                else { let left = 0; for (const d of this.debris) if (d.h === t.hard) left++; t.left = left; }
                if (t.left > (k === 'edger' ? Math.max(1, t.total * 0.03) : 0)) n++; else if (k === 'edger') t.left = 0;
            }
            if (n !== this.pendingCount[k]) { this.pendingCount[k] = n; changed = true; }
        }
        if (changed) this.refreshActions();
        UI.order(this);
    }

    drawTargets(time) {
        const g = this.targetG; g.clear();
        if (this.finished || this.active === 'mower') return;
        const a = 0.55 + 0.3 * Math.sin(time / 230);
        for (const t of this.targets[this.active]) {
            if (t.left <= 0) continue;
            const mine = t === this.tjob;
            g.lineStyle(mine ? 3 : 2.5, mine ? 0xffffff : 0xffe14d, mine ? 0.85 : a);
            for (const run of t.runs) {
                g.beginPath(); g.moveTo(run[0].x, run[0].y);
                for (let k = 1; k < run.length; k++) g.lineTo(run[k].x, run[k].y);
                if (t.closed) g.closePath();
                g.strokePath();
            }
        }
    }

    // Furthest point along a straight line the unit can reach before hitting something.
    reach(from, to, r, staticOnly) {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (len < 0.5) return { x: from.x, y: from.y };
        const n = Math.ceil(len / 1.5);
        let last = { x: from.x, y: from.y };
        for (let k = 1; k <= n; k++) {
            const x = from.x + (to.x - from.x) * k / n, y = from.y + (to.y - from.y) * k / n;
            if (this.yard.collides(x, y, r, staticOnly)) return { x: last.x, y: last.y, short: true };
            last = { x, y };
        }
        return { x: to.x, y: to.y };
    }

    stop() {
        const u = this.units[this.active]; u.queue.length = 0;
        if (u.kind === 'mower') { this.mstate = 'idle'; this.holdDir = null; } else this.tjob = null;
        this.refreshActions();
    }

    setTool(kind) {
        if (kind === this.active || this.finished || !this.units[kind]) return;
        this.units[this.active].queue.length = 0;
        if (this.active === 'mower') this.mstate = 'idle'; else this.tjob = null;
        if (this.active !== 'mower') this.units[this.active].c.setAlpha(0.55);
        this.active = kind;
        this.units[kind].c.setAlpha(1);
        this.cameras.main.startFollow(this.units[kind].c, true, 0.12, 0.12);
        if (kind !== 'mower') {
            this.targetCheckT = 0;
            const what = { trimmer: 'still needs trimming', edger: 'still needs edging', blower: 'has clippings to blow off' }[kind];
            UI.shown['tool_' + kind] = false;
            UI.hint('tool_' + kind, `Everything outlined in yellow ${what}. Tap one and you'll walk over and do it.`);
        }
        UI.toolChanged(kind);
        this.refreshActions();
    }

    // ---------- the loose dog ----------
    spawnDog() {
        const h = this.def.dogHome;
        this.dog = { x: h.x + 20, y: h.y + 10, r: 10, tx: h.x + 20, ty: h.y + 10, wait: 1, leaving: false, gone: false };
        this.yard.dynamic.push(this.dog);
        UI.hint('dog', `${this.visit.cust.dog} is loose! He won't move out of the mower's way. Go around him, or text Kyle.`);
        UI.extra(`Text Kyle about ${this.visit.cust.dog}`, () => {
            UI.extra(null);
            Game.tick && Game.s && Game.tick(5);
            UI.hint('kyle', "Kyle: \"Sorry!! Coming.\"");
            this.time.delayedCall(4000, () => { if (this.dog) { this.dog.leaving = true; this.dog.tx = this.def.house.door; this.dog.ty = 70; } });
        });
        if (typeof Game !== 'undefined' && Game.s) Game.walt('dog');
    }

    stepDog(dt) {
        const d = this.dog; if (!d || d.gone) return;
        const m = this.units.mower;
        d.wait -= dt;
        const near = Math.hypot(m.x - d.x, m.y - d.y) < 60 && !d.leaving;
        if (d.wait <= 0 && !near) {
            const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy);
            if (dist < 2) {
                if (d.leaving) { d.gone = true; this.yard.dynamic = []; this.dogG.clear(); this.dog = null; UI.hint('dogin', "Biscuit's inside. Clear to mow."); return; }
                d.wait = 1 + Math.random() * 2.5;
                // wander, and like the mower a little too much
                const L = this.def.lawn;
                for (let k = 0; k < 20; k++) {
                    const tx = Math.random() < 0.5 ? m.x + (Math.random() - 0.5) * 160 : L.x0 + 20 + Math.random() * (L.x1 - L.x0 - 40);
                    const ty = Math.random() < 0.5 ? m.y + (Math.random() - 0.5) * 160 : L.y0 + 30 + Math.random() * (L.y1 - L.y0 - 60);
                    if (!this.yard.collides(tx, ty, d.r, true)) { d.tx = tx; d.ty = ty; break; }
                }
            } else {
                const sp = (d.leaving ? 120 : 70) * dt, k = Math.min(1, sp / dist);
                const nx = d.x + dx * k, ny = d.y + dy * k;
                if (!this.yard.collides(nx, ny, d.r, true) || d.leaving) { d.x = nx; d.y = ny; } else d.wait = 0.2, d.tx = d.x, d.ty = d.y;
            }
        }
        // don't let him sit on top of a unit
        for (const k in this.units) { const u = this.units[k]; if (Math.hypot(u.x - d.x, u.y - d.y) < d.r + 8 && !d.leaving) { d.x += (d.x - u.x) * 0.1; d.y += (d.y - u.y) * 0.1; } }
        const g = this.dogG; g.clear();
        g.fillStyle(0x000000, 0.2).fillEllipse(d.x + 2, d.y + 3, 22, 14);
        g.fillStyle(0xc98d4a).fillEllipse(d.x, d.y, 22, 13);
        g.fillCircle(d.x + 10, d.y - 3, 6);
        g.fillStyle(0x8a5a2a).fillEllipse(d.x + 12, d.y - 8, 5, 7);
        g.lineStyle(1.5, 0x1d1d1d).strokeEllipse(d.x, d.y, 22, 13).strokeCircle(d.x + 10, d.y - 3, 6);
        g.fillStyle(0x1d1d1d).fillCircle(d.x + 14, d.y - 3, 1.5);
    }

    // ---------- breakdown ----------
    breakDown() {
        this.broke = true;
        const u = this.units.mower; u.queue.length = 0; this.mstate = 'idle'; this.holdDir = null;
        Sound.bump(); this.cameras.main.shake(200, 0.004);
        for (let i = 0; i < 25; i++) this.particles.push({ x: u.x, y: u.y, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, life: 1 + Math.random(), max: 2, kind: 'smoke' });
        this.refreshActions();
        if (this.visit.practice) { this.broke = false; this.refreshActions(); return; }
        const ch = [{ label: `Fix it myself (${N.fixSelfMin} min)`, act: 'fix' }, { label: `Call Rosa ($${N.rosaCost}, ${N.rosaMin} min)`, act: 'rosa' }];
        if (Math.random() < N.waltSpareChance) ch.unshift({ label: 'Walt brings his spare (15 min)', act: 'walt' });
        ch.push({ label: 'Pack up, come back tomorrow', act: 'leave' });
        this.paused = true;
        UI.modal("The mower coughs, smokes, and dies.", ch, act => {
            this.paused = false;
            if (act === 'leave') { Game.abandonJob(this.visit.jobId); Screens.leaveYard(); return; }
            Game.playerBreakdown(act, this.visit.mowerId);
            this.broke = false; this.refreshActions();
            UI.hint('fixed', act === 'walt' ? "Walt: \"Bring it back clean.\"" : "Running again.");
        });
    }

    // ---------- loop ----------
    update(time, delta) {
        const dt = Math.min(0.05, delta / 1000);
        if (this.paused) { this.updateParticles(dt); return; }
        if (!this.finished && !this.visit.practice && typeof Game !== 'undefined' && Game.s) Game.tick(dt * N.gameMinPerSec);
        this.holdDrive();
        let anyMoving = false;
        for (const k in this.units) { const u = this.units[k]; this.stepUnit(u, dt); if (k === this.active) anyMoving = u.moving; }
        const m = this.units.mower;
        if (!this.finished && !m.queue.length && (this.mstate === 'drive' || this.mstate === 'uturn' || this.mstate === 'around')) this.mowerStopped();
        if (this.tjob && !this.units[this.active].queue.length) { this.tjob = null; this.targetCheckT = 0; this.refreshActions(); }
        Sound.engine(this.finished || this.broke ? 'off' : this.active === 'mower' ? 'mower' : 'trimmer', anyMoving);
        this.stepDog(dt);

        this.updateTargets(dt);
        this.drawTargets(time);
        this.drawRoute();
        this.drawRing(time);
        this.drawEdges();
        this.drawDebris();
        this.updateMissed(dt);
        this.updateParticles(dt);

        const mc = this.yard.mowCoverage();
        UI.hud(mc);
        if (!this.finished && this.visit.breakdownAt && !this.brokeOnce && mc >= this.visit.breakdownAt) { this.brokeOnce = true; this.breakDown(); }
        if (!this.finished && mc >= CFG.trimHintAt && this.units.trimmer && this.visit.tasks.includes('trim'))
            UI.hint('trim', "See the thin strips around everything? Switch to the Trimmer for those.");
        if (!this.finished && mc >= CFG.finishAt && this.tasksDone()) this.finish();
    }

    // every task in the order that you have the tool for is done
    tasksDone() {
        const T = this.visit.tasks;
        if (T.includes('trim') && this.units.trimmer && this.pendingCount.trimmer) return false;
        if (T.includes('edge') && this.units.edger && this.pendingCount.edger) return false;
        if (T.includes('blow') && this.units.blower && this.pendingCount.blower) return false;
        return true;
    }

    stepUnit(u, dt) {
        u.moving = false;
        if (!u.queue.length) return;
        if (u.kind === 'mower' && this.broke) { u.queue.length = 0; return; }
        const t = u.queue[0];
        const dx = t.x - u.x, dy = t.y - u.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5) { u.queue.shift(); return; }
        const want = Math.atan2(dy, dx);
        let diff = Phaser.Math.Angle.Wrap(want - u.a);
        const r = u.cfg.collideR, walker = u.kind !== 'mower';
        if (Math.abs(diff) > 2.6 && dist < 50 && !t.turn) {   // short move straight behind: back up instead of spinning around
            const step = Math.min(dist, u.cfg.speed * 0.6 * dt);
            const nx = u.x + Math.cos(want) * step, ny = u.y + Math.sin(want) * step;
            if (this.yard.collides(nx, ny, r, walker)) { u.queue.length = 0; return; }
            u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
            this.cutAt(u, true);
            if (step >= dist - 0.01) u.queue.shift();
            return;
        }
        const maxTurn = u.cfg.turnRate * dt;
        if (Math.abs(diff) > maxTurn) u.a += Math.sign(diff) * maxTurn; else u.a = want;
        u.c.rotation = u.a;
        diff = Phaser.Math.Angle.Wrap(want - u.a);
        if (Math.abs(diff) > CFG.moveWhileTurningUnder) return;   // pivot first

        const step = Math.min(dist, u.cfg.speed * dt);
        const nx = u.x + Math.cos(want) * step, ny = u.y + Math.sin(want) * step;
        if (this.yard.collides(nx, ny, r, walker) && !this.yard.collides(u.x, u.y, r, walker)) {
            u.queue.length = 0;   // safety net (or the dog stepped in front)
            Sound.bump();
            this.cameras.main.shake(90, 0.003);
            return;
        }
        u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
        this.cutAt(u);
        if (step >= dist - 0.01) u.queue.shift();
    }

    cutAt(u, reversing) {
        if (u.kind === 'edger') { this.edgeAt(u); return; }
        if (u.kind === 'blower') { this.blowAt(u); return; }
        let ns;
        if (u.kind === 'trimmer') ns = STATE.TRIM;
        else {
            const k = reversing ? -1 : 1, hx = Math.cos(u.a) * k, hy = Math.sin(u.a) * k;
            ns = (hx * CFG.stripe.ax + hy * CFG.stripe.ay) > 0 ? STATE.LIGHT : STATE.DARK;
            this.checkHidden(u);
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

    // hidden sprinkler heads: hit one and it costs you
    checkHidden(u) {
        for (let i = this.hiddenLeft.length - 1; i >= 0; i--) {
            const h = this.hiddenLeft[i];
            if (Math.hypot(h.x - u.x, h.y - u.y) > 9) continue;
            this.hiddenLeft.splice(i, 1);
            this.hits++; this.found.push({ x: h.x, y: h.y });
            Sound.bump(); this.cameras.main.shake(160, 0.006);
            for (let k = 0; k < 20; k++) { const a = Math.random() * 6.28; this.particles.push({ x: h.x, y: h.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 30, life: 0.8, max: 0.8, kind: 'water' }); }
            this.add.graphics().setDepth(6).fillStyle(0x4a4a4a).fillCircle(h.x, h.y, 4).lineStyle(1.5, 0xffe14d).strokeCircle(h.x, h.y, 6);
            UI.shown.sprinkler = false;
            UI.hint('sprinkler', `Clunk! A sprinkler head was hiding in the grass. That's $${N.sprinklerCost} and a ding on the score. It's marked for next time.`);
        }
    }

    edgeAt(u) {
        for (const t of this.targets.edger) t.runs.forEach((run, ri) => run.forEach((p, k) => {
            if (t.hit[ri][k] || Math.abs(p.x - u.x) > 5 || Math.abs(p.y - u.y) > 5) return;
            t.hit[ri][k] = 1; t.done++; this.edgeDirty = true;
            if (Math.random() < 0.4) this.particles.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.4, max: 0.4, col: 0x6b4a2e, kind: 'clip' });
        }));
    }

    blowAt(u) {
        const before = this.debris.length;
        this.debris = this.debris.filter(d => Math.hypot(d.x - u.x, d.y - u.y) > 21);
        if (this.debris.length !== before) this.debrisDirty = true;
        if (Math.random() < 0.5) { const a = u.a + (Math.random() - 0.5) * 0.6; this.particles.push({ x: u.x + Math.cos(u.a) * 14, y: u.y + Math.sin(u.a) * 14, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life: 0.3, max: 0.3, col: 0xd8f0c8, kind: 'clip' }); }
    }

    drawEdges() {
        if (!this.edgeDirty) return;
        this.edgeDirty = false;
        const g = this.edgeG; g.clear();
        const all = this.units.edger ? this.targets.edger : buildEdgeTargets(this.yard);
        this.edgeView = all;
        for (const t of all) t.runs.forEach((run, ri) => run.forEach((p, k) => {
            if (t.hit && t.hit[ri][k]) { g.fillStyle(0x3a2a1a, 0.9).fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
            else if (k % 2 === 0) { g.fillStyle(0x3f7a2e, 0.9).fillTriangle(p.x - 2, p.y, p.x + 2, p.y, p.x + (Math.random() - 0.5) * 3, p.y + (Math.random() - 0.5) * 7); }
        }));
    }

    drawDebris() {
        if (!this.debrisDirty) return;
        this.debrisDirty = false;
        const g = this.debrisG; g.clear();
        for (const d of this.debris) g.fillStyle(d.c, 0.95).fillRect(d.x - 1, d.y - 1, 2.5, 2);
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
                col: Math.random() < 0.5 ? 0x9bd873 : 0x6fb04c, kind: 'clip', settle: u.kind === 'mower' });
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
            p.life -= dt;
            if (p.life <= 0) {
                // clippings that land on concrete stay there until someone blows them off
                if (p.settle && this.debris.length < 500 && this.yard.isHard(p.x, p.y) && Math.random() < 0.6) {
                    this.debris.push({ x: p.x, y: p.y, c: p.col, h: this.yard.isHard(p.x, p.y) }); this.debrisMade++; this.debrisDirty = true;
                }
                continue;
            }
            p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
            const a = Math.min(1, p.life / 0.3);
            if (p.kind === 'clip') g.fillStyle(p.col, a).fillRect(p.x - 1, p.y - 1, 2.5, 2);
            else if (p.kind === 'smoke') g.fillStyle(0x555555, a * 0.5).fillCircle(p.x, p.y, 4 + (2 - p.life) * 4);
            else if (p.kind === 'water') g.fillStyle(0x7cc4e8, a).fillCircle(p.x, p.y, 2);
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
            if (!u.queue.length || this.holdDir && k === 'mower') continue;
            const col = k === 'mower' ? 0xffffff : 0xffc24a;
            if (k !== 'mower') {
                g.lineStyle(2, col, 0.6).beginPath(); g.moveTo(u.x, u.y);
                for (const p of u.queue) g.lineTo(p.x, p.y);
                g.strokePath();
                const e = u.queue[u.queue.length - 1];
                g.fillStyle(col, 0.95).fillCircle(e.x, e.y, 5); g.lineStyle(2, 0x1d1d1d, 0.9).strokeCircle(e.x, e.y, 5);
                continue;
            }
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
        const cov = this.yard.mowCoverage(), g = this.missedG;
        if (this.finished || cov < CFG.showMissedAt) { if (this.blinkOn) { g.clear(); this.blinkOn = false; } return; }
        UI.hint('missed', "Almost there. Spots the mower missed are blinking yellow.");
        this.blinkT -= dt;
        if (this.blinkT > 0) return;
        this.blinkT = 0.45; this.blinkOn = !this.blinkOn;
        g.clear();
        if (!this.blinkOn) return;
        g.fillStyle(CFG.colors.missed, 0.85);
        for (const p of this.yard.uncutCenters(true)) g.fillRect(p.x, p.y, CFG.cell, CFG.cell);
    }

    // ---------- the result ----------
    result() {
        let trimLeft = 0; for (const i of this.trimCells) if (this.yard.state[i] === STATE.UNCUT) trimLeft++;
        const edgeDone = this.targets.edger.reduce((s, t) => s + t.done, 0);
        return {
            mowCov: this.yard.mowCoverage(), stripeQ: this.yard.stripeQuality(),
            trimFrac: this.units.trimmer ? (this.trimCells.length ? 1 - trimLeft / this.trimCells.length : 1) : 0,
            edgeFrac: this.units.edger ? (this.edgeTotal ? Math.min(1, edgeDone / (this.edgeTotal * 0.97)) : 1) : 0,
            blowFrac: this.units.blower ? (this.debrisMade < 5 ? 1 : 1 - this.debris.length / this.debrisMade) : (this.debrisMade < 5 ? 1 : 0),
            hits: this.hits, found: this.found, mowerId: this.visit.mowerId, passes: this.passes,
        };
    }

    finish() {
        if (this.finished) return;
        this.finished = true;
        UI.releaseHold();
        for (const k in this.units) this.units[k].queue.length = 0;
        this.refreshActions();
        this.cameras.main.stopFollow();
        this.cameras.main.zoomTo(this.fitZoom(), 600);
        this.cameras.main.pan(200, this.def.H / 2, 600);
        this.missedG.clear(); this.targetG.clear();
        Sound.ding();
        this.sparkle();
        const r = this.result();
        this.time.delayedCall(1300, () => Screens.yardDone(this.visit, r));
    }

    // Debug only: finish the whole job well, instantly.
    debugFinish() {
        for (let i = 0; i < this.yard.state.length; i++) {
            if (this.yard.state[i] !== STATE.UNCUT) continue;
            const c = CFG.cell, x = this.yard.ox + (i % this.yard.cols + 0.5) * c;
            this.yard.state[i] = this.yard.reach[i] ? (((x / 18) | 0) % 2 ? STATE.LIGHT : STATE.DARK) : STATE.TRIM;
            this.yard.cut++; if (this.yard.reach[i]) this.yard.reachCut++;
        }
        for (const t of this.targets.edger) { t.hit.forEach(h => h.fill(1)); t.done = t.total; }
        this.debris = []; this.debrisDirty = true; this.edgeDirty = true;
        this.yard.paintAll(this.gctx); this.grassTex.refresh();
        this.updateTargets(0, true);
    }
}
