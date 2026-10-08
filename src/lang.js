// Langage de commandes (à la GeoGebra) : analyse, évaluation, bibliothèque de constructions.
import * as G from './geo.js';
const { add, sub, mul, dot, norm, cross, pad, unit } = G;

export class LangError extends Error {}
const fail = m => { throw new LangError(m); };

// ---------- Analyse lexicale ----------
const NUM = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
const ID = /^[\p{L}_][\p{L}\p{N}_′']*/u;
export function tokenize(s) {
  const t = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    let m;
    if ((m = NUM.exec(s.slice(i)))) {
      t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length;
      if (s[i] && /[\p{L}_(√]/u.test(s[i]) && !/^[eE][+-]?\d/.test(s.slice(i))) t.push({ k: 'op', v: '*' });
      continue;
    }
    if ((m = ID.exec(s.slice(i)))) { t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    const map = { '·': '*', '−': '-', '–': '-', '÷': '/', '×': 'x', '²': '^2', '³': '^3', '√': 'sqrt' };
    if (c === '²' || c === '³') { t.push({ k: 'op', v: '^' }, { k: 'num', v: c === '²' ? 2 : 3 }); i++; continue; }
    if (c === '√') { t.push({ k: 'sqrt' }); i++; continue; }
    if (c === '×') { t.push({ k: 'op', v: 'x' }); i++; continue; }
    const cc = map[c] || c;
    if ('+-*/^(),=:'.includes(cc)) { t.push({ k: 'op', v: cc }); i++; continue; }
    fail(`Caractère inattendu « ${c} »`);
  }
  return t;
}

// ---------- Analyse syntaxique ----------
export function parseExpr(src) {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p], eat = () => t[p++];
  const isOp = v => t[p] && t[p].k === 'op' && t[p].v === v;
  function expr() { return add_(); }
  function add_() {
    let l = mul_();
    while (isOp('+') || isOp('-')) { const op = eat().v; l = { k: 'bin', op, l, r: mul_() }; }
    return l;
  }
  function mul_() {
    let l = unary();
    while (isOp('*') || isOp('/') || isOp('x')) { const op = eat().v; l = { k: 'bin', op: op === 'x' ? 'cross' : op, l, r: unary() }; }
    return l;
  }
  function unary() {
    if (isOp('-')) { eat(); return { k: 'neg', x: unary() }; }
    if (isOp('+')) { eat(); return unary(); }
    return pow();
  }
  function pow() {
    const b = primary();
    if (isOp('^')) { eat(); return { k: 'bin', op: '^', l: b, r: unary() }; }
    return b;
  }
  function primary() {
    const tk = eat();
    if (!tk) fail('Expression incomplète');
    if (tk.k === 'num') return { k: 'num', v: tk.v };
    if (tk.k === 'sqrt') return { k: 'call', f: 'sqrt', args: [unary()] };
    if (tk.k === 'id') {
      if (isOp('(')) {
        eat(); const args = [];
        if (!isOp(')')) { do { args.push(expr()); } while (isOp(',') && eat()); }
        if (!isOp(')')) fail('Parenthèse fermante manquante'); eat();
        return { k: 'call', f: tk.v, args };
      }
      return { k: 'id', v: tk.v };
    }
    if (tk.k === 'op' && tk.v === '(') {
      const items = [expr()];
      while (isOp(',')) { eat(); items.push(expr()); }
      if (!isOp(')')) fail('Parenthèse fermante manquante'); eat();
      return items.length === 1 ? items[0] : { k: 'tuple', items };
    }
    fail(`Symbole inattendu « ${tk.v ?? ''} »`);
  }
  const ast = expr();
  if (p < t.length) fail(`Symbole inattendu « ${t[p].v ?? ''} »`);
  return ast;
}
const hasVars = (a, names = ['x', 'y', 'z']) => {
  if (!a) return false;
  switch (a.k) {
    case 'id': return names.includes(a.v);
    case 'bin': return hasVars(a.l, names) || hasVars(a.r, names);
    case 'neg': return hasVars(a.x, names);
    case 'tuple': return a.items.some(i => hasVars(i, names));
    case 'call': return a.args.some(i => hasVars(i, names));
    default: return false;
  }
};

// « Nom = rhs », « Nom : équation », équation seule ou expression
export function parseStatement(src) {
  src = src.trim().replace(/;$/, '');
  if (!src) fail('Commande vide');
  const NAME = '([\\p{L}][\\p{L}\\p{N}_′\']*)';
  let m = new RegExp(`^${NAME}\\s*:\\s*(.+)$`, 'su').exec(src);
  if (m) return { name: m[1], ...classify(m[2]) };
  m = new RegExp(`^${NAME}\\s*=\\s*(.+)$`, 'su').exec(src);
  if (m && !/^[xyz]$/.test(m[1])) {
    let ast = null; try { ast = parseExpr(m[2]); } catch { /* équation */ }
    if (ast && !hasVars(ast)) return { name: m[1], kind: 'expr', ast, src: m[2] };
  }
  return classify(src);
}
function classify(rhs) {
  if (rhs.includes('=')) {
    const [l, r, ...rest] = rhs.split('=');
    if (rest.length) fail('Une équation ne contient qu’un seul « = »');
    return { kind: 'eq', lhs: parseExpr(l), rhs: parseExpr(r), src: rhs };
  }
  return { kind: 'expr', ast: parseExpr(rhs), src: rhs };
}

// ---------- Valeurs ----------
const num = v => ({ t: 'num', v });
const CONST = { pi: Math.PI, 'π': Math.PI, e: Math.E };
export const norm_key = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function asNum(v) {
  if (v.t === 'num') return v.v;
  if (v.t === 'angle') return v.v;
  fail('Un nombre est attendu');
}
function asPt(v, ctx) {
  if (v.t === 'pt') return v.p;
  if (v.t === 'tuple') return ctx.frame.pos(v.c);
  fail('Un point est attendu');
}
function asVec(v, ctx) {
  if (v.t === 'vec') return v.v;
  if (v.t === 'tuple') return ctx.frame.vec(v.c);
  if (v.t === 'seg') return sub(v.b, v.a);
  fail('Un vecteur est attendu');
}
const isVecLike = v => v.t === 'vec' || v.t === 'seg';
const isPtLike = v => v.t === 'pt' || v.t === 'tuple';
const isLine = v => ['line', 'ray', 'seg'].includes(v.t);

// ---------- Évaluation ----------
export function evalAst(a, ctx) {
  switch (a.k) {
    case 'num': return num(a.v);
    case 'id': {
      if (ctx.vars && a.v in ctx.vars) return num(ctx.vars[a.v]);
      const o = ctx.get(a.v); if (o) return o;
      const c = CONST[a.v] ?? CONST[a.v.toLowerCase()]; if (c !== undefined) return num(c);
      return fail(`« ${a.v} » n’est pas défini`);
    }
    case 'tuple': {
      const n = ctx.frame.n;
      if (a.items.length > n) fail(`Ce repère est en ${n}D : ${a.items.length} coordonnées données`);
      return { t: 'tuple', c: pad(a.items.map(i => asNum(evalAst(i, ctx))), n) };
    }
    case 'neg': {
      const v = evalAst(a.x, ctx);
      if (v.t === 'num' || v.t === 'angle') return num(-asNum(v));
      if (v.t === 'tuple') return { t: 'tuple', c: v.c.map(x => -x) };
      if (v.t === 'vec') return { t: 'vec', v: v.v.map(x => -x) };
      return fail('Opposé impossible ici');
    }
    case 'bin': return binop(a.op, evalAst(a.l, ctx), evalAst(a.r, ctx), ctx);
    case 'call': {
      const fn = COMMANDS[norm_key(a.f)];
      if (!fn) fail(`Commande inconnue : ${a.f}`);
      return fn(a.args.map(x => evalAst(x, ctx)), ctx);
    }
  }
  return fail('Expression invalide');
}

function binop(op, l, r, ctx) {
  const F = ctx.frame;
  if (l.t === 'angle') l = num(l.v);
  if (r.t === 'angle') r = num(r.v);
  if (l.t === 'num' && r.t === 'num') {
    switch (op) {
      case '+': return num(l.v + r.v); case '-': return num(l.v - r.v); case '*': return num(l.v * r.v);
      case '/': if (r.v === 0) fail('Division par zéro'); return num(l.v / r.v);
      case '^': return num(l.v ** r.v);
      default: fail('Opération impossible entre deux nombres');
    }
  }
  if (l.t === 'tuple' && r.t === 'tuple') {
    if (op === '+') return { t: 'tuple', c: add(l.c, r.c) };
    if (op === '-') return { t: 'tuple', c: sub(l.c, r.c) };
    l = { t: 'vec', v: F.vec(l.c) }; r = { t: 'vec', v: F.vec(r.c) };
  }
  if (op === '*' && l.t === 'num' && r.t === 'tuple') return { t: 'tuple', c: mul(r.c, l.v) };
  if (op === '*' && r.t === 'num' && l.t === 'tuple') return { t: 'tuple', c: mul(l.c, r.v) };
  if (op === '/' && r.t === 'num' && l.t === 'tuple') return { t: 'tuple', c: mul(l.c, 1 / r.v) };
  if (l.t === 'tuple') l = (op === '-' && r.t === 'pt') ? { t: 'pt', p: F.pos(l.c) } : { t: 'vec', v: F.vec(l.c) };
  if (r.t === 'tuple') r = { t: 'vec', v: F.vec(r.c) };
  if (l.t === 'seg') l = { t: 'vec', v: asVec(l) };
  if (r.t === 'seg') r = { t: 'vec', v: asVec(r) };
  const pt = x => x.t === 'pt', vc = x => x.t === 'vec';
  if (op === '+') {
    if (pt(l) && vc(r)) return { t: 'pt', p: add(l.p, r.v) };
    if (vc(l) && pt(r)) return { t: 'pt', p: add(l.v, r.p) };
    if (vc(l) && vc(r)) return { t: 'vec', v: add(l.v, r.v) };
    fail('Addition impossible (point + point ?)');
  }
  if (op === '-') {
    if (pt(l) && pt(r)) return { t: 'vec', v: sub(l.p, r.p), from: r.p };
    if (pt(l) && vc(r)) return { t: 'pt', p: sub(l.p, r.v) };
    if (vc(l) && vc(r)) return { t: 'vec', v: sub(l.v, r.v) };
    fail('Soustraction impossible');
  }
  if (op === '*') {
    if (l.t === 'num' && vc(r)) return { t: 'vec', v: mul(r.v, l.v) };
    if (vc(l) && r.t === 'num') return { t: 'vec', v: mul(l.v, r.v) };
    if (vc(l) && vc(r)) return num(dot(l.v, r.v));
    fail('Produit impossible : « * » est le produit scalaire pour deux vecteurs');
  }
  if (op === '/' && vc(l) && r.t === 'num') return { t: 'vec', v: mul(l.v, 1 / r.v) };
  if (op === 'cross' && vc(l) && vc(r)) {
    if (F.n === 3) return { t: 'vec', v: cross(l.v, r.v) };
    if (F.n === 2) return num(G.det2(l.v, r.v));
    fail('Le produit vectoriel n’existe qu’en dimension 3');
  }
  return fail('Opération non définie pour ces objets');
}

// ---------- Équations (droites, plans, cercles, sphères) ----------
export function evalEquation(st, ctx) {
  const F = ctx.frame, n = F.n, names = ['x', 'y', 'z', 'w'];
  const f = c => {
    const vars = {}; c.forEach((x, i) => vars[names[i]] = x);
    const sub_ = { ...ctx, vars };
    return asNum(evalAst(st.lhs, sub_)) - asNum(evalAst(st.rhs, sub_));
  };
  const Z = Array(n).fill(0), k = f(Z), l = [], q = [];
  for (let i = 0; i < n; i++) {
    const e = Z.slice(); e[i] = 1; const m = Z.slice(); m[i] = -1;
    const a = f(e), b = f(m); l.push((a - b) / 2); q.push((a + b) / 2 - k);
  }
  const probe = Z.map((_, i) => 0.7 + 0.37 * i), pred = k + l.reduce((s, x, i) => s + x * probe[i], 0) + q.reduce((s, x, i) => s + x * probe[i] ** 2, 0);
  const got = f(probe);
  if (!isFinite(got) || Math.abs(got - pred) > 1e-6 * (1 + Math.abs(got))) fail('Équation non reconnue (linéaire ou cercle/sphère attendu)');
  const linear = q.every(x => Math.abs(x) < 1e-9);
  if (linear) {
    if (l.every(x => Math.abs(x) < 1e-12)) fail('Équation dégénérée');
    if (n === 4) fail('Les hyperplans de ℝ⁴ ne sont pas dessinés');
    const h = -k, a2 = dot(l, l), cc = mul(l, h / a2), p = F.pos(cc), nw = F.covToWorld(l);
    if (n === 2) return { t: 'line', p, d: [-nw[1], nw[0]] };
    return { t: 'plane', p, n: nw };
  }
  if (!F.isOrtho()) fail('Équation de cercle/sphère : repère orthonormé requis');
  const q0 = q[0];
  if (!q.every(x => Math.abs(x - q0) < 1e-9) || Math.abs(q0) < 1e-12) fail('Équation quadratique non reconnue (cercle/sphère attendu)');
  const c = l.map(x => -x / (2 * q0)), r2 = dot(c, c) - k / q0;
  if (r2 < 0) fail('Équation sans solution réelle');
  const center = F.pos(c), r = Math.sqrt(r2);
  return n === 2 ? { t: 'circle', c: center, r, n: [0, 0, 1] } : { t: 'sphere', c: center, r };
}

// ---------- Transformations d'objets ----------
function mapObj(o, fp, fv) {
  switch (o.t) {
    case 'pt': return { t: 'pt', p: fp(o.p) };
    case 'vec': return { ...o, v: fv(o.v), from: o.from && fp(o.from) };
    case 'seg': return { t: 'seg', a: fp(o.a), b: fp(o.b) };
    case 'line': case 'ray': return { ...o, p: fp(o.p), d: fv(o.d) };
    case 'plane': return { ...o, p: fp(o.p), n: o.n };
    case 'poly': return { t: 'poly', pts: o.pts.map(fp) };
    case 'sphere': return { ...o, c: fp(o.c) };
    case 'circle': return { ...o, c: fp(o.c) };
    case 'solid': return { ...o, verts: o.verts.map(fp) };
    case 'cyl': case 'cone': return { ...o, a: fp(o.a), b: fp(o.b) };
    default: return fail('Transformation impossible pour cet objet');
  }
}

// ---------- Bibliothèque de commandes ----------
const COMMANDS = {};
const def = (names, fn) => names.split(' ').forEach(n => COMMANDS[n] = fn);
export const DOC = [];   // [syntaxe, description] pour l'aide / l'autocomplétion
const doc = (syntax, text) => DOC.push([syntax, text]);

const mathFn = (names, f) => def(names, a => num(f(...a.map(asNum))));
mathFn('sqrt racine', Math.sqrt); mathFn('abs', Math.abs); mathFn('sin', Math.sin); mathFn('cos', Math.cos); mathFn('tan', Math.tan);
mathFn('asin arcsin', Math.asin); mathFn('acos arccos', Math.acos); mathFn('atan arctan', Math.atan);
mathFn('ln', Math.log); mathFn('log', Math.log10); mathFn('exp', Math.exp); mathFn('floor', Math.floor); mathFn('ceil', Math.ceil);
mathFn('round arrondi', Math.round); mathFn('min', Math.min); mathFn('max', Math.max); mathFn('sign', Math.sign); mathFn('pow', Math.pow);
mathFn('deg degres', G.deg); mathFn('rad radians', G.rad);
doc('sqrt(x), sin(x), cos(x), ln(x), deg(x)…', 'Fonctions usuelles');

def('vecteur vector', (a, ctx) => {
  if (a.length === 1) return { t: 'vec', v: asVec(a[0], ctx) };
  const A = asPt(a[0], ctx);
  if (a[1].t === 'vec') return { t: 'vec', v: a[1].v, from: A };
  const B = asPt(a[1], ctx); return { t: 'vec', v: sub(B, A), from: A };
});
doc('Vecteur(A, B)', 'Vecteur AB, tracé depuis A');
def('segment', (a, ctx) => ({ t: 'seg', a: asPt(a[0], ctx), b: asPt(a[1], ctx) }));
doc('Segment(A, B)', 'Segment [AB]');
def('droite line', (a, ctx) => {
  if (a.length === 1 && a[0].t === 'seg') return { t: 'line', p: a[0].a, d: sub(a[0].b, a[0].a) };
  const A = asPt(a[0], ctx), d = a[1].t === 'vec' ? a[1].v : sub(asPt(a[1], ctx), A);
  if (G.isZero(d)) fail('Direction nulle');
  return { t: 'line', p: A, d };
});
doc('Droite(A, B)  ·  Droite(A, u)', 'Droite par deux points, ou par A de vecteur directeur u');
def('demidroite ray', (a, ctx) => {
  const A = asPt(a[0], ctx), d = a[1].t === 'vec' ? a[1].v : sub(asPt(a[1], ctx), A);
  return { t: 'ray', p: A, d };
});
doc('Demi-droite(A, B)', 'Demi-droite [AB)');
def('plan plane', (a, ctx) => {
  if (ctx.frame.n !== 3) fail('Les plans existent en dimension 3');
  if (a.length === 4 && a.every(x => x.t === 'num')) {          // ax+by+cz=d dans le repère
    const [ca, cb, cc, h] = a.map(asNum), co = [ca, cb, cc];
    if (G.isZero(co)) fail('Normale nulle');
    return { t: 'plane', p: ctx.frame.pos(mul(co, h / dot(co, co))), n: ctx.frame.covToWorld(co) };
  }
  const A = asPt(a[0], ctx);
  const vecs = a.slice(1).some(isVecLike);
  if (a.length === 2) {                                         // Plan(A, n) : normale
    const n = asVec(a[1], ctx); if (G.isZero(n)) fail('Normale nulle'); return { t: 'plane', p: A, n };
  }
  let u, v;
  if (vecs) { u = asVec(a[1], ctx); v = asVec(a[2], ctx); } else { u = sub(asPt(a[1], ctx), A); v = sub(asPt(a[2], ctx), A); }
  const n = cross(u, v);
  if (G.isZero(n, 1e-9)) fail(vecs ? 'Vecteurs colinéaires' : 'Points alignés : pas de plan');
  return { t: 'plane', p: A, n, u, v };
});
doc('Plan(A, B, C)  ·  Plan(A, u, v)  ·  Plan(A, n)  ·  Plan(a, b, c, d)', 'Plan par 3 points, par A dirigé par u et v, de normale n, ou ax+by+cz=d');
def('milieu midpoint', (a, ctx) => a.length === 1 && a[0].t === 'seg' ? { t: 'pt', p: G.mid(a[0].a, a[0].b) } : { t: 'pt', p: G.mid(asPt(a[0], ctx), asPt(a[1], ctx)) });
doc('Milieu(A, B)', 'Milieu de [AB]');
def('barycentre barycenter', (a, ctx) => {
  let s = 0, p = G.zeros(ctx.frame.n);
  for (let i = 0; i < a.length; i += 2) { const k = asNum(a[i + 1]); s += k; p = add(p, mul(asPt(a[i], ctx), k)); }
  if (Math.abs(s) < 1e-12) fail('Somme des coefficients nulle : barycentre inexistant');
  return { t: 'pt', p: mul(p, 1 / s) };
});
doc('Barycentre(A, a, B, b, …)', 'Barycentre de (A,a), (B,b)… (a + b + … ≠ 0)');
def('point', (a, ctx) => ({ t: 'pt', p: asPt(a[0], ctx) }));

const segDist = (P, s) => { const d = sub(s.b, s.a), t = Math.max(0, Math.min(1, dot(sub(P, s.a), d) / dot(d, d))); return G.dist(P, add(s.a, mul(d, t))); };
def('distance dist', (a, ctx) => {
  if (a.length === 2 && isPtLike(a[0]) && isPtLike(a[1])) return num(G.dist(asPt(a[0], ctx), asPt(a[1], ctx)));
  const [x, y] = isPtLike(a[0]) ? [a[0], a[1]] : [a[1], a[0]];
  const P = asPt(x, ctx);
  if (y.t === 'seg') return num(segDist(P, y));
  if (y.t === 'line' || y.t === 'ray') return num(G.distPtLine(P, y.p, y.d));
  if (y.t === 'plane') return num(G.distPtPlane(P, y.p, y.n));
  if (y.t === 'sphere') return num(Math.abs(G.dist(P, y.c) - y.r));
  return fail('Distance : objets non pris en charge');
});
doc('Distance(A, B)  ·  Distance(A, d)  ·  Distance(A, plan)', 'Distance entre deux points, d’un point à une droite ou à un plan');
def('longueur norme norm length', (a, ctx) => num(norm(asVec(a[0], ctx))));
doc('Norme(u)', 'Norme d’un vecteur');
def('angle', (a, ctx) => {
  if (a.length === 3) {
    const A = asPt(a[0], ctx), B = asPt(a[1], ctx), C = asPt(a[2], ctx), u = sub(A, B), v = sub(C, B);
    if (G.isZero(u) || G.isZero(v)) fail('Angle indéfini');
    return { t: 'angle', v: Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))), vertex: B, a: A, b: C };
  }
  const u = asVec(a[0], ctx), v = asVec(a[1], ctx);
  if (G.isZero(u) || G.isZero(v)) fail('Angle indéfini');
  return { t: 'angle', v: Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))) };
});
doc('Angle(A, B, C)  ·  Angle(u, v)', 'Angle géométrique ABC (de sommet B), ou entre deux vecteurs');
def('produitscalaire dotproduct', (a, ctx) => num(dot(asVec(a[0], ctx), asVec(a[1], ctx))));
def('produitvectoriel crossproduct cross', (a, ctx) => binop('cross', { t: 'vec', v: asVec(a[0], ctx) }, { t: 'vec', v: asVec(a[1], ctx) }, ctx));
def('determinant det', (a, ctx) => {
  const v = a.map(x => asVec(x, ctx));
  if (v.length === 2) return num(G.det2(v[0], v[1]));
  if (v.length === 3) return num(G.det3(v[0], v[1], v[2]));
  return fail('Déterminant de 2 ou 3 vecteurs');
});
doc('Déterminant(u, v, w)', 'Déterminant (volume algébrique du parallélépipède)');
def('colineaires', (a, ctx) => num(+G.parallel(asVec(a[0], ctx), asVec(a[1], ctx))));
def('orthogonaux', (a, ctx) => num(+G.orthogonal(asVec(a[0], ctx), asVec(a[1], ctx))));
def('coplanaires', (a, ctx) => num(+(Math.abs(G.det3(...a.map(x => asVec(x, ctx)))) < 1e-9)));
doc('Colinéaires(u, v) · Orthogonaux(u, v) · Coplanaires(u, v, w)', 'Teste (1 = vrai, 0 = faux)');

