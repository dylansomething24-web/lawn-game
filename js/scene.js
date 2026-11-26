// One visit to one yard. Nobody steers (2026-11-26 redesign): you pick which way the stripes run and how
// careful to be, then the mower runs its lanes and the trimmer, edger and blower follow on their own.
// How well it comes out depends on competence. Trouble (the dog, a breakdown) stops it and needs you.
// The job's game time comes from the work done, not from how long you watch.
const WALKERS = ['trimmer', 'edger', 'blower'];
const TOOL_LABEL = { mower: 'Mower', trimmer: 'Trimmer', edger: 'Edger', blower: 'Blower' };
const TASK_TOOL = { trim: 'trimmer', edge: 'edger', blow: 'blower' };
const TOOL_TASK = { mower: 'mow', trimmer: 'trim', edger: 'edge', blower: 'blow' };
const PACES = ['careful', 'steady', 'quick'];

class YardScene extends Phaser.Scene {
    constructor() { super('yard'); }

    init(data) { this.visit = data && data.yard ? data : YardScene.practiceVisit(); }

    static practiceVisit() {
        return { practice: true, yard: YARDS.walt, tasks: ['mow', 'trim'], known: [], hidden: [], tools: { trimmer: true, edger: false, blower: false },
            mowerSpeed: CFG.mower.speed, breakdownAt: null, dogOut: false, cust: { name: 'Walt' }, comp: N.comp.youStart, minutes: { mow: 108, trim: 27 } };
    }

    create() {
        const V = this.visit;
        this.def = V.yard;
        this.yard = new Yard(this.def, V.known);
        if (V.overgrown) this.yard.overgrown = true;
        // Phaser reuses this scene object for every yard: reset everything from the last visit
        this.finished = false; this.paused = false;
        this.touch = false; this.debugDone = false; this.kyleTexted = false; this.aroundDog = false; this.dogMin = 0; this.brokeOnce = false; this.dog = null;
        this.cur = null; this.list = null; this.phase = null; this.phaseIdx = 0; this.texDirty = false; this.stubs = [];
        this.hits = 0; this.found = []; this.spotted = 0;
        this.particles = [];
        this.blinkOn = false; this.blinkT = 0;
        this.broke = false; this.debris = []; this.debrisMade = 0; this.debrisDirty = true;
        this.hiddenLeft = (V.hidden || []).map(h => ({ x: h.x, y: h.y }));

        this.drawBackground();
        if (this.textures.exists('grass')) this.textures.remove('grass');
        this.grassTex = this.textures.createCanvas('grass', this.yard.cols * CFG.cell, this.yard.rows * CFG.cell);
        this.gctx = this.grassTex.getContext();
        this.yard.paintAll(this.gctx);
        this.grassTex.refresh();
        this.add.image(this.yard.ox, this.yard.oy, 'grass').setOrigin(0).setDepth(2);

        this.debrisG = this.add.graphics().setDepth(2.5);
        this.edgeG = this.add.graphics().setDepth(2.6);
        this.planG = this.add.graphics().setDepth(2.7);
        this.missedG = this.add.graphics().setDepth(3);
        this.fxG = this.add.graphics().setDepth(8);
        this.drawObstacles();
        this.ringG = this.add.graphics().setDepth(4);
        this.targetG = this.add.graphics().setDepth(4);
        this.dogG = this.add.graphics().setDepth(5.5);

        // the tools you own come with you; the mower always does
        this.toolList = ['mower', ...WALKERS.filter(k => V.tools[k])];
        this.units = {};
        for (const k of this.toolList) this.units[k] = this.makeUnit(k);
        this.active = 'mower';
        this.pather = new TrimPather(this.yard, CFG.trimmer.collideR);
        this.mPather = new TrimPather(this.yard, CFG.mower.collideR);
        this.targets = {
            trimmer: V.tools.trimmer ? buildTrimTargets(this.yard) : [],
            edger: V.tools.edger ? buildEdgeTargets(this.yard) : [],
            blower: V.tools.blower ? buildBlowTargets(this.yard) : [],
        };
        this.trimCells = [...new Set((V.tools.trimmer ? this.targets.trimmer : buildTrimTargets(this.yard)).flatMap(t => t.cells))];
        this.edgeTotal = (V.tools.edger ? this.targets.edger : buildEdgeTargets(this.yard)).reduce((s, t) => s + t.total, 0);
        this.targetCheckT = 0;
        this.pendingCount = {};
        this.edgeDirty = true;

        // the plan: which way the stripes run, and how careful to be
        this.k = (V.comp ?? N.comp.youStart) / 100;
        this.plans = { v: planLanes(this.yard, 'v'), h: planLanes(this.yard, 'h') };
        this.pref = V.cust.stripes || null;
        this.orient = this.pref || (this.plans.v.passes <= this.plans.h.passes ? 'v' : 'h');
        this.pace = 'steady';
        this.stage = 'plan';   // plan | run | review | touchup
        this.phases = ['mower', ...['trim', 'edge', 'blow'].filter(t => V.tasks.includes(t) && V.tools[TASK_TOOL[t]]).map(t => TASK_TOOL[t])];
        this.speed = 2; this.skip = false;
        this.spent = 0; this.mins = null;
        this.waitDog = false;

        const cam = this.cameras.main;
        cam.setBounds(0, 0, 400, this.def.H);
        this.zoomed = UI.zoomed;
        cam.setZoom(this.zoomed ? CFG.zoom : this.fitZoom());
        cam.centerOn(200, this.def.H / 2);
        if (this.zoomed) cam.startFollow(this.units.mower.c, true, 0.12, 0.12);

        this.input.on('pointerup', () => { if (!this.paused && this.stage === 'plan') UI.say("Pick the stripes and the pace below, then Start."); });
        UI.sceneReady(this);
        this.refreshActions();
        this.updateTargets(0, true);
        this.drawPlan();
        this.status();
        if (V.tutorial) UI.hint('tutorial', "This is Walt's yard. You don't steer: pick which way the stripes run and how careful to be, then press Start and watch.");
        else UI.hint('plan', "Pick which way the stripes run and how careful to be. Careful takes longer but misses less. Quick saves time but the customer notices.");
        if (this.pref) UI.say(`${V.cust.name} wants ${this.pref === 'v' ? 'up-and-down' : 'side-to-side'} stripes.`, 5000);
        else if (V.overgrown) UI.hint('overgrown', "This one's overgrown. It takes longer in tall grass.");
        if (V.dogOut && this.def.dogHome) this.spawnDog();
    }

