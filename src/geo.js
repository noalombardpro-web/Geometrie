// Moteur géométrique n-D (n = 2, 3 ou 4). Toutes les valeurs internes sont en coordonnées du MONDE (orthonormé).
// Le repère (O; e1…en) sert à saisir et afficher les coordonnées.

export const EPS = 1e-9;
export const PI = Math.PI;
export const zeros = n => Array(n).fill(0);
export const pad = (a, n) => { const r = a.slice(0, n); while (r.length < n) r.push(0); return r; };
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const mul = (a, k) => a.map(x => x * k);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const norm = a => Math.sqrt(dot(a, a));
export const dist = (a, b) => norm(sub(a, b));
export const mid = (a, b) => a.map((x, i) => (x + b[i]) / 2);
export const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export const isZero = (a, e = 1e-9) => a.every(x => Math.abs(x) < e);
export const unit = a => { const n = norm(a); return n < EPS ? a.slice() : mul(a, 1 / n); };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const det2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export const det3 = (a, b, c) => dot(a, cross(b, c));
export const near = (x, y, e = 1e-7) => Math.abs(x - y) <= e * Math.max(1, Math.abs(x), Math.abs(y));
// colinéaires : tous les mineurs 2×2 sont nuls
export function parallel(a, b, e = 1e-9) {
  const s = norm(a) * norm(b);
  if (s < EPS) return true;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (Math.abs(a[i] * b[j] - a[j] * b[i]) > e * s) return false;
  return true;
}
export const orthogonal = (a, b, e = 1e-9) => Math.abs(dot(a, b)) <= e * Math.max(1, norm(a) * norm(b));

export function matInv(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map(r => r.slice(n));
}
export const matVec = (M, v) => M.map(r => dot(r, v));
export const transpose = M => M[0].map((_, j) => M.map(r => r[j]));
export const identity = n => Array.from({ length: n }, (_, i) => zeros(n).map((_, j) => +(i === j)));

// ---------- Repère ----------
export class Frame {
  constructor(n = 3) { this.set(n); }
  set(n, O, B) {
    this.n = n;
    this.O = O ? pad(O, n) : zeros(n);
    this.B = B ? B.map(v => pad(v, n)) : identity(n);
    this.M = transpose(this.B);                     // colonnes = e_i
    this.Minv = matInv(this.M);
    this.singular = !this.Minv;
    if (!this.Minv) { this.B = identity(n); this.M = identity(n); this.Minv = identity(n); }
  }
  pos(c) { return add(this.O, this.vec(c)); }                 // repère → monde (point)
  vec(c) { return matVec(this.M, pad(c, this.n)); }           // repère → monde (vecteur)
  toPos(w) { return this.toVec(sub(w, this.O)); }             // monde → repère (point)
  toVec(w) { return matVec(this.Minv, w); }                   // monde → repère (vecteur)
  covToWorld(a) { return matVec(transpose(this.Minv), a); }   // a·c = h  ↔  n·(w−O) = h
  worldToCov(n) { return matVec(transpose(this.M), n); }
  gram() { return this.B.map(a => this.B.map(b => dot(a, b))); }
  isOrtho() { const G = this.gram(); return G.every((r, i) => r.every((x, j) => Math.abs(x - (i === j)) < 1e-9)); }
  isStd() { return this.isOrtho() && isZero(this.O); }
}

// ---------- Formatage (valeurs exactes quand c'est possible) ----------
export function ratio(x, maxq = 60) {
  if (!isFinite(x)) return null;
  const s = Math.sign(x), a = Math.abs(x);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = a;
  for (let i = 0; i < 24; i++) {
    const ai = Math.floor(b), h2 = ai * h1 + h0, k2 = ai * k1 + k0;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (k1 > maxq) return null;
    if (Math.abs(a - h1 / k1) < 1e-9 * Math.max(1, a)) return [s * h1, k1];
    const fr = b - ai; if (fr < 1e-12) break; b = 1 / fr;
  }
  return null;
}
export const dec = (x, d = 4) => {
  const r = Math.round(x * 10 ** d) / 10 ** d;
  return (Object.is(r, -0) ? 0 : r).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ').replace('-', '−');
};
const SQ = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30];
// valeur exacte lisible : entier, fraction, a√b, (a√b)/q
export function exact(x) {
  if (Math.abs(x) < 1e-10) return { s: '0', ex: true };
  const r = ratio(x);
  if (r) return { s: (r[1] === 1 ? `${r[0]}` : `${r[0]}/${r[1]}`).replace('-', '−'), ex: true };
  for (const b of SQ) {
    const r2 = ratio(x / Math.sqrt(b), 12);
    if (r2 && Math.abs(r2[0]) <= 60) {
      const [p, q] = r2, ap = Math.abs(p);
      return { s: `${p < 0 ? '−' : ''}${ap === 1 ? '' : ap}√${b}${q === 1 ? '' : '/' + q}`, ex: true };
    }
  }
  const r3 = ratio(x / PI, 24);
  if (r3 && Math.abs(r3[0]) <= 60) { const [p, q] = r3, ap = Math.abs(p); return { s: `${p < 0 ? '−' : ''}${ap === 1 ? '' : ap}π${q === 1 ? '' : '/' + q}`, ex: true }; }
  return { s: dec(x), ex: false };
}
export const nice = x => exact(x).s;
export const niceApprox = x => { const e = exact(x); return e.ex && !/^−?\d+$/.test(e.s) ? `${e.s} ≈ ${dec(x)}` : e.s; };
export const niceVec = (c, sep = " ; ") => `(${c.map(nice).join(sep)})`;
export const deg = r => r * 180 / PI;
export const rad = d => d * PI / 180;