def('projete projection project', (a, ctx) => {
  if (a[0].t === 'vec' && a[1].t === 'vec') return { t: 'vec', v: mul(a[1].v, dot(a[0].v, a[1].v) / dot(a[1].v, a[1].v)) };
  const P = asPt(a[0], ctx), o = a[1];
  if (isLine(o)) { const L = G.lineLike(o); return { t: 'pt', p: G.projPtLine(P, L.p, L.d) }; }
  if (o.t === 'plane') return { t: 'pt', p: G.projPtPlane(P, o.p, o.n) };
  return fail('Projeté : droite ou plan attendu');
});
doc('Projeté(A, d)  ·  Projeté(A, plan)', 'Projeté orthogonal d’un point sur une droite ou un plan');
def('symetrique reflect', (a, ctx) => {
  const P = asPt(a[0], ctx), o = a[1];
  let H;
  if (isPtLike(o)) H = asPt(o, ctx);
  else if (isLine(o)) { const L = G.lineLike(o); H = G.projPtLine(P, L.p, L.d); }
  else if (o.t === 'plane') H = G.projPtPlane(P, o.p, o.n);
  else fail('Symétrique : point, droite ou plan attendu');
  return { t: 'pt', p: sub(mul(H, 2), P) };
});
doc('Symétrique(A, B)  ·  Symétrique(A, d)  ·  Symétrique(A, plan)', 'Symétrique du point A par rapport à un point, une droite ou un plan');
def('perpendiculaire perpendicular', (a, ctx) => {
  const A = asPt(a[0], ctx), o = a[1], n = ctx.frame.n;
  if (o.t === 'plane') return { t: 'line', p: A, d: o.n };
  const L = G.lineLike(o) || (o.t === 'vec' ? { d: o.v } : fail('Perpendiculaire : droite ou plan attendu'));
  if (n === 2) return { t: 'line', p: A, d: [-L.d[1], L.d[0]] };
  if (n === 3) return { t: 'plane', p: A, n: L.d };
  return fail('Perpendiculaire non disponible en ℝ⁴');
});
doc('Perpendiculaire(A, d)  ·  Perpendiculaire(A, plan)', '2D : droite ⟂ d en A. 3D : plan ⟂ d passant par A, ou droite ⟂ au plan');
def('parallele parallel', (a, ctx) => {
  const A = asPt(a[0], ctx), o = a[1];
  if (o.t === 'plane') return { t: 'plane', p: A, n: o.n };
  const L = G.lineLike(o) || (o.t === 'vec' ? { d: o.v } : fail('Parallèle : droite ou plan attendu'));
  return { t: 'line', p: A, d: L.d };
});
doc('Parallèle(A, d)  ·  Parallèle(A, plan)', 'Parallèle à d (ou au plan) passant par A');
def('mediatrice perpendicularbisector', (a, ctx) => {
  const A = asPt(a[0], ctx), B = asPt(a[1], ctx), M = G.mid(A, B), v = sub(B, A);
  if (ctx.frame.n === 2) return { t: 'line', p: M, d: [-v[1], v[0]] };
  if (ctx.frame.n === 3) return { t: 'plane', p: M, n: v };
  return fail('Médiatrice non disponible en ℝ⁴');
});
doc('Médiatrice(A, B)', '2D : médiatrice. 3D : plan médiateur de [AB]');
def('translation translate', (a, ctx) => { const u = asVec(a[1], ctx); return mapObj(a[0], p => add(p, u), v => v); });
def('homothetie dilate', (a, ctx) => {
  const O = asPt(a[1], ctx), k = asNum(a[2]);
  return mapObj(a[0], p => add(O, mul(sub(p, O), k)), v => mul(v, k));
});
doc('Translation(objet, u) · Homothétie(objet, O, k)', 'Transforme point, droite, polygone ou solide');

