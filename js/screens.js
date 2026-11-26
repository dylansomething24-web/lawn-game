// Everything outside the yard: title, morning plan, the street, evening and weekend summaries,
// and the sheets that slide up (phone, quotes, crew, Rosa's shop, calendar, menu).
const REL = ['Prospect', 'Trial', 'Regular', 'Trusted', 'Loyal', 'Advocate'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
const starStr = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const hex = n => '#' + n.toString(16).padStart(6, '0');

const Screens = {
    cur: 'title', sheetOpen: false, paused: false, lastHtml: '', renderAt: 0,

    $(id) { return document.getElementById(id); },

    init() {
        this.$('h-phone').onclick = () => { Sound.init(); this.phone(); };
        this.$('h-menu').onclick = () => { Sound.init(); this.menu(); };
        this.$('screen').addEventListener('click', e => this.onClick(e));
        this.$('sheet').addEventListener('click', e => this.onClick(e));
        this.$('modal').addEventListener('click', e => { if (e.target.id === 'modal' && this.sheetClosable) this.closeSheet(); });
        Game.onChange(() => this.changed());
        document.addEventListener('visibilitychange', () => { if (document.hidden && Game.s && this.cur !== 'title') Game.save(); });
        setInterval(() => this.loop(), 200);
        this.title();
    },

    // ---------- the clock ----------
    loop() {
        const s = Game.s; if (!s) return;
        if (this.cur === 'street' || this.cur === 'yard' || this.cur === 'morning') s.playSec = (s.playSec || 0) + 0.2;
        if (this.cur === 'street' && s.phase === 'day' && !this.sheetOpen && !this.paused) {
            Game.tick(0.2 * N.gameMinPerSec);
            if (Game.shouldEndDay()) this.endDay();
        }
        this.hud();
    },

    changed() {
        this.hud();
        if (this.cur !== 'street' || this.sheetOpen) return;
        const now = performance.now();
        if (now - this.renderAt < 400) return;
        this.renderAt = now;
        this.street(true);
    },

    hud() {
        const s = Game.s; if (!s) return;
        this.$('h-day').textContent = `${N.days[s.day].slice(0, 3)} · Wk ${s.week}`;
        this.$('h-clock').textContent = s.phase === 'day' ? Game.clockText(s.clock) + (this.paused && this.cur === 'street' ? ' ⏸' : '') : s.phase === 'morning' ? 'Morning' : s.phase === 'evening' ? 'Evening' : 'Weekend';
        const m = this.$('h-money'); m.textContent = money(s.money); m.classList.toggle('neg', s.money < 0);
        const n = Game.unread(), b = this.$('h-badge'); b.hidden = !n; b.textContent = n;
    },

    // ---------- clicks: every button carries data-act ----------
    onClick(e) {
        const el = e.target.closest('[data-act]'); if (!el) return;
        Sound.init();
        const a = el.dataset.act, v = el.dataset.v;
        const acts = {
            newgame: () => this.confirmNew(el),
            cont: () => { if (Game.load()) this.show(); },
            loadcode: () => this.importSheet(),
            startday: () => { Game.startDay(); this.show(); },
            assign: () => { Game.cycleAssignee(+v); this.render(); },
            go: () => this.goYard(+v),
            knock: () => this.knock(),
            crew: () => this.crew(), shop: () => this.shop(), cal: () => this.calendar(), phone: () => this.phone(),
            pause: () => { this.paused = !this.paused; this.render(); this.hud(); },
            wrap: () => this.wrapUp(),
            endday: () => this.endDay(),
            maintain: () => { Game.maintain(v); this.render(); },
            nextday: () => { Game.nextDay(); this.show(); },
            nextweek: () => { Game.nextWeek(); this.show(); },
            answer: () => { const [id, i] = v.split(':').map(Number); Game.answer(id, i); this.phone(); },
            hire: () => { Game.hire(v); this.crew(); },
            post: () => { Game.postHelpWanted(); this.crew(); },
            buy: () => { if (Game.buy(v)) { if (Sound.cash) Sound.cash(); } this.shop(); },
            close: () => this.closeSheet(),
            price: () => { this.q.price = Math.max(5, this.q.price + +v); this.quoteSheet(); },
            qday: () => { this.q.day = +v; this.quoteSheet(); },
            offer: () => this.offer(),
            take: () => { Game.acceptCounter(); this.quoteDone(`Deal at $${this.q.counter}.`); },
            walk: () => { Game.declineQuote(); this.closeSheet(); },
            result: () => { this.closeSheet(); this.leaveYard(); },
            exportsave: () => this.exportSheet(), importsave: () => this.importSheet(),
            doimport: () => this.doImport(),
            sound: () => { this.$('btn-sound').click(); this.menu(); },
            tips: () => this.tipsSheet(),
            menu: () => this.menu(),
        };
        if (acts[a]) acts[a]();
    },

    // ---------- which screen ----------
    show() {
        const s = Game.s;
        this.closeSheet();
        if (s.phase === 'morning') this.morning();
        else if (s.phase === 'day') this.street();
        else if (s.phase === 'evening') this.evening();
        else this.weekend();
        this.hud();
    },
    render() { if (['morning', 'street', 'evening', 'weekend'].includes(this.cur)) { this.lastHtml = ''; this[this.cur](); } },
    put(html, dock) {
        const sc = this.$('screen');
        sc.innerHTML = html + (dock ? `<div class="dock">${dock}</div>` : '');
        this.$('yardview').hidden = true; sc.hidden = false;
    },

    title() {
        this.cur = 'title';
        const has = Game.hasSave();
        this.put(`<div class="title"><h1>Cut Above</h1><div class="sub">A lawn care company, one yard at a time.</div>
            <div class="stripes"></div>
            <div class="btns" style="grid-template-columns:1fr;max-width:300px;margin:0 auto">
            ${has ? '<button class="btn go" data-act="cont">Continue</button>' : ''}
            <button class="btn ${has ? 'alt' : 'go'}" data-act="newgame">New game</button>
            <button class="btn alt" data-act="loadcode">Load a save code</button></div>
            <p class="sub" style="margin-top:18px">Test build: automatic mowing. Maple Street.</p></div>`);
        this.$('h-day').textContent = ''; this.$('h-clock').textContent = ''; this.$('h-money').textContent = '';
    },
    confirmNew(el) {
        if (Game.hasSave() && !el.dataset.armed) { el.dataset.armed = 1; el.textContent = 'Erase your save and start over?'; return; }
        Game.newGame(); Game.save();
        try { localStorage.removeItem('cutabove_pacing'); } catch (e) { }
        this.show();
    },

    repBar() {
        const r = Game.s.rep;
        const ticks = N.unlockMarks.map(m => `<span style="position:absolute;left:${m}%;top:-14px;font-size:.65rem;color:#6a6658;transform:translateX(-50%)">${m}</span>`).join('');
        return `<div class="rep">Maple Street <div class="bar" style="position:relative;overflow:visible"><i style="width:${r}%"></i>${ticks}</div> ${r}</div>`;
    },

    houseIcon(c) {
        const y = c.yard ? yardOf(c.yard) : null;
        const wall = y ? hex(y.house.wall) : '#ddd', roof = y ? hex(y.house.roof) : '#999';
        return `<div class="house" style="background:${wall};--roof:${roof}"><span>${c.house || '•'}</span></div>`;
    },

    jobStatus(j) {
        const s = Game.s;
        if (j.status === 'done') return `<span class="status done">${starStr(j.result.stars)}</span>`;
        if (j.assignee === 'you') return `<span class="status you">You</span>`;
        const w = Game.worker(j.assignee), nm = w ? w.name : '?';
        if (s.phase !== 'day' || j.status === 'waiting') return `<span class="status crew">${esc(nm)}${s.phase === 'day' ? ' · later' : ''}</span>`;
        if (j.status === 'stuck') return `<span class="status stuck">${esc(nm)} needs you!</span>`;
        if (j.status === 'driving') return `<span class="status crew">${esc(nm)} driving</span>`;
        return `<span class="status crew">${esc(nm)} working</span>`;
    },

    jobCard(j, mode) {
        const c = Game.cust(j.cust), s = Game.s;
        const tasks = j.tasks.map(t => ({ mow: 'Mow', trim: 'Trim', edge: 'Edge', blow: 'Blow' })[t]).join(' · ');
        let extra = '';
        if (mode === 'morning' && j.status === 'waiting' && s.workers.length) extra = `<button class="btn mini alt" data-act="assign" data-v="${j.id}">${j.assignee === 'you' ? 'You' : esc(Game.worker(j.assignee).name)} ▸</button>`;
        if (mode === 'day' && j.status === 'waiting' && j.assignee === 'you') extra = `<button class="btn mini go" data-act="go" data-v="${j.id}">Go mow</button>`;
        let bar = '';
        if (mode === 'day' && j.assignee !== 'you' && (j.status === 'working' || j.status === 'stuck') && j.need) {
            const p = Math.min(100, Math.round(j.progress / (j.need + (j.extra || 0)) * 20) * 5);
            bar = `<div class="bar"><i style="width:${p}%"></i></div>`;
        }
        const late = j.late ? ' <span class="small" style="color:#d94a3a">from yesterday</span>' : '';
        const odd = c.start === 'odd' ? ' <span class="small">one-time</span>' : '';
        return `<div class="card"><div class="row">${this.houseIcon(c)}<div class="grow"><div class="name">${esc(c.name)}${late}${odd}</div>
            <div class="small">${tasks}${j.price ? ' · $' + j.price : ' · free'} · ${yardOf(c.yard).size}</div>${bar}</div>
            ${extra || this.jobStatus(j)}</div></div>`;
    },

    // ---------- morning ----------
    morning() {
        this.cur = 'morning';
        const s = Game.s, plan = Game.mowerPlan();
        const jobs = s.jobs.map(j => this.jobCard(j, 'morning')).join('') || '<div class="card sub">No jobs today. Knock on doors, or answer the phone: neighbors sometimes need a one-time mow.</div>';
        const people = Object.keys(plan);
        const gear = people.map(p => {
            const nm = p === 'you' ? 'You' : Game.worker(p).name, m = s.gear.find(g => g.id === plan[p]);
            return `<div class="small">${esc(nm)}: ${m ? esc(N.gear[m.type].name) + ` (condition ${m.cond})` : '<b style="color:#d94a3a">no mower! Their jobs go to you.</b>'}</div>`;
        }).join('');
        const unanswered = s.phone.filter(m => m.choices && !m.resolved).length;
        this.put(`<h1>${Game.dayName()} morning</h1><div class="sub">Week ${s.week}${s.workers.length ? ` · crew of ${s.workers.length + 1}` : ''}</div>
            <div class="card" style="margin-top:10px">${this.repBar()}</div>
            ${unanswered ? `<div class="card" style="background:#fff3c4"><div class="row"><div class="grow"><b>📱 ${unanswered} message${unanswered > 1 ? 's' : ''} waiting for an answer</b></div><button class="btn mini" data-act="phone">Open</button></div></div>` : ''}
            <h2>Today's jobs</h2>${jobs}
            ${s.workers.length ? '<div class="sub" style="margin:-2px 0 6px">Tap a name to change who does the job.</div>' : ''}
            ${gear ? `<h2>Mowers</h2><div class="card">${gear}</div>` : ''}`,
            `<button class="btn alt" data-act="cal">Week</button><button class="btn alt" data-act="crew">Crew</button><button class="btn alt" data-act="shop">Rosa's</button><button class="btn go" data-act="startday">Start the day</button>`);
    },

    // ---------- the street (the day) ----------
    street(soft) {
        this.cur = 'street';
        const s = Game.s;
        for (const j of s.jobs) if (j.assignee === 'you' && j.status === 'working') j.status = 'waiting';   // left a yard without finishing
        const mine =s.jobs.filter(j => j.assignee === 'you'), crew = s.jobs.filter(j => j.assignee !== 'you');
        const left = mine.filter(j => j.status !== 'done').length, crewLeft = crew.filter(j => j.status !== 'done').length;
        const houses = [...CUSTOMERS.filter(c => c.house), ...LOCKED_HOUSES].sort((a, b) => a.house - b.house).map(c => {
            if (!c.id) return `<div class="card" style="opacity:.7"><div class="row">${this.houseIcon(c)}<div class="grow"><div class="name">${esc(c.name)}</div><div class="small">${esc(c.note)}</div></div><span class="status">Not yet</span></div></div>`;
            const st = s.customers[c.id];
            let tag;
            if (st.status === 'customer') tag = `<span class="status done">${REL[st.rel]} · ${N.days[st.day].slice(0, 3)}</span>`;
            else if (st.status === 'tutorial') tag = `<span class="status">Walt</span>`;
            else if (st.status === 'lost') tag = `<span class="status bad">Lost</span>`;
            else if ((c.needRep || 0) > s.rep) tag = `<span class="status">Needs rep ${c.needRep}</span>`;
            else tag = `<span class="status wait">Knock?</span>`;
            return `<div class="card"><div class="row">${this.houseIcon(c)}<div class="grow"><div class="name">${esc(c.name)}</div><div class="small">${esc(c.who)}${st.status === 'customer' ? ' · $' + st.price : ''}</div></div>${tag}</div></div>`;
        }).join('');
        const late = s.clock >= N.dayEnd;
        const html = `${this.repBar()}
            <h2>Your jobs ${left ? `<span class="sub">(${left} left)</span>` : ''}</h2>
            ${mine.map(j => this.jobCard(j, 'day')).join('') || '<div class="card sub">Nothing assigned to you today.</div>'}
            ${crew.length ? `<h2>Crew ${crewLeft ? `<span class="sub">(${crewLeft} left)</span>` : ''}</h2>${crew.map(j => this.jobCard(j, 'day')).join('')}` : ''}
            ${!left ? `<div class="card" style="background:#f3f9e8"><div class="row"><div class="grow"><b>${crewLeft ? 'Your jobs are done.' : 'Everything is done for today.'}</b><div class="small">${crewLeft ? 'Knock on doors, or wrap up and let the crew finish.' : 'Knock on doors for new customers, or call it a day.'}</div></div><button class="btn mini go" data-act="wrap">Wrap up the day</button></div></div>` : ''}
            <h2>Maple Street</h2>${houses}`;
        const dock = `<button class="btn alt" data-act="knock" ${s.clock > N.dayEnd - N.knockMin ? 'disabled' : ''}>Knock (30m)</button><button class="btn alt" data-act="crew">Crew</button><button class="btn alt" data-act="shop">Rosa's</button><button class="btn alt" data-act="pause">${this.paused ? '▶' : '⏸'}</button>`;
        const full = html + dock;
        if (soft && full === this.lastHtml) return;
        this.lastHtml = full;
        const sc = this.$('screen'), top = sc.scrollTop;
        this.put(html, dock);
        sc.scrollTop = top;
        if (late) this.endDay();
    },

    // ---------- going into a yard ----------
    goYard(jobId) {
        if (!Game.goToJob(jobId)) return;
        const visit = Game.visitFor(jobId);
        this.cur = 'yard'; this.paused = false;
        this.$('screen').hidden = true; this.$('yardview').hidden = false;
        game.scale.refresh();
        UI.shown = Object.assign({}, UI.shown, { start: Game.s.totalJobs > 0, tutorial: false, dog: false, overgrown: false });
        game.scene.stop('idle');
        game.scene.start('yard', visit);
        if (visit.tutorial) Game.walt('firstYard');
    },
    yardDone(visit, r) {
        if (visit.practice) return;
        const res = Game.finishPlayerJob(visit.jobId, r);
        if (Sound.cash && res.pay) Sound.cash();
        const p = res.parts, c = visit.cust;
        const line = (label, got, max, note) => `<tr><td>${label}${note ? ` <span class="small">${note}</span>` : ''}</td><td>${got} / ${max}</td></tr>`;
        const te = visit.tasks.filter(t => t === 'trim' || t === 'edge');
        this.sheet(`<div class="result"><h2>${esc(c.name)}</h2>
            <span class="stars">${starStr(res.stars)}</span><div class="big">${res.score}</div>
            <table class="sum">
            ${line('Coverage', p.coverage, 40, Math.floor(r.mowCov * 1000) / 10 + '% mowed')}
            ${line('Stripes', p.stripes, 20, r.wrongStripes ? `wanted ${r.pref === 'v' ? 'up-and-down' : 'side-to-side'}` : '')}
            ${line('Trim and edge', p.trimEdge, 20, te.length ? '' : 'not ordered')}
            ${line('Cleanup', p.cleanup, 10, visit.tasks.includes('blow') ? '' : 'not ordered')}
            ${line('No damage', p.damage, 10, r.hits ? r.hits + ' sprinkler head' + (r.hits > 1 ? 's' : '') : r.spotted ? 'spotted ' + r.spotted + ' sprinkler head' + (r.spotted > 1 ? 's' : '') : '')}
            ${res.pay ? `<tr><td>Paid</td><td class="pos">+$${res.pay}</td></tr>` : ''}
            ${res.tip ? `<tr><td>Tip</td><td class="pos">+$${res.tip}</td></tr>` : ''}
            ${res.repair ? `<tr><td>Sprinkler repair</td><td class="neg">-$${res.repair}</td></tr>` : ''}
            <tr><td>Maple Street reputation</td><td class="${res.rep >= 0 ? 'pos' : 'neg'}">${res.rep >= 0 ? '+' : ''}${res.rep}</td></tr>
            </table>
            ${c.expect && c.start !== 'tutorial' && c.start !== 'odd' ? `<p class="small" style="margin-top:8px">${esc(c.name)} expects ${c.expect} stars.</p>` : ''}
            ${res.relMsg ? `<p style="margin-top:6px"><b>${esc(res.relMsg)}</b></p>` : ''}
            ${res.comp ? `<p class="small" style="margin-top:6px">Your competence: ${res.comp[0].toFixed(1)} → <b>${res.comp[1].toFixed(1)}</b></p>` : ''}
            <button class="btn go full" style="margin-top:12px" data-act="result">Back to the street</button></div>`, false);
    },
    leaveYard() {
        Sound.engine('off', false);
        UI.releaseHold();
        this.$('hint').classList.remove('show');
        UI.extra(null);
        game.scene.stop('yard'); game.scene.start('idle');
        this.cur = 'street';
        this.$('yardview').hidden = true; this.$('screen').hidden = false;
        this.lastHtml = '';
        if (Game.shouldEndDay()) this.endDay(); else this.street();
        Game.save();
    },

    knock() {
        const r = Game.knock();
        if (r.none) { UI.say(r.text || "Nobody's interested right now."); this.street(); return; }
        const c = r.cust;
        this.q = { price: Game.suggestedPrice(c), day: this.quietDay(), c };
        this.quoteSheet();
    },
    quietDay() {
        const counts = [0, 0, 0, 0, 0];
        for (const k in Game.s.customers) { const st = Game.s.customers[k]; if (st.status === 'customer' && st.day !== null) counts[st.day]++; }
        return counts.indexOf(Math.min(...counts));
    },
    quoteSheet(msg) {
        const q = this.q, c = q.c, y = yardOf(c.yard), sug = Game.suggestedPrice(c);
        const counts = [0, 0, 0, 0, 0];
        for (const k in Game.s.customers) { const st = Game.s.customers[k]; if (st.status === 'customer' && st.day !== null) counts[st.day]++; }
        this.sheet(`<h2>${esc(c.name)} <button class="btn mini alt x" data-act="walk">Walk away</button></h2>
            <div class="card"><div class="row">${this.houseIcon(c)}<div class="grow"><b>${esc(c.who)}</b><div class="small">${esc(c.blurb)}</div></div></div></div>
            <div class="card"><div class="small">${y.size[0].toUpperCase() + y.size.slice(1)} yard · wants ${c.tasks.join(', ')} · weekly</div>
            <div class="small">Suggested price: <b>$${sug}</b></div>
            <div class="stepper"><button class="btn mini alt" data-act="price" data-v="-5">−5</button><b>$${q.price}</b><button class="btn mini alt" data-act="price" data-v="5">+5</button></div>
            <div class="small">Which day each week? (number of yards already on that day)</div>
            <div class="daypick">${N.days.map((d, i) => `<button class="${q.day === i ? 'on' : ''}" data-act="qday" data-v="${i}">${d.slice(0, 3)}<br>${counts[i]}</button>`).join('')}</div></div>
            ${msg ? `<div class="card" style="background:#fff3c4">${msg}</div>` : ''}
            ${q.counter ? `<div class="btns"><button class="btn go" data-act="take">Take $${q.counter}</button><button class="btn alt" data-act="walk">No deal</button></div>`
                : `<button class="btn go full" data-act="offer">Offer $${q.price} every ${N.days[q.day]}</button>`}`, false);
    },
    offer() {
        const r = Game.offer(this.q.price, this.q.day), c = this.q.c;
        if (r === 'yes') { if (Sound.cash) Sound.cash(); this.quoteDone(`${c.name} said yes: $${this.q.price} every ${N.days[this.q.day]}.`); }
        else if (r === 'gone') { this.closeSheet(); UI.say(`${c.name}: "Too rich for me. Maybe another time."`); this.street(); }
        else if (r === 'no') this.quoteSheet(`"$${this.q.price}? That's more than I want to spend." Try a lower price.`);
        else if (r && r.counter) { this.q.counter = r.counter; this.quoteSheet(`"How about $${r.counter}? Cash, every time."`); }
    },
    quoteDone(text) { this.closeSheet(); UI.say(text); this.street(); },

    wrapUp() {
        // let the crew finish (time flies), then end the day
        const s = Game.s;
        while (s.phase === 'day' && s.clock < N.dayEnd && s.jobs.some(j => j.assignee !== 'you' && j.status !== 'done' && j.status !== 'stuck')) Game.tick(5);
        if (s.jobs.some(j => j.status === 'stuck')) { this.street(); this.phone(); UI.say('Someone on the crew needs an answer first.'); return; }
        this.endDay();
    },

    endDay() {
        if (Game.s.phase !== 'day') return;
        if (this.cur === 'yard') return;   // finish your yard first; overtime is fine
        Game.endDay();
        this.show();
    },

    // ---------- evening ----------
    evening() {
        this.cur = 'evening';
        const s = Game.s, L = s.dayLog;
        const rows = L.jobsDone.map(j => `<tr><td>${esc(j.cust)} <span class="small">${esc(j.who)}</span><br><span class="stars" style="font-size:.85rem">${starStr(j.stars)}</span> <span class="small">${j.score}</span>${j.relMsg ? `<br><span class="small">${esc(j.relMsg)}</span>` : ''}</td><td>${j.pay ? '+$' + j.pay : ''}${j.tip ? `<br><span class="small">+$${j.tip} tip</span>` : ''}</td></tr>`).join('');
        const mowers = Game.mowers().map(m => `<div class="row" style="margin:4px 0"><div class="grow">${esc(N.gear[m.type].name)} <span class="small">condition ${m.cond}${m.cond < 50 ? ' · breaks down often' : ''}</span></div>
            <button class="btn mini ${m.maintained ? '' : 'alt'}" data-act="maintain" data-v="${m.id}" ${m.maintained || m.cond >= 100 ? 'disabled' : ''}>${m.maintained ? 'Done ✓' : `Maintain $${N.maintenanceCost} (+${N.maintenanceGain})`}</button></div>`).join('');
        const dr = L.repEnd - L.repStart;
        this.put(`<h1>${Game.dayName()} evening</h1><div class="sub">Week ${s.week}</div>
            <h2>Jobs</h2><div class="card"><table class="sum">${rows || '<tr><td class="sub">No jobs finished today.</td><td></td></tr>'}</table>
            ${L.missed.length ? `<p class="neg" style="margin-top:6px"><b>Missed:</b> ${L.missed.map(esc).join(', ')}</p>` : ''}
            ${L.notes.map(n => `<p class="small" style="margin-top:6px">${esc(n)}</p>`).join('')}</div>
            <h2>Money</h2><div class="card"><table class="sum">
            <tr><td>Paid for jobs</td><td class="pos">+$${L.income || 0}</td></tr>
            ${L.tips ? `<tr><td>Tips</td><td class="pos">+$${L.tips}</td></tr>` : ''}
            <tr><td>Gas</td><td class="neg">-$${L.gas || 0}</td></tr>
            ${L.repairs ? `<tr><td>Repairs and upkeep</td><td class="neg">-$${L.repairs}</td></tr>` : ''}
            ${L.spent ? `<tr><td>Bought at Rosa's</td><td class="neg">-$${L.spent}</td></tr>` : ''}
            ${(L.wages || []).map(w => `<tr><td>${esc(w.name)}: ${w.hrs} h <span class="small">paid Friday</span></td><td>$${w.pay}</td></tr>`).join('')}
            <tr><td><b>Cash now</b></td><td class="${s.money < 0 ? 'neg' : ''}">${money(s.money)}</td></tr></table>
            ${s.money < 0 ? '<p class="small" style="margin-top:6px">Walt is covering you for now. Pay him back when you can.</p>' : ''}</div>
            <div class="card">${this.repBar()}<div class="small" style="margin-top:4px">${dr >= 0 ? '+' : ''}${dr} today</div></div>
            <h2>End-of-day upkeep</h2><div class="card">${mowers}<div class="small">Maintenance takes 15 minutes after work and keeps breakdowns down.</div></div>`,
            `<button class="btn go" data-act="nextday">${s.day === 4 ? 'On to the weekend' : 'Next day'}</button>`);
    },

    // ---------- weekend ----------
    weekend() {
        this.cur = 'weekend';
        const s = Game.s, W = s.weekLog;
        const net = (W.income || 0) + (W.tips || 0) - (W.wages || 0) - (W.gas || 0) - (W.repairs || 0) - (W.spent || 0);
        const avg = W.jobs ? (W.stars / W.jobs).toFixed(1) : '-';
        const next = N.days.map((d, i) => {
            const names = CUSTOMERS.filter(c => s.customers[c.id].status === 'customer' && s.customers[c.id].day === i).map(c => c.name);
            return `<tr><td>${d}</td><td style="text-align:left;font-weight:400">${names.map(esc).join(', ') || '<span class="small">open</span>'}</td></tr>`;
        }).join('');
        this.put(`<h1>Week ${s.week} is done</h1><div class="sub">Payday. Workers got paid.</div>
            <h2>The week</h2><div class="card"><table class="sum">
            <tr><td>Jobs</td><td>${W.jobs} · avg ${avg} ★</td></tr>
            <tr><td>Paid for jobs</td><td class="pos">+$${W.income || 0}</td></tr>
            <tr><td>Tips</td><td class="pos">+$${W.tips || 0}</td></tr>
            <tr><td>Wages</td><td class="neg">-$${W.wages || 0}</td></tr>
            <tr><td>Gas</td><td class="neg">-$${W.gas || 0}</td></tr>
            <tr><td>Repairs and upkeep</td><td class="neg">-$${W.repairs || 0}</td></tr>
            <tr><td>Equipment</td><td class="neg">-$${W.spent || 0}</td></tr>
            <tr><td><b>Net</b></td><td class="${net >= 0 ? 'pos' : 'neg'}">${money(net)}</td></tr>
            <tr><td><b>Cash</b></td><td>${money(s.money)}</td></tr></table></div>
            <div class="card">${this.repBar()}<div class="small" style="margin-top:4px">Started the week at ${W.repStart}.</div></div>
            <h2>Next week</h2><div class="card"><table class="sum">${next}</table></div>`,
            `<button class="btn go" data-act="nextweek">Start week ${s.week + 1}</button>`);
    },

    // ---------- sheets ----------
    sheet(html, closable = true) {
        this.$('sheet').innerHTML = html;
        this.$('modal').hidden = false; this.sheetOpen = true; this.sheetClosable = closable;
        if (this.cur === 'yard' && UI.scene) { UI.releaseHold(); UI.scene.paused = true; }
    },
    closeSheet() {
        this.$('modal').hidden = true; this.sheetOpen = false; this.$('sheet').innerHTML = '';
        if (this.cur === 'yard' && UI.scene && !UI.scene.broke) UI.scene.paused = false;
        if (this.cur === 'street') { this.lastHtml = ''; this.street(); }
        else if (this.cur === 'morning') this.morning();
    },
    head(t) { return `<h2>${t}<button class="btn mini alt x" data-act="close">Close</button></h2>`; },

    phone() {
        const s = Game.s; if (!s) return;
        const list = s.phone.slice(0, 30).map(m => {
            const unread = !m.read && !(m.choices && !m.resolved) ? (m.read = true, true) : false;
            const open = m.choices && !m.resolved;
            const when = `${N.days[m.day].slice(0, 3)} ${Game.clockText(m.time)}`;
            return `<div class="msg ${open || unread ? 'unread' : ''}"><span class="when">${when}</span><div class="from">${m.walt ? '👴 ' : ''}${esc(m.from)}</div><div>${esc(m.text)}</div>
                ${open ? `<div class="choices">${m.choices.map((c, i) => `<button class="btn mini ${i === 0 ? 'go' : 'alt'}" data-act="answer" data-v="${m.id}:${i}">${esc(c.label)}</button>`).join('')}</div>` : ''}
                ${m.resolved && m.choices ? `<div class="resolved">${esc(m.resolved)}</div>` : ''}</div>`;
        }).join('');
        this.sheet(this.head('📱 Phone') + (list || '<div class="sub">No messages.</div>'));
        this.hud();
    },

    crew() {
        const s = Game.s;
        const statRow = (st, show) => Object.keys(st).map(k => `<span class="stat">${k} <b>${show && !show.includes(k) ? '?' : st[k]}</b></span>`).join('');
        const compBar = v => `<div class="row" style="margin:4px 0"><span class="small" style="width:100px">Competence <b>${Math.floor(v)}</b></span><div class="bar grow" style="margin:0"><i style="width:${v}%"></i></div></div>`;
        const workers = s.workers.map(w => `<div class="card"><div class="row"><div class="grow"><span class="name">${esc(w.name)}</span> <span class="small">${w.age} · ${Game.rank(w.level)} L${w.level} · ${w.xp} xp · $${w.wage}/h</span></div></div>${compBar(Game.comp(w.id))}
            <div>${statRow(w.stats)}</div><div>${w.traits.map(t => `<span class="trait" title="${esc(TRAIT_TEXT[t] || '')}">${esc(t)}</span>`).join('')}</div>
            <div class="small">${w.traits.map(t => esc(TRAIT_TEXT[t] || '')).join(' ')}</div></div>`).join('');
        let hiring = '';
        if (!s.hireUnlocked) hiring = `<div class="card sub">Hiring opens in week ${N.hireUnlockWeek}. For now it's just you.</div>`;
        else if (s.workers.length >= N.maxWorkers) hiring = `<div class="card sub">Your crew is full for now (${N.maxWorkers} workers).</div>`;
        else if (!s.applicants) hiring = `<div class="card"><div class="small">Post a help wanted flyer on the board at Rosa's. People answer by the next morning.</div><button class="btn go full" style="margin-top:8px" data-act="post">Post help wanted (free)</button></div>`;
        else if (s.applicants.pending) hiring = `<div class="card sub">Your flyer is up at Rosa's. Answers come in tomorrow morning.</div>`;
        else hiring = s.applicants.list.map(n => {
            const a = APPLICANTS.find(x => x.name === n);
            return `<div class="card"><div class="row"><div class="grow"><span class="name">${esc(a.name)}</span> <span class="small">${a.age} · asks $${a.wage}/h</span></div><button class="btn mini go" data-act="hire" data-v="${esc(a.name)}">Hire</button></div>
                <div class="small">${esc(a.line)}</div><div>${statRow(a.stats, SHOWN_STATS[a.name])}</div>
                <div><span class="trait">${esc(a.traits[0])}</span><span class="trait">?</span> <span class="small">${esc(TRAIT_TEXT[a.traits[0]] || '')}</span></div></div>`;
        }).join('');
        const mowers = Game.mowers().length;
        this.sheet(this.head('Crew') + `<div class="card"><b>You</b><div class="small">Owner. Runs the jobs and answers the phone.</div>${compBar(Game.comp('you'))}<div class="small">Competence makes jobs faster and cleaner. It grows with every job.</div></div>${workers}
            <h2>Hiring</h2>${hiring}
            <div class="small" style="margin-top:4px">Each worker needs a mower to work. You have ${mowers}. Workers are paid by the hour for the time they work (at least ${N.minPaidHours} hours), every Friday.</div>`);
    },

    shop() {
        const s = Game.s;
        const items = ['selfprop', 'trimmer', 'edger', 'blower'].map(k => {
            const g = N.gear[k], owned = g.kind === 'tool' && s.tools[k];
            const have = g.kind === 'mower' ? Game.mowers().filter(m => m.type === k).length : 0;
            const why = { selfprop: `Faster than Walt's push mower and breaks down less. A worker needs one.${have ? ` You have ${have}.` : ''}`,
                trimmer: 'For everything the mower can\'t reach.', edger: 'Clean lines along the sidewalk, walk and driveway.', blower: 'Blows the clippings off the concrete.' }[k];
            return `<div class="card"><div class="row"><div class="grow"><span class="name">${esc(g.name)}</span> <span class="small">$${g.price}</span><div class="small">${why}</div></div>
                ${owned ? '<span class="status done">Owned</span>' : `<button class="btn mini go" data-act="buy" data-v="${k}" ${s.money < g.price ? 'disabled' : ''}>Buy</button>`}</div></div>`;
        }).join('');
        const mowers = Game.mowers().map(m => `<div class="small">${esc(N.gear[m.type].name)}: condition ${m.cond}</div>`).join('');
        this.sheet(this.head("Rosa's Hardware") + `<div class="sub" style="margin-bottom:8px">"Cash only. No refunds. Treat it right and it'll last."</div>${items}
            <h2>Your mowers</h2><div class="card">${mowers}<div class="small" style="margin-top:4px">A mower in bad shape breaks down more. Maintain it at the end of the day.</div></div>`);
    },

    calendar() {
        const s = Game.s;
        const days = N.days.map((d, i) => {
            const list = CUSTOMERS.filter(c => s.customers[c.id].status === 'customer' && s.customers[c.id].day === i);
            return `<div class="card" ${i === s.day ? 'style="background:#f3f9e8"' : ''}><b>${d}</b>${i === s.day ? ' <span class="small">today</span>' : ''}
                <div class="small">${list.map(c => `${esc(c.name)} ($${s.customers[c.id].price}, ${yardOf(c.yard).size})`).join('<br>') || 'Open'}</div></div>`;
        }).join('');
        this.sheet(this.head(`Week ${s.week}`) + days + '<div class="small">One-time jobs come in by phone in the morning and only show up the day they\'re for.</div>');
    },

    menu() {
        this.sheet(this.head('Menu') + `<div class="btns" style="grid-template-columns:1fr">
            <button class="btn alt" data-act="tips">Walt's notebook</button>
            <button class="btn alt" data-act="exportsave">Save code (back up your game)</button>
            <button class="btn alt" data-act="importsave">Load a save code</button>
            <button class="btn alt" data-act="sound">${Sound.on ? 'Sound: on' : 'Sound: off'}</button></div>
            <p class="small">The game saves itself at the end of every day.</p>`);
    },
    tipsSheet() {
        const s = Game.s;
        const tips = s ? Object.keys(s.tipsShown).map(k => `<div class="msg">${esc(WALT[k] || '')}</div>`).join('') : '';
        this.sheet(this.head("Walt's notebook") + (tips || '<div class="sub">Nothing yet.</div>'));
    },
    exportSheet() {
        if (!Game.s) return;
        this.sheet(this.head('Save code') + `<p class="small">Copy this somewhere safe. Paste it into "Load a save code" to get your game back, even on another phone.</p>
            <textarea readonly id="savecode">${Game.exportCode()}</textarea>`);
        const t = this.$('savecode'); t.focus(); t.select();
    },
    importSheet() {
        this.sheet(this.head('Load a save code') + `<textarea id="loadcode" placeholder="Paste your save code here"></textarea>
            <button class="btn go full" style="margin-top:8px" data-act="doimport">Load it</button><p class="small" id="loadmsg"></p>`);
    },
    doImport() {
        try { Game.importCode(this.$('loadcode').value); this.closeSheet(); this.show(); }
        catch (e) { this.$('loadmsg').textContent = "That code didn't work. Make sure you copied all of it."; }
    },

    waltSays(text) { UI.say(text, 7500); },
};