    fitZoom() { return Math.min(1, 640 / this.def.H); }
    toggleZoom() {
        this.zoomed = !this.zoomed; UI.zoomed = this.zoomed;
        const cam = this.cameras.main;
        cam.zoomTo(this.zoomed ? CFG.zoom : this.fitZoom(), 250);
        if (this.zoomed) cam.startFollow(this.units[this.active].c, true, 0.12, 0.12);
        else { cam.stopFollow(); cam.pan(200, this.def.H / 2, 250); }
        return this.zoomed;
    }

    // ---------- planning ----------
    // Game minutes for each part of the job with this stripe direction and pace.
    phaseMinutes(orient, pace) {
        const M = this.visit.minutes || {}, P = N.pace[pace], out = { total: 0 };
        const passes = this.plans[orient].passes, best = Math.min(this.plans.v.passes, this.plans.h.passes);
        const turns = 1 + Math.min(0.15, 0.3 * (passes - best) / best);   // more, shorter lanes mean more turning
        for (const ph of this.phases) {
            out[ph] = (M[TOOL_TASK[ph]] || 0) * P.time * (ph === 'mower' ? turns : 1);
            out.total += out[ph];
        }
        return out;
    }

    finishText(mins) {
        if (typeof Game === 'undefined' || !Game.s || this.visit.practice) return Math.round(mins) + ' min';
        return 'done ~' + Game.clockText(Game.s.clock + mins);
    }

    drawPlan() {
        const g = this.planG; g.clear();
        if (this.stage !== 'plan') return;
        for (const s of this.plans[this.orient].segs) {
            g.lineStyle(7, segShade(s) === STATE.LIGHT ? 0xd8f5c0 : 0x1f4a18, 0.35).lineBetween(s.from.x, s.from.y, s.to.x, s.to.y);
        }
    }

    refreshActions() {
        const A = [];
        if (this.finished || this.paused) { UI.setActions(A); return; }
        if (this.stage === 'plan') {
            const est = this.phaseMinutes(this.orient, this.pace);
            A.push({ label: `Stripes ${this.orient === 'v' ? '↕' : '↔'}`, fn: () => { this.orient = this.orient === 'v' ? 'h' : 'v'; this.drawPlan(); this.refreshActions(); } });
            A.push({ label: N.pace[this.pace].label, fn: () => { this.pace = PACES[(PACES.indexOf(this.pace) + 1) % PACES.length]; this.refreshActions(); } });
            A.push({ label: `Start · ${this.finishText(est.total)}`, fn: () => this.start(), go: true });
        } else if (this.stage === 'run' || this.stage === 'touchup') {
            if (this.waitDog) A.push({ label: `Waiting on Kyle…`, fn: () => {}, off: true });
            A.push({ label: this.skip ? 'Speed 1×' : `Speed ${this.speed}×`, fn: () => { if (this.skip) this.skip = false; else { const S = N.watchSpeeds; this.speed = S[(S.indexOf(this.speed) + 1) % S.length]; } this.refreshActions(); } });
            A.push({ label: this.skip ? 'Skipping ⏭' : 'Skip ⏭', fn: () => { this.skip = !this.skip; this.refreshActions(); }, go: this.skip });
        } else if (this.stage === 'review') {
            A.push({ label: `Touch up · +${Math.round(this.touchMin())} min`, fn: () => this.touchUp() });
            A.push({ label: 'Finish job', fn: () => this.finish(), go: true });
        }
        UI.setActions(A);
    }