def('intersection intersect', (a, ctx) => {
  const [x, y] = a, k = a[2] ? Math.round(asNum(a[2])) : 1;
  const pick = pts => { if (!pts.length) fail('Pas d’intersection'); const p = pts[k - 1]; if (!p) fail(`Il n’y a que ${pts.length} point(s) d’intersection`); return { t: 'pt', p }; };
  if (isLine(x) && isLine(y)) {
    const A = G.lineLike(x), B = G.lineLike(y), r = G.relLineLine(A, B);
    if (r.type !== 'sécantes') fail(r.type === 'non coplanaires' ? 'Droites non coplanaires : pas d’intersection' : 'Droites ' + r.type);
    if (!G.inRange(r.t, A) || !G.inRange(r.s, B)) fail('Les objets ne se coupent pas');
    return pick([r.point]);
  }
  const lp = (l, p) => { const L = G.lineLike(l), r = G.relLinePlane(L, p); if (r.type !== 'sécants') fail(r.type === 'contenue' ? 'Droite contenue dans le plan' : 'Droite parallèle au plan'); if (!G.inRange(r.t, L)) fail('Les objets ne se coupent pas'); return pick([r.point]); };
  if (isLine(x) && y.t === 'plane') return lp(x, y);
  if (x.t === 'plane' && isLine(y)) return lp(y, x);
  if (x.t === 'plane' && y.t === 'plane') {
    const r = G.relPlanePlane(x, y);
    if (r.type !== 'sécants') fail('Plans ' + r.type);
    return { t: 'line', ...r.line };
  }
  const ls = (l, s) => pick(G.lineSphere(G.lineLike(l), s.c, s.r));
  if (isLine(x) && y.t === 'sphere') return ls(x, y);
  if (x.t === 'sphere' && isLine(y)) return ls(y, x);
  const lc = (l, c) => pick(G.lineSphere(G.lineLike(l), c.c, c.r));
  if (isLine(x) && y.t === 'circle' && ctx.frame.n === 2) return lc(x, y);
  if (x.t === 'circle' && isLine(y) && ctx.frame.n === 2) return lc(y, x);
  if (x.t === 'circle' && y.t === 'circle' && ctx.frame.n === 2) {
    const d = G.dist(x.c, y.c);
    if (d > x.r + y.r + 1e-9 || d < Math.abs(x.r - y.r) - 1e-9 || d < 1e-12) fail('Pas d’intersection');
    const aa = (x.r * x.r - y.r * y.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, x.r * x.r - aa * aa)), e = mul(sub(y.c, x.c), 1 / d), P = add(x.c, mul(e, aa)), o = [-e[1], e[0]];
    return pick(h < 1e-9 ? [P] : [add(P, mul(o, h)), sub(P, mul(o, h))]);
  }
  const ps = (p, s) => {
    const dd = G.distPtPlane(s.c, p.p, p.n);
    if (dd > s.r + 1e-9) fail('Le plan ne coupe pas la sphère');
    return { t: 'circle', c: G.projPtPlane(s.c, p.p, p.n), r: Math.sqrt(Math.max(0, s.r * s.r - dd * dd)), n: p.n };
  };
  if (x.t === 'plane' && y.t === 'sphere') return ps(x, y);
  if (x.t === 'sphere' && y.t === 'plane') return ps(y, x);
  return fail('Intersection : couple d’objets non pris en charge');
});
doc('Intersection(a, b)  ·  Intersection(a, b, k)', 'Droite/droite, droite/plan, plan/plan, droite/sphère, plan/sphère (k-ième point)');

