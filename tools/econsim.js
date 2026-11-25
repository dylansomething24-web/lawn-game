// Economy simulator (L06): plays weeks of the business with no graphics, in seconds.
// Run: node tools/econsim.js [weeks] [skill 0..1]
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'js') + '/';
const store = {};
const ctx = { Math, console, JSON, Object, Array, Set, Uint8Array, Float32Array, Int32Array, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'), escape, unescape, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } } };
vm.createContext(ctx);
for (const f of ['config.js', 'numbers.js', 'yards.js', 'data.js', 'game.js'])
    vm.runInContext(fs.readFileSync(dir + f, 'utf8').replace(/^const (\w+)/gm, 'var $1').replace(/^class (\w+)/gm, 'var $1 = class $1'), ctx);

const weeks = +process.argv[2] || 4, skill = process.argv[3] !== undefined ? +process.argv[3] : 0.8;
const out = vm.runInContext(`(function(){
  var G = Game; G.newGame(); var lines = [];
  var handMin = { small: 150, medium: 210 };
  for (var d = 0; d < ${weeks} * 5; d++) {
    var s = G.s;
    // morning: hire and buy when it makes sense
    if (G.canHire() && !s.applicants) G.postHelpWanted();
    if (s.applicants && !s.applicants.pending && s.money > 450) {
      if (G.mowers().length <= s.workers.length + 1) G.buy('selfprop');
      if (G.mowers().length > s.workers.length + 1) G.hire(s.applicants.list[0]);
    }
    if (!s.tools.edger && s.money > 500) G.buy('edger');
    if (!s.tools.blower && s.money > 500) G.buy('blower');
    // give workers every other job
    var wi = 0; s.jobs.forEach(function(j, i){ if (s.workers.length && i % 2 === 1) j.assignee = s.workers[(wi++) % s.workers.length].id; });
    G.startDay();
    var guard = 0;
    while (s.phase === 'day' && guard++ < 500) {
      for (var m of s.phone) if (m.choices && !m.resolved) G.answer(m.id, 0);
      var mine = s.jobs.find(function(j){ return j.assignee === 'you' && j.status === 'waiting'; });
      if (mine && s.clock < 16 * 60) {
        var c = G.cust(mine.cust); G.goToJob(mine.id);
        var v = G.visitFor(mine.id);
        G.tick(handMin[yardOf(c.yard).size] * (v.breakdownAt ? 1.1 : 1));
        G.finishPlayerJob(mine.id, { mowCov: 0.96 + 0.04 * ${skill}, stripeQ: 0.25 + 0.3 * ${skill}, trimFrac: 0.8 + 0.2 * ${skill}, edgeFrac: 0.8 + 0.2 * ${skill}, blowFrac: 0.9, hits: v.hidden.length && Math.random() < 0.5 ? 1 : 0, found: v.hidden, mowerId: v.mowerId });
      } else if (G.prospects().length && s.clock < 15 * 60) {
        var r = G.knock();
        if (r.cust) {
          var used = {}; for (var k in s.customers) if (s.customers[k].status === 'customer') used[s.customers[k].day] = (used[s.customers[k].day] || 0) + 1;
          var day = [0,1,2,3,4].sort(function(a,b){ return (used[a]||0) - (used[b]||0); })[0];
          var res = G.offer(G.suggestedPrice(r.cust), day);
          if (res && res.counter) G.acceptCounter();
          else if (res === 'no') G.offer(G.suggestedPrice(r.cust) - 10, day);
        }
      } else G.tick(10);
      if (G.shouldEndDay() && !s.jobs.some(function(j){ return j.status === 'working' && j.assignee === 'you'; })) G.endDay();
    }
    for (var g of G.mowers()) if (g.cond < 70) G.maintain(g.id);
    var log = s.dayLog;
    lines.push('W' + s.week + ' ' + G.dayName().slice(0,3) + ' $' + Math.round(s.money) + ' rep ' + s.rep + ' jobs ' + log.jobsDone.map(function(x){ return x.cust.split(' ').pop() + '(' + x.who[0] + x.stars + ')'; }).join(' ') + (log.missed.length ? ' MISSED ' + log.missed : '') + (log.wages.length ? ' wages ' + log.wages.map(function(w){return w.name + ' ' + w.hrs + 'h $' + w.pay;}).join(',') : ''));
    G.nextDay();
    if (s.phase === 'weekend') { lines.push('  -- week ' + s.week + ': income ' + s.weekLog.income + ' tips ' + s.weekLog.tips + ' wages ' + s.weekLog.wages + ' spent ' + (s.weekLog.spent||0) + ' repairs ' + s.weekLog.repairs + ' gas ' + s.weekLog.gas + ' | workers ' + s.workers.map(function(w){return w.name + ' L' + w.level + ' ' + w.xp + 'xp';}).join(',')); G.nextWeek(); }
  }
  var cs = Object.keys(G.s.customers).map(function(k){ var c = G.s.customers[k]; return k + ':' + c.status + ' rel' + c.rel + (c.day !== null ? ' ' + N.days[c.day].slice(0,3) : '') + ' $' + c.price; });
  lines.push(cs.join(' | '));
  lines.push('phone: ' + G.s.phone.length + ' msgs; save size ' + JSON.stringify(G.s).length + ' bytes; export ok ' + (function(){ var code = G.exportCode(); return G.importCode(code); })());
  return lines.join('\\n');
})()`, ctx);
console.log(out);