    status() {
        let t = '';
        if (this.stage === 'plan') t = `Plan the job · ${this.plans[this.orient].passes} passes`;
        else if (this.stage === 'review') t = 'Done. Look it over.';
        else if (this.phase === 'mower') t = this.list && this.list.length ? `Mowing · pass ${this.list0 - this.list.length} of ${this.list0}` : 'Mowing · cleaning up missed spots';
        else if (this.phase) {
            const verb = { trimmer: 'Trimming', edger: 'Edging', blower: 'Blowing off' }[this.phase];
            t = `${verb}${this.cur && this.cur.t ? ' · ' + this.cur.t.name.toLowerCase() : ''}`;
        }
        if (this.stage === 'touchup') t = 'Touch-up · ' + t;
        UI.status(t);
    }

    // ---------- running the job ----------
    start() {
        const P = N.pace[this.pace], C = N.comp, k = this.k;
        this.covTarget = Math.min(0.998, lerp(C.covAt0, C.covAt100, k) + P.cov);
        this.wobble = lerp(C.wobbleAt0, 0, k) * P.wobble;
        this.short = lerp(C.shortAt0, 0, k) * P.miss;
        this.miss = Math.min(0.9, lerp(C.missAt0, 0, k) * P.miss);
        this.spot = Math.max(0.05, Math.min(0.98, lerp(C.spotAt0, C.spotAt100, k) + P.spot));
        this.stripeScore = Math.max(0, Math.min(1, lerp(C.stripeAt0, C.stripeAt100, k) + P.stripe + (Math.random() - 0.5) * 0.1));
        this.mins = this.phaseMinutes(this.orient, this.pace); this.spent = 0;
        this.plan = this.plans[this.orient];
        this.stage = 'run';
        Sound.init(); Sound.pullStart();
        this.drawPlan();
        this.beginPhase(0);
        this.refreshActions();
    }

    beginPhase(i) {
        this.phaseIdx = i; this.phase = this.phases[i]; this.cur = null;
        if (!this.phase) { this.runDone(); return; }
        this.switchUnit(this.phase);
        if (this.phase === 'mower') {
            this.list = this.touch ? [] : this.plan.segs.map(seg => ({ seg }));
            this.cleanTries = 0; this.cleanSkip = new Set();
        } else {
            this.updateTargets(0, true);
            this.list = this.targets[this.phase].filter(t => t.left > 0);
        }
        this.list0 = this.list.length;
        this.status();
    }

    endPhase() { this.beginPhase(this.phaseIdx + 1); }

    switchUnit(kind) {
        if (this.units[this.active] && this.active !== 'mower') this.units[this.active].c.setAlpha(0.55);
        this.active = kind;
        this.units[kind].c.setAlpha(1);
        if (this.zoomed) this.cameras.main.startFollow(this.units[kind].c, true, 0.12, 0.12);
    }

    mReach() { const r = CFG.mower.collideR; return (a, b) => { const p = this.reach(a, b, r, true); return Math.hypot(p.x - b.x, p.y - b.y) < 0.5; }; }

    // Hand the active unit its next piece of work. Called whenever it runs out of route.
    nextItem() {
        const u = this.units[this.phase];
        for (let guard = 0; guard < 400; guard++) {
            if (this.phase === 'mower') {
                if (this.list.length) {
                    // nearest lane start; lanes put off because of the dog go last
                    const pool = this.list.some(it => !it.later) ? this.list.filter(it => !it.later) : this.list;
                    let best = pool[0], bd = 1e9;
                    for (const it of pool) { const d = Math.hypot(it.seg.from.x - u.x, it.seg.from.y - u.y); if (d < bd) { bd = d; best = it; } }
                    this.list.splice(this.list.indexOf(best), 1);
                    if (this.runLane(best)) { this.status(); return; }
                    continue;
                }
                // the bits of lanes it stopped short on, then single missed spots
                if (this.stubs.length && this.yard.mowCoverage() < (this.touch ? 1 : this.covTarget)) {
                    let best = this.stubs[0], bd = 1e9;
                    for (const it of this.stubs) { const d = Math.hypot(it.seg.from.x - u.x, it.seg.from.y - u.y); if (d < bd) { bd = d; best = it; } }
                    this.stubs.splice(this.stubs.indexOf(best), 1);
                    if (this.runLane(best)) { this.status(); return; }
                    continue;
                }
                const c = this.cleanStep();
                if (c === 'ok') { this.status(); return; }
                if (c === 'again') continue;
                this.endPhase(); return;
            }
            // trimmer, edger, blower: nearest target that still needs it
            this.updateTargets(0, true);
            this.list = this.list.filter(t => t.left > 0);
            if (!this.list.length) { this.endPhase(); return; }
            let best = this.list[0], bd = 1e9;
            for (const t of this.list) { const d = this.distTo(t, u.x, u.y); if (d < bd) { bd = d; best = t; } }
            this.list.splice(this.list.indexOf(best), 1);
            let plan = this.workPlan(best);
            if (!plan.length) continue;
            if (!this.touch && Math.random() < this.miss) {   // didn't quite get all the way around it
                const keep = 0.55 + Math.random() * 0.3;
                plan = plan.slice(0, Math.max(1, Math.round(plan.length * keep)));
            }
            u.queue.push(...plan);
            this.cur = { t: best, end: plan[plan.length - 1] };
            this.status();
            return;
        }
        this.endPhase();
    }

