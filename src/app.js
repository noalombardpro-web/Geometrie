// Atelier de construction : outils, liste algébrique, panneaux, repère programmable.
import * as THREE from 'three';
import { Doc, PALETTE } from './doc.js';
import { View, AXIS_COLORS } from './view.js';
import * as G from './geo.js';
import { analyze, describe } from './analysis.js';
import { FORMULARY } from './formulary.js';
import { COMMAND_DOC, LangError, expandProgram, parseExpr, evalAst } from './lang.js';
import { EXAMPLES } from './examples.js';
import { onTheme } from './theme.js';
import { mountZoom } from './zoom.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const r3 = x => Math.round(x * 1000) / 1000;
const doc = new Doc();
const view = new View($('cstage'), $('clabels'), $('cink'));
const S = { tool: 'move', args: [], sel: new Set(), hover: null, snap: true, step: .5, workZ: 0, drawPlane: 'sol', penColor: '#f2c14e', penWidth: 3, playing: false,
  tab: 'obj', dirty: true, ui: true, alg: true, hist: [], hi: 0, drag: null, stroke: null, erasing: false, down: null, lastTool: {} };
const STORE = 'atelier-construction-v1';

// ---------- Outils ----------
const tp = o => o.value && o.value.t;
const K = {
  pt: o => tp(o) === 'pt',
  line: o => ['line', 'seg', 'ray'].includes(tp(o)),
  lineOrPlane: o => K.line(o) || tp(o) === 'plane',
  ptAny: o => K.pt(o) || K.lineOrPlane(o),
  inter: o => K.line(o) || ['plane', 'sphere', 'circle'].includes(tp(o)),
};
const canNewPt = f => f === K.pt || f === K.ptAny;
const sz = () => Math.max(2, Math.round(doc.range * .3));
const ex = c => doc.exec(c).obj;
const sol = (shape, n) => { const o = ex(shape); const r = [o]; for (let i = 2; i <= n; i++) r.push(ex(`Sommet(${o.name},${i})`)); return r; };
const TOOLS = {
  move: { g: '↖', n: 'Déplacer', h: 'Glissez un point libre ou la vue. Clic : sélectionner (Maj : ajouter à la sélection).' },
  point: { g: '•', n: 'Point', h: 'Cliquez pour placer un point. Maj + glisser (Déplacer) : changer la hauteur.' },
  milieu: { g: '⊹', n: 'Milieu', need: [K.pt, K.pt], cmd: a => `Milieu(${a[0]},${a[1]})`, h: 'Cliquez deux points.' },
  inter: { g: '✕', n: 'Intersection', need: [K.inter, K.inter], make: a => {
    const r = [ex(`Intersection(${a[0]},${a[1]})`)];
    if (r[0].value.t === 'pt' && a.some(n => ['sphere', 'circle'].includes(doc.byName(n).value.t))) { try { r.push(ex(`Intersection(${a[0]},${a[1]},2)`)); } catch { /* un seul point */ } }
    return r; }, h: 'Cliquez deux objets (droites, plans, cercles, sphères).' },
  proj: { g: '⊥', n: 'Projeté orthogonal', need: [K.pt, K.lineOrPlane], cmd: a => `Projeté(${a[0]},${a[1]})`, h: 'Cliquez un point puis une droite ou un plan.' },
  sym: { g: '⇄', n: 'Symétrique', need: [K.pt, K.ptAny], cmd: a => `Symétrique(${a[0]},${a[1]})`, h: 'Cliquez un point puis un centre, une droite ou un plan.' },
  segment: { g: '⎯', n: 'Segment', need: [K.pt, K.pt], cmd: a => `Segment(${a[0]},${a[1]})`, h: 'Cliquez deux points.' },
  droite: { g: '⟷', n: 'Droite', need: [K.pt, K.pt], cmd: a => `Droite(${a[0]},${a[1]})`, h: 'Cliquez deux points.' },
  demi: { g: '↦', n: 'Demi-droite', need: [K.pt, K.pt], cmd: a => `Demi-droite(${a[0]},${a[1]})`, h: 'Origine puis second point.' },
  vecteur: { g: '→', n: 'Vecteur', need: [K.pt, K.pt], cmd: a => `Vecteur(${a[0]},${a[1]})`, h: 'Origine puis extrémité.' },
  perp: { g: '⟂', n: 'Perpendiculaire', need: [K.pt, K.lineOrPlane], cmd: a => `Perpendiculaire(${a[0]},${a[1]})`, h: 'Point puis droite ou plan : en 3D, plan ⟂ à la droite, ou droite ⟂ au plan.' },
  para: { g: '∥', n: 'Parallèle', need: [K.pt, K.lineOrPlane], cmd: a => `Parallèle(${a[0]},${a[1]})`, h: 'Point puis droite ou plan.' },
  mediatrice: { g: '⫲', n: 'Médiatrice', need: [K.pt, K.pt], cmd: a => `Médiatrice(${a[0]},${a[1]})`, h: '2D : médiatrice. 3D : plan médiateur.' },
  plan: { g: '▱', n: 'Plan (3 points)', dims: [3], need: [K.pt, K.pt, K.pt], cmd: a => `Plan(${a[0]},${a[1]},${a[2]})`, h: 'Cliquez trois points non alignés.' },
  poly: { g: '⬠', n: 'Polygone', many: true, cmd: a => `Polygone(${a.join(',')})`, h: 'Cliquez les sommets, puis le premier point (ou Entrée) pour fermer.' },
  cercle: { g: '◯', n: 'Cercle', need: [K.pt, K.pt], cmd: a => `Cercle(${a[0]},${a[1]})`, h: 'Centre puis un point du cercle (en 3D : cercle horizontal).' },
  sphereT: { g: '●', n: 'Sphère', dims: [3], need: [K.pt, K.pt], cmd: a => `Sphère(${a[0]},${a[1]})`, h: 'Centre puis un point de la sphère.' },
  angle: { g: '∠', n: 'Angle', need: [K.pt, K.pt, K.pt], cmd: a => `Angle(${a[0]},${a[1]},${a[2]})`, h: 'Trois points : le sommet est le deuxième.' },
  distance: { g: '↔', n: 'Distance', need: [K.pt, K.ptAny], cmd: a => `Distance(${a[0]},${a[1]})`, h: 'Un point puis un point, une droite ou un plan.' },
  cube: { g: '▣', n: 'Cube', dims: [3], need: [K.pt], make: a => sol(`Cube(${a[0]},${sz()})`, 8), h: 'Cliquez le sommet A : le cube et ses sommets sont créés.' },
  pave: { g: '▭', n: 'Pavé droit', dims: [3], need: [K.pt], make: a => sol(`Pavé(${a[0]},${sz() * 1.5},${sz()},${Math.max(1, sz() * .7)})`, 8), h: 'Cliquez le sommet A.' },
  tetra: { g: '△', n: 'Tétraèdre régulier', dims: [3], need: [K.pt], make: a => sol(`TétraèdreRégulier(${a[0]},${sz()})`, 4), h: 'Cliquez le sommet A.' },
  pyramide: { g: '◭', n: 'Pyramide', dims: [3], need: [K.pt], make: a => {
    const s = sz(), A = a[0], B = ex(`${A}+(${s},0,0)`).name, C = ex(`${A}+(${s},${s},0)`).name, D = ex(`${A}+(0,${s},0)`).name, T = ex(`${A}+(${s / 2},${s / 2},${s})`).name;
    return [ex(`Pyramide(${T},${A},${B},${C},${D})`)]; }, h: 'Cliquez le sommet A de la base carrée.' },
  prisme: { g: '⏢', n: 'Prisme', dims: [3], need: [K.pt], make: a => {
    const s = sz(), A = a[0], B = ex(`${A}+(${s},0,0)`).name, C = ex(`${A}+(${s / 2},${r3(s * .866)},0)`).name;
    return [ex(`Prisme(${A},${B},${C},(0,0,${s}))`)]; }, h: 'Cliquez le sommet A de la base triangulaire.' },
  cylindre: { g: '⌭', n: 'Cylindre', dims: [3], need: [K.pt], make: a => { const s = sz(), T = ex(`${a[0]}+(0,0,${s * 1.5})`).name; return [ex(`Cylindre(${a[0]},${T},${r3(s / 2)})`)]; }, h: 'Cliquez le centre de la base.' },
  cone: { g: '▲', n: 'Cône', dims: [3], need: [K.pt], make: a => { const s = sz(), T = ex(`${a[0]}+(0,0,${s * 1.5})`).name; return [ex(`Cône(${a[0]},${T},${r3(s / 2)})`)]; }, h: 'Cliquez le centre de la base.' },
  hyper: { g: '⧈', n: 'Hypercube', dims: [4], need: [K.pt], make: a => [ex(`Hypercube(${a[0]},${r3(sz() / 2)})`)], h: 'Cliquez le sommet de départ.' },
  penta: { g: '⬟', n: 'Pentachore', dims: [4], need: [K.pt], make: a => [ex(`Pentachore(${a[0]},${r3(sz() / 2)})`)], h: 'Cliquez le centre.' },
  hexa: { g: '⌬', n: 'Hexadécachore', dims: [4], need: [K.pt], make: a => [ex(`Hexadécachore(${a[0]},${r3(sz() / 2)})`)], h: 'Cliquez le centre.' },
  base: { g: '⌐', n: 'Base', need: [K.pt], make: null, h: 'Cliquez le point d’origine : les vecteurs de la base (modifiables) sont tracés.' },
  pen: { g: '✎', n: 'Crayon', h: 'Dessinez à main levée. Le plan de dessin se règle dans l’onglet Repère.' },
  eraser: { g: '⌫', n: 'Gomme', h: 'Passez sur un trait du crayon pour l’effacer.' },
};
const GROUPS = [['move'], ['point', 'milieu', 'inter', 'proj', 'sym'], ['segment', 'droite', 'demi', 'vecteur', 'perp', 'para', 'mediatrice'], ['plan', 'poly', 'cercle', 'sphereT'],
  ['angle', 'distance'], ['cube', 'pave', 'tetra', 'pyramide', 'prisme', 'cylindre', 'cone', 'hyper', 'penta', 'hexa'], ['base'], ['pen', 'eraser']];
