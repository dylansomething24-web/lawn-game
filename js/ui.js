// Pacing log (L06): records real play time for each milestone, first time only per save.
const Pacing = {
    t0: performance.now(), marks: {},
    mark(name) {
        if (this.marks[name] !== undefined) return;
        this.marks[name] = Math.round((performance.now() - this.t0) / 1000);
        try {
            const all = JSON.parse(localStorage.getItem('cutabove_pacing') || '[]');
            if (all.some(m => m.name === name)) return;
            const played = typeof Game !== 'undefined' && Game.s ? Game.s.playSec || 0 : 0;
            all.push({ name, sec: Math.round(played), at: new Date().toISOString() });
            localStorage.setItem('cutabove_pacing', JSON.stringify(all.slice(-200)));
        } catch (e) { /* storage unavailable: the log is optional */ }
        Debug.refresh();
    },
};

// The yard view's controls. The street and menus live in screens.js.
const UI = {
    scene: null, shown: {}, hintTimer: null, lastCov: -1, zoomed: true, auto: true, held: null,

    $(id) { return document.getElementById(id); },

    setActions(list) {
        this.releaseHold();
        const box = this.$('actions');
        box.innerHTML = '';
        box.classList.toggle('many', list.length > 4);
        for (const a of list) {
            const b = document.createElement('button');
            b.className = 'abtn' + (a.label === 'Stop' ? ' stop' : '') + (a.hold ? ' hold' : '');
            b.textContent = a.label;
            b.disabled = !!a.off;
            if (a.hold) {   // hold-to-drive: works only while the finger is down
                b.onpointerdown = e => {
                    e.preventDefault(); Sound.init();
                    this.releaseHold();
                    try { b.setPointerCapture(e.pointerId); } catch (err) {}
                    this.held = { b, up: a.up }; b.classList.add('held'); a.down();
                };
                b.onpointerup = b.onpointercancel = b.onlostpointercapture = () => { if (this.held && this.held.b === b) this.releaseHold(); };
                b.oncontextmenu = e => e.preventDefault();
            } else b.onclick = () => { Sound.init(); a.fn(); };
            box.appendChild(b);
        }
    },
    releaseHold() {
        const h = this.held; if (!h) return;
        this.held = null; h.b.classList.remove('held'); h.up();
    },

    init() {
        this.$('btn-zoom').onclick = () => { if (this.scene) this.$('btn-zoom').textContent = this.scene.toggleZoom() ? 'Whole yard' : 'Zoom in'; };
        const fin = this.$('btn-finish');
        fin.onclick = () => {
            const sc = this.scene; if (!sc || sc.finished) return;
            const ready = sc.yard.mowCoverage() >= CFG.finishAt && sc.tasksDone();
            if (!ready && !fin.dataset.armed) {
                fin.dataset.armed = '1'; fin.classList.add('armed'); fin.textContent = 'Not done. Sure?';
                setTimeout(() => { delete fin.dataset.armed; fin.classList.remove('armed'); fin.textContent = 'Finish job'; }, 2500);
                return;
            }
            delete fin.dataset.armed; fin.classList.remove('armed'); fin.textContent = 'Finish job';
            sc.finish();
        };
        const md = this.$('btn-mode');
        md.onclick = () => { this.auto = !this.auto; this.showMode(); if (this.scene) this.scene.modeChanged(); };
        window.addEventListener('pointerup', () => this.releaseHold());
        window.addEventListener('blur', () => this.releaseHold());
        document.addEventListener('visibilitychange', () => this.releaseHold());
        this.$('btn-sound').onclick = () => { Sound.init(); this.$('btn-sound').textContent = Sound.toggle() ? 'Sound on' : 'Sound off'; };
        Debug.init();
    },

    showMode() { const md = this.$('btn-mode'); md.textContent = this.auto ? 'Auto' : 'Manual'; md.classList.toggle('auto', this.auto); },

    sceneReady(scene) {
        this.scene = scene; this.showMode(); this.lastCov = -1;
        this.$('btn-zoom').textContent = this.zoomed ? 'Whole yard' : 'Zoom in';
        this.$('y-name').textContent = scene.visit.cust.name;
        const row = this.$('toolrow'); row.innerHTML = '';
        for (const k of scene.toolList) {
            const b = document.createElement('button');
            b.className = 'tbtn'; b.id = 'tool-' + k; b.textContent = TOOL_LABEL[k];
            b.onclick = () => { Sound.init(); scene.setTool(k); };
            row.appendChild(b);
        }
        this.toolChanged('mower');
        this.extra(null);
    },

    toolChanged(kind) {
        for (const b of this.$('toolrow').children) b.classList.toggle('on', b.id === 'tool-' + kind);
    },

    hud(cov) {
        const pct = Math.floor(cov * 1000) / 10;
        if (pct !== this.lastCov) {
            this.lastCov = pct;
            this.$('h-cov').textContent = pct.toFixed(1) + '%';
            this.$('h-bar').style.width = Math.min(100, pct) + '%';
        }
        Debug.tick(cov);
    },

    // the customer's order, with what's done
    order(sc) {
        const box = this.$('y-order'), out = [];
        const mc = sc.yard.mowCoverage();
        out.push(`<span class="chip ${mc >= CFG.finishAt ? 'ok' : ''}">Mow ${mc >= CFG.finishAt ? '✓' : Math.floor(mc * 100) + '%'}</span>`);
        const tool = { trim: 'trimmer', edge: 'edger', blow: 'blower' }, word = { trim: 'Trim', edge: 'Edge', blow: 'Blow' };
        for (const t of ['trim', 'edge', 'blow']) {
            if (!sc.visit.tasks.includes(t)) continue;
            if (!sc.units[tool[t]]) { out.push(`<span class="chip no">${word[t]}: no ${tool[t]}</span>`); continue; }
            const n = sc.pendingCount[tool[t]] || 0;
            out.push(`<span class="chip ${n ? '' : 'ok'}">${word[t]} ${n ? n + ' left' : '✓'}</span>`);
        }
        if (sc.visit.price) out.push(`<span class="chip">$${sc.visit.price}</span>`);
        const html = out.join('');
        if (html !== this.lastOrder) { box.innerHTML = html; this.lastOrder = html; }
    },

    // one extra button floating over the yard (text Kyle about the dog)
    extra(label, fn) {
        const box = this.$('y-extra'); box.innerHTML = '';
        if (!label) return;
        const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = '📱 ' + label;
        b.onclick = () => { Sound.init(); fn(); };
        box.appendChild(b);
    },

    // a choice that stops play (mower broke)
    modal(text, choices, cb) {
        Screens.sheet(`<h2>${text}</h2><div class="btns" style="grid-template-columns:1fr">${choices.map((c, i) => `<button class="btn ${i === 0 ? 'go' : ''}" data-i="${i}">${c.label}</button>`).join('')}</div>`, false);
        for (const b of document.querySelectorAll('#sheet [data-i]')) b.onclick = () => { Screens.closeSheet(); cb(choices[+b.dataset.i].act); };
    },

    hint(key, text) {
        if (this.shown[key]) return;
        this.shown[key] = true;
        this.say(text);
    },
    say(text, ms) {
        const h = this.$('hint');
        this.$('hint-text').textContent = text;
        h.classList.add('show');
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => h.classList.remove('show'), ms || 6500);
    },
};