    runLane(it) {
        const u = this.units.mower, s0 = it.seg, Y = this.yard;
        let s = s0;
        if (this.short > 0 && !it.retry) {   // stopping short of the edges, more often with less competence
            const L = s0.len, dx = (s0.to.x - s0.from.x) / L, dy = (s0.to.y - s0.from.y) / L;
            const a = Math.random() * this.short, b = Math.random() * this.short;
            if (L - a - b > 8) {
                s = { from: { x: s0.from.x + dx * a, y: s0.from.y + dy * a }, to: { x: s0.to.x - dx * b, y: s0.to.y - dy * b }, len: L - a - b };
                // remember the pieces left uncut, so a cleanup pass can run them later (same direction, same shade)
                if (a > 3) this.stubs.push({ retry: true, seg: { from: s0.from, to: s.from, len: a, shade: segShade(s0) } });
                if (b > 3) this.stubs.push({ retry: true, seg: { from: s.to, to: s0.to, len: b, shade: segShade(s0) } });
            }
        }
        const path = this.mPather.find({ x: u.x, y: u.y }, s.from, this.mReach());
        if (!path) return false;
        const shade = s0.shade || segShade(s0);
        for (const p of path) u.queue.push({ x: p.x, y: p.y, lift: true });
        for (const p of wobbleLane(Y, s, it.retry ? 0 : this.wobble)) u.queue.push({ x: p.x, y: p.y, shade });
        this.cur = { it, end: s.to };
        return true;
    }

    // One missed spot: drive there with the blade up, cut it, in the shade of the lane it's in.
    cleanStep() {
        const target = this.touch ? 1 : this.covTarget, Y = this.yard, u = this.units.mower, c = CFG.cell;
        if (Y.mowCoverage() >= target || this.cleanTries > 300) return 'done';
        let bi = -1, bd = 1e18;
        for (let i = 0; i < Y.state.length; i++) {
            if (Y.state[i] !== STATE.UNCUT || !Y.reach[i] || this.cleanSkip.has(i)) continue;
            const x = Y.ox + (i % Y.cols + 0.5) * c, y = Y.oy + ((i / Y.cols | 0) + 0.5) * c, d = (x - u.x) * (x - u.x) + (y - u.y) * (y - u.y);
            if (d < bd) { bd = d; bi = i; }
        }
        if (bi < 0) return 'done';
        const cx = Y.ox + (bi % Y.cols + 0.5) * c, cy = Y.oy + ((bi / Y.cols | 0) + 0.5) * c;
        const p = coverPoint(Y, cx, cy, u);
        if (!p) { this.cleanSkip.add(bi); return 'again'; }
        const path = this.mPather.find({ x: u.x, y: u.y }, p, this.mReach());
        if (!path) { this.cleanSkip.add(bi); return 'again'; }
        this.cleanTries++;
        for (const q of path) u.queue.push({ x: q.x, y: q.y, lift: true });
        u.queue.push({ x: p.x, y: p.y, cutHere: true, shade: laneShadeAt(this.plan, p.x, p.y) });
        this.cur = { clean: bi, end: p };
        return 'ok';
    }

    // The active unit ran out of route: was it finished, or was it stopped?
    runnerStep() {
        if (this.stage !== 'run' && this.stage !== 'touchup') return;
        if (this.broke || this.waitDog) return;
        const u = this.units[this.phase];
        if (!u || u.queue.length) return;
        const cur = this.cur; this.cur = null;
        if (cur && cur.it && Math.hypot(u.x - cur.end.x, u.y - cur.end.y) > 3) {
            if (this.dog && Math.hypot(this.dog.x - u.x, this.dog.y - u.y) < 70) { this.dogBlocked(cur.it); return; }
            if (!cur.it.retry) { cur.it.retry = true; this.list.unshift(cur.it); }   // stopped (a breakdown): run that lane again
        }
        this.nextItem();
    }