const GROUP_NAMES = ['Déplacer', 'Points', 'Lignes', 'Surfaces', 'Mesures', 'Formes', 'Base', 'Dessin'];
// l'outil « base » : construit les vecteurs unitaires du repère courant
TOOLS.base.make = a => {
  const E = G.identity(doc.dim).map(v => `(${v.join(',')})`).join(',');
  return [ex(`Base(${a[0]},${E})`)];
};
const toolOK = t => !TOOLS[t].dims || TOOLS[t].dims.includes(doc.dim);

function buildToolbar() {
  const bar = $('ctools'); bar.innerHTML = '';
  GROUPS.forEach((g, gi) => {
    const items = g.filter(toolOK); if (!items.length) return;
    const cur = items.includes(S.lastTool[gi]) ? S.lastTool[gi] : items[0];
    const wrap = document.createElement('div'); wrap.className = 'tg' + (items.includes(S.tool) ? ' on' : ''); wrap.title = GROUP_NAMES[gi];
    const main = document.createElement('button'); main.className = 'tb'; main.innerHTML = `<span class="g">${TOOLS[items.includes(S.tool) ? S.tool : cur].g}</span><span class="l">${TOOLS[items.includes(S.tool) ? S.tool : cur].n}</span>`;
    main.onclick = () => setTool(items.includes(S.tool) ? S.tool : cur); wrap.appendChild(main);
    if (items.length > 1) {
      const car = document.createElement('button'); car.className = 'car'; car.textContent = '▾'; car.setAttribute('aria-label', `Outils : ${GROUP_NAMES[gi]}`);
      const pop = document.createElement('div'); pop.className = 'pop';
      for (const t of items) { const b = document.createElement('button'); b.innerHTML = `<span class="g">${TOOLS[t].g}</span>${TOOLS[t].n}`; b.onclick = () => { pop.classList.remove('open'); setTool(t); }; pop.appendChild(b); }
      car.onclick = e => { e.stopPropagation(); const was = pop.classList.contains('open'); document.querySelectorAll('.pop.open').forEach(p => p.classList.remove('open')); if (!was) pop.classList.add('open'); };
      wrap.append(car, pop);
    }
    bar.appendChild(wrap);
  });
}
document.addEventListener('click', () => document.querySelectorAll('.pop.open').forEach(p => p.classList.remove('open')));
function setTool(t) {
  S.tool = t; S.args = []; view.setPreview(null);
  GROUPS.forEach((g, gi) => { if (g.includes(t)) S.lastTool[gi] = t; });
  buildToolbar(); status(); renderAlgebraSel();
  view.renderer.domElement.style.cursor = t === 'move' ? 'default' : (t === 'pen' || t === 'eraser') ? 'crosshair' : 'crosshair';
}
function status(extra) {
  const T = TOOLS[S.tool], step = T.need ? `Étape ${S.args.length + 1}/${T.need.length}${S.args.length ? ' · ' + S.args.join(', ') : ''} — ` : T.many && S.args.length ? `${S.args.join(', ')} — ` : '';
  $('cstatus').textContent = (extra ? extra + '  ·  ' : '') + step + T.h;
}
let msgTimer = 0;
function msg(text, kind = 'ok') { const m = $('cmsg'); m.textContent = text; m.className = 'cmsg ' + kind; clearTimeout(msgTimer); msgTimer = setTimeout(() => { m.textContent = ''; m.className = 'cmsg'; }, 6000); }

