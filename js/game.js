// The business: days, jobs, customers, money, reputation, workers, chaos. No drawing in here,
// so the economy simulator can run it with no graphics (L06 testing tools).
const SAVE_KEY = 'cutabove_save_v1';
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = v => Math.max(0, Math.min(1, v));
const TASK_TOOLS = { trim: 'trimmer', edge: 'edger', blow: 'blower' };
const mark = name => { if (typeof Pacing !== 'undefined') Pacing.mark(name); };

const Game = {
    s: null,
    listeners: [],
    onChange(fn) { this.listeners.push(fn); },
    changed() { for (const f of this.listeners) f(); },

    // ---------- setup and saving ----------
    newGame() {
        const customers = {};
        for (const c of CUSTOMERS) customers[c.id] = {
            status: c.start === 'list' ? 'customer' : c.start === 'tutorial' ? 'tutorial' : 'prospect',
            rel: c.start === 'list' ? 1 : 0, relXP: 0, price: this.suggestedPrice(c), day: c.day ?? null,
            plan: null, visits: 0, lastStars: null, rejectedWeek: 0, tries: 0,
        };
        this.s = {
            v: 1, week: 1, day: 0, clock: N.dayStart, phase: 'morning',
            money: N.startMoney, rep: N.startRep,
            customers, jobs: [], carry: [], workers: [], applicants: null, hireUnlocked: false,
            gear: [{ id: 'm1', type: 'push', cond: N.startCondition, broken: false }],
            tools: { trimmer: true, edger: false, blower: false },
            found: {}, know: { you: {} }, me: { comp: N.comp.youStart },
            phone: [], msgId: 1, jobId: 1, workerId: 1,
            day0: null, week0: null, tipsShown: {}, knocks: 0, wageOwed: 0, totalJobs: 0,
        };
        this.startMorning();
        return this.s;
    },
    save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch (e) { } },
    load() {
        try { const t = localStorage.getItem(SAVE_KEY); if (t) { this.s = JSON.parse(t); this.migrate(); return true; } } catch (e) { }
        return false;
    },
    // older saves: add competence
    migrate() {
        const s = this.s;
        if (!s.me) s.me = { comp: N.comp.youStart };
        for (const w of s.workers) if (w.comp == null) w.comp = N.comp.fromStats(w.stats);
    },
    hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } },
    exportCode() { return btoa(unescape(encodeURIComponent(JSON.stringify(this.s)))); },
    importCode(code) {
        const s = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
        if (!s || !s.customers || !s.week) throw new Error('not a save code');
        this.s = s; this.migrate(); this.save(); return true;
    },

    // ---------- lookups ----------
    cust(id) { return CUSTOMERS.find(c => c.id === id) || (this.s.odd || {})[id]; },
    cs(id) { return this.s.customers[id]; },
    worker(id) { return this.s.workers.find(w => w.id === id); },
    job(id) { return this.s.jobs.find(j => j.id === id); },
    mowers() { return this.s.gear.filter(g => N.gear[g.type].kind === 'mower'); },
    bestMower() { return this.mowers().filter(g => !g.broken).sort((a, b) => N.gear[b.type].speed - N.gear[a.type].speed || b.cond - a.cond)[0] || null; },
    suggestedPrice(c) {
        if (c.start === 'tutorial') return 0;
        return N.price[yardOf(c.yard).size] + c.tasks.reduce((s, t) => s + (N.addon[t] || 0), 0);
    },
    rank(level) { return level >= 9 ? 'Master' : level >= 7 ? 'Veteran' : level >= 5 ? 'Pro' : level >= 3 ? 'Hand' : 'Rookie'; },
    levelFor(xp) { let l = 1; for (let i = 0; i < N.levels.length; i++) if (xp >= N.levels[i]) l = i + 1; return l; },
    knowLevel(person, yard) {
        const v = (this.s.know[person] || {})[yard] || 0;
        let l = 0; N.knowledgeVisits.forEach((need, i) => { if (v >= need) l = i; });
        return l;
    },
    // ---------- competence ----------
    comp(person) {
        if (person === 'you') return this.s.me.comp;
        const w = this.worker(person); if (!w) return N.comp.youStart;
        if (w.comp == null) w.comp = N.comp.fromStats(w.stats);
        return w.comp;
    },
    // Every job teaches something; a bad one teaches less. Returns [before, after].
    grow(person, size, stars) {
        const w = person === 'you' ? null : this.worker(person), o = w || this.s.me, before = this.comp(person);
        const k = N.comp.gain * N.xpSize[size] * (stars >= 3 ? 1 : 0.5) * (w && w.traits.includes('Eager') ? 1.25 : 1);
        o.comp = Math.round((before + (100 - before) * k) * 10) / 10;
        return [before, o.comp];
    },
    // Game minutes for each part of a job, before pace and stripe direction.
    jobMinutes(person, custId, tasks, mowerType) {
        const c = this.cust(custId), y = yardOf(c.yard), k = this.comp(person) / 100;
        const f = lerp(N.comp.timeAt0, N.comp.timeAt100, k) * N.knowledgeSpeed[this.knowLevel(person, c.yard)] * (c.overgrown ? N.overgrownTime : 1);
        const out = { mow: N.workerMin[y.size] * f * (mowerType ? Math.sqrt(N.gear.push.speed / N.gear[mowerType].speed) : 1) };
        for (const t of tasks) if (t !== 'mow' && this.s.tools[TASK_TOOLS[t]]) out[t] = N.workerTaskMin[t] * f;
        return out;
    },

    clockText(m) {
        m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60, h12 = ((h + 11) % 12) + 1;
        return `${h12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    },
    dayName() { return N.days[this.s.day]; },
    starsFor(score) { const a = N.starsAt; return score >= a[0] ? 5 : score >= a[1] ? 4 : score >= a[2] ? 3 : score >= a[3] ? 2 : 1; },
    openProblems() { return this.s.phone.filter(m => m.choices && !m.resolved).length; },
    unread() { return this.s.phone.filter(m => !m.read).length; },
    canHire() { return this.s.hireUnlocked && this.s.workers.length < N.maxWorkers; },

    // ---------- phone ----------
    msg(from, text, extra) {
        const m = Object.assign({ id: this.s.msgId++, from, text, week: this.s.week, day: this.s.day, time: this.s.clock, read: false, resolved: false }, extra || {});
        this.s.phone.unshift(m);
        if (this.s.phone.length > 60) this.s.phone.length = 60;
        if (typeof Sound !== 'undefined' && Sound.buzz) Sound.buzz();
        return m;
    },
    walt(key) {
        if (this.s.tipsShown[key]) return;
        this.s.tipsShown[key] = true;
        this.msg('Walt', WALT[key], { walt: true });
        if (typeof Screens !== 'undefined') Screens.waltSays(WALT[key]);
    },

    // ---------- the day ----------
    startMorning() {
        const s = this.s;
        s.phase = 'morning'; s.clock = N.dayStart;
        s.jobs = [];
        for (const j of s.carry) s.jobs.push(Object.assign(j, { status: 'waiting', assignee: 'you', progress: 0, late: true, events: [] }));
        s.carry = [];
        if (s.week === 1 && s.day === 0) s.jobs.push(this.newJob('walt'));
        for (const c of CUSTOMERS) {
            const st = s.customers[c.id];
            if (st.status === 'customer' && st.day === s.day && !s.jobs.some(j => j.cust === c.id)) s.jobs.push(this.newJob(c.id));
        }
        s.dayLog = { income: 0, tips: 0, gas: 0, repairs: 0, parts: [], repStart: s.rep, jobsDone: [], missed: [], notes: [] };
        if (s.day === 0) s.weekLog = { income: 0, tips: 0, gas: 0, repairs: 0, wages: 0, spent: 0, jobs: 0, stars: 0, repStart: s.rep };
        if (s.week === 1 && s.day === 0) this.walt('day1');
        if (s.week >= N.hireUnlockWeek && !s.hireUnlocked) { s.hireUnlocked = true; this.walt('hire'); }
        this.offerOddJobs();
        if (s.applicants && s.applicants.pending) {
            s.applicants.pending = false;
            this.msg('Rosa', `Three people answered your help wanted ad: ${s.applicants.list.join(', ')}. Check the Crew screen.`);
        }
        this.changed();
    },

    // One-time jobs from around the block arrive by phone each morning (not on day 1: that's the tutorial).
    offerOddJobs() {
        const s = this.s;
        if (s.week === 1 && s.day === 0) return;
        s.odd = s.odd || {}; s.oddN = s.oddN || 0;
        const [lo, hi] = N.oddPerDay, n = s.week === 1 ? lo : lo + Math.floor(Math.random() * (hi - lo + 1));
        const pool = ODD_JOBS.slice().sort(() => Math.random() - 0.5);
        for (let k = 0; k < n && k < pool.length; k++) {
            const o = pool[k], id = 'odd' + (++s.oddN), tasks = o.tasks || ['mow'];
            const c = { id, name: o.name, who: 'One-time job', archetype: 'One-time', yard: o.yard, tasks, expect: 3, start: 'odd', overgrown: true, blurb: o.note };
            c.price = Math.round(this.suggestedPrice(c) * N.oddPremium / 5) * 5;
            s.odd[id] = c;
            s.customers[id] = { status: 'odd', rel: 0, relXP: 0, price: c.price, day: null, plan: null, visits: 0, lastStars: null };
            this.msg(o.name, `${o.note} Can you mow it today? $${c.price}${tasks.length > 1 ? ' (' + tasks.join(', ') + ')' : ''}. Need an answer by noon.`,
                { kind: 'odd', odd: id, choices: [{ label: `Yes, today ($${c.price})`, act: 'odd_yes' }, { label: 'No thanks', act: 'odd_no' }] });
        }
        // drop old one-time customers nobody needs any more
        for (const id of Object.keys(s.odd)) if (s.customers[id].status === 'odd-done' && s.customers[id].day !== s.week) { delete s.odd[id]; delete s.customers[id]; }
    },

    newJob(custId) {
        const c = this.cust(custId), st = this.s.customers[custId];
        return { id: this.s.jobId++, cust: custId, assignee: 'you', status: 'waiting', progress: 0, need: 0, late: false, events: [],
            price: c.start === 'tutorial' ? 0 : st.price, tasks: c.tasks.slice() };
    },

    // Which mower each person gets today. You get the best one if you have jobs.
    mowerPlan() {
        const s = this.s, free = this.mowers().filter(g => !g.broken)
            .sort((a, b) => N.gear[b.type].speed - N.gear[a.type].speed || b.cond - a.cond);
        const plan = {};
        const people = [];
        if (s.jobs.some(j => j.assignee === 'you' && j.status !== 'done')) people.push('you');
        for (const w of s.workers) if (s.jobs.some(j => j.assignee === w.id && j.status !== 'done')) people.push(w.id);
        people.forEach((p, i) => { plan[p] = free[i] ? free[i].id : null; });
        return plan;
    },

    cycleAssignee(jobId) {
        const j = this.job(jobId); if (!j || j.status !== 'waiting') return;
        const opts = ['you', ...this.s.workers.map(w => w.id)];
        j.assignee = opts[(opts.indexOf(j.assignee) + 1) % opts.length];
        this.changed();
    },

    startDay() {
        const s = this.s;
        s.phase = 'day'; s.clock = N.dayStart;
        const plan = this.mowerPlan();
        for (const j of s.jobs) if (j.assignee !== 'you' && !plan[j.assignee]) j.assignee = 'you';   // no mower, no job
        s.mowerFor = this.mowerPlan();
        for (const w of s.workers) { w.start = null; w.end = null; }
        this.save();
        this.changed();
    },

    // Advance the clock. Workers keep working while you mow.
    tick(dt) {
        const s = this.s;
        if (!s || s.phase !== 'day') return;
        // big jumps (driving, knocking, fixing a mower) are handed out in small slices so workers don't lose time
        for (let left = dt; left > 0;) {
            const d = Math.min(2, left); left -= d;
            s.clock += d;
            for (const w of s.workers) this.workerStep(w, d);
        }
        if (s.clock >= N.oddExpiry) for (const m of s.phone) if (m.kind === 'odd' && !m.resolved && m.week === s.week && m.day === s.day) { m.resolved = 'Too late: they found someone else'; m.read = true; }
        this.changed();
    },

    shouldEndDay() { return this.s.phase === 'day' && this.s.clock >= N.dayEnd; },

    // ---------- workers ----------
    workerStep(w, dt) {
        const s = this.s;
        if (s.clock > N.dayEnd) return;
        const j = s.jobs.find(x => x.assignee === w.id && x.status !== 'done' && x.status !== 'left');
        if (!j) return;
        if (j.status === 'waiting') {
            j.status = 'driving'; j.progress = 0; j.driveLeft = N.driveMin;
            if (w.start === null) w.start = s.clock;
            this.planWorkerJob(w, j);
        }
        if (j.status === 'driving') {
            j.driveLeft -= dt;
            if (j.driveLeft <= 0) j.status = 'working';
            return;
        }
        if (j.status === 'stuck') return;   // waiting on your answer: time is being lost
        if (j.status === 'working') {
            let rate = 1;
            if (w.traits.includes('Early Bird')) rate = s.clock < 12 * 60 ? 1.1 : s.clock > 15 * 60 ? 0.85 : 1;
            j.progress += dt * rate;
            const ev = j.events.find(e => !e.fired && j.progress >= e.at * j.need);
            if (ev) { ev.fired = true; this.fireWorkerEvent(w, j, ev); return; }
            if (j.progress >= j.need + (j.extra || 0)) this.finishWorkerJob(w, j);
        }
    },

    planWorkerJob(w, j) {
        const c = this.cust(j.cust), M = this.jobMinutes(w.id, j.cust, j.tasks, null);
        let need = Object.values(M).reduce((a, b) => a + b, 0);
        need *= 1.25 - w.stats.speed * 0.05;
        if (w.traits.includes('Perfectionist')) need *= 1.2;
        if (w.traits.includes('Chatty') && c.archetype === 'Nice Lady') need += 20;
        j.need = Math.round(need); j.extra = 0;
        j.events = [];
        if (this.openProblems() < N.maxOpenProblems) {
            const m = this.s.gear.find(g => g.id === this.s.mowerFor[w.id]);
            if (m && Math.random() * 100 < N.breakdownPct(m.cond)) j.events.push({ kind: 'break', at: rnd(0.25, 0.7) });
            if (c.dog && Math.random() < N.dogOutChance) j.events.push({ kind: 'dog', at: rnd(0.1, 0.4) });
        }
    },

    fireWorkerEvent(w, j, ev) {
        const c = this.cust(j.cust);
        if (ev.kind === 'break') {
            if (w.stats.mechanic >= 6 || w.traits.includes('Gearhead')) {
                j.extra += 15; w.clutch = (w.clutch || 0) + 1;
                this.msg(w.name, `Mower died at ${c.name}'s. Fixed it myself. Back at it.`);
                const m = this.s.gear.find(g => g.id === this.s.mowerFor[w.id]); if (m) m.cond = Math.min(100, m.cond + 5);
                return;
            }
            j.status = 'stuck'; j.stuckAt = this.s.clock;
            this.msg(w.name, `Mower won't start at ${c.name}'s. What do I do?`, { job: j.id, worker: w.id, kind: 'break',
                choices: [{ label: 'Talk them through a fix (+30 min)', act: 'fix' }, { label: `Call Rosa ($${N.rosaCost}, +${N.rosaMin} min)`, act: 'rosa' }] });
        } else if (ev.kind === 'dog') {
            j.status = 'stuck'; j.stuckAt = this.s.clock;
            this.msg(w.name, `${c.dog} got out at the Brandts'. He's sitting in front of the mower and won't move.`, { job: j.id, worker: w.id, kind: 'dog',
                choices: [{ label: 'Text Kyle to grab him (+10 min)', act: 'kyle' }, { label: 'Work around him (+25 min, rougher stripes)', act: 'around' }] });
        }
    },

    answer(msgId, idx) {
        const m = this.s.phone.find(x => x.id === msgId);
        if (!m || m.resolved || !m.choices) return;
        const ch = m.choices[idx]; m.resolved = ch.label; m.read = true;
        if (m.kind === 'odd') {
            if (ch.act === 'odd_yes' && this.cust(m.odd) && (this.s.phase === 'morning' || this.s.phase === 'day')) {
                this.s.jobs.push(this.newJob(m.odd)); this.cs(m.odd).status = 'odd-today';
            }
            this.changed(); return;
        }
        const j = this.job(m.job), w = this.worker(m.worker);
        if (j && j.status === 'stuck') {
            j.status = 'working';
            const mower = w && this.s.gear.find(g => g.id === this.s.mowerFor[w.id]);
            if (ch.act === 'fix') { j.extra += 30; if (mower) mower.cond = Math.min(100, mower.cond + 5); }
            if (ch.act === 'rosa') { j.extra += N.rosaMin; this.spend(N.rosaCost, 'repairs'); if (mower) mower.cond = Math.min(100, mower.cond + N.rosaGain); }
            if (ch.act === 'kyle') { j.extra += 10; }
            if (ch.act === 'around') { j.extra += 25; j.rough = true; }
            if (w) w.clutch = (w.clutch || 0) + 1;
        }
        this.changed();
    },

    finishWorkerJob(w, j) {
        const c = this.cust(j.cust), y = yardOf(c.yard), P = w.stats, C = N.comp;
        const know = this.knowLevel(w.id, c.yard), k = this.comp(w.id) / 100;
        const cov = Math.min(1, lerp(C.covAt0, C.covAt100, k) + 0.003 * know + rnd(-0.012, 0.012));
        let stripes = 20 * clamp01(lerp(C.stripeAt0, C.stripeAt100, k) + rnd(-0.05, 0.05));
        if (w.traits.includes('Perfectionist')) stripes += 3;
        if (j.rough) stripes -= 4;
        stripes = Math.max(0, Math.min(20, stripes));
        const miss = lerp(C.missAt0, 0, k);
        const frac = { trim: null, edge: null, blow: null };
        for (const t of ['trim', 'edge', 'blow']) {
            if (!j.tasks.includes(t)) continue;
            if (!this.s.tools[TASK_TOOLS[t]]) { frac[t] = 0; continue; }
            if (t !== 'blow' && w.traits.includes('Corner Cutter') && Math.random() < 0.4) { frac[t] = 0.3; continue; }
            frac[t] = Math.random() < miss ? rnd(0.75, 0.92) : rnd(0.97, 1);
        }
        let hits = 0;
        const found = this.s.found[c.yard] || [];
        for (const h of y.hidden) {
            if (found.some(f => f.x === h.x && f.y === h.y)) continue;
            let p = 1 - lerp(C.spotAt0, C.spotAt100, k) - 0.03 * P.care; if (w.traits.includes('Rookie Nerves') && know === 0) p += 0.15;
            if (Math.random() < p) { hits++; }
            found.push({ x: h.x, y: h.y });   // found either way: hit it or spotted it
        }
        this.s.found[c.yard] = found;
        const parts = this.scoreParts(cov, stripes, frac, hits);
        w.end = this.s.clock;
        const res = this.completeJob(j, parts, w.id, hits);
        const xp = Math.round(N.xpBase * N.xpSize[y.size] * res.stars / 3 * (w.traits.includes('Eager') ? 1.1 : 1));
        w.xp += xp; const lv = this.levelFor(w.xp);
        if (lv > w.level) { w.level = lv; this.msg(w.name, `Hit level ${lv}! (${this.rank(lv)})`); }
        this.grow(w.id, y.size, res.stars);
        const m = this.s.gear.find(g => g.id === this.s.mowerFor[w.id]); if (m) m.cond = Math.max(0, m.cond - N.gear[m.type].wear);
    },

    // ---------- scoring (L02 section 5) ----------
    coveragePts(cov) { return 40 * clamp01((cov - N.coverageZero) / (N.coverageFull - N.coverageZero)); },
    scoreParts(cov, stripes, frac, hits) {
        const te = [frac.trim, frac.edge].filter(v => v !== null);
        return {
            coverage: Math.round(this.coveragePts(cov)),
            stripes: Math.round(stripes),
            trimEdge: Math.round(te.length ? 20 * te.reduce((a, b) => a + b, 0) / te.length : 20),
            cleanup: Math.round(frac.blow === null ? 10 : 10 * frac.blow),
            damage: Math.max(0, 10 - N.sprinklerPts * hits),
            cov,
        };
    },

    // Common end of any job: score, stars, pay, relationship, reputation, knowledge.
    completeJob(j, parts, person, hits) {
        const s = this.s, c = this.cust(j.cust), st = this.cs(j.cust);
        const score = parts.coverage + parts.stripes + parts.trimEdge + parts.cleanup + parts.damage;
        const stars = this.starsFor(score);
        j.status = 'done';
        const res = { score, stars, parts, person, pay: 0, tip: 0, rep: 0, repair: hits * N.sprinklerCost, relMsg: null };
        // pay
        if (c.start !== 'tutorial') {
            res.pay = j.price;
            const tipChance = c.tipChance ?? N.tipChance;
            if (stars >= c.expect + 0.5 && (st.rel >= 2 || c.tipChance) && Math.random() < tipChance) res.tip = Math.round(rnd(N.tip[0], N.tip[1]));
            this.earn(res.pay, 'income'); if (res.tip) this.earn(res.tip, 'tips');
        }
        if (res.repair) this.spend(res.repair, 'repairs');
        this.spend(N.gasPerYard, 'gas');
        // relationship (one-time jobs have none)
        if (c.start === 'odd') { st.status = 'odd-done'; st.day = s.week; }
        else if (c.start !== 'tutorial') {
            if (stars >= c.expect) {
                st.relXP++;
                if (N.relUp[st.rel] && st.relXP >= N.relUp[st.rel] && st.rel < 3) { st.rel++; st.relXP = 0; res.relMsg = `${c.name} ${['', 'is trying you out', 'is a regular now', 'trusts you now'][st.rel]}.`; }
            } else if (stars < c.expect - 1) {
                st.relXP = 0; st.strikes = (st.strikes || 0) + 1;
                if (st.rel > 1) { st.rel--; res.relMsg = `${c.name} wasn't happy.`; }
                else if (st.strikes > (c.patience ?? 1)) { st.status = 'lost'; res.relMsg = `${c.name} cancelled. They found someone else.`; this.msg(c.name, "We're going to go with someone else. Thanks anyway."); }
                else { res.relMsg = `${c.name} wasn't happy. One more like that and they'll find someone else.`; this.msg(c.name, `That wasn't great. I expected better.`); }
            }
        }
        // reputation (bad counts double, built into the table)
        let dr = c.start === 'odd' ? 0 : N.repStars[stars];   // one-time jobs are off Maple Street
        if (c.gossip) dr = Math.round(dr * c.gossip);
        res.rep = dr; this.addRep(dr);
        // knowledge, records
        s.know[person] = s.know[person] || {};
        s.know[person][c.yard] = (s.know[person][c.yard] || 0) + 1;
        st.visits++; st.lastStars = stars;
        j.result = res;
        s.dayLog.jobsDone.push({ cust: c.name, who: person === 'you' ? 'You' : (this.worker(person) || {}).name, stars, score, pay: res.pay, tip: res.tip, rep: dr, relMsg: res.relMsg });
        s.weekLog.jobs++; s.weekLog.stars += stars; s.totalJobs++;
        if (res.pay > 0) { mark('first paid job'); if (this.prospects().length) this.walt('knock'); }
        if (person !== 'you') mark('first worker job done');
        this.changed();
        return res;
    },

    addRep(d) {
        const before = this.s.rep;
        this.s.rep = Math.max(0, Math.min(100, this.s.rep + d));
        for (const m of N.unlockMarks) if (before < m && this.s.rep >= m) {
            if (m === 25) this.walt('rep25');
            mark('rep ' + m);
        }
    },
    earn(n, kind) { this.s.money += n; this.s.dayLog[kind] = (this.s.dayLog[kind] || 0) + n; this.s.weekLog[kind] = (this.s.weekLog[kind] || 0) + n; },
    spend(n, kind) { this.s.money -= n; this.s.dayLog[kind] = (this.s.dayLog[kind] || 0) + n; this.s.weekLog[kind] = (this.s.weekLog[kind] || 0) + n; },

    // ---------- your own jobs ----------
    // Everything the yard scene needs to set up this visit.
    visitFor(jobId) {
        const j = this.job(jobId), c = this.cust(j.cust), mower = this.s.gear.find(g => g.id === (this.s.mowerFor || {}).you) || this.bestMower();
        const found = (this.s.found[c.yard] || []);
        const breakdown = mower && this.openProblems() < N.maxOpenProblems && Math.random() * 100 < N.breakdownPct(mower.cond) ? rnd(0.25, 0.7) : null;
        return {
            jobId, cust: c, yard: yardOf(c.yard), tasks: j.tasks, price: j.price,
            known: found.map(f => ({ type: 'circle', x: f.x, y: f.y, r: 4, kind: 'sprinkler' })),
            hidden: yardOf(c.yard).hidden.filter(h => !found.some(f => f.x === h.x && f.y === h.y)),
            tools: Object.assign({}, this.s.tools),
            mowerSpeed: mower ? N.gear[mower.type].speed : 80, mowerId: mower && mower.id,
            breakdownAt: breakdown, dogOut: !!c.dog && Math.random() < N.dogOutChance,
            tutorial: c.start === 'tutorial', overgrown: !!c.overgrown,
            comp: this.comp('you'),
            minutes: this.jobMinutes('you', c.id, j.tasks, mower ? mower.type : null),
        };
    },

    goToJob(jobId) {
        const j = this.job(jobId);
        if (!j || j.assignee !== 'you' || j.status !== 'waiting' || this.s.phase !== 'day') return false;
        j.status = 'working';
        this.tick(N.driveMin);
        return true;
    },

    // r: { mowCov, stripes (0..20), wrongStripes, trimFrac, edgeFrac, blowFrac, hits, found:[{x,y}], mowerId }
    finishPlayerJob(jobId, r) {
        const j = this.job(jobId), c = this.cust(j.cust), y = yardOf(c.yard);
        const f = this.s.found[c.yard] = this.s.found[c.yard] || [];
        for (const h of r.found || []) if (!f.some(x => x.x === h.x && x.y === h.y)) f.push(h);
        const frac = { trim: j.tasks.includes('trim') ? r.trimFrac : null, edge: j.tasks.includes('edge') ? r.edgeFrac : null, blow: j.tasks.includes('blow') ? r.blowFrac : null };
        const stripes = r.stripes * (r.wrongStripes ? 0.5 : 1);
        const parts = this.scoreParts(r.mowCov, stripes, frac, r.hits);
        const res = this.completeJob(j, parts, 'you', r.hits);
        res.comp = this.grow('you', y.size, res.stars);
        const m = this.s.gear.find(g => g.id === r.mowerId); if (m) m.cond = Math.max(0, m.cond - N.gear[m.type].wear);
        mark('first yard mowed');
        if (c.start === 'tutorial') this.walt('firstPaid');
        return res;
    },

    // Breakdown in your own yard. Returns minutes lost.
    playerBreakdown(choice, mowerId) {
        const m = this.s.gear.find(g => g.id === mowerId);
        this.walt('breakdown');
        if (choice === 'fix') { if (m) m.cond = Math.min(100, m.cond + 5); this.tick(N.fixSelfMin); return N.fixSelfMin; }
        if (choice === 'rosa') { this.spend(N.rosaCost, 'repairs'); if (m) m.cond = Math.min(100, m.cond + N.rosaGain); this.tick(N.rosaMin); return N.rosaMin; }
        if (choice === 'walt') { this.tick(15); return 15; }
        return 0;
    },
    // You left the yard without finishing (mower broke, out of time): try again tomorrow.
    abandonJob(jobId) {
        const j = this.job(jobId); if (!j) return;
        j.status = 'waiting';
        this.changed();
    },

    // ---------- new customers ----------
    prospects() {
        return CUSTOMERS.filter(c => c.start === 'knock' && this.s.customers[c.id].status === 'prospect'
            && (c.needRep || 0) <= this.s.rep && this.s.customers[c.id].rejectedWeek !== this.s.week);
    },
    knock() {
        const s = this.s;
        if (s.phase !== 'day') return { none: true };
        this.tick(N.knockMin);
        s.knocks++;
        const list = this.prospects();
        if (!list.length) return { none: true, text: "Nobody on the street is looking for help right now. Your reputation opens more doors." };
        if (s.knocks > 1 && Math.random() < 0.3) return { none: true, text: "Nobody answered. Try again later." };
        const c = list[Math.floor(Math.random() * list.length)];
        s.quote = { cust: c.id, tries: 0, countered: false };
        this.walt('quote');
        return { cust: c };
    },
    quoteLimit(c) { return c.budget * (1 + Math.max(0, this.s.rep - 10) / 200); },
    // returns 'yes' | 'no' | 'gone' | { counter }
    offer(price, day) {
        const s = this.s, q = s.quote; if (!q) return 'gone';
        const c = this.cust(q.cust), st = this.cs(c.id), lim = this.quoteLimit(c);
        if (c.haggle && !q.countered) {
            q.countered = true;
            const counter = Math.min(price, Math.floor(lim)) - 5;
            if (price > counter) { q.counter = counter; q.day = day; return { counter }; }
        }
        if (price <= lim) { this.sign(c, price, day); return 'yes'; }
        q.tries++;
        if (q.tries >= 2) { st.rejectedWeek = s.week; s.quote = null; return 'gone'; }
        return 'no';
    },
    acceptCounter() { const q = this.s.quote; if (!q || !q.counter) return; this.sign(this.cust(q.cust), q.counter, q.day); },
    declineQuote() { const q = this.s.quote; if (q) this.cs(q.cust).rejectedWeek = this.s.week; this.s.quote = null; this.changed(); },
    sign(c, price, day) {
        const st = this.cs(c.id);
        Object.assign(st, { status: 'customer', rel: 1, relXP: 0, price, day });
        this.s.quote = null;
        this.msg(c.name, `Deal. $${price} every ${N.days[day]}. See you then.`);
        mark('first new customer');
        this.changed();
    },

    // ---------- crew ----------
    postHelpWanted() {
        const s = this.s; if (!this.canHire() || s.applicants) return;
        const pool = APPLICANTS.filter(a => !s.workers.some(w => w.name === a.name)).sort(() => Math.random() - 0.5).slice(0, 3);
        s.applicants = { pending: true, list: pool.map(a => a.name) };
        this.changed();
    },
    hire(name) {
        const s = this.s, a = APPLICANTS.find(x => x.name === name);
        if (!a || !this.canHire()) return;
        s.workers.push({ id: 'w' + s.workerId++, name: a.name, age: a.age, stats: Object.assign({}, a.stats), traits: a.traits.slice(), wage: a.wage,
            xp: 0, level: 1, comp: N.comp.fromStats(a.stats), morale: 70, clutch: 0, start: null, end: null, hired: `${s.week}-${s.day}` });
        s.know[s.workers[s.workers.length - 1].id] = {};
        s.applicants.list = s.applicants.list.filter(n => n !== name);
        if (!s.applicants.list.length || !this.canHire()) s.applicants = null;
        mark('first hire');
        this.walt('hired');
        this.changed();
    },
    buy(type) {
        const g = N.gear[type]; if (!g || this.s.money < g.price) return false;
        if (g.kind === 'mower') this.s.gear.push({ id: 'm' + (this.s.gear.length + 1), type, cond: 100, broken: false });
        else { if (this.s.tools[type]) return false; this.s.tools[type] = true; }
        this.spend(g.price, 'spent');
        this.changed();
        return true;
    },

    // ---------- end of day ----------
    endDay() {
        const s = this.s;
        if (s.phase !== 'day') return;
        s.phase = 'evening';
        for (const j of s.jobs) {
            if (j.status === 'done') continue;
            const c = this.cust(j.cust);
            if (c.start === 'tutorial') { s.carry.push({ id: j.id, cust: j.cust, price: 0, tasks: j.tasks }); continue; }
            if (c.start === 'odd') {
                s.dayLog.missed.push(c.name); this.addRep(-2); this.cs(j.cust).status = 'odd-done';
                this.msg(c.name, "You said today. Guess not."); continue;
            }
            if (j.late) {
                s.dayLog.missed.push(c.name); this.addRep(N.repMissed);
                const st = this.cs(j.cust); st.rel--; if (st.rel < 1) { st.status = 'lost'; this.msg(c.name, "You never showed. We found someone else."); }
            } else {
                s.carry.push({ id: j.id, cust: j.cust, price: j.price, tasks: j.tasks });
                s.dayLog.notes.push(`${c.name}'s yard moves to tomorrow. Miss it again and it counts as a missed visit.`);
            }
        }
        // wages for hours on the clock (first drive to last job)
        s.dayLog.wages = [];
        for (const w of s.workers) {
            if (w.start === null) continue;
            const hrs = Math.max(N.minPaidHours, ((w.end ?? Math.min(s.clock, N.dayEnd)) - w.start) / 60);
            const pay = Math.round(hrs * w.wage);
            s.wageOwed += pay; s.dayLog.wages.push({ name: w.name, hrs: Math.round(hrs * 10) / 10, pay });
        }
        s.dayLog.repEnd = s.rep;
        this.changed();
    },

    maintain(mowerId) {
        const m = this.s.gear.find(g => g.id === mowerId);
        if (!m || m.maintained) return;
        m.maintained = true; m.cond = Math.min(100, m.cond + N.maintenanceGain);
        this.spend(N.maintenanceCost, 'repairs');
        this.changed();
    },

    nextDay() {
        const s = this.s;
        for (const g of s.gear) g.maintained = false;
        if (s.day === 4) {
            // payday and the weekend summary
            s.money -= s.wageOwed; s.weekLog.wages = s.wageOwed; s.wageOwed = 0;
            s.phase = 'weekend';
            this.walt('weekend');
            this.save(); this.changed();
            return;
        }
        s.day++;
        this.startMorning();
        this.save();
    },
    nextWeek() {
        const s = this.s;
        s.week++; s.day = 0;
        this.startMorning();
        this.save();
    },
};