// Debug panel (L06): open the game with ?debug in the address.
const Debug = {
    on: /[?&]debug/.test(location.search), el: null, frames: 0, t: performance.now(), fps: 0,
    init() {
        if (!this.on) return;
        this.el = document.getElementById('debug'); this.el.hidden = false;
        const $ = id => document.getElementById(id);
        $('dbg-finish').onclick = () => { if (UI.scene && Screens.cur === 'yard') { UI.scene.debugFinish(); } };
        $('dbg-money').onclick = () => { Game.s.money += 500; Game.changed(); };
        $('dbg-rep').onclick = () => { Game.addRep(10); Game.changed(); };
        $('dbg-five').onclick = () => { if (Game.s.phase === 'day' && Game.s.clock < 17 * 60) Game.tick(17 * 60 - Game.s.clock); };
        $('dbg-week').onclick = () => { if (Game.s.phase === 'morning') { Game.s.day = 4; Game.s.phase = 'day'; Game.endDay(); Game.nextDay(); Screens.show(); } };
        $('dbg-clear').onclick = () => { try { localStorage.removeItem('cutabove_pacing'); } catch (e) {} this.refresh(); };
        this.refresh();
    },
    tick(cov) {
        if (!this.on) return;
        this.frames++;
        const now = performance.now();
        if (now - this.t > 1000) {
            this.fps = Math.round(this.frames * 1000 / (now - this.t)); this.frames = 0; this.t = now;
            const y = UI.scene && UI.scene.yard;
            document.getElementById('dbg-stats').textContent = `fps ${this.fps} | mow ${(cov * 100).toFixed(1)}% | stripes ${y ? y.stripeQuality().toFixed(2) : '-'}`;
        }
    },
    refresh() {
        if (!this.on) return;
        let all = [];
        try { all = JSON.parse(localStorage.getItem('cutabove_pacing') || '[]'); } catch (e) {}
        document.getElementById('dbg-pacing').textContent = all.slice(-8).map(m => `${m.name}: ${Math.round(m.sec / 60)}m`).join('\n') || 'no pacing marks yet';
    },
};