// ---------- Synchronisation document ↔ vue ----------
function syncView() {
  if (view.dim !== doc.dim) { view.setDim(doc.dim); buildToolbar(); if (!toolOK(S.tool)) setTool('move'); }
  const rangeChanged = view.range !== doc.range;
  view.frame = doc.frame; view.range = doc.range; view.axisNames = doc.axisNames; view.basisNames = doc.basisNames;
  for (const id of [...S.sel]) if (!doc.byId(id)) S.sel.delete(id);
  view.setState({ objs: doc.objs, sel: S.sel, hover: S.hover, strokes: doc.strokes });
  if (rangeChanged) view.resize();
  S.dirty = S.ui = S.alg = true;
}
doc.onChange = syncView;
onTheme(() => { S.dirty = true; });
const zoomBar = mountZoom($('czoom'), () => view.zoomPct, p => view.setZoom(p));
view.onZoom = p => zoomBar.sync(p);
function commit() { doc.commit(); try { localStorage.setItem(STORE, JSON.stringify(doc.toJSON())); } catch { /* stockage indisponible */ } syncButtons(); }
function syncButtons() { $('undoBtn').disabled = doc.ptr <= 0; $('redoBtn').disabled = doc.ptr >= doc.stack.length - 1; document.querySelectorAll('#dimSeg button').forEach(b => b.classList.toggle('on', +b.dataset.dim === doc.dim)); }

function select(ids, add) {
  if (!add) S.sel.clear();
  for (const id of ids) { if (add && S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); }
  view.state.sel = S.sel; S.dirty = S.ui = true; renderAlgebraSel();
}
const selObjs = () => [...S.sel].map(id => doc.byId(id)).filter(o => o && o.value);

// ---------- Placement de points ----------
function cursorWorld(x, y) {
  const d = doc.dim;
  if (d === 2) { const h = view.rayPlane(x, y, [0, 0, 0], [0, 0, 1]); return h && [h.x, h.y]; }
  if (d === 3) { const h = view.rayPlane(x, y, [0, 0, S.workZ], [0, 0, 1]); return h && [h.x, h.y, h.z]; }
  const t = view.controls.target, dir = view.cam.getWorldDirection(new THREE.Vector3()), h = view.rayPlane(x, y, [t.x, t.y, t.z], [dir.x, dir.y, dir.z]);
  return h && view.unmap(h);
}
function worldToFrameSnap(w) {
  let c = doc.frame.toPos(w);
  if (S.snap) { const st = doc.range > 25 ? Math.max(S.step, 1) : S.step; c = c.map(v => Math.round(v / st) * st); }
  return c.map(r3);
}
const cursorFrame = (x, y) => { const w = cursorWorld(x, y); return w && worldToFrameSnap(w); };
function placePoint(x, y) {
  const c = cursorFrame(x, y); if (!c) { msg('Visez le plan de travail pour placer un point', 'err'); return null; }
  return ex(`(${c.join(', ')})`);
}

// ---------- Clics des outils ----------
function toolClick(x, y) {
  const T = TOOLS[S.tool];
  if (S.tool === 'point') { const hit = view.pick(x, y); if (hit && doc.byId(hit.id)?.value.t === 'pt') { select([hit.id]); return; } const p = placePoint(x, y); if (p) { select([p.id]); commit(); } return; }
  const idx = S.args.length, need = T.many ? K.pt : T.need[idx];
  const hit = view.pick(x, y), o = hit && doc.byId(hit.id);
  let name = null;
  try {
    if (o && o.value && need(o)) name = o.name;
    else if (canNewPt(need) && !(o && K.pt(o))) { const p = placePoint(x, y); if (p) name = p.name; }
  } catch (e) { msg(e.message, 'err'); return; }
  if (!name) { msg(o ? 'Cet objet ne convient pas pour cette étape' : 'Cliquez sur un objet', 'err'); return; }
  if (T.many && S.args.length >= 3 && name === S.args[0]) return finishTool();
  S.args.push(name);
  if (!T.many && S.args.length === T.need.length) return finishTool();
  status(); updatePreview(x, y); S.ui = true;
  const ob = doc.byName(name); if (ob) { S.sel.clear(); S.sel.add(ob.id); view.state.sel = S.sel; S.dirty = true; }
}
function finishTool() {
  const T = TOOLS[S.tool], a = S.args; S.args = []; view.setPreview(null);
  try {
    const made = T.make ? T.make(a) : [ex(T.cmd(a))];
    S.sel.clear(); made.forEach(o => o && S.sel.add(o.id)); commit(); msg(`${made.map(o => o.name).join(', ')} créé`);
  } catch (e) { msg(e.message, 'err'); }
  syncView(); status();
}
function updatePreview(x, y) {
  const T = TOOLS[S.tool];
  if (!S.args.length || (!T.many && !T.need)) { view.setPreview(null); return; }
  const last = doc.byName(S.args[S.args.length - 1]), step = T.many ? K.pt : T.need[S.args.length];
  if (!last || !K.pt(last) || (!T.many && !step)) { view.setPreview(null); return; }
  const w = cursorWorld(x, y); if (!w) return;
  const segs = []; const pts = S.args.map(n => doc.byName(n)?.value.p).filter(Boolean);
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  segs.push([pts[pts.length - 1], doc.frame.pos(worldToFrameSnap(w))]);
  view.setPreview({ segs, pts: [] });
}

// ---------- Pointeur ----------
const el = view.renderer.domElement;
const local = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const setCtl = on => { view.cPersp.enabled = on && doc.dim !== 2; view.cOrtho.enabled = on && doc.dim === 2; };
const drawPlaneSpec = () => doc.dim === 2 ? { mode: 'world', p: [0, 0, 0], n: [0, 0, 1] } : doc.dim === 4 || S.drawPlane === 'ecran' ? { mode: 'screen' }
  : S.drawPlane === 'face' ? { mode: 'world', p: [0, 0, 0], n: [0, 1, 0] } : S.drawPlane === 'profil' ? { mode: 'world', p: [0, 0, 0], n: [1, 0, 0] } : { mode: 'world', p: [0, 0, S.workZ], n: [0, 0, 1] };
