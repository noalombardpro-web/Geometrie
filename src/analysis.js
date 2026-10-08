// Description des objets et analyse « spé maths » de la sélection (formules + valeurs).
import * as G from './geo.js';
const { nice, niceApprox, dec, dot, norm, sub, add, mul, cross } = G;

export const fr = (a, b) => `<span class="fr"><span>${a}</span><span>${b}</span></span>`;
export const rt = x => `√<span class="sq">${x}</span>`;
const I = s => `<i>${s}</i>`;
const sup = s => `<sup>${s}</sup>`;
const sb = s => `<sub>${s}</sub>`;
const V = ['x', 'y', 'z', 'w'];
const nm = o => o.name;
const vecS = c => `(${c.map(nice).join(' ; ')})`;
const sgn = (x, first) => x < 0 ? (first ? '−' : ' − ') : (first ? '' : ' + ');

// Équation Σ a_i x_i = h (coefficients entiers si possible)
function intScale(v) {
  const k = v.findIndex(x => Math.abs(x) > 1e-12); if (k < 0) return 1;
  const w = v.map(x => x / v[k]), den = w.map(x => G.ratio(x, 60)); if (den.some(d => !d)) return 1 / v[k];
  let L = 1; const gcd = (a, b) => b ? gcd(b, a % b) : a;
  for (const [, q] of den) L = L * q / gcd(L, q);
  return L / v[k];
}
export function eqHTML(a, h, names = V) {
  const s = intScale([...a, h]), A = a.map(x => x * s), H = h * s;
  let out = '', first = true;
  A.forEach((c, i) => {
    if (Math.abs(c) < 1e-10) return;
    const ac = Math.abs(c); out += sgn(c, first) + (Math.abs(ac - 1) < 1e-9 ? '' : nice(ac)) + I(names[i]); first = false;
  });
  return `${out || '0'} = ${nice(H)}`;
}
export function eqHTML0(a, h, names) {          // ax + by + c = 0
  const s = intScale([...a, h]), A = a.map(x => x * s), H = h * s;
  let out = '', first = true;
  A.forEach((c, i) => { if (Math.abs(c) < 1e-10) return; const ac = Math.abs(c); out += sgn(c, first) + (Math.abs(ac - 1) < 1e-9 ? '' : nice(ac)) + I(names[i]); first = false; });
  if (Math.abs(H) > 1e-10) out += (H < 0 ? ' − ' : ' + ') + nice(Math.abs(H));
  return `${out} = 0`;
}
const paramRows = (p, d, names = V) => p.map((x, i) => `${I(names[i])} = ${Math.abs(x) < 1e-10 && Math.abs(d[i]) < 1e-10 ? '0' : [Math.abs(x) < 1e-10 ? '' : nice(x), Math.abs(d[i]) < 1e-10 ? '' : `${d[i] < 0 ? (Math.abs(x) < 1e-10 ? '−' : ' − ') : (Math.abs(x) < 1e-10 ? '' : ' + ')}${Math.abs(Math.abs(d[i]) - 1) < 1e-10 ? '' : nice(Math.abs(d[i]))}${I('t')}`].join('')}`);

// ---------- Description courte (liste algébrique) ----------
export function describe(o, F) {
  const v = o.value; if (!v) return '';
  const c = p => F.toPos(p), cv = x => F.toVec(x);
  switch (v.t) {
    case 'pt': return vecS(c(v.p));
    case 'vec': return vecS(cv(v.v));
    case 'num': return nice(v.v);
    case 'angle': return `${dec(G.deg(v.v), 2)}°`;
    case 'seg': return `${nice(G.dist(v.a, v.b))}`;
    case 'line': case 'ray': {
      if (F.n === 2) { const a = F.worldToCov([-v.d[1], v.d[0]]), h = dot(a, c(v.p)); return eqHTML(a, h, ['x', 'y']); }
      return paramRows(c(v.p), cv(v.d)).join(' ; ');
    }
    case 'plane': { const a = F.worldToCov(v.n), h = dot(a, c(v.p)); return eqHTML(a, h); }
    case 'circle': return F.n === 2 ? `(x − ${nice(c(v.c)[0])})² + (y − ${nice(c(v.c)[1])})² = ${nice(v.r * v.r)}` : `centre ${vecS(c(v.c))}, r = ${nice(v.r)}`;
    case 'sphere': { const q = c(v.c); return `(x − ${nice(q[0])})² + (y − ${nice(q[1])})² + (z − ${nice(q[2])})² = ${nice(v.r * v.r)}`; }
    case 'solid': return v.dim4 ? `${v.counts.join(' · ')}` : `${v.verts.length} sommets`;
    case 'poly': return `${v.pts.length} sommets`;
    case 'basis': return `${v.vs.length} vecteurs`;
    case 'cyl': case 'cone': return `r = ${nice(v.r)}, h = ${nice(G.dist(v.a, v.b))}`;
  }
  return '';
}