    runDone() {
        this.chargeClock(true);
        this.switchUnit('mower');
        if (this.touch) { this.finish(); return; }
        this.updateTargets(0, true);
        const mowLeft = this.yard.mowCoverage() < 0.997 && this.yard.reachTotal - this.yard.reachCut > 6;
        const left = this.phases.filter(p => p !== 'mower' && this.pendingCount[p]);
        if (!mowLeft && !left.length) { this.finish(); return; }
        this.stage = 'review';
        this.skip = false;
        if (!this.zoomed) this.cameras.main.pan(200, this.def.H / 2, 400);
        const bits = [];
        if (mowLeft) bits.push(`${(Math.floor(this.yard.mowCoverage() * 1000) / 10)}% mowed (missed spots blink)`);
        for (const p of left) bits.push(`${this.pendingCount[p]} ${{ trimmer: 'trim', edger: 'edge', blower: 'blow' }[p]} spot${this.pendingCount[p] > 1 ? 's' : ''} missed`);
        UI.say(`Finished the plan: ${bits.join(', ')}. Touch it up, or call it done.`, 7000);
        this.status();
        this.refreshActions();
    }

    touchMin() { return N.touchUpMin * lerp(N.comp.timeAt0, N.comp.timeAt100, this.k); }

    touchUp() {
        if (!this.visit.practice && typeof Game !== 'undefined' && Game.s) Game.tick(this.touchMin());
        this.touch = true; this.stage = 'touchup';
        this.missedG.clear(); this.blinkOn = false;
        this.updateTargets(0, true);
        this.phases = ['mower', ...this.phases.filter(p => p !== 'mower' && this.pendingCount[p])];
        this.beginPhase(0);
        this.refreshActions();
    }

    // The clock moves with the work: each part of the job costs its minutes as it gets done.
    phaseProgress(ph) {
        const i = this.phases.indexOf(ph);
        if (i < this.phaseIdx) return 1;
        if (i > this.phaseIdx) return 0;
        if (ph === 'mower') return Math.min(1, this.yard.mowCoverage() / this.covTarget);
        return this.list0 ? Math.max(0, 1 - (this.list.length + (this.cur ? 0.5 : 0)) / this.list0) : 1;
    }

    chargeClock(all) {
        if (!this.mins || this.touch || this.visit.practice || typeof Game === 'undefined' || !Game.s) return;
        let want = 0;
        if (all) want = this.mins.total;
        else for (const ph of this.phases) want += (this.mins[ph] || 0) * this.phaseProgress(ph);
        const d = want - this.spent;
        if (d >= 0.5 || (all && d > 0)) { this.spent = want; Game.tick(d); }
    }

    // ---------- the loose dog ----------
    spawnDog() {
        const h = this.def.dogHome;
        this.dog = { x: h.x + 20, y: h.y + 10, r: 10, tx: h.x + 20, ty: h.y + 10, wait: 1, leaving: false, gone: false };
        this.yard.dynamic.push(this.dog);
        UI.hint('dog', `${this.visit.cust.dog} is loose! He won't move out of the mower's way.`);
        UI.extra(`Text Kyle about ${this.visit.cust.dog}`, () => this.textKyle());
        if (typeof Game !== 'undefined' && Game.s) Game.walt('dog');
    }

    textKyle() {
        if (this.kyleTexted || !this.dog) return;
        this.kyleTexted = true;
        UI.extra(null);
        if (!this.visit.practice && typeof Game !== 'undefined' && Game.s) Game.tick(N.kyleMin);
        UI.say("Kyle: \"Sorry!! Coming.\"", 3500);
        this.time.delayedCall(2500, () => { if (this.dog) { this.dog.leaving = true; this.dog.tx = this.def.house.door; this.dog.ty = 70; } });
    }

    // Biscuit sat down in front of the mower. Choosing "mow around him" holds for the rest of the yard:
    // the mower works around him on its own (a couple of minutes each time, rougher stripes).
    dogBlocked(it) {
        const name = this.visit.cust.dog || 'The dog';
        it.retry = true;
        if (this.kyleTexted) { this.list.unshift(it); this.waitDog = true; this.refreshActions(); return; }
        it.blocked = (it.blocked || 0) + 1;
        if (this.aroundDog && !(this.list.every(o => o.later) && it.blocked >= 3)) {
            this.putOff(it);
            if ((this.dogMin || 0) < 20 && !this.visit.practice && typeof Game !== 'undefined' && Game.s) { this.dogMin = (this.dogMin || 0) + 2; Game.tick(2); }
            return;
        }
        this.skip = false;
        const ch = [{ label: `Text Kyle to come get him (+${N.kyleMin} min)`, act: 'kyle' }];
        if (!this.aroundDog) ch.push({ label: 'Mow around him (slower, rougher stripes)', act: 'around' });
        this.paused = true;
        UI.modal(this.aroundDog ? `${name} is still in the way, right where the mower needs to go.` : `${name} is sitting in front of the mower and won't move.`, ch, act => {
            this.paused = false;
            if (act === 'kyle') { this.textKyle(); this.list.unshift(it); this.waitDog = true; }
            else { this.aroundDog = true; this.putOff(it); }
            this.refreshActions();
        });
    }