function strokePoint(x, y, spec) {
  if (spec.mode === 'screen') return [x / el.clientWidth, y / el.clientHeight];
  const h = view.rayPlane(x, y, spec.p, spec.n); return h ? [r3(h.x), r3(h.y), r3(h.z)] : null;
}
function erase(x, y) {
  const before = doc.strokes.length;
  doc.strokes = doc.strokes.filter(s => !s.pts.some(p => {
    const sp = s.mode === 'screen' ? { x: p[0] * el.clientWidth, y: p[1] * el.clientHeight } : view.screen(new THREE.Vector3(...p)); return Math.hypot(sp.x - x, sp.y - y) < 12; }));
  if (doc.strokes.length !== before) { view.state.strokes = doc.strokes; S.dirty = true; S.erased = true; }
}
el.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const [x, y] = local(e); S.down = { x, y, t: performance.now(), shift: e.shiftKey || e.ctrlKey || e.metaKey };
  if (S.tool === 'pen') {
    const spec = drawPlaneSpec(), p = strokePoint(x, y, spec); setCtl(false); el.setPointerCapture(e.pointerId);
    S.stroke = { mode: spec.mode, color: S.penColor, width: S.penWidth, pts: p ? [p] : [], spec }; doc.strokes.push(S.stroke); return;
  }
  if (S.tool === 'eraser') { setCtl(false); el.setPointerCapture(e.pointerId); S.erasing = true; S.erased = false; erase(x, y); return; }
  if (S.tool === 'move' && doc.dim !== 4) {
    const hit = view.pick(x, y), o = hit && doc.byId(hit.id);
    if (o && o.free && o.value.t === 'pt') {
      setCtl(false); el.setPointerCapture(e.pointerId); S.drag = { o, moved: false, vertical: e.shiftKey && doc.dim === 3 };
      if (!S.sel.has(o.id)) select([o.id], e.shiftKey && false);
    }
  }
}, { capture: true });
el.addEventListener('pointermove', e => {
  const [x, y] = local(e);
  if (S.stroke) { const p = strokePoint(x, y, S.stroke.spec); if (p) { S.stroke.pts.push(p); S.dirty = true; } return; }
  if (S.erasing) { erase(x, y); return; }
  if (S.drag) {
    const d = S.drag; if (!S.down || Math.hypot(x - S.down.x, y - S.down.y) < 3) return; d.moved = true;
    const P = new THREE.Vector3(...G.pad(d.o.value.p, 3));
    let w;
    if (doc.dim === 2) { const h = view.rayPlane(x, y, [0, 0, 0], [0, 0, 1]); w = h && [h.x, h.y]; }
    else if (d.vertical) { const z = view.rayVertical(x, y, P); w = z === null ? null : [P.x, P.y, z]; }
    else { const h = view.rayPlane(x, y, [0, 0, P.z], [0, 0, 1]); w = h && [h.x, h.y, P.z]; }
    if (w) { try { doc.setFree(d.o, worldToFrameSnap(w)); } catch (err) { /* position invalide : ignorée */ } }
    return;
  }
  if (e.buttons) return;
  const hit = view.pick(x, y), id = hit ? hit.id : null;
  if (id !== S.hover) { S.hover = id; view.state.hover = id; S.dirty = true; }
  el.style.cursor = S.tool === 'move' ? (hit ? 'pointer' : 'default') : 'crosshair';
  const c = cursorFrame(x, y); $('ccoord').textContent = c ? `(${c.map(v => String(v).replace('.', ',').replace('-', '−')).join(' ; ')})` : '';
  if (S.tool !== 'move') updatePreview(x, y);
});
el.addEventListener('pointerup', e => {
  const [x, y] = local(e); const down = S.down; S.down = null;
  if (S.stroke) { S.stroke = null; setCtl(true); commit(); return; }
  if (S.erasing) { S.erasing = false; setCtl(true); if (S.erased) commit(); return; }
  if (S.drag) { const d = S.drag; S.drag = null; setCtl(true); if (d.moved) commit(); else select([d.o.id], down?.shift); return; }
  if (!down || Math.hypot(x - down.x, y - down.y) > 5) return;
  if (S.tool === 'move') { const hit = view.pick(x, y); if (hit) select([hit.id], down.shift); else if (!down.shift) select([]); }
  else toolClick(x, y);
});
el.addEventListener('pointerleave', () => { if (S.hover) { S.hover = null; view.state.hover = null; S.dirty = true; } });
window.addEventListener('keydown', e => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if ($('consApp').hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (inField) return; e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { if (inField) return; e.preventDefault(); redo(); }
  else if (e.key === 'Escape') { S.args = []; view.setPreview(null); setTool('move'); select([]); document.activeElement?.blur?.(); }
  else if (!inField && (e.key === 'Delete' || e.key === 'Backspace')) { const l = selObjs(); if (l.length) { e.preventDefault(); l.forEach(o => doc.byId(o.id) && doc.remove(o)); S.sel.clear(); commit(); } }
  else if (!inField && e.key === 'Enter' && S.tool === 'poly' && S.args.length >= 3) finishTool();
});
function undo() { if (doc.undo()) { syncView(); syncButtons(); commitStore(); } }
function redo() { if (doc.redo()) { syncView(); syncButtons(); commitStore(); } }
function commitStore() { try { localStorage.setItem(STORE, JSON.stringify(doc.toJSON())); } catch { /* ignoré */ } }
$('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
document.querySelectorAll('#dimSeg button').forEach(b => b.onclick = () => { if (+b.dataset.dim === doc.dim) return; try { doc.exec(`Repère(${b.dataset.dim})`); commit(); } catch (e) { msg(e.message, 'err'); } });

// ---------- Barre de commandes ----------
const cmd = $('cmd');
function runCommand(text) {
  try {
    const res = doc.run(text);
    const created = res.filter(r => r.obj).map(r => r.obj);
    if (created.length) { S.sel.clear(); created.forEach(o => S.sel.add(o.id)); }
    commit(); syncView();
    msg(created.length ? `${created.map(o => o.name).join(', ')} : ${plain(describe(created[created.length - 1], doc.frame))}` : 'Repère mis à jour');
    return true;
  } catch (e) { msg(e instanceof LangError ? e.message : `Erreur : ${e.message}`, 'err'); return false; }
}
const plain = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
cmd.addEventListener('keydown', e => {
  if (e.key === 'Enter' && cmd.value.trim()) { if (runCommand(cmd.value)) { S.hist.push(cmd.value); S.hi = S.hist.length; cmd.value = ''; hint(); } }
  else if (e.key === 'ArrowUp' && S.hist.length) { S.hi = Math.max(0, S.hi - 1); cmd.value = S.hist[S.hi]; e.preventDefault(); }
  else if (e.key === 'ArrowDown') { S.hi = Math.min(S.hist.length, S.hi + 1); cmd.value = S.hist[S.hi] || ''; e.preventDefault(); }
  else if (e.key === 'Tab' && $('chint').firstChild?.dataset?.syn) { e.preventDefault(); cmd.value = $('chint').firstChild.dataset.syn.split('  ·  ')[0].replace(/\(.*$/, '('); }
});
cmd.addEventListener('input', hint);
function hint() {
  const v = cmd.value.trim().replace(/^[\p{L}\p{N}_′']+\s*[=:]\s*/u, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), box = $('chint'); box.innerHTML = '';
  if (!v || /\(/.test(v) && v.indexOf(')') > v.indexOf('(')) return;
  const word = v.replace(/\(.*$/, '');
  const hits = COMMAND_DOC.filter(([s]) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(word)).slice(0, 4);
  for (const [s, d] of hits) { const b = document.createElement('div'); b.dataset.syn = s; b.innerHTML = `<code>${esc(s)}</code><span>${esc(d)}</span>`; b.onclick = () => { cmd.value = s.split('  ·  ')[0].replace(/\(.*$/, '('); cmd.focus(); hint(); }; box.appendChild(b); }
}

// ---------- Liste algébrique ----------
const TYPE_FR = { pt: 'Point', vec: 'Vecteur', seg: 'Segment', line: 'Droite', ray: 'Demi-droite', plane: 'Plan', circle: 'Cercle', sphere: 'Sphère', poly: 'Polygone', num: 'Nombre', angle: 'Angle', basis: 'Base', cyl: 'Cylindre', cone: 'Cône' };
const typeName = v => v.t === 'solid' ? (v.name[0].toUpperCase() + v.name.slice(1)) : TYPE_FR[v.t] || v.t;
function renderAlgebra() {
  const box = $('alg'); const focus = document.activeElement; if (focus && box.contains(focus) && focus.tagName === 'INPUT' && focus.classList.contains('adef') && !S.forceAlg) return;
  S.forceAlg = false; box.innerHTML = '';
  if (!doc.objs.length) { box.innerHTML = '<p class="empty">Aucun objet. Choisissez un outil, ou tapez une commande en bas, par exemple <code>A=(1,2,3)</code>.</p>'; return; }
  for (const o of doc.objs) {
    const row = document.createElement('div'); row.className = 'arow' + (S.sel.has(o.id) ? ' sel' : '') + (o.error ? ' err' : ''); row.dataset.id = o.id;
    const v = o.value;
    row.innerHTML = `<button class="eye${o.style.visible ? '' : ' off'}" style="--c:${o.style.color}" title="Afficher / masquer" aria-label="Afficher ou masquer ${esc(o.name)}"></button>
      <div class="amain"><div class="ahead"><input class="aname" value="${esc(o.name)}" aria-label="Nom" size="${Math.max(2, o.name.length)}"><span class="atype">${v ? typeName(v) : 'Erreur'}</span></div>
      <input class="adef" value="${esc(o.text)}" spellcheck="false" aria-label="Définition de ${esc(o.name)}">
      ${o.error ? `<div class="aerr">${esc(o.error)}</div>` : `<div class="aval">${describe(o, doc.frame)}</div>`}
      ${o.slider ? `<input class="asl" type="range" min="${o.slider.min}" max="${o.slider.max}" step="${o.slider.step}" value="${o.slider.val}" aria-label="Curseur ${esc(o.name)}">` : ''}</div>
      <button class="adel" title="Supprimer" aria-label="Supprimer ${esc(o.name)}">×</button>`;
    row.querySelector('.eye').onclick = e => { e.stopPropagation(); o.style.visible = !o.style.visible; commit(); syncView(); };
    row.querySelector('.adel').onclick = e => { e.stopPropagation(); doc.remove(o); S.sel.delete(o.id); commit(); };
    const def = row.querySelector('.adef');
    def.addEventListener('keydown', e => { if (e.key === 'Enter') def.blur(); if (e.key === 'Escape') { def.value = o.text; def.blur(); } });
    def.addEventListener('change', () => { try { doc.setText(o, def.value); commit(); msg(`${o.name} redéfini`); } catch (err) { msg(err.message, 'err'); def.value = o.text; } S.forceAlg = true; syncView(); });
    const nm = row.querySelector('.aname');
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') nm.blur(); });
    nm.addEventListener('change', () => { try { doc.rename(o, nm.value); commit(); } catch (err) { msg(err.message, 'err'); nm.value = o.name; } S.forceAlg = true; syncView(); });
    const sl = row.querySelector('.asl');
    if (sl) { sl.addEventListener('input', () => { doc.setSlider(o, +sl.value); doc.onChange(); updateAlgebraValues(); }); sl.addEventListener('change', commit); }
    row.addEventListener('click', e => { if (e.target.closest('input,button')) return; select([o.id], e.shiftKey || e.ctrlKey); });
    box.appendChild(row);
  }
}
function updateAlgebraValues() {
  for (const row of $('alg').querySelectorAll('.arow')) {
    const o = doc.byId(+row.dataset.id); if (!o) continue;
    const val = row.querySelector('.aval'); if (val && !o.error) val.innerHTML = describe(o, doc.frame);
    const def = row.querySelector('.adef'); if (def && document.activeElement !== def) def.value = o.text;
  }
}
function renderAlgebraSel() { for (const row of $('alg').querySelectorAll('.arow')) row.classList.toggle('sel', S.sel.has(+row.dataset.id)); }

// ---------- Panneau : onglets ----------
document.querySelectorAll('#ctabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#ctabs button').forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.pane').forEach(p => p.hidden = p.id !== 'pane-' + t);
  if (t === 'frame') renderFrame();
}

// --- Objet / analyse
function renderObject() {
  const pane = $('pane-obj'), list = selObjs();
  if (!list.length) {
    pane.innerHTML = `<div class="help"><h3>Pour commencer</h3>
      <p>Choisissez un exemple en haut, ou construisez avec les outils. Sélectionnez un ou plusieurs objets : les formules du programme s’affichent ici avec leurs valeurs.</p>
      <ul><li>Une droite et un plan : position relative, intersection, orthogonalité</li><li>Un point et un plan : distance et projeté orthogonal</li><li>Deux vecteurs : produit scalaire, angle, colinéarité</li><li>Une base : libre ? orthonormée ? coordonnées d’un vecteur</li></ul>
      <p class="mut">Raccourcis : <kbd>Échap</kbd> annule, <kbd>Suppr</kbd> supprime, <kbd>Ctrl</kbd>+<kbd>Z</kbd> annule, <kbd>Maj</kbd> + glisser monte un point en z. Clic droit : déplacer la vue.</p></div>`;
    return;
  }
  let html = '';
  if (list.length === 1) {
    const o = list[0], v = o.value;
    html += `<header class="oh"><h2>${esc(o.name)}</h2><span class="atype">${typeName(v)}</span></header>
      <div class="ostyle"><div class="sw">${PALETTE.map(c => `<button class="swb${o.style.color === c ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('')}</div>
      <label class="ck"><input type="checkbox" id="o-label" ${o.style.label !== false ? 'checked' : ''}> Nom affiché</label>
      <label class="ck"><input type="checkbox" id="o-vis" ${o.style.visible ? 'checked' : ''}> Visible</label></div>`;
    if (o.free && (v.t === 'pt' || v.t === 'vec')) {
      const c = v.t === 'pt' ? doc.frame.toPos(v.p) : doc.frame.toVec(v.v);
      html += `<div class="coords"><span class="lbl">Coordonnées</span>${c.map((x, i) => `<label>${doc.axisNames[i]}<input type="number" step="0.1" data-i="${i}" value="${r3(x)}"></label>`).join('')}</div>`;
    }
  } else html += `<header class="oh"><h2>${list.map(o => esc(o.name)).join(' · ')}</h2><span class="atype">${list.length} objets</span></header>`;
  const rows = analyze(list.slice(0, 4), doc.frame);
  html += '<div class="an">' + rows.map(r => r.sect ? '' : `<div class="ar${r.ok === true ? ' ok' : r.ok === false ? ' bad' : ''}"><div class="k">${r.k}</div><div class="f">${r.f}</div><div class="v">${r.v}</div></div>`).join('') + '</div>';
  if (!rows.length) html += '<p class="mut pad">Pas de formule pour cet objet.</p>';
  pane.innerHTML = html;
  pane.querySelectorAll('.swb').forEach(b => b.onclick = () => { list[0].style.color = b.dataset.c; commit(); syncView(); });
  const lb = $('o-label'); if (lb) lb.onchange = () => { list[0].style.label = lb.checked; commit(); syncView(); };
  const vs = $('o-vis'); if (vs) vs.onchange = () => { list[0].style.visible = vs.checked; commit(); syncView(); };
  const inputs = pane.querySelectorAll('.coords input');
  inputs.forEach(inp => inp.onchange = () => { try { doc.setFree(list[0], [...inputs].map(i => +i.value || 0)); commit(); } catch (e) { msg(e.message, 'err'); } });
}

// --- Formulaire
function buildFormulary() {
  const pane = $('pane-form');
  pane.innerHTML = `<input type="search" id="fsearch" class="search" placeholder="Rechercher une formule (distance, plan, produit scalaire…)" aria-label="Rechercher une formule"><div id="fbody"></div>`;
  const body = $('fbody');
  const render = q => {
    q = q.trim().toLowerCase(); body.innerHTML = '';
    for (const sec of FORMULARY) {
      const items = sec.items.filter(it => !q || (it.n + ' ' + sec.title + ' ' + it.f.replace(/<[^>]+>/g, '') + ' ' + (it.note || '')).toLowerCase().includes(q));
      if (!items.length) continue;
      const d = document.createElement('details'); d.open = !!q || sec.id === 'espace-droites-plans' || sec.id === 'orthogonalite';
      d.innerHTML = `<summary><span>${sec.title}</span><em class="lv lv-${sec.level.toLowerCase().replace(/[^a-z]/g, '')}">${sec.level}</em></summary>` + items.map(it => `<div class="fi"><div class="fn">${it.n}</div><div class="ff">${it.f}</div>${it.note ? `<div class="fnote">${it.note}</div>` : ''}${it.cmd ? `<button class="fcmd" data-cmd="${esc(it.cmd)}" title="Copier dans la ligne de commande">${esc(it.cmd)}</button>` : ''}</div>`).join('');
      body.appendChild(d);
    }
    body.querySelectorAll('.fcmd').forEach(b => b.onclick = () => { cmd.value = b.dataset.cmd; cmd.focus(); hint(); });
    if (!body.children.length) body.innerHTML = '<p class="mut pad">Aucune formule ne correspond.</p>';
  };
  $('fsearch').oninput = e => render(e.target.value); render('');
}

// --- Repère
function renderFrame() {
  if (S.tab !== 'frame') return;
  const pane = $('pane-frame'), F = doc.frame, n = doc.dim, ae = document.activeElement;
  if (pane.contains(ae) && ae.tagName === 'INPUT' && ae.type !== 'range' && ae.type !== 'checkbox') return;
  const tog = (id, label, on) => `<label class="ck"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
  const vn = ['i', 'j', 'k', 'l'];
  pane.innerHTML = `
  <section><h3>Repère</h3>
    <div class="seg3" role="group" aria-label="Dimension">${[2, 3, 4].map(d => `<button data-d="${d}" class="${d === n ? 'on' : ''}">${d}D</button>`).join('')}</div>
    <div class="grid-in"><span class="lbl">Origine O</span>${F.O.map((x, i) => `<input type="number" step="0.5" class="fo" data-i="${i}" value="${r3(x)}" aria-label="Origine ${doc.axisNames[i]}">`).join('')}</div>
    <div class="lbl">Base (vecteurs du repère, en coordonnées du monde)</div>
    ${F.B.map((e, r) => `<div class="grid-in"><span class="bn" style="color:${AXIS_COLORS[r]}">${doc.basisNames[r] || vn[r]}</span>${e.map((x, c) => `<input type="number" step="0.1" class="fb" data-r="${r}" data-c="${c}" value="${r3(x)}" aria-label="Vecteur ${r + 1}, composante ${c + 1}">`).join('')}</div>`).join('')}
    <div class="btns"><button id="f-apply" class="btn pri">Appliquer</button><button id="f-ortho" class="btn">Repère orthonormé</button></div>
    <p class="mut">${F.isOrtho() ? (F.isStd() ? 'Repère orthonormé standard.' : 'Repère orthonormé.') : 'Repère non orthonormé : produits scalaires et distances restent calculés dans le monde réel (matrice de Gram).'}</p>
    ${F.isOrtho() ? '' : `<div class="gram"><span class="lbl">Matrice de Gram G = (eᵢ·eⱼ)</span><table>${F.gram().map(r => `<tr>${r.map(x => `<td>${G.nice(x)}</td>`).join('')}</tr>`).join('')}</table></div>`}
    <div class="grid-in names"><span class="lbl">Noms des axes</span>${Array.from({ length: n }, (_, i) => `<input class="an-ax" data-i="${i}" maxlength="3" value="${esc(doc.axisNames[i])}" aria-label="Nom de l’axe ${i + 1}">`).join('')}</div>
    <div class="grid-in names"><span class="lbl">Noms des vecteurs</span>${Array.from({ length: n }, (_, i) => `<input class="an-bs" data-i="${i}" maxlength="3" value="${esc(doc.basisNames[i])}" aria-label="Nom du vecteur ${i + 1}">`).join('')}</div>
  </section>
  <section><h3>Affichage</h3>
    <div class="slider2"><label for="f-range">Taille du repère (portée ± ${doc.range})</label><input type="range" id="f-range" min="3" max="200" step="1" value="${doc.range}"></div>
    <div class="tg2">${tog('f-grid', 'Grille', view.opts.grid)}${n === 3 ? tog('f-gxz', 'Grille xz', view.opts.gridXZ) + tog('f-gyz', 'Grille yz', view.opts.gridYZ) : ''}${tog('f-axes', 'Axes', view.opts.axes)}${tog('f-ticks', 'Graduations', view.opts.ticks)}${tog('f-basis', 'Vecteurs de base', view.opts.basisArrows)}${n === 3 ? tog('f-hidden', 'Arêtes cachées', view.opts.hidden) : ''}</div>
    ${n > 2 ? `<div class="btns">${n === 3 ? ['persp:Perspective', 'face:Face', 'profil:Profil', 'dessus:Dessus'].map(s => `<button class="btn vw" data-v="${s.split(':')[0]}">${s.split(':')[1]}</button>`).join('') : ''}<button class="btn" id="f-reset">Recentrer</button></div>` : '<div class="btns"><button class="btn" id="f-reset">Recentrer</button></div>'}
  </section>
  <section><h3>Construction</h3>
    ${tog('f-snap', 'Aimanter à la grille', S.snap)}
    <div class="grid-in"><span class="lbl">Pas</span><select id="f-step">${[.1, .25, .5, 1, 2].map(s => `<option ${s === S.step ? 'selected' : ''} value="${s}">${s}</option>`).join('')}</select></div>
    ${n === 3 ? `<div class="slider2"><label for="f-wz">Hauteur du plan de travail z = ${S.workZ}</label><input type="range" id="f-wz" min="${-doc.range}" max="${doc.range}" step="0.5" value="${S.workZ}"></div>` : ''}
  </section>
  ${n === 4 ? `<section><h3>Projection 4D → 3D</h3>
    ${[['xw', 'Rotation dans le plan (x, w)'], ['yw', 'Rotation dans le plan (y, w)'], ['zw', 'Rotation dans le plan (z, w)']].map(([k, l]) => `<div class="slider2"><label for="v4-${k}">${l} : ${Math.round(view.v4[k] * 180 / Math.PI)}°</label><input type="range" id="v4-${k}" data-k="${k}" min="${-Math.PI}" max="${Math.PI}" step="0.01" value="${view.v4[k]}"></div>`).join('')}
    ${tog('v4-persp', 'Perspective (sinon projection parallèle)', view.v4.persp)}
    <div class="slider2"><label for="v4-d">Distance du point de vue D = ${view.v4.d}</label><input type="range" id="v4-d" min="3" max="20" step="0.5" value="${view.v4.d}"></div>
    <div class="btns"><button class="btn ${S.playing ? 'pri' : ''}" id="v4-play">${S.playing ? '❚❚ Arrêter la rotation' : '▶ Faire tourner'}</button></div></section>` : ''}
  <section><h3>Dessin à main levée</h3>
    <div class="sw">${PALETTE.map(c => `<button class="swb pen${S.penColor === c ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Couleur du crayon ${c}"></button>`).join('')}<button class="swb pen${S.penColor === '#ffffff' ? ' on' : ''}" data-c="#ffffff" style="--c:#fff" aria-label="Blanc"></button></div>
    <div class="slider2"><label for="f-pw">Épaisseur du trait : ${S.penWidth}</label><input type="range" id="f-pw" min="1" max="10" step="1" value="${S.penWidth}"></div>
    ${n === 3 ? `<div class="grid-in"><span class="lbl">Plan de dessin</span><select id="f-dp">${[['sol', 'Sol (xy)'], ['face', 'Face (xz)'], ['profil', 'Profil (yz)'], ['ecran', 'Écran (fixe)']].map(([v, l]) => `<option value="${v}" ${S.drawPlane === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : n === 4 ? '<p class="mut">En 4D le dessin est fixé à l’écran.</p>' : '<p class="mut">Le dessin est tracé dans le plan.</p>'}
    <div class="btns"><button class="btn" id="f-pen">✎ Crayon</button><button class="btn" id="f-clr">Effacer le dessin</button></div>
  </section>`;
  const $$ = s => pane.querySelector(s), on = (s, ev, fn) => { const e = pane.querySelector(s); if (e) e[ev] = fn; };
  pane.querySelectorAll('.seg3 button').forEach(b => b.onclick = () => { try { doc.exec(`Repère(${b.dataset.d})`); commit(); } catch (e) { msg(e.message, 'err'); } });
  const applyFrame = () => {
    try {
      const O = [...pane.querySelectorAll('.fo')].map(i => +i.value || 0), B = G.identity(n).map((_, r) => [...pane.querySelectorAll(`.fb[data-r="${r}"]`)].map(i => +i.value || 0));
      doc.setFrame(n, O, B); if (doc.frame.singular) { doc.setFrame(n); throw new LangError('Les vecteurs de base sont liés (déterminant nul)'); } commit(); msg('Repère appliqué');
    } catch (e) { msg(e.message, 'err'); }
  };
  on('#f-apply', 'onclick', applyFrame);
  on('#f-ortho', 'onclick', () => { doc.setFrame(n); commit(); });
  pane.querySelectorAll('.fo,.fb').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') applyFrame(); }));
  pane.querySelectorAll('.an-ax').forEach(i => i.onchange = () => { doc.axisNames[+i.dataset.i] = i.value || 'xyzw'[+i.dataset.i]; commit(); syncView(); });
  pane.querySelectorAll('.an-bs').forEach(i => i.onchange = () => { doc.basisNames[+i.dataset.i] = i.value || 'ijkl'[+i.dataset.i]; commit(); syncView(); });
  on('#f-range', 'oninput', e => { doc.range = +e.target.value; view.range = doc.range; view.resize(); syncView(); pane.querySelector('label[for=f-range]').textContent = `Taille du repère (portée ± ${doc.range})`; });
  on('#f-range', 'onchange', () => { renderFrame(); commit(); });
  for (const [id, k] of [['f-grid', 'grid'], ['f-gxz', 'gridXZ'], ['f-gyz', 'gridYZ'], ['f-axes', 'axes'], ['f-ticks', 'ticks'], ['f-basis', 'basisArrows'], ['f-hidden', 'hidden']]) on('#' + id, 'onchange', e => { view.opts[k] = e.target.checked; S.dirty = true; });
  pane.querySelectorAll('.vw').forEach(b => b.onclick = () => view.setView(b.dataset.v));
  on('#f-reset', 'onclick', () => view.resetCamera());
  on('#f-snap', 'onchange', e => S.snap = e.target.checked); on('#f-step', 'onchange', e => S.step = +e.target.value);
  on('#f-wz', 'oninput', e => { S.workZ = +e.target.value; pane.querySelector('label[for=f-wz]').textContent = `Hauteur du plan de travail z = ${S.workZ}`; });
  pane.querySelectorAll('input[data-k]').forEach(i => i.oninput = () => { view.v4[i.dataset.k] = +i.value; S.dirty = true; pane.querySelector(`label[for=v4-${i.dataset.k}]`).textContent = pane.querySelector(`label[for=v4-${i.dataset.k}]`).textContent.replace(/: -?\d+°/, `: ${Math.round(+i.value * 180 / Math.PI)}°`); });
  on('#v4-persp', 'onchange', e => { view.v4.persp = e.target.checked; S.dirty = true; });
  on('#v4-d', 'oninput', e => { view.v4.d = +e.target.value; S.dirty = true; pane.querySelector('label[for=v4-d]').textContent = `Distance du point de vue D = ${view.v4.d}`; });
  on('#v4-play', 'onclick', () => { S.playing = !S.playing; renderFrame(); });
  pane.querySelectorAll('.swb.pen').forEach(b => b.onclick = () => { S.penColor = b.dataset.c; renderFrame(); });
  on('#f-pw', 'oninput', e => { S.penWidth = +e.target.value; pane.querySelector('label[for=f-pw]').textContent = `Épaisseur du trait : ${S.penWidth}`; });
  on('#f-dp', 'onchange', e => S.drawPlane = e.target.value);
  on('#f-pen', 'onclick', () => setTool('pen'));
  on('#f-clr', 'onclick', () => { doc.strokes = []; view.state.strokes = doc.strokes; S.dirty = true; commit(); });
}

// --- Programme
function buildProgram() {
  const pane = $('pane-prog');
  pane.innerHTML = `<section><h3>Programme</h3>
    <p class="mut">Une instruction par ligne. <code>pour k de 0 à 5 : P{k}=(k, k^2/5, 0)</code> répète une ligne. Les commandes <code>Repère</code>, <code>Origine</code>, <code>BaseRepère</code> et <code>Portée</code> programment le repère.</p>
    <textarea id="prog" spellcheck="false" aria-label="Programme" rows="9">// Repère de dimension 3, origine décalée, base oblique
Repère(3)
Portée(12)
A=(1,1,0)
pour k de 0 à 4 : P{k}=(k, k^2/4, 0)
Polygone(P0,P1,P2,P3,P4)</textarea>
    <div class="btns"><button class="btn pri" id="prog-run">▶ Exécuter</button><button class="btn" id="prog-clear">Vider la scène</button><button class="btn" id="prog-copy">Copier en JSON</button></div>
    <div id="prog-out" class="out" aria-live="polite"></div></section>
  <section><h3>Commandes disponibles</h3><input type="search" id="csearch" class="search" placeholder="Filtrer les commandes" aria-label="Filtrer les commandes"><div id="clist"></div></section>`;
  const out = $('prog-out');
  $('prog-run').onclick = () => {
    const evalNum = s => { const v = evalAst(parseExpr(s), doc.ctxFor(null)); if (v.t !== 'num') throw new LangError('Un nombre est attendu'); return v.v; };
    out.className = 'out'; out.textContent = '';
    let lines;
    try { lines = expandProgram($('prog').value, evalNum); } catch (e) { out.className = 'out bad'; out.textContent = e.message; return; }
    let n = 0;
    for (const [i, l] of lines.entries()) {
      try { doc.exec(l); n++; } catch (e) { out.className = 'out bad'; out.textContent = `Ligne ${i + 1} : ${l}\n→ ${e.message}`; break; }
    }
    if (!out.textContent) out.textContent = `${n} instruction${n > 1 ? 's' : ''} exécutée${n > 1 ? 's' : ''}.`;
    commit(); syncView();
  };
  $('prog-clear').onclick = () => { doc.run('Effacer()'); S.sel.clear(); commit(); out.textContent = 'Scène vidée.'; out.className = 'out'; };
  $('prog-copy').onclick = async () => {
    const txt = JSON.stringify(doc.toJSON());
    try { await navigator.clipboard.writeText(txt); out.textContent = 'Construction copiée dans le presse-papiers.'; out.className = 'out'; }
    catch { out.textContent = txt; out.className = 'out'; const r = document.createRange(); r.selectNodeContents(out); getSelection().removeAllRanges(); getSelection().addRange(r); }
  };
  const render = q => { q = q.toLowerCase(); $('clist').innerHTML = COMMAND_DOC.filter(([s, d]) => !q || (s + d).toLowerCase().includes(q)).map(([s, d]) => `<button class="ci" data-s="${esc(s)}"><code>${esc(s)}</code><span>${esc(d)}</span></button>`).join(''); $('clist').querySelectorAll('.ci').forEach(b => b.onclick = () => { cmd.value = b.dataset.s.split('  ·  ')[0]; cmd.focus(); cmd.setSelectionRange(cmd.value.length, cmd.value.length); hint(); }); };
  $('csearch').oninput = e => render(e.target.value); render('');
}

// ---------- Exemples ----------
function loadExample(i) {
  const e = EXAMPLES[i];
  doc.objs = []; doc.strokes = []; doc.colorIdx = 0; doc.frame.set(e.dim); doc.range = e.range || 10; doc.axisNames = ['x', 'y', 'z', 'w']; doc.basisNames = ['i', 'j', 'k', 'l']; doc.recompute();
  S.sel.clear(); S.args = [];
  const errs = [];
  for (const l of e.lines) { try { doc.exec(l); } catch (err) { errs.push(`${l} → ${err.message}`); } }
  syncView(); view.resetCamera();
  for (const n of e.select || []) { const o = doc.byName(n); if (o) S.sel.add(o.id); }
  view.state.sel = S.sel; S.dirty = S.ui = true;
  doc.stack = []; doc.ptr = -1; commit(); setTool('move'); setTab('obj');
  if (errs.length) msg(errs[0], 'err'); else msg(`Exemple : ${e.name}`);
}
EXAMPLES.forEach((e, i) => $('exSel').add(new Option(e.name, i)));
$('exSel').onchange = e => { if (e.target.value !== '') loadExample(+e.target.value); e.target.value = ''; };

// ---------- Boucle ----------
let last = performance.now(), uiTimer = 0;
view.onFrame = () => {
  const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
  if (S.playing && doc.dim === 4) { view.v4.xw += dt * .55; view.v4.yw += dt * .33; view.v4.zw += dt * .21; S.dirty = true; }
  if (S.dirty) { S.dirty = false; view.rebuild(); }
  if (S.alg) { S.alg = false; renderAlgebra(); updateAlgebraValues(); }
  if (S.ui) { S.ui = false; if (!(document.activeElement?.closest?.('#pane-obj') && document.activeElement.tagName === 'INPUT')) renderObject(); renderFrame(); syncButtons(); }
};

// ---------- Mode Solides / Construire ----------
function setMode(m) {
  const cons = m === 'construct';
  $('solidsApp').hidden = cons; $('consApp').hidden = !cons;
  document.querySelectorAll('#modeBtns button').forEach(b => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  window.__solids?.setActive(!cons);
  if (cons) { view.start(); requestAnimationFrame(() => { view.resize(); syncView(); }); } else view.stop();
  try { localStorage.setItem('atelier-mode', m); } catch { /* ignoré */ }
}
document.querySelectorAll('#modeBtns button').forEach(b => b.onclick = () => setMode(b.dataset.mode));

// ---------- Démarrage ----------
buildToolbar(); buildFormulary(); buildProgram(); setTab('obj');
let restored = false;
try { const j = JSON.parse(localStorage.getItem(STORE) || 'null'); if (j && j.objs?.length) { doc.load(j); restored = true; doc.commit(); } } catch { /* ignoré */ }
if (!restored) loadExample(0); else { syncView(); view.resetCamera(); setTool('move'); syncButtons(); }
let mode = 'construct'; try { mode = localStorage.getItem('atelier-mode') || 'construct'; } catch { /* ignoré */ }
setMode(mode);
status();
window.__c = { doc, view, S, run: t => { const r = runCommand(t); return r; }, loadExample, setTool, setTab, select, setMode, TOOLS, toolClick, undo };
window.__consReady = true;