def('cercle circle', (a, ctx) => {
  if (a.length === 3 && a.every(isPtLike)) {                       // cercle circonscrit
    const [A, B, C] = a.map(x => asPt(x, ctx)), u = sub(B, A), v = sub(C, A), w = ctx.frame.n === 2 ? [0, 0, 1] : cross(u, v);
    const uu = dot(u, u), vv = dot(v, v), uv = dot(u, v), D = 2 * (uu * vv - uv * uv);
    if (Math.abs(D) < 1e-12) fail('Points alignés : pas de cercle');
    const s = vv * (uu - uv) / D, t = uu * (vv - uv) / D, c = add(A, add(mul(u, s), mul(v, t)));
    return { t: 'circle', c, r: G.dist(c, A), n: ctx.frame.n === 2 ? [0, 0, 1] : w };
  }
  const O = asPt(a[0], ctx), r = a[1].t === 'num' ? a[1].v : G.dist(O, asPt(a[1], ctx));
  if (!(r > 0)) fail('Rayon strictement positif attendu');
  const n = a[2] ? asVec(a[2], ctx) : [0, 0, 1];
  return { t: 'circle', c: O, r, n: pad(n, 3) };
});
doc('Cercle(O, r)  ·  Cercle(O, B)  ·  Cercle(A, B, C)  ·  Cercle(O, r, n)', 'Cercle de centre O (en 3D : dans le plan de normale n, par défaut horizontal)');
def('sphere', (a, ctx) => {
  const O = asPt(a[0], ctx), r = a[1].t === 'num' ? a[1].v : G.dist(O, asPt(a[1], ctx));
  if (!(r > 0)) fail('Rayon strictement positif attendu');
  return { t: 'sphere', c: O, r };
});
doc('Sphère(O, r)  ·  Sphère(O, B)', 'Sphère de centre O');
def('polygone polygon', (a, ctx) => {
  if (a.length < 3) fail('Au moins 3 sommets');
  return { t: 'poly', pts: a.map(x => asPt(x, ctx)) };
});
doc('Polygone(A, B, C, …)', 'Polygone');