// ---------- Analyse ----------
export function analyze(sel, F) {
  const rows = [], add_ = (k, f, val, ok) => rows.push({ k, f, v: val, ok });
  const sect = t => rows.push({ sect: t });
  const ortho = F.isOrtho();
  const Kp = p => ortho ? F.toPos(p) : p, Kv = x => ortho ? F.toVec(x) : x;
  const co = (p) => F.toPos(p), cov = (x) => F.toVec(x);
  const n = F.n;
  if (!ortho) add_('Repère non orthonormé', 'Gram', 'les formules ci-dessous utilisent les coordonnées du repère orthonormé de référence', false);
  const N = sel.length;
  const types = sel.map(o => o.value.t).join(',');
  const lineish = v => ['line', 'ray', 'seg'].includes(v.t);
  const LL = v => G.lineLike(v);

  const sum2 = c => c.map(x => `${nice(x)}${sup(2)}`).join(' + ');
  const normRow = (label, name, c, val) => add_(label, `‖${name}‖ = ${rt(c.map((x, i) => I(V[i]) + sup(2)).join(' + '))} = ${rt(sum2(c))}`, niceApprox(val));

  if (N === 1) {
    const o = sel[0], v = o.value;
    sect(`${o.name}`);
    switch (v.t) {
      case 'pt': add_('Coordonnées', `${o.name}(${V.slice(0, n).map(I).join(' ; ')})`, vecS(co(v.p))); break;
      case 'num': add_('Valeur', o.name, niceApprox(v.v)); break;
      case 'angle': add_('Mesure', 'degrés · radians', `${dec(G.deg(v.v), 3)}° · ${niceApprox(v.v)} rad`); add_('Cosinus · sinus', 'cos θ · sin θ', `${niceApprox(Math.cos(v.v))} · ${niceApprox(Math.sin(v.v))}`); break;
      case 'vec': {
        const c = Kv(v.v); add_('Coordonnées', `${o.name}(${V.slice(0, n).map(I).join(' ; ')})`, vecS(cov(v.v)));
        normRow('Norme', o.name, c, norm(v.v));
        add_('Vecteur unitaire', `${fr(o.name, '‖' + o.name + '‖')}`, vecS(cov(G.unit(v.v)).map(x => x)));
        break;
      }
      case 'seg': {
        const A = co(v.a), B = co(v.b); add_('Vecteur AB', `(x${sb('B')} − x${sb('A')} ; …)`, vecS(cov(sub(v.b, v.a))));
        add_('Longueur', `AB = ${rt('Σ (x' + sb('B') + ' − x' + sb('A') + ')' + sup(2))}`, niceApprox(G.dist(v.a, v.b)));
        add_('Milieu', `${fr('x' + sb('A') + ' + x' + sb('B'), '2')}`, vecS(co(G.mid(v.a, v.b)))); break;
      }
      case 'line': case 'ray': {
        const d = cov(v.d), p = co(v.p);
        add_('Vecteur directeur', 'u', vecS(d));
        if (n === 2) {
          const a = F.worldToCov([-v.d[1], v.d[0]]), h = dot(a, p);
          add_('Vecteur normal', `n(a ; b) pour ax + by + c = 0`, vecS(a));
          add_('Équation cartésienne', `${I('a')}${I('x')} + ${I('b')}${I('y')} + ${I('c')} = 0`, eqHTML0(a, -h, ['x', 'y']));
          if (Math.abs(a[1]) > 1e-10) add_('Équation réduite', `${I('y')} = ${I('m')}${I('x')} + ${I('p')}`, `${I('y')} = ${nice(-a[0] / a[1])}${I('x')} ${h / a[1] < 0 ? '−' : '+'} ${nice(Math.abs(h / a[1]))}`);
          else add_('Droite verticale', `${I('x')} = ${I('k')}`, `${I('x')} = ${nice(h / a[0])}`);
        } else {
          add_('Point', 'A', vecS(p));
          add_('Représentation paramétrique', `M(${I('t')}) = A + ${I('t')}·u,  ${I('t')} ∈ ℝ`, `<div class="lines">${paramRows(p, d).join('<br>')}</div>`);
        }
        break;
      }
      case 'plane': {
        const a = F.worldToCov(v.n), p = co(v.p), h = dot(a, p);
        add_('Vecteur normal', `n(${I('a')} ; ${I('b')} ; ${I('c')})`, vecS(a));
        add_('Équation cartésienne', `${I('a')}${I('x')} + ${I('b')}${I('y')} + ${I('c')}${I('z')} + ${I('d')} = 0`, eqHTML0(a, -h, V));
        const [e1, e2] = v.u ? [v.u, v.v] : G.planeBasis(v.n).map(x => mul(x, 1));
        add_('Point du plan', 'A', vecS(p));
        add_('Représentation paramétrique', `M = A + ${I('s')}·u + ${I('t')}·v`, `<div class="lines">${p.map((x, i) => `${I(V[i])} = ${nice(x)} + ${nice(cov(e1)[i])}${I('s')} + ${nice(cov(e2)[i])}${I('t')}`).join('<br>')}</div>`);
        break;
      }
      case 'sphere': {
        const q = co(v.c);
        add_('Centre et rayon', 'Ω ; r', `${vecS(q)} ; ${niceApprox(v.r)}`);
        add_('Équation', `(${I('x')} − ${I('a')})${sup(2)} + (${I('y')} − ${I('b')})${sup(2)} + (${I('z')} − ${I('c')})${sup(2)} = ${I('r')}${sup(2)}`, describe(o, F));
        add_('Volume', `${fr('4', '3')}π${I('r')}${sup(3)}`, niceApprox(4 / 3 * Math.PI * v.r ** 3));
        add_('Aire', `4π${I('r')}${sup(2)}`, niceApprox(4 * Math.PI * v.r ** 2)); break;
      }
      case 'circle': {
        add_('Centre et rayon', 'Ω ; r', `${vecS(co(v.c))} ; ${niceApprox(v.r)}`);
        if (n === 2) add_('Équation', `(${I('x')} − ${I('a')})${sup(2)} + (${I('y')} − ${I('b')})${sup(2)} = ${I('r')}${sup(2)}`, describe(o, F));
        add_('Périmètre', `2π${I('r')}`, niceApprox(2 * Math.PI * v.r)); add_('Aire', `π${I('r')}${sup(2)}`, niceApprox(Math.PI * v.r ** 2)); break;
      }
      case 'poly': {
        let per = 0, A = 0; for (let i = 0; i < v.pts.length; i++) per += G.dist(v.pts[i], v.pts[(i + 1) % v.pts.length]);
        for (let i = 1; i < v.pts.length - 1; i++) A += norm(cross(G.pad(sub(v.pts[i], v.pts[0]), 3), G.pad(sub(v.pts[i + 1], v.pts[0]), 3))) / 2;
        add_('Périmètre', 'Σ AᵢAᵢ₊₁', niceApprox(per)); add_('Aire', `${fr('1', '2')}‖AB × AC‖ (par triangulation)`, niceApprox(A)); break;
      }
      case 'solid': {
        if (v.dim4) {
          const [S, A, F2, C] = v.counts;
          add_('Sommets · arêtes · faces · cellules', 'S ; A ; F ; C', `${S} · ${A} · ${F2} · ${C}`);
          add_('Relation d’Euler (ℝ⁴)', 'S − A + F − C = 0', `${S} − ${A} + ${F2} − ${C} = ${S - A + F2 - C}`, S - A + F2 - C === 0);
          const e = v.edges[0]; add_('Longueur d’une arête', 'a', niceApprox(G.dist(v.verts[e[0]], v.verts[e[1]])));
          if (v.name === 'hypercube') { const a = v.dims.a; add_('Hypervolume', `a${sup(4)}`, niceApprox(a ** 4)); add_('Diagonale principale', `a${rt('4')} = 2a`, niceApprox(2 * a)); }
        } else {
          const m = G.polyMetrics(v), S = v.verts.length, A = v.edges.length, Fc = v.faces.length;
          add_('Volume', v.name === 'cube' ? `${I('a')}${sup(3)}` : v.name === 'pavé' ? `${I('L')}·${I('l')}·${I('h')}` : v.name === 'pyramide' ? `${fr('1', '3')}·${I('B')}·${I('h')}` : v.name === 'prisme' ? `${I('B')}·${I('h')}` : 'V', niceApprox(m.vol));
          add_('Aire totale', 'Σ aires des faces', niceApprox(m.area));
          add_('Sommets · arêtes · faces', 'S ; A ; F', `${S} · ${A} · ${Fc}`);
          add_('Relation d’Euler', 'S − A + F = 2', `${S} − ${A} + ${Fc} = ${S - A + Fc}`, S - A + Fc === 2);
          if (v.name === 'cube') add_('Diagonale d’une face · de l’espace', `${I('a')}${rt('2')} ; ${I('a')}${rt('3')}`, `${niceApprox(v.dims.a * Math.SQRT2)} ; ${niceApprox(v.dims.a * Math.sqrt(3))}`);
          if (v.name === 'pavé') add_('Diagonale de l’espace', rt(`${I('L')}${sup(2)} + ${I('l')}${sup(2)} + ${I('h')}${sup(2)}`), niceApprox(Math.hypot(v.dims.L, v.dims.l, v.dims.h)));
        }
        break;
      }
      case 'cyl': { const h = G.dist(v.a, v.b); add_('Volume', `π${I('r')}${sup(2)}${I('h')}`, niceApprox(Math.PI * v.r * v.r * h)); add_('Aire latérale', `2π${I('r')}${I('h')}`, niceApprox(2 * Math.PI * v.r * h)); add_('Aire totale', `2π${I('r')}(${I('r')} + ${I('h')})`, niceApprox(2 * Math.PI * v.r * (v.r + h))); break; }
      case 'cone': { const h = G.dist(v.a, v.b), g = Math.hypot(v.r, h); add_('Volume', `${fr('1', '3')}π${I('r')}${sup(2)}${I('h')}`, niceApprox(Math.PI * v.r * v.r * h / 3)); add_('Génératrice', `${I('g')} = ${rt(I('r') + sup(2) + ' + ' + I('h') + sup(2))}`, niceApprox(g)); add_('Aire totale', `π${I('r')}(${I('r')} + ${I('g')})`, niceApprox(Math.PI * v.r * (v.r + g))); break; }
      case 'basis': {
        const B = v.vs, m = B.length;
        B.forEach((e, i) => add_(`Vecteur ${i + 1}`, `e${sb(i + 1)}`, vecS(cov(e))));
        const Gm = B.map(a => B.map(b => dot(a, b)));
        if (m === n || (m === 3 && n === 3)) {
          const D = m === 3 ? G.det3(...B) : m === 2 ? G.det2(...B) : null;
          if (D !== null) add_(m === 3 ? 'Déterminant det(u, v, w)' : 'Déterminant det(u, v)', m === 3 ? 'u·(v × w)' : `${I('xy′')} − ${I('x′y')}`, niceApprox(D), Math.abs(D) > 1e-9);
          if (D !== null) add_(m === 3 ? 'Base de l’espace ?' : 'Base du plan ?', 'famille libre ⇔ det ≠ 0', Math.abs(D) > 1e-9 ? 'oui, la famille est libre' : 'non, vecteurs coplanaires (liés)', Math.abs(D) > 1e-9);
        } else if (m === 2 && n === 3) add_('Famille libre ?', 'u, v non colinéaires', G.parallel(B[0], B[1]) ? 'non (colinéaires)' : 'oui', !G.parallel(B[0], B[1]));
        const orth = Gm.every((r, i) => r.every((x, j) => i === j || Math.abs(x) < 1e-9)), unitary = Gm.every((r, i) => Math.abs(r[i] - 1) < 1e-9);
        add_('Base orthogonale ?', 'eᵢ·eⱼ = 0 (i ≠ j)', orth ? 'oui' : 'non', orth); add_('Base orthonormée ?', 'orthogonale et ‖eᵢ‖ = 1', orth && unitary ? 'oui' : 'non', orth && unitary);
        break;
      }
    }
  } else if (N === 2) {
    const [a, b] = sel, u = a.value, w = b.value, k = `${a.name}, ${b.name}`;
    sect(k);
    const ptv = x => x.t === 'pt';
    if (ptv(u) && ptv(w)) {
      const d = sub(w.p, u.p), c = cov(d);
      add_(`Vecteur ${a.name}${b.name}`, `(x${sb(b.name)} − x${sb(a.name)} ; …)`, vecS(c));
      add_(`Distance ${a.name}${b.name}`, `${a.name}${b.name} = ${rt('(' + I('x') + sb('B') + ' − ' + I('x') + sb('A') + ')' + sup(2) + ' + …')}`, niceApprox(norm(d)));
      add_('Calcul', `${a.name}${b.name} = ${rt(Kv(d).map(x => nice(x) + sup(2)).join(' + '))}`, niceApprox(norm(d)));
      add_('Milieu', `${fr('x' + sb('A') + ' + x' + sb('B'), '2')}`, vecS(co(G.mid(u.p, w.p))));
      if (n === 2) { const m = F.worldToCov([-d[1], d[0]]); add_(`Droite (${a.name}${b.name})`, 'ax + by + c = 0', eqHTML0(m, -dot(m, co(u.p)), ['x', 'y'])); }
    } else if ((ptv(u) && (lineish(w) || w.t === 'plane' || w.t === 'sphere')) || (ptv(w) && (lineish(u) || u.t === 'plane' || u.t === 'sphere'))) {
      const [P, o] = ptv(u) ? [u, w] : [w, u], pn = ptv(u) ? a.name : b.name, on = ptv(u) ? b.name : a.name;
      if (lineish(o)) {
        const L = LL(o), H = G.projPtLine(P.p, L.p, L.d), d = G.dist(P.p, H);
        add_(`Projeté orthogonal de ${pn}`, `H = A + ${fr('AM·u', '‖u‖' + sup(2))}·u`, vecS(co(H)));
        add_(`Distance de ${pn} à (${on})`, `d(M, 𝒟) = MH`, niceApprox(d));
        if (n === 3) { const cr = cross(sub(P.p, L.p), L.d); add_('Formule du produit vectoriel (hors programme)', `${fr('‖AM × u‖', '‖u‖')}`, niceApprox(norm(cr) / norm(L.d))); }
        add_(`${pn} appartient à (${on}) ?`, 'MH = 0', d < 1e-9 ? 'oui' : 'non', d < 1e-9);
      } else if (o.t === 'plane') {
        const a_ = F.worldToCov(o.n), h = dot(a_, co(o.p)), pc = co(P.p), val = dot(a_, pc) - h;
        const H = G.projPtPlane(P.p, o.p, o.n);
        add_(`Distance de ${pn} au plan`, `${fr(`|${I('a')}${I('x')}${sb('0')} + ${I('b')}${I('y')}${sb('0')} + ${I('c')}${I('z')}${sb('0')} + ${I('d')}|`, rt(`${I('a')}${sup(2)} + ${I('b')}${sup(2)} + ${I('c')}${sup(2)}`))}`, niceApprox(G.distPtPlane(P.p, o.p, o.n)));
        if (ortho) { add_('Calcul', `${fr(`|${nice(val)}|`, rt(sum2(a_)))}`, niceApprox(Math.abs(val) / norm(a_))); }
        add_(`Projeté orthogonal de ${pn}`, `H = M − ${fr(`${I('a')}${I('x')}${sb('0')} + … + ${I('d')}`, `‖n‖${sup(2)}`)}·n`, vecS(co(H)));
        add_(`${pn} appartient au plan ?`, 'a x₀ + b y₀ + c z₀ + d = 0', Math.abs(val) < 1e-9 ? 'oui' : 'non', Math.abs(val) < 1e-9);
      } else {
        const d = G.dist(P.p, o.c);
        add_('Distance au centre', 'ΩM', niceApprox(d)); add_(`Position de ${pn}`, 'ΩM comparé à r', Math.abs(d - o.r) < 1e-9 ? 'sur la sphère' : d < o.r ? 'à l’intérieur' : 'à l’extérieur', Math.abs(d - o.r) < 1e-9);
      }
    } else if ((u.t === 'vec' || u.t === 'seg') && (w.t === 'vec' || w.t === 'seg')) {
      const p = u.t === 'vec' ? u.v : sub(u.b, u.a), q = w.t === 'vec' ? w.v : sub(w.b, w.a), cp = Kv(p), cq = Kv(q);
      const dotF = ['xx′', 'yy′', 'zz′', 'ww′'].slice(0, n).join(' + ');
      add_('Produit scalaire (coordonnées)', `${a.name}·${b.name} = ${dotF}`, `${cp.map((x, i) => `${nice(x)}×${nice(cq[i])}`).join(' + ')} = ${niceApprox(dot(p, q))}`);
      add_('Produit scalaire (angle)', `${a.name}·${b.name} = ‖${a.name}‖‖${b.name}‖cos θ`, `${niceApprox(norm(p))} × ${niceApprox(norm(q))} × cos θ`);
      if (norm(p) > 1e-12 && norm(q) > 1e-12) {
        const c = Math.max(-1, Math.min(1, dot(p, q) / (norm(p) * norm(q))));
        add_('Cosinus de l’angle', `cos θ = ${fr(a.name + '·' + b.name, '‖' + a.name + '‖‖' + b.name + '‖')}`, niceApprox(c)); add_('Angle', 'θ = arccos(…)', `${dec(G.deg(Math.acos(c)), 3)}° ≈ ${dec(Math.acos(c), 4)} rad`);
      }
      add_('Orthogonaux ?', `${a.name}·${b.name} = 0`, G.orthogonal(p, q) ? 'oui' : 'non', G.orthogonal(p, q));
      add_('Colinéaires ?', n === 2 ? 'xy′ − x′y = 0' : 'u = k·v', G.parallel(p, q) ? 'oui' : 'non', G.parallel(p, q));
      if (n === 2) add_('Déterminant', `${I('xy′')} − ${I('x′y')}`, niceApprox(G.det2(p, q)));
      if (n === 3) { const cr = cross(p, q); add_('Produit vectoriel (hors programme)', `${a.name} × ${b.name}`, vecS(cov(cr))); add_('Aire du parallélogramme', `‖${a.name} × ${b.name}‖`, niceApprox(norm(cr))); }
      add_('Identité', `‖${a.name} + ${b.name}‖² = ‖${a.name}‖² + 2${a.name}·${b.name} + ‖${b.name}‖²`, `${niceApprox(norm(add(p, q)) ** 2)} = ${niceApprox(norm(p) ** 2 + 2 * dot(p, q) + norm(q) ** 2)}`);
    } else if (lineish(u) && lineish(w)) {
      const A = LL(u), B = LL(w), r = G.relLineLine(A, B), du = cov(A.d), dv = cov(B.d);
      add_('Vecteurs directeurs', 'u, v', `${vecS(du)} ; ${vecS(dv)}`);
      add_('Colinéaires ?', 'u = k·v', G.parallel(A.d, B.d) ? 'oui' : 'non', G.parallel(A.d, B.d));
      add_('Position relative', r.type === 'sécantes' ? 'u, v non colinéaires et système compatible' : r.type === 'non coplanaires' ? 'non colinéaires, système sans solution' : 'u et v colinéaires', r.type, r.type === 'sécantes' || r.type === 'confondues');
      if (r.point) add_('Point d’intersection', 'système A + t·u = B + s·v', vecS(co(r.point)));
      if (r.type === 'non coplanaires' && n === 3) add_('Distance entre les droites (hors programme)', `${fr('|AB·(u × v)|', '‖u × v‖')}`, niceApprox(G.dist(r.point, G.add(B.p, mul(B.d, r.s)))));
      add_('Orthogonales ?', 'u·v = 0', G.orthogonal(A.d, B.d) ? 'oui' : 'non', G.orthogonal(A.d, B.d));
      const c = Math.abs(dot(A.d, B.d)) / (norm(A.d) * norm(B.d)); add_('Angle aigu', `cos θ = ${fr('|u·v|', '‖u‖‖v‖')}`, `${dec(G.deg(Math.acos(Math.min(1, c))), 3)}°`);
    } else if ((lineish(u) && w.t === 'plane') || (u.t === 'plane' && lineish(w))) {
      const [l, p] = lineish(u) ? [u, w] : [w, u], L = LL(l), r = G.relLinePlane(L, p), nd = dot(p.n, L.d);
      add_('Vecteurs', 'u (direction), n (normal)', `${vecS(cov(L.d))} ; ${vecS(F.worldToCov(p.n))}`);
      add_('u·n', 'u·n = 0 ⇔ droite parallèle au plan', niceApprox(nd), Math.abs(nd) < 1e-9);
      add_('Position relative', 'u·n ≠ 0 : sécants · u·n = 0 : parallèles ou contenue', r.type, true);
      if (r.point) add_('Point d’intersection', 'A + t·u ∈ plan', vecS(co(r.point)));
      add_('Droite orthogonale au plan ?', 'u colinéaire à n', G.parallel(L.d, p.n) ? 'oui' : 'non', G.parallel(L.d, p.n));
      add_('Angle droite / plan', `sin φ = ${fr('|u·n|', '‖u‖‖n‖')}`, `${dec(G.deg(Math.asin(Math.min(1, Math.abs(nd) / (norm(L.d) * norm(p.n))))), 3)}°`);
    } else if (u.t === 'plane' && w.t === 'plane') {
      const r = G.relPlanePlane(u, w), a1 = F.worldToCov(u.n), a2 = F.worldToCov(w.n);
      add_('Vecteurs normaux', 'n, n′', `${vecS(a1)} ; ${vecS(a2)}`);
      add_('Position relative', 'n, n′ colinéaires : parallèles ou confondus ; sinon sécants', r.type, true);
      if (r.line) add_('Droite d’intersection', 'système de deux équations', `<div class="lines">${paramRows(co(r.line.p), cov(r.line.d)).join('<br>')}</div>`);
      add_('Plans perpendiculaires ?', 'n·n′ = 0', G.orthogonal(u.n, w.n) ? 'oui' : 'non', G.orthogonal(u.n, w.n));
      const c = Math.abs(dot(u.n, w.n)) / (norm(u.n) * norm(w.n)); add_('Angle des plans', `cos θ = ${fr('|n·n′|', '‖n‖‖n′‖')}`, `${dec(G.deg(Math.acos(Math.min(1, c))), 3)}°`);
    } else if (u.t === 'basis' && (w.t === 'vec' || w.t === 'tuple') || w.t === 'basis' && (u.t === 'vec')) {
      const [B, x] = u.t === 'basis' ? [u, w] : [w, u], xv = x.v;
      const Gm = B.vs.map(p => B.vs.map(q => dot(p, q))), inv = G.matInv(Gm);
      if (inv) { const c = G.matVec(inv, B.vs.map(e => dot(e, xv))); add_('Coordonnées dans la base', 'x = α·e₁ + β·e₂ + γ·e₃', vecS(c)); }
    } else if ((lineish(u) && ['sphere', 'circle'].includes(w.t)) || (['sphere', 'circle'].includes(u.t) && lineish(w))) {
      const [l, c] = lineish(u) ? [u, w] : [w, u], L = LL(l), dC = G.distPtLine(c.c, L.p, L.d), pts = G.lineSphere({ ...L, lo: -Infinity, hi: Infinity }, c.c, c.r);
      add_('Distance du centre à la droite', 'd(Ω, 𝒟) = ΩH', niceApprox(dC));
      add_('Position relative', `d < r : sécante · d = r : tangente · d > r : extérieure`, Math.abs(dC - c.r) < 1e-9 ? 'tangente' : dC < c.r ? 'sécante (2 points)' : 'extérieure', true);
      pts.forEach((q, i) => add_(`Point d’intersection ${i + 1}`, 'système droite / équation', vecS(co(q))));
    } else if ((u.t === 'plane' && w.t === 'sphere') || (u.t === 'sphere' && w.t === 'plane')) {
      const [p, c] = u.t === 'plane' ? [u, w] : [w, u], dC = G.distPtPlane(c.c, p.p, p.n);
      add_('Distance du centre au plan', `${fr('|ax₀ + by₀ + cz₀ + d|', '‖n‖')}`, niceApprox(dC));
      add_('Position relative', 'd < r : sécants selon un cercle · d = r : tangents · d > r : disjoints', Math.abs(dC - c.r) < 1e-9 ? 'tangents' : dC < c.r ? 'sécants (cercle)' : 'disjoints', true);
      if (dC < c.r) add_('Rayon du cercle d’intersection', rt(`${I('r')}${sup(2)} − ${I('d')}${sup(2)}`), niceApprox(Math.sqrt(c.r * c.r - dC * dC)));
    } else add_('Analyse', '—', 'pas de formule spécifique pour ce couple d’objets');
  } else if (N === 3) {
    const vs = sel.map(o => o.value), names = sel.map(o => o.name);
    sect(names.join(', '));
    if (vs.every(x => x.t === 'pt')) {
      const [A, B, C] = vs.map(x => x.p), AB = sub(B, A), AC = sub(C, A), BC = sub(C, B);
      add_('Longueurs', 'AB, AC, BC', `${niceApprox(norm(AB))} ; ${niceApprox(norm(AC))} ; ${niceApprox(norm(BC))}`);
      add_('Alignés ?', 'AB et AC colinéaires', G.parallel(AB, AC) ? 'oui' : 'non', G.parallel(AB, AC));
      if (!G.parallel(AB, AC)) {
        const ca = dot(AB, AC) / (norm(AB) * norm(AC));
        add_(`Angle en ${names[0]}`, `cos Â = ${fr('AB·AC', 'AB × AC')}`, `${dec(G.deg(Math.acos(Math.max(-1, Math.min(1, ca)))), 3)}°`);
        add_('Théorème d’Al-Kashi', 'BC² = AB² + AC² − 2·AB·AC·cos Â', `${niceApprox(norm(BC) ** 2)} = ${niceApprox(norm(AB) ** 2 + norm(AC) ** 2 - 2 * dot(AB, AC))}`);
        add_('Aire du triangle', `${fr('1', '2')}·AB·AC·sin Â`, niceApprox(norm(cross(G.pad(AB, 3), G.pad(AC, 3))) / 2));
        add_('Triangle rectangle ?', 'Pythagore / produit scalaire nul', [[AB, AC], [sub(A, B), BC], [sub(A, C), sub(B, C)]].some(([p, q]) => G.orthogonal(p, q)) ? 'oui' : 'non');
        if (n === 3) { const nn = cross(AB, AC), a_ = F.worldToCov(nn); add_('Plan (ABC)', 'n = AB × AC', eqHTML0(a_, -dot(a_, co(A)), V)); }
      }
    } else if (vs.every(x => x.t === 'vec' || x.t === 'seg') && n >= 3) {
      const p = vs.map(x => x.t === 'vec' ? x.v : sub(x.b, x.a)), D = G.det3(p[0], p[1], p[2]);
      add_('Déterminant', 'u·(v × w)', niceApprox(D), Math.abs(D) > 1e-9);
      add_('Coplanaires ?', 'det = 0 ⇔ coplanaires', Math.abs(D) < 1e-9 ? 'oui' : 'non, ils forment une base', Math.abs(D) < 1e-9);
      add_('Volume du parallélépipède', '|det(u, v, w)|', niceApprox(Math.abs(D)));
    } else add_('Analyse', '—', 'sélectionnez 3 points ou 3 vecteurs');
  } else if (N === 4 && sel.every(o => o.value.t === 'pt') && n === 3) {
    const [A, B, C, D] = sel.map(o => o.value.p), det = G.det3(sub(B, A), sub(C, A), sub(D, A));
    sect(sel.map(o => o.name).join(', '));
    add_('Coplanaires ?', 'det(AB, AC, AD) = 0', Math.abs(det) < 1e-9 ? 'oui' : 'non', Math.abs(det) < 1e-9);
    add_('Volume du tétraèdre', `${fr('1', '6')}|det(AB, AC, AD)|`, niceApprox(Math.abs(det) / 6));
  }
  return rows;
}