    // put off this lane and every other lane that runs past the dog
    putOff(it) {
        it.later = true; this.list.push(it);
        const d = this.dog; if (!d) return;
        for (const o of this.list) {
            const s = o.seg, vx = s.to.x - s.from.x, vy = s.to.y - s.from.y, L2 = vx * vx + vy * vy || 1;
            const t = Math.max(0, Math.min(1, ((d.x - s.from.x) * vx + (d.y - s.from.y) * vy) / L2));
            if (Math.hypot(s.from.x + vx * t - d.x, s.from.y + vy * t - d.y) < 45) o.later = true;
        }
    }

    stepDog(dt) {
        const d = this.dog; if (!d || d.gone) return;
        const m = this.units.mower;
        d.wait -= dt;
        const near = Math.hypot(m.x - d.x, m.y - d.y) < 60 && !d.leaving;
        if (d.wait <= 0 && !near) {
            const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy);
            if (dist < 2) {
                if (d.leaving) {
                    d.gone = true; this.yard.dynamic = []; this.dogG.clear(); this.dog = null; UI.extra(null);
                    if (this.waitDog) { this.waitDog = false; this.refreshActions(); }
                    UI.say(`${this.visit.cust.dog || 'The dog'}'s inside. Clear to mow.`, 3000);
                    return;
                }
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
                if (!this.yard.collides(nx, ny, d.r, true) || d.leaving) { d.x = nx; d.y = ny; } else { d.wait = 0.2; d.tx = d.x; d.ty = d.y; }
            }
        }
        // don't let him sit on top of a unit
        for (const k in this.units) { const u = this.units[k]; if (Math.hypot(u.x - d.x, u.y - d.y) < d.r + 8 && !d.leaving) { d.x += (d.x - u.x) * 0.1; d.y += (d.y - u.y) * 0.1; } }
    }

    drawDog() {
        const d = this.dog; if (!d) return;
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
        this.broke = true; this.skip = false;
        const u = this.units.mower; u.queue.length = 0;
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
            UI.say(act === 'walt' ? "Walt: \"Bring it back clean.\"" : "Running again.", 3000);
        });
    }

    // ---------- the loop ----------
    update(time, delta) {
        const dt = Math.min(0.05, delta / 1000);
        if (this.paused) { this.updateParticles(dt); return; }
        const running = this.stage === 'run' || this.stage === 'touchup';
        const steps = running ? (this.skip ? 30 : this.speed) : 1;
        for (let s = 0; s < steps && !this.paused && !this.finished; s++) this.simStep(dt);
        if (this.texDirty) { this.grassTex.refresh(); this.texDirty = false; }
        const u = this.units[this.active];
        Sound.engine(this.finished || this.broke || !running ? 'off' : this.active === 'mower' ? 'mower' : 'trimmer', u.moving);
        this.drawDog();
        this.drawTargets(time);
        this.drawRing(time);
        this.drawEdges();
        this.drawDebris();
        this.updateMissed(dt);
        this.updateParticles(dt);
        const mc = this.yard.mowCoverage();
        UI.hud(mc);
        UI.order(this);
    }

    simStep(dt) {
        for (const k in this.units) this.stepUnit(this.units[k], dt);
        this.stepDog(dt);
        this.updateTargets(dt);
        this.runnerStep();
        if (this.stage === 'run' && this.phase === 'mower' && this.visit.breakdownAt && !this.brokeOnce && this.yard.mowCoverage() >= this.visit.breakdownAt) { this.brokeOnce = true; this.breakDown(); }
        if (this.stage === 'run') this.chargeClock(false);
    }

    stepUnit(u, dt) {
        u.moving = false;
        if (!u.queue.length) return;
        if (u.kind === 'mower' && this.broke) { u.queue.length = 0; return; }
        const t = u.queue[0];
        const dx = t.x - u.x, dy = t.y - u.y, dist = Math.hypot(dx, dy);
        if (dist < 0.5) {
            if (t.cutHere) { u.x = t.x; u.y = t.y; u.c.setPosition(t.x, t.y); this.cutAt(u, t); }
            u.queue.shift(); return;
        }
        const want = Math.atan2(dy, dx);
        let diff = Phaser.Math.Angle.Wrap(want - u.a);
        const r = u.cfg.collideR, walker = u.kind !== 'mower';
        if (Math.abs(diff) > 2.6 && dist < 50) {   // short move straight behind: back up instead of spinning around
            const step = Math.min(dist, u.cfg.speed * 0.6 * dt);
            const nx = u.x + Math.cos(want) * step, ny = u.y + Math.sin(want) * step;
            if (this.yard.collides(nx, ny, r, walker)) { u.queue.length = 0; return; }
            u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
            if (!t.lift) this.cutAt(u, t);
            if (step >= dist - 0.01) { if (t.cutHere) this.cutAt(u, t); u.queue.shift(); }
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
            u.queue.length = 0;   // something stepped in front (the dog)
            Sound.bump();
            return;
        }
        u.x = nx; u.y = ny; u.c.setPosition(nx, ny); u.moving = true;
        if (!t.lift && !t.cutHere) this.cutAt(u, t);
        if (step >= dist - 0.01) { if (t.cutHere) this.cutAt(u, t); u.queue.shift(); }
    }

    cutAt(u, wp) {
        if (u.kind === 'edger') { this.edgeAt(u); return; }
        if (u.kind === 'blower') { this.blowAt(u); return; }
        let ns;
        if (u.kind === 'trimmer') ns = STATE.TRIM;
        else {
            ns = wp && wp.shade ? wp.shade : headingShade(Math.cos(u.a), Math.sin(u.a));
            this.checkHidden(u);
        }
        const res = this.yard.cutAround(u.x, u.y, u.cfg.cutR, ns);
        if (res.changed.length) {
            for (const i of res.changed) this.yard.paintCell(this.gctx, i);
            this.texDirty = true;
        }
        if (res.fresh > 0) {
            if (this.yard.cut === res.fresh) Pacing.mark('first grass cut');
            this.spray(u, Math.min(4, 1 + (res.fresh >> 1)));
        }
    }

    // hidden sprinkler heads: competence decides whether you see one in time
    checkHidden(u) {
        for (let i = this.hiddenLeft.length - 1; i >= 0; i--) {
            const h = this.hiddenLeft[i], d = Math.hypot(h.x - u.x, h.y - u.y);
            if (d < 34 && !h.rolled) {
                h.rolled = true;
                if (Math.random() < this.spot) {
                    this.hiddenLeft.splice(i, 1); this.spotted++; this.found.push({ x: h.x, y: h.y });
                    this.add.graphics().setDepth(6).fillStyle(0x4a4a4a).fillCircle(h.x, h.y, 4).lineStyle(1.5, 0xffe14d).strokeCircle(h.x, h.y, 6);
                    UI.say("Spotted a sprinkler head hiding in the grass. Went around it and marked it for next time.", 4000);
                    continue;
                }
            }
            if (d > 9) continue;
            this.hiddenLeft.splice(i, 1);
            this.hits++; this.found.push({ x: h.x, y: h.y });
            Sound.bump(); this.cameras.main.shake(160, 0.006);
            for (let k = 0; k < 20; k++) { const a = Math.random() * 6.28; this.particles.push({ x: h.x, y: h.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 30, life: 0.8, max: 0.8, kind: 'water' }); }
            this.add.graphics().setDepth(6).fillStyle(0x4a4a4a).fillCircle(h.x, h.y, 4).lineStyle(1.5, 0xffe14d).strokeCircle(h.x, h.y, 6);
            UI.say(`Clunk! Ran over a sprinkler head hiding in the grass. That's $${N.sprinklerCost} and a ding on the score.`, 4500);
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

    // ---------- trimming, edging, blowing by target ----------
    distTo(t, x, y) {
        let best = 1e9;
        for (const run of t.runs) for (const p of run) { const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < best) best = d; }
        return Math.sqrt(best);
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
            out.push(...path.map(p => ({ x: p.x, y: p.y, lift: true })), ...run.slice(1).map(p => ({ x: p.x, y: p.y })));
            cur = run[run.length - 1];
        }
        return out;
    }

    updateTargets(dt, force) {
        this.targetCheckT -= dt;
        if (this.targetCheckT > 0 && !force) return;
        this.targetCheckT = 0.2;
        for (const k of WALKERS) {
            let n = 0;
            for (const t of this.targets[k]) {
                if (k === 'trimmer') { let left = 0; for (const i of t.cells) if (this.yard.state[i] === STATE.UNCUT) left++; t.left = left; }
                else if (k === 'edger') t.left = t.total - t.done;
                else { let left = 0; for (const d of this.debris) if (d.h === t.hard) left++; t.left = left; }
                if (t.left > (k === 'edger' ? Math.max(1, t.total * 0.03) : 0)) n++; else if (k === 'edger') t.left = 0;
            }
            this.pendingCount[k] = n;
        }
    }

    // outlines on what was missed, once the plan is finished
    drawTargets(time) {
        const g = this.targetG; g.clear();
        if (this.finished || this.stage !== 'review') return;
        const a = 0.55 + 0.3 * Math.sin(time / 230);
        for (const k of this.phases) {
            if (k === 'mower') continue;
            for (const t of this.targets[k]) {
                if (t.left <= 0) continue;
                g.lineStyle(2.5, 0xffe14d, a);
                for (const run of t.runs) {
                    g.beginPath(); g.moveTo(run[0].x, run[0].y);
                    for (let j = 1; j < run.length; j++) g.lineTo(run[j].x, run[j].y);
                    if (t.closed) g.closePath();
                    g.strokePath();
                }
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
            g.fillStyle(this.visit.mowerSpeed > 150 ? 0x2f8f4a : 0xd94a3a).fillRoundedRect(-11, -12, 28, 24, 6);
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
        if (kind !== 'mower') c.setAlpha(0.55);
        return { kind, cfg, x: st.x + ox, y: st.y, a: st.a, queue: [], c, moving: false };
    }

    drawEdges() {
        if (!this.edgeDirty) return;
        this.edgeDirty = false;
        const g = this.edgeG; g.clear();
        const all = this.units.edger ? this.targets.edger : buildEdgeTargets(this.yard);
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

    drawRing(time) {
        const g = this.ringG; g.clear();
        if (this.finished || this.stage === 'review') return;
        const u = this.units[this.active];
        const r = (u.kind === 'mower' ? 20 : 12) + Math.sin(time / 260) * 1.5;
        g.lineStyle(2, 0xffffff, 0.5).strokeCircle(u.x, u.y, r);
    }

    // missed spots blink once the plan is done
    updateMissed(dt) {
        const g = this.missedG;
        if (this.finished || this.stage !== 'review') { if (this.blinkOn) { g.clear(); this.blinkOn = false; } return; }
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
        const started = this.stage !== 'plan';
        return {
            mowCov: this.yard.mowCoverage(),
            stripes: started ? 20 * Math.max(0, this.stripeScore - (this.aroundDog ? 0.1 : 0)) * Math.min(1, this.yard.mowCoverage() / 0.9) : 0,
            wrongStripes: !!(this.pref && this.pref !== this.orient), pref: this.pref, orient: this.orient, pace: this.pace,
            trimFrac: this.units.trimmer ? (this.trimCells.length ? 1 - trimLeft / this.trimCells.length : 1) : 0,
            edgeFrac: this.units.edger ? (this.edgeTotal ? Math.min(1, edgeDone / (this.edgeTotal * 0.97)) : 1) : 0,
            blowFrac: this.units.blower ? (this.debrisMade < 5 ? 1 : 1 - this.debris.length / this.debrisMade) : (this.debrisMade < 5 ? 1 : 0),
            hits: this.hits, spotted: this.spotted, found: this.found, mowerId: this.visit.mowerId,
        };
    }

    finish() {
        if (this.finished) return;
        if (this.debugDone && !this.mins) { this.mins = this.phaseMinutes(this.orient, this.pace); this.stripeScore = this.stripeScore ?? 0.8; this.stage = 'run'; }
        if (this.stage === 'run') this.chargeClock(!!this.debugDone);
        this.finished = true;
        for (const k in this.units) this.units[k].queue.length = 0;
        this.refreshActions();
        UI.status('');
        UI.extra(null);
        this.cameras.main.stopFollow();
        this.cameras.main.zoomTo(this.fitZoom(), 600);
        this.cameras.main.pan(200, this.def.H / 2, 600);
        this.missedG.clear(); this.targetG.clear(); this.planG.clear();
        Sound.ding();
        this.sparkle();
        const r = this.result();
        this.time.delayedCall(1300, () => Screens.yardDone(this.visit, r));
    }

    // Debug only: finish the whole job well, instantly.
    debugFinish() {
        for (let i = 0; i < this.yard.state.length; i++) {
            if (this.yard.state[i] !== STATE.UNCUT) continue;
            const c = CFG.cell, x = this.yard.ox + (i % this.yard.cols + 0.5) * c, y = this.yard.oy + ((i / this.yard.cols | 0) + 0.5) * c;
            this.yard.state[i] = this.yard.reach[i] ? laneShadeAt(this.plans[this.orient], x, y) : STATE.TRIM;
            this.yard.cut++; if (this.yard.reach[i]) this.yard.reachCut++;
        }
        for (const t of this.targets.edger) { t.hit.forEach(h => h.fill(1)); t.done = t.total; }
        this.debris = []; this.debrisDirty = true; this.edgeDirty = true;
        this.yard.paintAll(this.gctx); this.grassTex.refresh();
        this.updateTargets(0, true);
        this.debugDone = true;
        this.finish();
    }
}