// ---------- Droites, demi-droites, segments : {p, d, lo, hi} ----------
export function lineLike(v) {
  if (v.t === 'line') return { p: v.p, d: v.d, lo: -Infinity, hi: Infinity };
  if (v.t === 'ray') return { p: v.p, d: v.d, lo: 0, hi: Infinity };
  if (v.t === 'seg') return { p: v.a, d: sub(v.b, v.a), lo: 0, hi: 1 };
  if (v.t === 'vec' && v.from) return { p: v.from, d: v.v, lo: 0, hi: 1 };
  return null;
}
export const inRange = (t, L) => t >= L.lo - 1e-9 && t <= L.hi + 1e-9;

export const projPtLine = (P, p, d) => add(p, mul(d, dot(sub(P, p), d) / dot(d, d)));
export const projPtPlane = (P, p, n) => sub(P, mul(n, dot(sub(P, p), n) / dot(n, n)));
export const distPtLine = (P, p, d) => dist(P, projPtLine(P, p, d));
export const distPtPlane = (P, p, n) => Math.abs(dot(sub(P, p), n)) / norm(n);

// Position relative de deux droites : confondues / parallèles / sécantes / non coplanaires
export function relLineLine(l1, l2) {
  const w = sub(l2.p, l1.p);
  if (parallel(l1.d, l2.d)) return { type: parallel(w, l1.d) ? 'confondues' : 'parallèles', dist: distPtLine(l2.p, l1.p, l1.d) };
  const a = dot(l1.d, l1.d), b = dot(l1.d, l2.d), c = dot(l2.d, l2.d), e = dot(l1.d, w), f = dot(l2.d, w);
  const D = a * c - b * b, t = (e * c - b * f) / D, s = (b * e - a * f) / D;
  const q1 = add(l1.p, mul(l1.d, t)), q2 = add(l2.p, mul(l2.d, s));
  const gap = dist(q1, q2);
  return { type: gap < 1e-7 * Math.max(1, norm(w)) ? 'sécantes' : 'non coplanaires', t, s, point: q1, dist: gap };
}
export function relLinePlane(l, P) {
  const nd = dot(P.n, l.d), h = dot(P.n, sub(P.p, l.p));
  if (Math.abs(nd) < 1e-9 * norm(P.n) * norm(l.d)) return { type: Math.abs(h) < 1e-9 * norm(P.n) * Math.max(1, norm(sub(P.p, l.p))) ? 'contenue' : 'parallèle' };
  const t = h / nd; return { type: 'sécants', t, point: add(l.p, mul(l.d, t)) };
}
export function relPlanePlane(P, Q) {
  const d = cross(P.n, Q.n);
  if (norm(d) < 1e-9 * norm(P.n) * norm(Q.n)) return { type: Math.abs(dot(P.n, sub(Q.p, P.p))) < 1e-9 * norm(P.n) * Math.max(1, norm(sub(Q.p, P.p))) ? 'confondus' : 'parallèles' };
  const h1 = dot(P.n, P.p), h2 = dot(Q.n, Q.p), dd = dot(d, d);
  const x0 = mul(add(mul(cross(Q.n, d), h1), mul(cross(d, P.n), h2)), 1 / dd);
  return { type: 'sécants', line: { p: x0, d } };
}
export function lineSphere(l, c, r) {
  const a = dot(l.d, l.d), pc = sub(l.p, c), b = 2 * dot(l.d, pc), k = dot(pc, pc) - r * r, D = b * b - 4 * a * k;
  if (D < -1e-12) return [];
  const sq = Math.sqrt(Math.max(D, 0)), ts = D < 1e-12 ? [-b / (2 * a)] : [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
  return ts.filter(t => inRange(t, l)).map(t => add(l.p, mul(l.d, t)));
}
// base orthonormée du plan de normale n
export function planeBasis(n) {
  const nn = unit(n), h = Math.abs(nn[2]) < .9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(h, nn)), v = cross(nn, u); return [u, v];
}

