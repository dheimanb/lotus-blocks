/* [Grok Bot] Lotus Blocks board generator.
 * generateBoard(seed, difficulty) -> board (same shape as BOARDS in lotus-blocks/index.html)
 * Pure JS, no DOM, no deps, no Math.random / Date. Same (seed, difficulty) => same board.
 * Load: Node `require('./generator.js')`, browser `<script src="generator.js">` -> window.LotusGenerator.
 */
(function (root) {
  'use strict';

  // ---- Tunables: change numbers here, not logic. ----
  var CONFIG = {
    maxAttempts: 2000,          // full restarts before giving up (throws)
    partitionTries: 40,         // tray-partition tries per given layout
    easy: {
      size: { min: 3, max: 7 },
      trayAvg: { min: 5, max: 7 },
      trayWeights: { 4: 1, 5: 3, 6: 3, 7: 2 },   // target size draw for tray pieces
      givenCells: { min: 25, max: 30 },
      givenSize: { min: 3, max: 4 },
      // 'piece': every 3x3 box fully contains >=1 given piece (one per box)
      // 'cell' : every 3x3 box contains >=1 given cell
      boxRule: 'cell',
      cornerAnchors: false,
      givenPieces: null
    },
    normal: {
      size: { min: 3, max: 6 },
      trayAvg: { min: 4, max: 5 },
      trayWeights: { 3: 1, 4: 3, 5: 3, 6: 1 },
      givenCells: { min: 22, max: 27 },
      givenSize: { min: 3, max: 6 },
      boxRule: 'cell',
      cornerAnchors: false,
      givenPieces: null
    },
    hard: {
      size: { min: 3, max: 5 },
      trayAvg: { min: 3, max: 4 },
      trayWeights: { 3: 3, 4: 3, 5: 1 },
      givenCells: { min: 15, max: 22 },
      givenSize: { min: 3, max: 5 },
      boxRule: null,
      cornerAnchors: true,      // each corner has a given cell within Chebyshev distance 1
      givenPieces: { min: 4, max: 6 }
    }
  };

  // ---- Seeded PRNG (xmur3 hash -> sfc32) ----
  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function makeRng(seedStr) {
    var s = xmur3(seedStr);
    var a = s(), b = s(), c = s(), d = s();
    function next() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (var i = 0; i < 15; i++) next();
    return {
      next: next,
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle: function (arr) {
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      weighted: function (w) {
        var keys = Object.keys(w).map(Number).sort(function (x, y) { return x - y; });
        var tot = 0, k; for (k = 0; k < keys.length; k++) tot += w[keys[k]];
        var r = next() * tot;
        for (k = 0; k < keys.length; k++) { r -= w[keys[k]]; if (r < 0) return keys[k]; }
        return keys[keys.length - 1];
      }
    };
  }

  // ---- Grid helpers (cell index 0..80, row-major) ----
  var NB = [];
  for (var ci = 0; ci < 81; ci++) {
    var r0 = Math.floor(ci / 9), c0 = ci % 9, l = [];
    if (r0 > 0) l.push(ci - 9); if (r0 < 8) l.push(ci + 9);
    if (c0 > 0) l.push(ci - 1); if (c0 < 8) l.push(ci + 1);
    NB.push(l);
  }
  function boxOf(i) { return Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3); }

  // ---- 1. Full sudoku solution (randomised backtracking) ----
  function makeSolution(rng) {
    var g = new Array(81).fill(0);
    var rowM = new Array(9).fill(0), colM = new Array(9).fill(0), boxM = new Array(9).fill(0);
    function fill(i) {
      if (i === 81) return true;
      var r = Math.floor(i / 9), c = i % 9, b = boxOf(i);
      var digits = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (var k = 0; k < 9; k++) {
        var d = digits[k], bit = 1 << d;
        if ((rowM[r] | colM[c] | boxM[b]) & bit) continue;
        g[i] = d; rowM[r] |= bit; colM[c] |= bit; boxM[b] |= bit;
        if (fill(i + 1)) return true;
        g[i] = 0; rowM[r] &= ~bit; colM[c] &= ~bit; boxM[b] &= ~bit;
      }
      return false;
    }
    fill(0);
    return g;
  }

  // Grow a connected piece from `start` up to `size` cells using only cells where allowed(i) is true.
  // `score(i)` (optional) biases the frontier choice: higher score preferred.
  function grow(rng, start, size, allowed, score) {
    var piece = [start], inP = {}; inP[start] = true;
    while (piece.length < size) {
      var front = [];
      for (var a = 0; a < piece.length; a++) {
        var n = NB[piece[a]];
        for (var b = 0; b < n.length; b++) {
          var x = n[b];
          if (!inP[x] && allowed(x) && front.indexOf(x) < 0) front.push(x);
        }
      }
      if (!front.length) return null;
      var choice;
      if (score) {
        var best = -Infinity, bestL = [];
        for (var f = 0; f < front.length; f++) {
          var s = score(front[f], piece);
          if (s > best) { best = s; bestL = [front[f]]; } else if (s === best) bestL.push(front[f]);
        }
        choice = rng.pick(bestL);
      } else choice = rng.pick(front);
      piece.push(choice); inP[choice] = true;
    }
    return piece;
  }

  // ---- 2. Given (pre-placed) pieces ----
  function pickGivens(rng, cfg) {
    var owner = new Array(81).fill(-1);   // index of given piece
    var pieces = [];
    function blocked(i) {                  // occupied or edge-adjacent to an existing given piece
      if (owner[i] >= 0) return true;
      var n = NB[i];
      for (var k = 0; k < n.length; k++) if (owner[n[k]] >= 0) return true;
      return false;
    }
    function add(p) { for (var k = 0; k < p.length; k++) owner[p[k]] = pieces.length; pieces.push(p); }
    function cellsTotal() { var t = 0; for (var k = 0; k < pieces.length; k++) t += pieces[k].length; return t; }

    if (cfg.boxRule === 'piece') {
      // One given piece wholly inside each box; sizes chosen so total hits givenCells.
      var target = rng.int(Math.max(cfg.givenCells.min, 9 * cfg.givenSize.min), Math.min(cfg.givenCells.max, 9 * cfg.givenSize.max));
      var sizes = new Array(9).fill(cfg.givenSize.min), extra = target - 9 * cfg.givenSize.min;
      while (extra > 0) { var bi = rng.int(0, 8); if (sizes[bi] < cfg.givenSize.max) { sizes[bi]++; extra--; } }
      var order = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      for (var o = 0; o < 9; o++) {
        var box = order[o];
        var inBox = function (i) { return boxOf(i) === box && !blocked(i); };
        var starts = []; for (var i = 0; i < 81; i++) if (inBox(i)) starts.push(i);
        if (!starts.length) return null;
        var p = grow(rng, rng.pick(starts), sizes[box], inBox);
        if (!p) return null;
        add(p);
      }
    } else if (cfg.boxRule === 'cell') {
      // Grow pieces until every box holds a given cell; prefer spreading into uncovered boxes.
      var covered = new Array(9).fill(false);
      var guard = 0;
      while (covered.indexOf(false) >= 0) {
        if (++guard > 20) return null;
        var unc = []; for (var bb = 0; bb < 9; bb++) if (!covered[bb]) unc.push(bb);
        var tb = rng.pick(unc);
        var cand = []; for (var j = 0; j < 81; j++) if (boxOf(j) === tb && !blocked(j)) cand.push(j);
        if (!cand.length) return null;
        var sz = rng.int(cfg.givenSize.min, cfg.givenSize.max);
        var allowedC = function (i) { return !blocked(i); };
        var scoreC = function (i, piece) {
          var bx = boxOf(i);
          if (covered[bx]) return 0;
          for (var q = 0; q < piece.length; q++) if (boxOf(piece[q]) === bx) return 1;
          return 2;
        };
        var pc = grow(rng, rng.pick(cand), sz, allowedC, scoreC);
        if (!pc) return null;
        add(pc);
        for (var z = 0; z < pc.length; z++) covered[boxOf(pc[z])] = true;
      }
    }

    if (cfg.cornerAnchors) {
      var corners = rng.shuffle([[0, 0], [0, 8], [8, 0], [8, 8]]);
      for (var cI = 0; cI < 4; cI++) {
        var cr = corners[cI][0], cc = corners[cI][1], ok = false, zone = [];
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          var rr = cr + dr, c2 = cc + dc;
          if (rr < 0 || rr > 8 || c2 < 0 || c2 > 8) continue;
          var id = rr * 9 + c2; if (owner[id] >= 0) ok = true; zone.push(id);
        }
        if (ok) continue;
        zone = zone.filter(function (i) { return !blocked(i); });
        if (!zone.length) return null;
        var pz = grow(rng, rng.pick(zone), rng.int(cfg.givenSize.min, cfg.givenSize.max), function (i) { return !blocked(i); });
        if (!pz) return null;
        add(pz);
      }
    }

    if (cfg.givenPieces) {
      var wantPieces = rng.int(Math.max(cfg.givenPieces.min, pieces.length), cfg.givenPieces.max);
      var g2 = 0;
      while (pieces.length < wantPieces && g2++ < 30) {
        var free = []; for (var f = 0; f < 81; f++) if (!blocked(f)) free.push(f);
        if (!free.length) break;
        var px = grow(rng, rng.pick(free), rng.int(cfg.givenSize.min, cfg.givenSize.max), function (i) { return !blocked(i); });
        if (px) add(px);
      }
      if (pieces.length < cfg.givenPieces.min || pieces.length > cfg.givenPieces.max) return null;
    }

    var tc = cellsTotal();
    if (tc < cfg.givenCells.min || tc > cfg.givenCells.max) return null;
    return pieces;
  }

  // ---- 3. Partition the remaining cells into tray pieces ----
  function components(free) {
    var seen = {}, comps = [];
    for (var i = 0; i < 81; i++) {
      if (!free[i] || seen[i]) continue;
      var st = [i], comp = []; seen[i] = true;
      while (st.length) {
        var x = st.pop(); comp.push(x);
        for (var k = 0; k < NB[x].length; k++) { var y = NB[x][k]; if (free[y] && !seen[y]) { seen[y] = true; st.push(y); } }
      }
      comps.push(comp);
    }
    return comps;
  }

  function partitionTray(rng, givenPieces, cfg) {
    var free = new Array(81).fill(true);
    givenPieces.forEach(function (p) { p.forEach(function (i) { free[i] = false; }); });
    var cs = components(free);
    for (var c = 0; c < cs.length; c++) if (cs[c].length < cfg.size.min) return null;

    var tray = [];
    var freeCount = function () { var n = 0; for (var i = 0; i < 81; i++) if (free[i]) n++; return n; };
    var freeDeg = function (i) { var d = 0; for (var k = 0; k < NB[i].length; k++) if (free[NB[i][k]]) d++; return d; };

    while (freeCount() > 0) {
      // start at the most constrained free cell (fewest free neighbours)
      var minD = 9, starts = [];
      for (var i = 0; i < 81; i++) if (free[i]) {
        var d = freeDeg(i);
        if (d < minD) { minD = d; starts = [i]; } else if (d === minD) starts.push(i);
      }
      var placed = false;
      for (var t = 0; t < 8 && !placed; t++) {
        var size = rng.weighted(cfg.trayWeights);
        var start = rng.pick(starts);
        var p = grow(rng, start, size, function (x) { return free[x]; }, function (x, piece) {
          // prefer frontier cells that would otherwise be left with few free neighbours
          var d2 = 0; for (var k = 0; k < NB[x].length; k++) { var y = NB[x][k]; if (free[y] && piece.indexOf(y) < 0) d2++; }
          return -d2;
        });
        if (!p) {
          // component smaller than requested size: take whole component if it is a legal size
          var comp = components(free).filter(function (cp) { return cp.indexOf(start) >= 0; })[0];
          if (comp.length >= cfg.size.min && comp.length <= cfg.size.max) p = comp; else continue;
        }
        p.forEach(function (x) { free[x] = false; });
        var bad = components(free).some(function (cp) { return cp.length < cfg.size.min; });
        if (bad) { p.forEach(function (x) { free[x] = true; }); continue; }
        tray.push(p); placed = true;
      }
      if (!placed) return null;
    }
    var avg = 0; tray.forEach(function (p) { avg += p.length; }); avg /= tray.length;
    if (avg < cfg.trayAvg.min || avg > cfg.trayAvg.max) return null;
    return tray;
  }

  // ---- Public API ----
  function generateBoard(seed, difficulty) {
    var cfg = CONFIG[difficulty];
    if (!cfg) throw new Error('difficulty must be "easy" | "normal" | "hard"');
    var rng = makeRng(String(seed) + '|' + difficulty);
    var solution = makeSolution(rng);
    for (var attempt = 0; attempt < CONFIG.maxAttempts; attempt++) {
      var givens = pickGivens(rng, cfg);
      if (!givens) continue;
      for (var pt = 0; pt < CONFIG.partitionTries; pt++) {
        var tray = partitionTray(rng, givens, cfg);
        if (!tray) continue;
        return buildBoard(seed, difficulty, solution, givens, tray, rng);
      }
    }
    throw new Error('generateBoard: no valid board after ' + CONFIG.maxAttempts + ' attempts');
  }

  function toPiece(cells, given, solution) {
    var sorted = cells.slice().sort(function (a, b) { return a - b; });
    return {
      cells: sorted.map(function (i) { return [Math.floor(i / 9), i % 9]; }),
      vals: sorted.map(function (i) { return solution[i]; }),
      given: given
    };
  }

  function buildBoard(seed, difficulty, solution, givens, tray, rng) {
    var pieces = givens.map(function (p) { return toPiece(p, true, solution); })
      .concat(tray.map(function (p) { return toPiece(p, false, solution); }));
    rng.shuffle(pieces);   // order carries no information (matches sample, which is unordered)
    var sizes = pieces.map(function (p) { return p.cells.length; });
    var givenCells = 0; givens.forEach(function (p) { givenCells += p.length; });
    var trayCells = 81 - givenCells;
    return {
      seed: seed,
      difficulty: difficulty,
      solution: solution.slice(),
      pieces: pieces,
      stats: {
        totalPieces: pieces.length,
        givenPieces: givens.length,
        givenCells: givenCells,
        trayPieces: tray.length,
        trayCells: trayCells,
        avgTraySize: Math.round((trayCells / tray.length) * 10) / 10,
        minSize: Math.min.apply(null, sizes),
        maxSize: Math.max.apply(null, sizes)
      }
    };
  }

  var api = { generateBoard: generateBoard, CONFIG: CONFIG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LotusGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
