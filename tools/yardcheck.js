// Checks every yard (and its flipped copy): the mower plus the trimmer can reach 100% of the grass,
// the trimmer can walk to every target, and the edger and blower have something to do.
// Run: node tools/yardcheck.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'js') + '/';
const ctx = { Math, console, Set, Uint8Array, Float32Array, Int32Array, JSON, Object };
vm.createContext(ctx);
for (const f of ['config.js', 'numbers.js', 'yards.js', 'yard.js', 'trim.js'])
    vm.runInContext(fs.readFileSync(dir + f, 'utf8').replace(/^const (\w+)/gm, 'var $1').replace(/^class (\w+)/gm, 'var $1 = class $1'), ctx);
vm.runInContext(`
var keys = Object.keys(YARDS).slice(); keys.forEach(function(k){ keys.push(k + '~m'); });
var bad = 0;
keys.forEach(function(k) {
  var def = yardOf(k), yard = new Yard(def, def.hidden.map(function(h){ return { type: 'circle', x: h.x, y: h.y, r: 4, kind: 'sprinkler' }; }));
  var m = CFG.mower;
  for (var y = 52; y <= def.H; y += 2) for (var x = 16; x <= 384; x += 2) if (!yard.collides(x, y, m.collideR)) yard.cutAround(x, y, m.cutR, STATE.LIGHT);
  var mowCov = yard.mowCoverage(), afterMow = yard.coverage();
  var T = buildTrimTargets(yard), probs = [];
  T.forEach(function(t){ t.runs.forEach(function(run){ run.forEach(function(p){ if (yard.collides(p.x, p.y, CFG.trimmer.collideR)) probs.push('bad point ' + t.name); yard.cutAround(p.x, p.y, CFG.trimmer.cutR, STATE.TRIM); }); }); });
  var P = new TrimPather(yard, CFG.trimmer.collideR);
  var see = function(a,b){ var n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/1.5); for (var i=1;i<=n;i++){ if (yard.collides(a.x+(b.x-a.x)*i/n, a.y+(b.y-a.y)*i/n, 3)) return false;} return true; };
  var st = def.start.trimmer;
  if (yard.collides(st.x, st.y, 3)) probs.push('trimmer start blocked');
  if (yard.collides(def.start.mower.x, def.start.mower.y, m.collideR)) probs.push('mower start blocked');
  T.concat(buildEdgeTargets(yard), buildBlowTargets(yard)).forEach(function(t){ t.runs.forEach(function(run){ if (!P.find(st, run[0], see)) probs.push('no path to ' + t.name); }); });
  var E = buildEdgeTargets(yard), Bl = buildBlowTargets(yard);
  var left = yard.total - yard.cut;
  if (left > 0 || probs.length || mowCov < 0.999) bad++;
  console.log((left || probs.length ? 'PROBLEM ' : 'ok      ') + k.padEnd(14) + ' ' + def.size.padEnd(6) + ' mower ' + (afterMow*100).toFixed(1) + '% of grass, trim targets ' + T.length + ', edge ' + E.length + ', blow ' + Bl.length + ', left ' + left + (probs.length ? ' | ' + probs.join('; ') : '') + (left ? ' ' + JSON.stringify(yard.uncutCenters().slice(0, 6)) : ''));
});
console.log(bad ? bad + ' yards with problems' : 'all yards ok');
`, ctx);
