// Modèle du document : objets nommés dépendants, redéfinition, annulation, sérialisation.
import * as G from './geo.js';
import { parseStatement, evalAst, evalEquation, LangError } from './lang.js';

export const PALETTE = ['#f2c14e', '#7fc8f8', '#f28f79', '#8fe3b0', '#c7a6f5', '#f5a6c8', '#6fe0dc', '#ff9aa2'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', VEC_LETTERS = 'uvwabcdefghijklmnopqrst', GREEK = 'αβγδεζηθικλμ';
const BASE_WORD = { seg: 's', line: 'd', ray: 'dr', plane: 'p', circle: 'c', sphere: 'sph', poly: 'poly', cyl: 'cyl', cone: 'cone', basis: 'base', num: 'k' };
const SOLID_WORD = { cube: 'cube', 'pavé': 'pave', 'tétraèdre': 'tetra', 'tétraèdre régulier': 'tetra', pyramide: 'pyr', prisme: 'prisme', hypercube: 'hyper', pentachore: 'penta', 'hexadécachore': 'hexa' };
const isIdent = (s, name) => new RegExp(`(?<![\\p{L}\\p{N}_′'])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_′'])`, 'u').test(s);
const fmtNum = x => { const r = Math.round(x * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };
const isLit = a => a.k === 'num' || (a.k === 'neg' && a.x.k === 'num');

export class Doc {
  constructor() {
    this.frame = new G.Frame(3); this.range = 10; this.objs = []; this.strokes = []; this.nextId = 1; this.colorIdx = 0;
    this.stack = []; this.ptr = -1; this.onChange = () => {};
    this.axisNames = ['x', 'y', 'z', 'w']; this.basisNames = ['i', 'j', 'k', 'l'];
  }
  get dim() { return this.frame.n; }
  byId(id) { return this.objs.find(o => o.id === id); }
  byName(n) { return this.objs.find(o => o.name === n); }
  valueMap(upTo) { const m = new Map(); for (const o of this.objs) { if (o === upTo) break; if (o.value) m.set(o.name, o.value); } return m; }
  ctxFor(upTo, act) { const m = this.valueMap(upTo); return { frame: this.frame, get: n => m.get(n), act: act || (() => {}) }; }

  // ---------- évaluation ----------
  evalObj(o, ctx) {
    let v = o.st.kind === 'eq' ? evalEquation(o.st, ctx) : evalAst(o.st.ast, ctx);
    if (v.t === 'tuple') v = /^\p{Lu}/u.test(o.name) ? { t: 'pt', p: this.frame.pos(v.c) } : { t: 'vec', v: this.frame.vec(v.c) };
    if (v.t === 'action') throw new LangError('Cette commande ne crée pas d’objet');
    if (v.slider) { if (!o.slider) o.slider = { ...v.slider, val: v.v }; v = { t: 'num', v: o.slider.val, slider: o.slider }; }
    return v;
  }
  recompute() {
    const m = new Map();
    for (const o of this.objs) {
      o.error = null; o.value = null;
      try { o.value = this.evalObj(o, { frame: this.frame, get: n => m.get(n), act: () => {} }); }
      catch (e) { o.error = e instanceof LangError ? e.message : (e.message || String(e)); }
      o.free = !!(o.value && o.st.kind === 'expr' && o.st.ast && ((o.st.ast.k === 'tuple' && o.st.ast.items.every(isLit)) || (o.st.ast.k === 'num' && !o.slider)));
      if (o.value) m.set(o.name, o.value);
    }
  }

  // ---------- noms ----------
  uniq(base) { if (!this.byName(base)) return base; for (let k = 1; ; k++) if (!this.byName(base + k)) return base + k; }
  fromLetters(L) {
    for (const c of L) if (!this.byName(c)) return c;
    for (let k = 1; ; k++) for (const c of L) if (!this.byName(c + k)) return c + k;
  }
  autoName(v) {
    switch (v.t) {
      case 'pt': return this.fromLetters(LETTERS);
      case 'vec': return this.fromLetters(VEC_LETTERS);
      case 'angle': return this.fromLetters(GREEK);
      case 'solid': return this.uniq(SOLID_WORD[v.name] || 'solide');
      default: return this.uniq(BASE_WORD[v.t] || 'obj');
    }
  }

  // ---------- commandes ----------
  // Exécute une ligne ; renvoie { obj } | { action: true }. Lève LangError en cas de problème.
  exec(line) {
    const st = parseStatement(line);
    let acted = false;
    const ctx = this.ctxFor(null, (a, v) => { acted = true; this.act(a, v); });
    const existing = st.name ? this.byName(st.name) : null;
    const scratch = { name: st.name || 'X', st };
    const v = st.kind === 'eq' ? evalEquation(st, ctx) : evalAst(st.ast, ctx);
    if (v.t === 'action') { this.recompute(); this.onChange(); return { action: true }; }
    const name = st.name || (v.t === 'tuple' ? this.fromLetters(LETTERS) : this.autoName(v));
    scratch.name = name;
    let o;
    let prev = null;
    if (existing) { o = existing; prev = { st: o.st, text: o.text, kind: o.kind, slider: o.slider }; o.st = st; o.text = st.src ?? line; o.kind = st.kind; delete o.slider; }
    else { o = { id: this.nextId++, name, st, text: st.src, kind: st.kind, style: { color: PALETTE[this.colorIdx++ % PALETTE.length], visible: true, label: true, width: 2.2 } }; this.objs.push(o); }
    this.recompute();
    if (o.error) {
      const msg = o.error;
      if (prev) Object.assign(o, prev); else this.objs.splice(this.objs.indexOf(o), 1);
      this.recompute(); throw new LangError(msg);
    }
    this.onChange(); return { obj: o };
  }
  run(text) {          // plusieurs instructions séparées par « ; » ou saut de ligne
    const out = [];
    for (const part of text.split(/[;\n]/)) if (part.trim()) out.push(this.exec(part.trim()));
    return out;
  }
  act(a, v) {
    if (a === 'dim') { if (![2, 3, 4].includes(v)) throw new LangError('Dimension 2, 3 ou 4'); this.setFrame(v); }
    else if (a === 'origin') this.setFrame(this.dim, v, this.frame.B);
    else if (a === 'basis') {
      if (v.length !== this.dim) throw new LangError(`Il faut ${this.dim} vecteurs de base`);
      this.setFrame(this.dim, this.frame.O, v.map(c => this.frame.vec(c)));
      if (this.frame.singular) throw new LangError('Les vecteurs de base sont liés : repère invalide');
    }
    else if (a === 'range') this.range = Math.max(3, Math.min(200, v));
    else if (a === 'clear') { this.objs = []; this.strokes = []; }
  }
  setFrame(n, O, B) {
    if (n !== this.dim) { this.frame.set(n, O, B); this.axisNames = ['x', 'y', 'z', 'w']; }
    else this.frame.set(n, O, B);
    this.recompute(); this.onChange();
  }
  setText(o, text) {      // redéfinition depuis la liste algébrique
    const src = o.st.kind === 'eq' || text.includes('=') ? `${o.name}: ${text}` : `${o.name}=${text}`;
    return this.exec(src);
  }
  setFree(o, coords) { return this.exec(`${o.name}=(${coords.map(fmtNum).join(', ')})`); }
  setSlider(o, val) { o.slider.val = val; o.text = String(val); this.recompute(); }
  rename(o, nn) {
    nn = nn.trim(); if (!nn || nn === o.name) return;
    if (!/^[\p{L}][\p{L}\p{N}_′']*$/u.test(nn)) throw new LangError('Nom invalide');
    if (this.byName(nn)) throw new LangError(`« ${nn} » existe déjà`);
    const old = o.name, re = new RegExp(`(?<![\\p{L}\\p{N}_′'])${old}(?![\\p{L}\\p{N}_′'(])`, 'gu');
    o.name = nn;
    for (const p of this.objs) if (p !== o && p.text) { const t = p.text.replace(re, nn); if (t !== p.text) { p.text = t; p.st = parseStatement(p.kind === 'eq' ? t : `${p.name}=${t}`); } }
    this.recompute(); this.onChange();
  }
  dependents(o) {
    const set = new Set([o.name]); let grow = true;
    while (grow) { grow = false; for (const p of this.objs) if (!set.has(p.name) && p.text && [...set].some(n => isIdent(p.text, n))) { set.add(p.name); grow = true; } }
    return this.objs.filter(p => set.has(p.name));
  }
  remove(o) {
    const del = new Set(this.dependents(o)); this.objs = this.objs.filter(p => !del.has(p)); this.recompute(); this.onChange();
  }

  // ---------- historique et sérialisation ----------
  toJSON() {
    return { n: this.dim, O: this.frame.O, B: this.frame.B, range: this.range, axisNames: this.axisNames, basisNames: this.basisNames, colorIdx: this.colorIdx,
      objs: this.objs.map(o => ({ name: o.name, text: o.text, kind: o.kind, style: o.style, slider: o.slider })), strokes: this.strokes };
  }
  load(j) {
    this.frame.set(j.n, j.O, j.B); this.range = j.range || 10; this.axisNames = j.axisNames || ['x', 'y', 'z', 'w']; this.basisNames = j.basisNames || ['i', 'j', 'k', 'l'];
    this.colorIdx = j.colorIdx || 0; this.strokes = j.strokes || []; this.objs = [];
    for (const d of j.objs || []) {
      try {
        const st = parseStatement(d.kind === 'eq' ? `${d.name}: ${d.text}` : `${d.name}=${d.text}`);
        this.objs.push({ id: this.nextId++, name: d.name, st, text: d.text, kind: d.kind, style: d.style, slider: d.slider });
      } catch { /* objet illisible : ignoré */ }
    }
    this.recompute(); this.onChange();
  }
  commit() {
    const s = JSON.stringify(this.toJSON());
    if (this.stack[this.ptr] === s) return;
    this.stack = this.stack.slice(0, this.ptr + 1); this.stack.push(s); if (this.stack.length > 120) this.stack.shift(); this.ptr = this.stack.length - 1;
  }
  undo() { if (this.ptr > 0) { this.ptr--; this.load(JSON.parse(this.stack[this.ptr])); return true; } return false; }
  redo() { if (this.ptr < this.stack.length - 1) { this.ptr++; this.load(JSON.parse(this.stack[this.ptr])); return true; } return false; }
}
