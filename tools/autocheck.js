// Checks automatic mowing on every yard: how much the lanes alone cover, how clean the stripes come out
// at different amounts of wander, and whether cleanup can reach 100%.
// Run: node tools/autocheck.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'js') + '/';
const ctx = { Math, console, Set, Uint8Array, Float32Array, Int32Array, JSON, Object };
vm.createContext(ctx);
for (const f of ['config.js', 'numbers.js', 'yards.js', 'yard.js', 'trim.js', 'auto.js'])
    vm.runInContext(fs.readFileSync(dir + f, 'utf8').replace(/^const (\w+)/gm, 'var $1').replace(/^class (\w+)/gm, 'var $1 = class $1'), ctx);
vm.runInContext(`
function drive(yard, a, b, shade) {
  var n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (var i = 1; i <= n; i++) yard.cutAround(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n, CFG.mower.cutR, shade);
}
function run(key, orient, amp, clean) {
  var def = yardOf(key), yard = new Yard(def, []), plan = planLanes(yard, orient);
  plan.segs.forEach(function(s) {
    var sh = segShade(s), pts = wobbleLane(yard, s, amp), cur = s.from;
    yard.cutAround(cur.x, cur.y, CFG.mower.cutR, sh);
    pts.forEach(function(p) { drive(yard, cur, p, sh); cur = p; });
  });
  var lanes = yard.mowCoverage(), q = yard.stripeQuality(), fail = 0;
  if (clean) {
    for (var i = 0; i < yard.state.length; i++) {
      if (yard.state[i] !== STATE.UNCUT || !yard.reach[i]) continue;
      var cx = yard.ox + (i % yard.cols + 0.5) * CFG.cell, cy = yard.oy + ((i / yard.cols | 0) + 0.5) * CFG.cell;
      var p = coverPoint(yard, cx, cy, { x: cx, y: cy });
      if (!p) { fail++; continue; }
      yard.cutAround(p.x, p.y, CFG.mower.cutR, laneShadeAt(plan, p.x, p.y));
    }
  }
  return { passes: plan.passes, lanes: lanes, q: q, after: yard.mowCoverage(), qAfter: yard.stripeQuality(), fail: fail };
}
Object.keys(YARDS).forEach(function(k) {
  var line = k.padEnd(10);
  ['v', 'h'].forEach(function(o) {
    var r0 = run(k, o, 0, true);
    line += ' ' + o + ': ' + r0.passes + ' passes, lanes ' + (r0.lanes * 100).toFixed(1) + '%, clean ' + (r0.after * 100).toFixed(2) + '% (fail ' + r0.fail + ') q';
    [0, 2, 3.5, 5, 8].forEach(function(a) { line += ' ' + run(k, o, a, true).qAfter.toFixed(2); });
  });
  console.log(line);
});
`, ctx);
