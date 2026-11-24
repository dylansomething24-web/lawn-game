// Pacing log (L06): records real play time for each milestone, first time only per session.
const Pacing = {
    t0: performance.now(), marks: {},
    mark(name) {
        if (this.marks[name] !== undefined) return;
        this.marks[name] = Math.round((performance.now() - this.t0) / 1000);
        try {
            const all = JSON.parse(localStorage.getItem('cutabove_pacing') || '[]');
            all.push({ name, sec: this.marks[name], at: new Date().toISOString() });
            localStorage.setItem('cutabove_pacing', JSON.stringify(all.slice(-200)));
        } catch (e) { /* storage unavailable: the log is optional */ }
        Debug.refresh();
    },
};

const UI = {
    scene: null, shown: {}, hintTimer: null, lastCov: -1, lastSec: -1,
    $(id) { return document.getElementById(id); },

    init() {
        this.$('tool-mower').onclick = () => this.scene && this.scene.setTool('mower');
        this.$('tool-trimmer').onclick = () => this.scene && this.scene.setTool('trimmer');
        this.$('btn-undo').onclick = () => this.scene && this.scene.undo();
        this.$('btn-stop').onclick = () => this.scene && this.scene.stop();
        const rs = this.$('btn-restart');
        rs.onclick = () => {
            if (rs.dataset.armed) { this.restart(); return; }
            rs.dataset.armed = '1'; rs.textContent = 'Sure?';
            setTimeout(() => { delete rs.dataset.armed; rs.textContent = 'Restart'; }, 2200);
        };
        this.$('btn-sound').onclick = () => { Sound.init(); this.$('btn-sound').textContent = Sound.toggle() ? 'Sound on' : 'Sound off'; };
        this.$('done-again').onclick = () => this.restart();
        Debug.init();
    },

    sceneReady(scene) { this.scene = scene; this.toolChanged('mower'); this.$('done').hidden = true; this.lastCov = -1; this.lastSec = -1; },

    restart() {
        const rs = this.$('btn-restart'); delete rs.dataset.armed; rs.textContent = 'Restart';
        this.$('done').hidden = true;
        this.shown = { start: true };
        this.scene.scene.restart();
    },

    toolChanged(kind) {
        this.$('tool-mower').classList.toggle('on', kind === 'mower');
        this.$('tool-trimmer').classList.toggle('on', kind === 'trimmer');
    },

    hud(cov, sec) {
        const pct = Math.floor(cov * 1000) / 10;
        if (pct !== this.lastCov) {
            this.lastCov = pct;
            this.$('h-cov').textContent = pct.toFixed(1) + '%';
            this.$('h-bar').style.width = Math.min(100, pct) + '%';
        }
        const s = Math.floor(sec);
        if (s !== this.lastSec) { this.lastSec = s; this.$('h-time').textContent = this.fmt(s); }
        Debug.tick(cov);
    },

    fmt(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); },

    hint(key, text) {
        if (this.shown[key]) return;
        this.shown[key] = true;
        const h = this.$('hint');
        this.$('hint-text').textContent = text;
        h.classList.add('show');
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(() => h.classList.remove('show'), 6500);
    },

    showDone(sec, cov, passes) {
        this.$('done-time').textContent = this.fmt(sec);
        this.$('done-cov').textContent = (Math.floor(cov * 1000) / 10).toFixed(1) + '%';
        this.$('done-passes').textContent = passes;
        this.$('done').hidden = false;
        this.$('hint').classList.remove('show');
    },
};

// Debug panel (L06): open the game with ?debug in the address.
const Debug = {
    on: /[?&]debug/.test(location.search), el: null, frames: 0, t: performance.now(), fps: 0,
    init() {
        if (!this.on) return;
        this.el = document.getElementById('debug'); this.el.hidden = false;
        document.getElementById('dbg-mowall').onclick = () => UI.scene && UI.scene.debugMowAll();
        document.getElementById('dbg-clear').onclick = () => { try { localStorage.removeItem('cutabove_pacing'); } catch (e) {} this.refresh(); };
        this.refresh();
    },
    tick(cov) {
        if (!this.on) return;
        this.frames++;
        const now = performance.now();
        if (now - this.t > 1000) {
            this.fps = Math.round(this.frames * 1000 / (now - this.t)); this.frames = 0; this.t = now;
            const y = UI.scene && UI.scene.yard;
            document.getElementById('dbg-stats').textContent = `fps ${this.fps} | cells ${y ? y.cut + '/' + y.total : '-'} | cov ${(cov * 100).toFixed(2)}%`;
        }
    },
    refresh() {
        if (!this.on) return;
        let all = [];
        try { all = JSON.parse(localStorage.getItem('cutabove_pacing') || '[]'); } catch (e) {}
        document.getElementById('dbg-pacing').textContent = all.slice(-8).map(m => `${m.name}: ${m.sec}s`).join('\n') || 'no pacing marks yet';
    },
};
