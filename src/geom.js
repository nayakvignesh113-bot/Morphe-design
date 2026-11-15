// Morphe geometry helpers: DXF / SVG outline import, exact polygon coverage, distance transform, minimum-inner-radius closing.
// Pure functions (no DOM), shared by the app and the Node tests. Coordinates in mm, y up. Grids: index ix * ny + iy, iy counted from the top.
const Geom = (() => {
  const hyp = Math.hypot;
  const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
  function bbox(loops) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const l of loops) for (const [x, y] of l) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }

  // ---- curves -> polylines (sag tolerance in the same units as the points)
  function arcPts(cx, cy, r, a0, a1, ccw, sag) {
    let sweep = ccw ? a1 - a0 : a0 - a1; while (sweep <= 1e-12) sweep += 2 * Math.PI; if (sweep > 2 * Math.PI + 1e-9) sweep -= 2 * Math.PI;
    const step = r > sag ? 2 * Math.acos(1 - sag / r) : Math.PI / 4, n = Math.max(2, Math.ceil(sweep / Math.min(step, Math.PI / 4))), out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (ccw ? 1 : -1) * sweep * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return out;
  }
  function bulgeArc(p, q, b, sag) {                       // DXF bulge = tan(theta/4); positive = counter-clockwise (arc bulges to the right of p->q)
    if (Math.abs(b) < 1e-12) return [p, q];
    const c = hyp(q[0] - p[0], q[1] - p[1]); if (c < 1e-12) return [p, q];
    const sg = Math.abs(b) * c / 2, r = (c * c / 4 + sg * sg) / (2 * sg), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, nx = -(q[1] - p[1]) / c, ny = (q[0] - p[0]) / c, sgn = b > 0 ? 1 : -1;
    const cx = mx + sgn * nx * (r - sg), cy = my + sgn * ny * (r - sg);
    const a0 = Math.atan2(p[1] - cy, p[0] - cx), a1 = Math.atan2(q[1] - cy, q[0] - cx), pts = arcPts(cx, cy, r, a0, a1, b > 0, sag);
    pts[0] = p; pts[pts.length - 1] = q; return pts;
  }
  function svgArc(x0, y0, rx, ry, phiDeg, fa, fs, x1, y1, sag) {   // SVG endpoint arc -> points
    if (x0 === x1 && y0 === y1) return [];
    rx = Math.abs(rx); ry = Math.abs(ry); if (!rx || !ry) return [[x1, y1]];
    const phi = phiDeg * Math.PI / 180, c = Math.cos(phi), s = Math.sin(phi), dx = (x0 - x1) / 2, dy = (y0 - y1) / 2, xp = c * dx + s * dy, yp = -s * dx + c * dy;
    const lam = xp * xp / (rx * rx) + yp * yp / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp, den = rx * rx * yp * yp + ry * ry * xp * xp, k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = k * rx * yp / ry, cyp = -k * ry * xp / rx, cx = c * cxp - s * cyp + (x0 + x1) / 2, cy = s * cxp + c * cyp + (y0 + y1) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
    const th1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry); let dth = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
    if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
    const rmax = Math.max(rx, ry), n = Math.max(2, Math.ceil(Math.abs(dth) / (rmax > sag ? Math.min(2 * Math.acos(1 - sag / rmax), Math.PI / 4) : Math.PI / 4))), out = [];
    for (let i = 1; i <= n; i++) { const t = th1 + dth * i / n, ex = rx * Math.cos(t), ey = ry * Math.sin(t); out.push([c * ex - s * ey + cx, s * ex + c * ey + cy]); }
    out[out.length - 1] = [x1, y1]; return out;
  }
  const bez = (pts, n) => { const out = []; for (let i = 1; i <= n; i++) { const t = i / n; let q = pts.map(p => p.slice()); while (q.length > 1) q = q.slice(1).map((p, j) => [q[j][0] + (p[0] - q[j][0]) * t, q[j][1] + (p[1] - q[j][1]) * t]); out.push(q[0]); } return out; };

  // ---- DXF (ASCII) -> {pieces: [{pts, closed}], warn, units}
  function parseDXF(text, sag = 0.004) {
    if (/^AutoCAD Binary DXF/.test(text)) throw new Error('This is a binary DXF. Save it as an ASCII DXF (R12 or 2000 format).');
    const L = text.split(/\r?\n/), pairs = []; for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
    const pieces = [], warn = [], skipped = {}; let units = null, inEnt = false, k = 0;
    for (; k < pairs.length; k++) { const [c, v] = pairs[k]; if (c === 9 && v === '$INSUNITS') { const u = pairs[k + 1]; if (u && u[0] === 70) units = ({ 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' })[parseInt(u[1], 10)] || null; } if (c === 0 && v === 'SECTION') { const nm = pairs[k + 1]; if (nm && nm[1] === 'ENTITIES') { inEnt = true; k += 2; break; } } }
    if (!inEnt) throw new Error('No ENTITIES section found. Is this an ASCII DXF?');
    const ents = []; let cur = null;
    for (; k < pairs.length; k++) { const [c, v] = pairs[k]; if (c === 0) { if (cur) ents.push(cur); if (v === 'ENDSEC') { cur = null; break; } cur = { type: v, g: [] }; } else if (cur) cur.g.push([c, v]); }
    if (cur) ents.push(cur);
    const num = (e, code, d = 0) => { const f = e.g.find(x => x[0] === code); return f ? parseFloat(f[1]) : d; };
    const all = (e, code) => e.g.filter(x => x[0] === code).map(x => parseFloat(x[1]));
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.type === 'LINE') pieces.push({ pts: [[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]], closed: false });
      else if (e.type === 'CIRCLE') { const cx = num(e, 10), cy = num(e, 20), r = num(e, 40); pieces.push({ pts: arcPts(cx, cy, r, 0, 2 * Math.PI, true, sag).slice(0, -1), closed: true }); }
      else if (e.type === 'ARC') { const cx = num(e, 10), cy = num(e, 20), r = num(e, 40), a0 = num(e, 50) * Math.PI / 180, a1 = num(e, 51) * Math.PI / 180; pieces.push({ pts: arcPts(cx, cy, r, a0, a1, true, sag), closed: false }); }
      else if (e.type === 'ELLIPSE') { const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1), t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI), a = hyp(mx, my), b = a * ratio, rot = Math.atan2(my, mx); let sw = t1 - t0; if (sw <= 0) sw += 2 * Math.PI; const n = Math.max(24, Math.ceil(sw / (Math.PI / 90))), pts = [];
        for (let j = 0; j <= n; j++) { const t = t0 + sw * j / n, x = a * Math.cos(t), y = b * Math.sin(t); pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
        const full = Math.abs(sw - 2 * Math.PI) < 1e-6; if (full) pts.pop(); pieces.push({ pts, closed: full }); }
      else if (e.type === 'LWPOLYLINE') {
        const flags = num(e, 70, 0), xs = all(e, 10), ys = all(e, 20); const bs = []; let vi = -1; for (const [c, v] of e.g) { if (c === 10) { vi++; bs[vi] = 0; } else if (c === 42 && vi >= 0) bs[vi] = parseFloat(v); }
        const V = xs.map((x, j) => [x, ys[j]]), closed = !!(flags & 1), out = [];
        for (let j = 0; j < V.length; j++) { const last = j === V.length - 1; if (last && !closed) { out.push(V[j]); break; } const q = V[(j + 1) % V.length], seg = bulgeArc(V[j], q, bs[j] || 0, sag); out.push(...seg.slice(0, -1)); }
        pieces.push({ pts: out, closed });
      } else if (e.type === 'POLYLINE') {
        const flags = num(e, 70, 0), V = [], B = []; let j = i + 1; for (; j < ents.length && ents[j].type === 'VERTEX'; j++) { V.push([num(ents[j], 10), num(ents[j], 20)]); B.push(num(ents[j], 42, 0)); }
        i = j - 1; const closed = !!(flags & 1), out = []; for (let m = 0; m < V.length; m++) { const last = m === V.length - 1; if (last && !closed) { out.push(V[m]); break; } out.push(...bulgeArc(V[m], V[(m + 1) % V.length], B[m], sag).slice(0, -1)); }
        pieces.push({ pts: out, closed });
      } else if (e.type === 'VERTEX' || e.type === 'SEQEND') { /* consumed with POLYLINE */ }
      else if (e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'DIMENSION' || e.type === 'POINT' || e.type === 'HATCH' || e.type === 'LEADER') skipped[e.type] = (skipped[e.type] || 0) + 1;
      else if (e.type === 'SPLINE' || e.type === 'INSERT' || e.type === '3DFACE' || e.type === 'SOLID' || e.type === '3DSOLID' || e.type === 'REGION') warn.push(`${e.type} entities are not supported and were skipped. Explode splines to polylines or arcs in your CAD package, and explode blocks.`);
      else skipped[e.type] = (skipped[e.type] || 0) + 1;
    }
    for (const [t, n] of Object.entries(skipped)) if (!['TEXT', 'MTEXT', 'DIMENSION', 'POINT', 'HATCH', 'LEADER'].includes(t)) warn.push(`${n} ${t} entities ignored.`);
    return { pieces, warn: [...new Set(warn)], units };
  }

  // ---- SVG -> {pieces, warn, units}; y is flipped to y-up. Tags are scanned with a small tokenizer so Node can run it.
  function parseSVG(text, sag = 0.004) {
    const pieces = [], warn = []; let units = 'px';
    const mm = /<svg\b([^>]*)>/i.exec(text); if (!mm) throw new Error('No <svg> element found.');
    const attr = (s, n) => { const m = new RegExp('(?:^|\\s)' + n + '\\s*=\\s*"([^"]*)"|(?:^|\\s)' + n + "\\s*=\\s*'([^']*)'").exec(s); return m ? (m[1] !== undefined ? m[1] : m[2]) : null; };
    const wAttr = attr(mm[1], 'width'), vb = (attr(mm[1], 'viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let uscale = 1; // viewBox unit -> unit named by 'units'
    if (wAttr && vb.length === 4 && vb[2] > 0) { const m = /^([\d.eE+-]+)\s*(mm|cm|in|pt|px|m)?$/.exec(wAttr.trim()); if (m) { const u = m[2] || 'px'; const f = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96, m: 1000 }[u]; units = 'mm'; uscale = parseFloat(m[1]) * f / vb[2]; } }
    const mulM = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
    const parseT = (s) => { let M = [1, 0, 0, 1, 0, 0]; if (!s) return M; const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let m;
      while ((m = re.exec(s))) { const a = m[2].trim().split(/[\s,]+/).map(Number); let T;
        if (m[1] === 'matrix') T = a; else if (m[1] === 'translate') T = [1, 0, 0, 1, a[0], a[1] || 0]; else if (m[1] === 'scale') T = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0];
        else if (m[1] === 'rotate') { const r = a[0] * Math.PI / 180, c = Math.cos(r), s_ = Math.sin(r); T = [c, s_, -s_, c, 0, 0]; if (a.length === 3) T = mulM(mulM([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]); }
        else if (m[1] === 'skewX') T = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; else T = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0];
        M = mulM(M, T); } return M; };
    const stack = [[1, 0, 0, 1, 0, 0]]; let skipDepth = 0, depth = 0; const skipTags = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'style', 'text']);
    const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g; let m; const sk = [];
    const emit = (pts, closed, T) => { if (pts.length < 2) return; pieces.push({ pts: pts.map(([x, y]) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]]), closed }); };
    const flat = (pts) => pts;
    function path(d, T) {
      const toks = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cur = [], lcx = 0, lcy = 0, lastC = '';
      const nx = () => parseFloat(toks[i++]); const flag = () => { const t = toks[i++]; return t === '1' || t === '1.' ? 1 : (t === '0' ? 0 : (parseFloat(t) ? 1 : 0)); };
      const flush = (closed) => { emit(cur, closed, T); cur = []; };
      while (i < toks.length) {
        if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++]; const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        if (C === 'Z') { flush(true); x = sx; y = sy; lastC = 'Z'; continue; }
        if (C === 'M') { if (cur.length) flush(false); let a = nx(), b = nx(); if (rel) { a += x; b += y; } x = sx = a; y = sy = b; cur = [[x, y]]; cmd = rel ? 'l' : 'L'; lastC = 'M'; continue; }
        if (!cur.length) cur = [[x, y]];
        if (C === 'L') { let a = nx(), b = nx(); if (rel) { a += x; b += y; } x = a; y = b; cur.push([x, y]); }
        else if (C === 'H') { let a = nx(); if (rel) a += x; x = a; cur.push([x, y]); }
        else if (C === 'V') { let b = nx(); if (rel) b += y; y = b; cur.push([x, y]); }
        else if (C === 'C') { let a = [nx(), nx(), nx(), nx(), nx(), nx()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); cur.push(...bez([[x, y], [a[0], a[1]], [a[2], a[3]], [a[4], a[5]]], 24)); lcx = a[2]; lcy = a[3]; x = a[4]; y = a[5]; }
        else if (C === 'S') { let a = [nx(), nx(), nx(), nx()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); const c1 = lastC === 'C' || lastC === 'S' ? [2 * x - lcx, 2 * y - lcy] : [x, y]; cur.push(...bez([[x, y], c1, [a[0], a[1]], [a[2], a[3]]], 24)); lcx = a[0]; lcy = a[1]; x = a[2]; y = a[3]; }
        else if (C === 'Q') { let a = [nx(), nx(), nx(), nx()]; if (rel) a = a.map((v, j) => v + (j % 2 ? y : x)); cur.push(...bez([[x, y], [a[0], a[1]], [a[2], a[3]]], 16)); lcx = a[0]; lcy = a[1]; x = a[2]; y = a[3]; }
        else if (C === 'T') { let a = [nx(), nx()]; if (rel) { a[0] += x; a[1] += y; } const c1 = lastC === 'Q' || lastC === 'T' ? [2 * x - lcx, 2 * y - lcy] : [x, y]; cur.push(...bez([[x, y], c1, a], 16)); lcx = c1[0]; lcy = c1[1]; x = a[0]; y = a[1]; }
        else if (C === 'A') { const rx = nx(), ry = nx(), ph = nx(), fa = flag(), fs = flag(); let a = nx(), b = nx(); if (rel) { a += x; b += y; } cur.push(...svgArc(x, y, rx, ry, ph, fa, fs, a, b, sag / Math.max(1e-9, Math.abs(T[0]) || 1))); x = a; y = b; }
        else { warn.push('Unsupported path command ' + cmd); break; }
        lastC = C;
      }
      if (cur.length) flush(false);
    }
    while ((m = re.exec(text))) {
      const closing = m[1] === '/', tag = m[2].toLowerCase(), a = m[3], selfc = m[4] === '/';
      if (closing) { if (skipTags.has(tag)) skipDepth = Math.max(0, skipDepth - 1); if (tag === 'g' || tag === 'svg' || tag === 'a') stack.pop(); continue; }
      if (skipTags.has(tag)) { if (!selfc) skipDepth++; continue; }
      const T0 = stack[stack.length - 1], T = mulM(T0, parseT(attr(a, 'transform')));
      if (tag === 'g' || tag === 'a' || tag === 'svg') { if (!selfc) stack.push(T); continue; }
      if (skipDepth) continue;
      const num = (n, d = 0) => { const v = attr(a, n); return v === null ? d : parseFloat(v); };
      if (tag === 'path') path(attr(a, 'd') || '', T);
      else if (tag === 'rect') { const x = num('x'), y = num('y'), w = num('width'), h = num('height'); if (w > 0 && h > 0) emit([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, T); }
      else if (tag === 'circle' || tag === 'ellipse') { const cx = num('cx'), cy = num('cy'), rx = tag === 'circle' ? num('r') : num('rx'), ry = tag === 'circle' ? num('r') : num('ry'), n = 96, pts = []; for (let j = 0; j < n; j++) pts.push([cx + rx * Math.cos(2 * Math.PI * j / n), cy + ry * Math.sin(2 * Math.PI * j / n)]); emit(pts, true, T); }
      else if (tag === 'line') emit([[num('x1'), num('y1')], [num('x2'), num('y2')]], false, T);
      else if (tag === 'polygon' || tag === 'polyline') { const v = (attr(a, 'points') || '').trim().split(/[\s,]+/).map(Number), pts = []; for (let j = 0; j + 1 < v.length; j += 2) pts.push([v[j], v[j + 1]]); emit(pts, tag === 'polygon', T); }
    }
    // y flip and unit scale: SVG user units -> mm when width/viewBox gave a physical size, otherwise left in px for the unit picker
    for (const p of pieces) p.pts = p.pts.map(([x, y]) => [x * uscale, -y * uscale]);
    if (!pieces.length) warn.push('No paths, polygons, rectangles or circles found.');
    return { pieces, warn: [...new Set(warn)], units };
  }

  // ---- pieces -> closed loops
  function chain(pieces, scale = 1) {
    const warn = [], loops = [], open = [];
    const sc = (p) => p.map(([x, y]) => [x * scale, y * scale]);
    for (const p of pieces) { const pts = sc(p.pts); if (p.closed) loops.push(pts); else open.push(pts); }
    let ext = 0; { const all = loops.concat(open), b = bbox(all.length ? all : [[[0, 0]]]); ext = Math.max(b.x1 - b.x0, b.y1 - b.y0, 1); }
    const tol = 2e-4 * ext, near = (a, b) => hyp(a[0] - b[0], a[1] - b[1]) <= tol;
    const used = new Array(open.length).fill(false);
    for (let s = 0; s < open.length; s++) {
      if (used[s]) continue; used[s] = true; let c = open[s].slice(), progress = true;
      while (progress && !near(c[0], c[c.length - 1])) {
        progress = false;
        for (let j = 0; j < open.length; j++) { if (used[j]) continue; const o = open[j], e = c[c.length - 1];
          if (near(e, o[0])) { c = c.concat(o.slice(1)); used[j] = true; progress = true; break; }
          if (near(e, o[o.length - 1])) { c = c.concat(o.slice(0, -1).reverse()); used[j] = true; progress = true; break; } }
      }
      if (near(c[0], c[c.length - 1]) && c.length > 3) { c.pop(); loops.push(c); }
      else warn.push(`An open chain of ${c.length} points near (${c[0][0].toFixed(1)}, ${c[0][1].toFixed(1)}) mm does not close (gap ${hyp(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]).toFixed(2)} mm). Close it in your CAD package.`);
    }
    return { loops, warn };
  }
  function rdp(p, tol) {                                    // open polyline, keeps ends
    if (p.length < 3) return p; const a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = hyp(dx, dy); let md = -1, mi = 0;
    for (let i = 1; i < p.length - 1; i++) { const d = L < 1e-12 ? hyp(p[i][0] - a[0], p[i][1] - a[1]) : Math.abs(dx * (a[1] - p[i][1]) - (a[0] - p[i][0]) * dy) / L; if (d > md) { md = d; mi = i; } }
    if (md <= tol) return [a, b]; return rdp(p.slice(0, mi + 1), tol).slice(0, -1).concat(rdp(p.slice(mi), tol));
  }
  function simplifyLoop(l, tol) {                           // closed: split at the point farthest from the start so no chord is degenerate
    if (l.length < 8) return l; let m = 0, md = -1; for (let i = 1; i < l.length; i++) { const d = hyp(l[i][0] - l[0][0], l[i][1] - l[0][1]); if (d > md) { md = d; m = i; } }
    const A = rdp(l.slice(0, m + 1), tol), B = rdp(l.slice(m).concat([l[0]]), tol); return A.concat(B.slice(1, -1));
  }
  function segHit(p, q, r, s) {                             // proper crossing of segments pq and rs (touching counts)
    const d1x = q[0] - p[0], d1y = q[1] - p[1], d2x = s[0] - r[0], d2y = s[1] - r[1], den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-14) { // parallel: overlap test only if collinear
      const cr = (r[0] - p[0]) * d1y - (r[1] - p[1]) * d1x; if (Math.abs(cr) > 1e-9 * (hyp(d1x, d1y) + 1)) return false;
      const t0 = ((r[0] - p[0]) * d1x + (r[1] - p[1]) * d1y) / (d1x * d1x + d1y * d1y), t1 = ((s[0] - p[0]) * d1x + (s[1] - p[1]) * d1y) / (d1x * d1x + d1y * d1y); return Math.max(Math.min(t0, t1), 0) < Math.min(Math.max(t0, t1), 1) - 1e-9; }
    const t = ((r[0] - p[0]) * d2y - (r[1] - p[1]) * d2x) / den, u = ((r[0] - p[0]) * d1y - (r[1] - p[1]) * d1x) / den, e = 1e-9; return t > e && t < 1 - e && u > e && u < 1 - e;
  }
  // loops are simplified, then checked: >= 3 points, non-zero area, no crossings (within or between loops)
  function prepare(loopsIn, tol) {
    const errors = [], loops = [];
    for (let l of loopsIn) { l = simplifyLoop(l, tol); const c = []; for (const p of l) { const q = c[c.length - 1]; if (!q || hyp(p[0] - q[0], p[1] - q[1]) > 1e-9) c.push(p); } if (c.length > 1 && hyp(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 1e-9) c.pop();
      if (c.length >= 3 && Math.abs(polyArea(c)) > 1e-6) loops.push(c); }
    if (!loops.length) { errors.push('No closed outline found.'); return { loops, errors }; }
    const segs = []; loops.forEach((l, li) => l.forEach((p, i) => segs.push({ li, i, p, q: l[(i + 1) % l.length], x0: Math.min(p[0], l[(i + 1) % l.length][0]), x1: Math.max(p[0], l[(i + 1) % l.length][0]), y0: Math.min(p[1], l[(i + 1) % l.length][1]), y1: Math.max(p[1], l[(i + 1) % l.length][1]) })));
    segs.sort((a, b) => a.x0 - b.x0);
    outer: for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length && segs[b].x0 <= segs[a].x1 + 1e-9; b++) {
      const A = segs[a], B = segs[b]; if (B.y0 > A.y1 + 1e-9 || B.y1 < A.y0 - 1e-9) continue;
      const adj = A.li === B.li && (Math.abs(A.i - B.i) === 1 || Math.abs(A.i - B.i) === loops[A.li].length - 1); if (adj) continue;
      if (segHit(A.p, A.q, B.p, B.q)) { errors.push(`The outline crosses itself or another loop near (${A.p[0].toFixed(1)}, ${A.p[1].toFixed(1)}) mm.`); break outer; }
    }
    return { loops, errors };
  }
  function inside(loops, x, y) {                            // even-odd point in region
    let c = false; for (const l of loops) for (let i = 0, j = l.length - 1; i < l.length; j = i++) { const a = l[i], b = l[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c;
  }
  function distToBoundary(loops, x, y) {
    let best = Infinity; for (const l of loops) for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const d = hyp(x - a[0] - t * dx, y - a[1] - t * dy); if (d < best) best = d; } return best;
  }
  const signedDist = (loops, x, y) => (inside(loops, x, y) ? 1 : -1) * distToBoundary(loops, x, y);

  // ---- exact area coverage of the (even-odd) region on a grid, W x H mm, nx x ny cells, index ix*ny+iy with iy from the top
  function coverage(loops, W, H, nx, ny) {
    // orientation by nesting depth: outer loops one way, holes the other; the accumulation rasteriser then gives true area coverage
    const dep = loops.map((l, i) => { let d = 0; const p = l[0]; loops.forEach((o, j) => { if (j !== i && inside([o], p[0] + 1e-7, p[1] + 1e-7)) d++; }); return d; });
    const hx = W / nx, hy = H / ny, acc = new Float32Array((nx + 2) * ny);
    const W2 = nx + 2;
    for (let li = 0; li < loops.length; li++) {
      let l = loops[li]; const ccw = polyArea(l) > 0, want = dep[li] % 2 === 0; if (ccw !== want) l = l.slice().reverse();
      for (let i = 0; i < l.length; i++) {
        let x0 = l[i][0] / hx, y0 = (H - l[i][1]) / hy, x1 = l[(i + 1) % l.length][0] / hx, y1 = (H - l[(i + 1) % l.length][1]) / hy;
        if (y0 === y1) continue; let dir = 1; if (y0 > y1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; dir = -1; }
        const dxdy = (x1 - x0) / (y1 - y0); let x = x0; const ys = Math.max(0, Math.floor(y0)), ye = Math.min(ny, Math.ceil(y1));
        if (y0 < 0) x -= y0 * dxdy;
        for (let y = ys; y < ye; y++) {
          const dy = Math.min(y + 1, y1) - Math.max(y, y0), xn = x + dxdy * dy, d = dy * dir, xa = Math.min(x, xn), xb = Math.max(x, xn);
          const xc = (v) => Math.max(0, Math.min(nx, v)); const a = xc(xa), b = xc(xb), a0 = Math.floor(a), b1 = Math.ceil(b), row = y * W2;
          if (b1 <= a0 + 1) { const xm = 0.5 * (xc(x) + xc(xn)) - a0; acc[row + a0] += d - d * xm; acc[row + a0 + 1] += d * xm; }
          else { const s = 1 / (b - a), af = a - a0, aa0 = 0.5 * s * (1 - af) * (1 - af), bf = b - b1 + 1, am = 0.5 * s * bf * bf;
            acc[row + a0] += d * aa0;
            if (b1 === a0 + 2) acc[row + a0 + 1] += d * (1 - aa0 - am);
            else { const a1 = s * (1.5 - af); acc[row + a0 + 1] += d * (a1 - aa0); for (let xi = a0 + 2; xi < b1 - 1; xi++) acc[row + xi] += d * s; const a2 = a1 + (b1 - a0 - 3) * s; acc[row + b1 - 1] += d * (1 - a2 - am); }
            acc[row + b1] += d * am; }
          x = xn;
        }
      }
    }
    const cov = new Float32Array(nx * ny);
    for (let iy = 0; iy < ny; iy++) { let s = 0; for (let ix = 0; ix < nx; ix++) { s += acc[iy * W2 + ix]; cov[ix * ny + iy] = Math.min(1, Math.abs(s)); } }
    return cov;
  }

  // ---- squared Euclidean distance transform (Felzenszwalb & Huttenlocher), anisotropic spacing. mask: 1 = feature (distance 0)
  function edt2(mask, nx, ny, hx, hy) {
    const INF = 1e20, g = new Float64Array(nx * ny), tmp = new Float64Array(Math.max(nx, ny)), out = new Float64Array(Math.max(nx, ny)), v = new Int32Array(Math.max(nx, ny)), z = new Float64Array(Math.max(nx, ny) + 1);
    for (let i = 0; i < nx * ny; i++) g[i] = mask[i] ? 0 : INF;
    function pass(n, s) {                                   // lower envelope of parabolas at positions q*s with heights tmp[q]
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < n; q++) {
        let sx = ((tmp[q] + q * s * q * s) - (tmp[v[k]] + v[k] * s * v[k] * s)) / (2 * s * (q - v[k]));
        while (sx <= z[k]) { k--; sx = ((tmp[q] + q * s * q * s) - (tmp[v[k]] + v[k] * s * v[k] * s)) / (2 * s * (q - v[k])); }
        k++; v[k] = q; z[k] = sx; z[k + 1] = INF;
      }
      k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q * s) k++; const d = (q - v[k]) * s; out[q] = d * d + tmp[v[k]]; }
    }
    for (let ix = 0; ix < nx; ix++) { for (let iy = 0; iy < ny; iy++) tmp[iy] = g[ix * ny + iy]; pass(ny, hy); for (let iy = 0; iy < ny; iy++) g[ix * ny + iy] = out[iy]; }
    for (let iy = 0; iy < ny; iy++) { for (let ix = 0; ix < nx; ix++) tmp[ix] = g[ix * ny + iy]; pass(nx, hx); for (let ix = 0; ix < nx; ix++) g[ix * ny + iy] = out[ix]; }
    return g;
  }
  // Minimum inner corner radius: morphological closing of the solid with a disc of radius r (fills slots narrower than 2r and rounds every
  // re-entrant corner to at least r). Cells outside the grid count as void. Returns a Uint8 mask of the cells that were added.
  function closingAdded(solid, nx, ny, hx, hy, r) {
    const add = new Uint8Array(nx * ny); if (!(r > 0)) return add;
    const pad = 0.5 * Math.max(hx, hy), m = Math.ceil((r + pad) / Math.min(hx, hy)) + 2, PX = nx + 2 * m, PY = ny + 2 * m;
    const sp = new Uint8Array(PX * PY); for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) if (solid[ix * ny + iy]) sp[(ix + m) * PY + iy + m] = 1;
    const dS = edt2(sp, PX, PY, hx, hy), E = new Uint8Array(PX * PY);
    for (let i = 0; i < PX * PY; i++) if (!sp[i] && Math.sqrt(dS[i]) >= r + pad) E[i] = 1;         // void cells whose r-disc fits entirely in void
    const dE = edt2(E, PX, PY, hx, hy);
    for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) { const i = (ix + m) * PY + iy + m; if (!sp[i] && !(Math.sqrt(dE[i]) <= r + pad + 0.5 * Math.max(hx, hy))) add[ix * ny + iy] = 1; }   // not within r of an eroded cell: not part of the opened void (half a cell of slack so pixel stair-steps do not add noise)
    return add;
  }
  return { polyArea, bbox, parseDXF, parseSVG, chain, prepare, simplifyLoop, inside, distToBoundary, signedDist, coverage, edt2, closingAdded, arcPts, bulgeArc };
})();
if (typeof module !== 'undefined') module.exports = Geom;