def('cube', (a, ctx) => { if (ctx.frame.n < 3) fail('Le cube existe en dimension 3'); return G.cube(asPt(a[0], ctx), asNum(a[1])); });
def('pave cuboid box', (a, ctx) => { if (ctx.frame.n < 3) fail('Le pavé existe en dimension 3'); return G.box(asPt(a[0], ctx), asNum(a[1]), asNum(a[2]), asNum(a[3])); });
def('tetraedre tetrahedron', (a, ctx) => G.tetra(...a.slice(0, 4).map(x => asPt(x, ctx))));
def('tetraedreregulier', (a, ctx) => G.tetraRegular(asPt(a[0], ctx), asNum(a[1])));
def('pyramide pyramid', (a, ctx) => G.pyramid(asPt(a[0], ctx), a.slice(1).map(x => asPt(x, ctx))));
def('prisme prism', (a, ctx) => G.prism(asPt(a[0], ctx), asPt(a[1], ctx), asPt(a[2], ctx), asVec(a[3], ctx)));
def('cylindre cylinder', (a, ctx) => ({ t: 'cyl', a: asPt(a[0], ctx), b: asPt(a[1], ctx), r: asNum(a[2]) }));
def('cone', (a, ctx) => ({ t: 'cone', a: asPt(a[0], ctx), b: asPt(a[1], ctx), r: asNum(a[2]) }));
def('hypercube tesseract', (a, ctx) => { if (ctx.frame.n !== 4) fail('Le hypercube se construit en dimension 4'); return G.hypercube(asPt(a[0], ctx), asNum(a[1])); });
def('pentachore simplexe', (a, ctx) => { if (ctx.frame.n !== 4) fail('Le pentachore se construit en dimension 4'); return G.pentachore(asPt(a[0], ctx), asNum(a[1])); });
def('hexadecachore', (a, ctx) => { if (ctx.frame.n !== 4) fail('L’hexadécachore se construit en dimension 4'); return G.hexadecachore(asPt(a[0], ctx), asNum(a[1])); });
doc('Cube(A, a)  ·  Pavé(A, L, l, h)', 'Solides alignés sur les axes, A = sommet');
doc('Tétraèdre(A, B, C, D)  ·  TétraèdreRégulier(A, a)', 'Tétraèdre');
doc('Pyramide(S, A, B, C…)  ·  Prisme(A, B, C, u)', 'Pyramide de sommet S ; prisme de base ABC et de translation u');
doc('Cylindre(A, B, r)  ·  Cône(A, B, r)', 'A = centre de la base, B = autre extrémité de l’axe');
doc('Hypercube(A, a)  ·  Pentachore(A, a)  ·  Hexadécachore(A, a)', 'Polytopes réguliers de ℝ⁴ (repère 4D)');
def('sommet vertex', (a, ctx) => {
  const s = a[0], i = Math.round(asNum(a[1])) - 1, L = s.t === 'solid' ? s.verts : s.t === 'poly' ? s.pts : fail('Sommet : solide ou polygone attendu');
  if (!L[i]) fail(`Ce solide n’a que ${L.length} sommets`); return { t: 'pt', p: L[i] };
});
doc('Sommet(solide, i)', 'i-ième sommet d’un solide ou polygone');
def('volume', a => {
  const s = a[0];
  if (s.t === 'solid' && !s.dim4) return num(G.polyMetrics(s).vol);
  if (s.t === 'sphere') return num(4 / 3 * Math.PI * s.r ** 3);
  if (s.t === 'cyl') return num(Math.PI * s.r ** 2 * G.dist(s.a, s.b));
  if (s.t === 'cone') return num(Math.PI * s.r ** 2 * G.dist(s.a, s.b) / 3);
  return fail('Volume : solide attendu');
});
def('aire area', a => {
  const s = a[0];
  if (s.t === 'poly') { let A = 0; for (let i = 1; i < s.pts.length - 1; i++) A += norm(cross(pad(sub(s.pts[i], s.pts[0]), 3), pad(sub(s.pts[i + 1], s.pts[0]), 3))) / 2; return num(A); }
  if (s.t === 'solid' && !s.dim4) return num(G.polyMetrics(s).area);
  if (s.t === 'sphere') return num(4 * Math.PI * s.r ** 2);
  if (s.t === 'circle') return num(Math.PI * s.r ** 2);
  return fail('Aire : polygone, cercle ou solide attendu');
});
doc('Volume(solide)  ·  Aire(objet)', 'Volume / aire (polygone, solide, sphère…)');
def('centre center', a => ({ t: 'pt', p: a[0].c ?? fail('Centre : cercle ou sphère attendu') }));
def('rayon radius', a => num(a[0].r ?? fail('Rayon : cercle ou sphère attendu')));
def('vecteurdirecteur', a => ({ t: 'vec', v: a[0].d ?? fail('Droite attendue') }));
def('vecteurnormal', (a, ctx) => {
  const o = a[0]; if (o.t === 'plane') return { t: 'vec', v: o.n };
  if (o.t === 'line' && ctx.frame.n === 2) return { t: 'vec', v: [-o.d[1], o.d[0]] };
  return fail('Vecteur normal : plan (ou droite en 2D)');
});
doc('VecteurDirecteur(d)  ·  VecteurNormal(plan)', 'Vecteurs caractéristiques');
def('base basis', (a, ctx) => {
  const vs = a.slice(1).map(x => asVec(x, ctx));
  if (vs.length < 2) fail('Base(A, u, v[, w])');
  return { t: 'basis', p: asPt(a[0], ctx), vs };
});
doc('Base(A, u, v, w)', 'Repère local (A ; u, v, w) : tracé des vecteurs et analyse (libre ? orthonormée ?)');
def('coordonnees coords', (a, ctx) => {
  const u = asVec(a[0], ctx), b = a[1];
  if (b.t !== 'basis') fail('Coordonnées(u, base) : une base est attendue');
  const B = b.vs, m = B.length, Gm = B.map(x => B.map(y => dot(x, y))), inv = G.matInv(Gm);
  if (!inv) fail('La famille de vecteurs est liée');
  const c = G.matVec(inv, B.map(x => dot(x, u))), res = add(u, mul(B.reduce((s, x, i) => add(s, mul(x, c[i])), G.zeros(u.length)), -1));
  if (G.norm(res) > 1e-7 * Math.max(1, G.norm(u))) fail('u n’appartient pas à l’espace engendré par la base');
  return { t: 'tuple', c: pad(c, ctx.frame.n) };
});
doc('Coordonnées(u, base)', 'Coordonnées de u dans la base');
['x', 'y', 'z', 'w'].forEach((nm, i) => def(nm, (a, ctx) => {
  const o = a[0];
  const c = o.t === 'pt' ? ctx.frame.toPos(o.p) : o.t === 'vec' ? ctx.frame.toVec(o.v) : o.t === 'tuple' ? o.c : fail('Point ou vecteur attendu');
  return num(c[i] ?? 0);
}));
doc('x(A), y(A), z(A), w(A)', 'Coordonnées d’un point ou vecteur dans le repère');
def('curseur slider', a => {
  const [lo, hi, st] = [asNum(a[0] ?? num(0)), asNum(a[1] ?? num(10)), asNum(a[2] ?? num(.1))];
  return { t: 'num', v: lo, slider: { min: lo, max: hi, step: st } };
});
doc('Curseur(min, max, pas)', 'Nombre réglable (curseur)');