// ---------- Solides ----------
export const edgesOfFaces = faces => {
  const seen = new Set(), E = [];
  for (const f of faces) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], k = a < b ? a + ',' + b : b + ',' + a;
    if (!seen.has(k)) { seen.add(k); E.push([a, b]); }
  }
  return E;
};
const mk = (verts, faces, name, extra = {}) => ({ t: 'solid', name, verts, faces, edges: edgesOfFaces(faces), ...extra });
const O3 = A => A.slice(0, 3);

export function cube(A, a) {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(c => add(A, mul(pad(c, A.length), a)));
  return mk(v, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], 'cube', { dims: { a } });
}
export function box(A, L, l, h) {
  const v = [[0, 0, 0], [L, 0, 0], [L, l, 0], [0, l, 0], [0, 0, h], [L, 0, h], [L, l, h], [0, l, h]].map(c => add(A, pad(c, A.length)));
  return mk(v, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], 'pavé', { dims: { L, l, h } });
}
export const tetra = (A, B, C, D) => mk([A, B, C, D], [[0, 1, 2], [0, 1, 3], [1, 2, 3], [0, 2, 3]], 'tétraèdre');
export function tetraRegular(A, a) {
  const s3 = Math.sqrt(3), s6 = Math.sqrt(2 / 3);
  const B = add(A, [a, 0, 0]), C = add(A, [a / 2, a * s3 / 2, 0]), D = add(A, [a / 2, a * s3 / 6, a * s6]);
  return { ...tetra(A, B, C, D), name: 'tétraèdre régulier', dims: { a } };
}
export function pyramid(S, base) {
  const n = base.length, faces = [Array.from({ length: n }, (_, i) => i + 1)];
  for (let i = 0; i < n; i++) faces.push([0, i + 1, (i + 1) % n + 1]);
  return mk([S, ...base], faces, 'pyramide');
}
export function prism(A, B, C, u) {
  const v = [A, B, C, add(A, u), add(B, u), add(C, u)];
  return mk(v, [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], 'prisme');
}
// Polytopes de ℝ⁴ : sommets + arêtes (pas de faces dessinées)
export function hypercube(A, a) {
  const verts = [], edges = [];
  for (let i = 0; i < 16; i++) verts.push(add(A, [i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1].map(x => x * a)));
  for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) edges.push([i, i | (1 << b)]);
  return { t: 'solid', name: 'hypercube', verts, faces: [], edges, dim4: true, counts: [16, 32, 24, 8], dims: { a } };
}
export function pentachore(A, a) {
  const k = a / (2 * Math.SQRT2), s = 1 / Math.sqrt(5);
  const base = [[1, 1, 1, -s], [1, -1, -1, -s], [-1, 1, -1, -s], [-1, -1, 1, -s], [0, 0, 0, 4 * s]];
  const verts = base.map(p => add(A, mul(p, k))), edges = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([i, j]);
  return { t: 'solid', name: 'pentachore', verts, faces: [], edges, dim4: true, counts: [5, 10, 10, 5], dims: { a } };
}
export function hexadecachore(A, a) {
  const r = a / Math.SQRT2, verts = [], edges = [];
  for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const p = [0, 0, 0, 0]; p[i] = s * r; verts.push(add(A, p)); }
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if ((i >> 1) !== (j >> 1)) edges.push([i, j]);
  return { t: 'solid', name: 'hexadécachore', verts, faces: [], edges, dim4: true, counts: [8, 24, 32, 16], dims: { a } };
}
// Volume (convexe) et aire d'un polyèdre de ℝ³
export function polyMetrics(s) {
  const V = s.verts.map(O3), c = V.reduce((p, q) => add(p, q), [0, 0, 0]).map(x => x / V.length);
  let vol = 0, area = 0;
  for (const f of s.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = V[f[0]], b = V[f[i]], d = V[f[i + 1]];
      vol += Math.abs(det3(sub(a, c), sub(b, c), sub(d, c))) / 6;
      area += norm(cross(sub(b, a), sub(d, a))) / 2;
    }
  }
  return { vol, area };
}