// Actions sur le repère (sans objet créé)
const action = (names, fn) => def(names, (a, ctx) => { fn(a, ctx); return { t: 'action' }; });
action('repere frame', (a, ctx) => ctx.act('dim', Math.round(asNum(a[0]))));
action('origine origin', (a, ctx) => ctx.act('origin', a.length === 1 && a[0].t === 'tuple' ? a[0].c : a.map(asNum)));
action('baserepere', (a, ctx) => ctx.act('basis', a.map(x => x.t === 'tuple' ? x.c : x.t === 'vec' ? ctx.frame.toVec(x.v) : fail('Vecteurs attendus'))));
action('portee range', (a, ctx) => ctx.act('range', asNum(a[0])));
action('effacer clear', (a, ctx) => ctx.act('clear'));
doc('Repère(2|3|4)', 'Choisit la dimension du repère');
doc('Origine(x, y, z)', 'Déplace l’origine du repère');
doc('BaseRepère((1,0,0), (1,1,0), (0,0,1))', 'Définit la base du repère (non orthonormée acceptée)');
doc('Portée(R)', 'Demi-largeur visible du repère (jusqu’à 200)');
doc('Effacer()', 'Supprime tous les objets');

export const COMMAND_DOC = DOC;

// ---------- Boucles de programme ----------
// « pour k de 0 à 4 : P{k} = (k, k^2, 0) »  →  lignes développées
export function expandProgram(text, evalNum) {
  const out = [];
  const lines = text.split(/\n/);
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$|#.*$/, '').trim();
    if (!line) continue;
    const m = /^(?:pour|for)\s+(\p{L}[\p{L}\p{N}_]*)\s*(?:=|de|in|from)\s*(.+?)\s*(?:\.\.|à|a|to)\s*(.+?)(?:\s+pas\s+(.+?))?\s*[:]\s*(.+)$/iu.exec(line);
    if (!m) { out.push(line); continue; }
    const [, v, lo, hi, st, body] = m, a = evalNum(lo), b = evalNum(hi), s = st ? evalNum(st) : 1;
    if (!(s > 0) || (b - a) / s > 400) fail('Boucle trop longue (400 itérations max)');
    for (let x = a; x <= b + 1e-9; x += s) {
      const xv = +x.toFixed(10);
      out.push(...expandProgram(body.replace(/\{([^}]*)\}/g, (_, e) => String(evalNum(e.replace(new RegExp(`\\b${v}\\b`, 'g'), `(${xv})`)))).replace(new RegExp(`(?<![\\p{L}\\p{N}_])${v}(?![\\p{L}\\p{N}_(])`, 'gu'), `(${xv})`), evalNum));
    }
  }
  return out;
}
