// Rendu 3D de la construction : repère 2D/3D/4D, objets, sélection, dessin à main levée.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/CSS2DRenderer.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import * as G from './geo.js';
import { onTheme, BG, inkCss } from './theme.js';
import { clampZoom, nextPalier } from './zoom.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const AXIS_COLORS = ['#f28f79', '#8fe3b0', '#7fc8f8', '#f2c14e'];

export class View {
  constructor(host, labelHost, inkCanvas) {
    this.host = host; this.ink = inkCanvas; this.inkCtx = inkCanvas.getContext('2d');
    this.dim = 3; this.range = 10; this.frame = new G.Frame(3);
    this.opts = { grid: true, gridXZ: false, gridYZ: false, axes: true, ticks: true, hidden: true, basisArrows: true };
    this.v4 = { xw: 0.5, yw: 0.3, zw: 0, persp: true, d: 7 };
    this.state = { objs: [], sel: new Set(), hover: null, strokes: [], preview: null };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer({ element: labelHost });
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color();
    onTheme(t => this.scene.background.setHex(BG[t]));
    this.persp = new THREE.PerspectiveCamera(40, 1, 0.05, 2000); this.persp.up.set(0, 0, 1);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500);
    this.cPersp = new OrbitControls(this.persp, this.renderer.domElement);
    this.cOrtho = new OrbitControls(this.ortho, this.renderer.domElement);
    for (const c of [this.cPersp, this.cOrtho]) { c.enableDamping = true; c.dampingFactor = .1; c.screenSpacePanning = true; }
    this.cPersp.minDistance = .5; this.cPersp.maxDistance = 4000;
    this.cPersp.enableZoom = false; this.cOrtho.enableZoom = false;
    this.zoomPct = 100; this.baseDist = 20; this.baseOrtho = 1; this.onZoom = () => {};
    this.renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); this.setZoom(nextPalier(this.zoomPct, e.deltaY < 0 ? 1 : -1)); }, { passive: false });
    this.cOrtho.enableRotate = false; this.cOrtho.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.cOrtho.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.cPersp.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.content = new THREE.Group(); this.scene.add(this.content);
    this.pickGroup = new THREE.Group();
    this.preview = new THREE.Group(); this.scene.add(this.preview);
    this.matCache = new Map(); this.lineMats = new Set(); this.arrows = []; this.labels = new Map();
    this.pickPts = []; this.pickSegs = [];
    this.ray = new THREE.Raycaster();
    this.active = false; this.onFrame = null;
    new ResizeObserver(() => this.resize()).observe(host);
    this.setDim(3);
  }

  get cam() { return this.dim === 2 ? this.ortho : this.persp; }
  get controls() { return this.dim === 2 ? this.cOrtho : this.cPersp; }

  // ---------- Dimensions, projection 4D ----------
  setDim(n) {
    this.dim = n; this.cPersp.enabled = n !== 2; this.cOrtho.enabled = n === 2; this.resetCamera();
  }
  rot4(p) {
    const q = G.pad(p, 4);
    for (const [i, j, a] of [[0, 3, this.v4.xw], [1, 3, this.v4.yw], [2, 3, this.v4.zw]]) {
      const c = Math.cos(a), s = Math.sin(a), x = q[i], w = q[j];
      q[i] = c * x - s * w; q[j] = s * x + c * w;
    }
    return q;
  }
  unrot4(q) {
    q = q.slice();
    for (const [i, j, a] of [[2, 3, this.v4.zw], [1, 3, this.v4.yw], [0, 3, this.v4.xw]]) {
      const c = Math.cos(-a), s = Math.sin(-a), x = q[i], w = q[j];
      q[i] = c * x - s * w; q[j] = s * x + c * w;
    }
    return q;
  }
  map(p) {
    if (this.dim < 4) return V(p[0] || 0, p[1] || 0, this.dim === 2 ? 0 : (p[2] || 0));
    const q = this.rot4(p), D = this.v4.d * Math.max(1, this.range / 6), den = this.v4.persp ? Math.max(.12, (D - q[3]) / D) : 1;
    return V(q[0] / den, q[1] / den, q[2] / den);
  }
  // point de l'espace affiché → point de ℝ⁴ (hyperplan w' = 0 faisant face à l'écran)
  unmap(v) { return this.dim < 4 ? [v.x, v.y, this.dim === 2 ? 0 : v.z].slice(0, this.dim) : this.unrot4([v.x, v.y, v.z, 0]); }

  resetCamera() {
    const R = this.range;
    if (this.dim === 2) {
      this.ortho.up.set(0, 1, 0); this.ortho.position.set(R * .12, R * .12, 100); this.ortho.zoom = this.baseOrtho;
      this.cOrtho.target.set(R * .12, R * .12, 0); this.ortho.lookAt(this.cOrtho.target);
      this.cOrtho.update();
    } else {
      const d = Math.min(R, 40) * 2.2 + 6;
      this.persp.position.set(d * .62, -d * .85, d * .55);
      this.cPersp.target.set(0, 0, Math.min(R, 40) * .12); this.persp.lookAt(this.cPersp.target);
      this.cPersp.update();
      this.baseDist = this.persp.position.distanceTo(this.cPersp.target);
    }
    this.resize();
    this.zoomPct = 100; this.onZoom(100);
  }
  // Zoom en pourcentage : 100 % = vue de référence, 200 % = deux fois plus près
  setZoom(pct) {
    pct = clampZoom(pct); this.zoomPct = pct;
    if (this.dim === 2) { this.ortho.zoom = this.baseOrtho * pct / 100; this.ortho.updateProjectionMatrix(); }
    else {
      const t = this.cPersp.target, d = this.persp.position.clone().sub(t), len = d.length() || 1;
      this.persp.position.copy(t).addScaledVector(d.divideScalar(len), this.baseDist * 100 / pct);
    }
    this.onZoom(pct);
  }
  setView(name) {
    if (this.dim === 2) return;
    const t = this.cPersp.target, d = this.persp.position.distanceTo(t), dirs = { persp: V(.62, -.85, .55), face: V(0, -1, .001), profil: V(1, 0, .001), dessus: V(0.001, -0.001, 1) };
    const v = dirs[name].normalize().multiplyScalar(name === 'persp' ? Math.max(d, 8) : d);
    this.persp.position.copy(t).add(v); this.persp.lookAt(t); this.cPersp.update();
    this.baseDist = v.length(); this.zoomPct = 100; this.onZoom(100);
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.ink.width = w * 2; this.ink.height = h * 2; this.ink.style.width = w + 'px'; this.ink.style.height = h + 'px';
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    const H = this.range * 2.4, a = w / h;
    this.ortho.top = H / 2; this.ortho.bottom = -H / 2; this.ortho.left = -H / 2 * a; this.ortho.right = H / 2 * a; this.ortho.updateProjectionMatrix();
  }
  pxScale(pos) {
    const h = this.host.clientHeight || 1;
    if (this.dim === 2) return (this.ortho.top - this.ortho.bottom) / this.ortho.zoom / h;
    return 2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) * this.persp.position.distanceTo(pos) / h;
  }

  // ---------- Fabriques ----------
  lineMat(color, width, opacity = 1, dashed = false, hiddenPass = false, depth = false) {
    const k = [color, width, opacity, dashed, hiddenPass, depth].join('|');
    let m = this.matCache.get(k);
    if (!m) {
      m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, dashed, dashSize: .25, gapSize: .18, depthWrite: false, depthTest: depth || hiddenPass });
      if (hiddenPass) m.depthFunc = THREE.GreaterDepth;
      this.matCache.set(k, m); this.lineMats.add(m);
    }
    return m;
  }
  addSegs(pairs, o = {}) {       // pairs : [Vector3, Vector3, …]
    if (!pairs.length) return null;
    const arr = []; for (const v of pairs) arr.push(v.x, v.y, v.z);
    const g = new LineSegmentsGeometry().setPositions(arr);
    const l = new LineSegments2(g, this.lineMat(o.color || '#fff', o.width || 2, o.opacity ?? 1, !!o.dashed, !!o.hidden, !!o.depth));
    if (o.dashed) l.computeLineDistances();
    l.renderOrder = o.order ?? 6; (o.parent || this.content).add(l); return l;
  }
  polyline(pts, o = {}) {        // suite de points → segments consécutifs
    const pairs = []; for (let i = 0; i < pts.length - 1; i++) pairs.push(pts[i], pts[i + 1]);
    if (o.closed && pts.length > 2) pairs.push(pts[pts.length - 1], pts[0]);
    return this.addSegs(pairs, o);
  }
  pushPick(id, pairs) { for (let i = 0; i < pairs.length; i += 2) this.pickSegs.push({ id, a: pairs[i], b: pairs[i + 1] }); }
  arrowHead(from, to, color, px = 13, parent = this.content) {
    const d = to.clone().sub(from); if (d.lengthSq() < 1e-12) return;
    const m = new THREE.Mesh(this.coneGeo || (this.coneGeo = new THREE.ConeGeometry(.34, 1, 18).translate(0, -.5, 0)), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); m.position.copy(to); m.renderOrder = 7;
    parent.add(m); this.arrows.push({ m, pos: to, px });
  }
  addLabel(key, text, pos, cls = 'cl', off) {
    let L = this.labels.get(key);
    if (!L) { const el = document.createElement('div'); L = { el, o: new CSS2DObject(el) }; this.scene.add(L.o); this.labels.set(key, L); }
    L.used = true; L.el.className = cls; if (L.el._t !== text) { L.el.innerHTML = text; L.el._t = text; }
    L.el.style.margin = off ? `${off[1]}px 0 0 ${off[0]}px` : '';
    L.o.position.copy(pos); L.o.visible = true; return L;
  }
  fillMat(color, opacity, hi) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity * (hi ? 1.8 : 1) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }',
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
        void main(){ vec3 n = normalize(vN), v = normalize(vV); if(dot(n,v)<0.) n=-n;
          float f = pow(1.-abs(dot(n,v)), 3.); float lit = .6 + .4*max(dot(n, normalize(vec3(.4,.5,.9))), 0.);
          gl_FragColor = vec4(mix(uColor*lit, vec3(1.), f*.3), clamp(uOpacity*lit + f*.16, 0., 1.));
          #include <colorspace_fragment>
        }`,
    });
  }
  addMesh(geo, o) {
    const m = new THREE.Mesh(geo, this.fillMat(o.color, o.opacity, o.hi)); m.renderOrder = o.order ?? 2; this.content.add(m);
    const pm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); pm.userData.id = o.id; this.pickGroup.add(pm);
    return m;
  }
  trisGeo(polys) {           // liste de polygones (Vector3[]) → triangles en éventail
    const pos = [];
    for (const P of polys) for (let i = 1; i < P.length - 1; i++) pos.push(P[0].x, P[0].y, P[0].z, P[i].x, P[i].y, P[i].z, P[i + 1].x, P[i + 1].y, P[i + 1].z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }

  // ---------- Reconstruction ----------
  setState(patch) { Object.assign(this.state, patch); }
  clearGroup(g) {
    for (const c of [...g.children]) { g.remove(c); c.geometry?.dispose(); if (c.material && !(c.material instanceof LineMaterial)) c.material.dispose(); }
  }
  rebuild() {
    this.clearGroup(this.content); this.clearGroup(this.pickGroup);
    this.arrows = []; this.pickPts = []; this.pickSegs = [];
    for (const L of this.labels.values()) L.used = false;
    this.buildFrame();
    const { objs, sel, hover } = this.state;
    const pts = { pos: [], col: [], size: [], halo: [] };
    for (const o of objs) {
      if (!o.value || !o.style.visible) continue;
      try { this.drawObj(o, sel.has(o.id), hover === o.id, pts); } catch (e) { console.warn('draw', o.name, e); }
    }
    if (pts.pos.length) this.addPoints(pts);
    this.drawStrokes();
    for (const [k, L] of this.labels) if (!L.used) { this.scene.remove(L.o); L.el.remove(); this.labels.delete(k); }
    this.pickGroup.updateMatrixWorld(true);
  }
  addPoints(P) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(P.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(P.size, 1));
    g.setAttribute('halo', new THREE.Float32BufferAttribute(P.halo, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, uniforms: { pr: { value: this.renderer.getPixelRatio() } },
      vertexShader: 'attribute float size; attribute float halo; attribute vec3 color; uniform float pr; varying vec3 vC; varying float vH; void main(){ vC = color; vH = halo; gl_PointSize = size*pr*(1.+halo*.9); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vC; varying float vH; void main(){ float d = length(gl_PointCoord-.5)*2.; if(d>1.) discard;
        float core = vH>0. ? .52 : 1.; if(vH>0. && d>core){ float a = smoothstep(1.,.88,d)*.55; gl_FragColor = vec4(vC,a); }
        else { float rim = smoothstep(core*.72, core*.9, d); gl_FragColor = vec4(mix(vC, vec3(.03), rim*.8), 1.); }
        #include <colorspace_fragment> }`,
    });
    const pts = new THREE.Points(g, m); pts.renderOrder = 8; pts.frustumCulled = false; this.content.add(pts);
  }

  // ---------- Repère : axes, graduations, grille ----------
  gridStep(R) { return R <= 12 ? 1 : R <= 25 ? 2 : R <= 60 ? 5 : R <= 120 ? 10 : 20; }
  fpos(c) { return this.map(this.frame.pos(c)); }
  buildFrame() {
    const F = this.frame, n = this.dim, R = this.range, gs = this.gridStep(R), Z = G.zeros(n);
    const at = (a, ka, b, kb) => { const c = Z.slice(); c[a] = ka; c[b] = kb; return this.fpos(c); };
    if (this.opts.grid) {
      const planes = n === 2 ? [[0, 1]] : n === 3 ? [[0, 1], ...(this.opts.gridXZ ? [[0, 2]] : []), ...(this.opts.gridYZ ? [[1, 2]] : [])] : [[0, 1]];
      const minor = [], major = [];
      for (const [a, b] of planes) for (let k = -R; k <= R + 1e-9; k += gs) {
        if (Math.abs(k) < 1e-9) continue;
        const M = Math.abs(Math.round(k / gs)) % 5 === 0 ? major : minor;
        if (n === 4) { const sub = (p, q, t) => { const out = []; for (let i = 0; i < 24; i++) out.push(this.fpos(blend(p, q, i / 24)), this.fpos(blend(p, q, (i + 1) / 24))); return out; }; const blend = (p, q, t) => p.map((x, i) => x + (q[i] - x) * t);
          const A1 = Z.slice(), B1 = Z.slice(); A1[a] = k; A1[b] = -R; B1[a] = k; B1[b] = R; M.push(...sub(A1, B1));
          const A2 = Z.slice(), B2 = Z.slice(); A2[b] = k; A2[a] = -R; B2[b] = k; B2[a] = R; M.push(...sub(A2, B2));
        } else M.push(at(a, k, b, -R), at(a, k, b, R), at(b, k, a, -R), at(b, k, a, R));
      }
      this.addSegs(minor, { color: inkCss(), width: 1, opacity: .08, order: 0 });
      this.addSegs(major, { color: inkCss(), width: 1.2, opacity: .2, order: 0 });
    }
    if (this.opts.axes) {
      const names = this.axisNames || ['x', 'y', 'z', 'w'], ts = Math.max(gs, R <= 12 ? 1 : gs);
      for (let i = 0; i < n; i++) {
        const col = AXIS_COLORS[i], c0 = Z.slice(), c1 = Z.slice(); c0[i] = -R; c1[i] = R;
        let a, b;
        if (n === 4) { const pts = []; for (let s = 0; s < 40; s++) { const p = Z.slice(), q = Z.slice(); p[i] = -R + 2 * R * s / 40; q[i] = -R + 2 * R * (s + 1) / 40; pts.push(this.fpos(p), this.fpos(q)); } this.addSegs(pts, { color: col, width: 1.5, opacity: .85, order: 4 }); b = this.fpos(c1); a = this.fpos(c0.map((x, j) => j === i ? R * .93 : 0)); }
        else { a = this.fpos(c0); b = this.fpos(c1); this.addSegs([a, b], { color: col, width: 1.5, opacity: .85, order: 4 }); a = this.fpos(c0.map((x, j) => j === i ? R * .93 : 0)); }
        this.arrowHead(a, b, col, 11);
        this.addLabel('ax' + i, names[i], b.clone(), 'cl cl-ax', [8, -12]).el.style.color = col;
        if (this.opts.ticks) for (let k = -R; k <= R + 1e-9; k += ts) {
          if (Math.abs(k) < 1e-9 || (R - k) < ts * .5 && k > 0) { if (Math.abs(k) < 1e-9 && i === 0) this.addLabel('o0', '0', this.fpos(Z), 'cl cl-tick', [-10, 10]); continue; }
          const c = Z.slice(); c[i] = k; this.addLabel(`t${i}_${k}`, String(Math.round(k * 100) / 100).replace('-', '−'), this.fpos(c), 'cl cl-tick', i === 0 ? [0, 12] : [-14, 4]);
        }
      }
      if (this.opts.basisArrows) {
        const O = this.fpos(Z);
        const bn = this.basisNames || ['i', 'j', 'k', 'l'];
        for (let i = 0; i < n; i++) {
          const c = Z.slice(); c[i] = 1; const e = this.fpos(c);
          this.addSegs([O, e], { color: AXIS_COLORS[i], width: 3.6, order: 5 }); this.arrowHead(O, e, AXIS_COLORS[i], 15);
          this.addLabel('bs' + i, bn[i], O.clone().lerp(e, .5), 'cl cl-basis', [0, -10]).el.style.color = AXIS_COLORS[i];
        }
      }
    }
  }

  // ---------- Objets ----------
  clipLine(L) {            // [t0, t1] dans la boîte du repère
    const F = this.frame, R = this.range * 1.0, pf = F.toPos(L.p), df = F.toVec(L.d);
    let t0 = L.lo, t1 = L.hi;
    for (let i = 0; i < pf.length; i++) {
      if (Math.abs(df[i]) < 1e-12) { if (Math.abs(pf[i]) > R) return null; continue; }
      let a = (-R - pf[i]) / df[i], b = (R - pf[i]) / df[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    return t0 < t1 ? [t0, t1] : null;
  }
  planePolygon(P) {        // section du plan par la boîte [-R, R]³ du repère
    const F = this.frame, R = this.range, a = F.worldToCov(P.n), h = G.dot(a, F.toPos(P.p));
    const corners = []; for (let i = 0; i < 8; i++) corners.push([i & 1 ? R : -R, i & 2 ? R : -R, i & 4 ? R : -R]);
    const out = [];
    for (let i = 0; i < 8; i++) for (let b = 0; b < 3; b++) if (!(i & (1 << b))) {
      const c0 = corners[i], c1 = corners[i | (1 << b)], d0 = G.dot(a, c0) - h, d1 = G.dot(a, c1) - h;
      if (d0 === d1) continue; const t = d0 / (d0 - d1);
      if (t >= -1e-9 && t <= 1 + 1e-9) out.push(G.lerp(c0, c1, t));
    }
    if (out.length < 3) return null;
    const cen = out.reduce((s, p) => G.add(s, p), [0, 0, 0]).map(x => x / out.length);
    const pts = out.map(c => F.pos(c)), cW = F.pos(cen), [u, v] = G.planeBasis(P.n);
    pts.sort((p, q) => Math.atan2(G.dot(G.sub(p, cW), v), G.dot(G.sub(p, cW), u)) - Math.atan2(G.dot(G.sub(q, cW), v), G.dot(G.sub(q, cW), u)));
    const uniq = []; for (const p of pts) if (!uniq.some(q => G.dist(p, q) < 1e-7)) uniq.push(p);
    return uniq.length >= 3 ? uniq : null;
  }
  drawObj(o, sel, hov, pts) {
    const v = o.value, col = o.style.color, hi = sel || hov, w = (o.style.width || 2.2) + (sel ? 1.6 : hov ? .8 : 0);
    const id = o.id, lc = sel ? inkCss() : col;
    const showLabel = o.style.label !== false;
    const label = (pos, off) => { if (showLabel) this.addLabel('o' + id, o.name, pos, 'cl cl-obj' + (sel ? ' sel' : ''), off || [8, -14]).el.style.color = col; };
    const segs = (pairs, opt = {}) => { this.addSegs(pairs, { color: lc, width: w, order: 6, ...opt }); this.pushPick(id, pairs); };
    const M = p => this.map(p);
    switch (v.t) {
      case 'pt': {
        const p = M(v.p); pts.pos.push(p.x, p.y, p.z);
        const c = new THREE.Color(col); pts.col.push(c.r, c.g, c.b); pts.size.push(o.free ? 11 : 9); pts.halo.push(hi ? 1 : 0);
        this.pickPts.push({ id, p }); label(p, [9, -15]); break;
      }
      case 'vec': {
        const A = M(v.from || this.frame.O), B = M(G.add(v.from || this.frame.O, v.v));
        segs([A, B], { color: lc }); this.arrowHead(A, B, lc, 14); label(A.clone().lerp(B, .5), [6, -12]); break;
      }
      case 'seg': { const A = M(v.a), B = M(v.b); segs(this.dim === 4 ? this.sub4(v.a, v.b) : [A, B]); label(A.clone().lerp(B, .5), [6, -12]); break; }
      case 'line': case 'ray': {
        const L = G.lineLike(v), r = this.clipLine(L); if (!r) break;
        const a = G.add(L.p, G.mul(L.d, r[0])), b = G.add(L.p, G.mul(L.d, r[1]));
        const pairs = this.dim === 4 ? this.sub4(a, b) : [M(a), M(b)]; segs(pairs);
        label(M(G.add(L.p, G.mul(L.d, r[0] + (r[1] - r[0]) * .82))), [8, -14]); break;
      }
      case 'plane': {
        const poly = this.planePolygon(v); if (!poly) break;
        const P3 = poly.map(M); this.addMesh(this.trisGeo([P3]), { color: col, opacity: .13, hi, id });
        const pairs = []; for (let i = 0; i < P3.length; i++) pairs.push(P3[i], P3[(i + 1) % P3.length]);
        segs(pairs, { width: w * .75, opacity: .85 }); label(P3[0].clone().lerp(P3[Math.floor(P3.length / 2)], .25), [4, -12]); break;
      }
      case 'poly': {
        const P3 = v.pts.map(M); this.addMesh(this.trisGeo([P3]), { color: col, opacity: .16, hi, id });
        const pairs = []; for (let i = 0; i < P3.length; i++) pairs.push(P3[i], P3[(i + 1) % P3.length]); segs(pairs);
        label(P3.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / P3.length), [0, 0]); break;
      }
      case 'circle': {
        const [e1, e2] = this.dim === 2 ? [[1, 0, 0], [0, 1, 0]] : G.planeBasis(v.n), N = 128, ring = [];
        for (let i = 0; i <= N; i++) { const t = i / N * Math.PI * 2; ring.push(M(G.pad(G.add(v.c, G.add(G.mul(G.pad(e1, this.dim), v.r * Math.cos(t)), G.mul(G.pad(e2, this.dim), v.r * Math.sin(t)))), this.dim))); }
        const pairs = []; for (let i = 0; i < N; i++) pairs.push(ring[i], ring[i + 1]); segs(pairs);
        if (this.dim === 2) this.addMesh(this.trisGeo([ring]), { color: col, opacity: .05, hi, id });
        label(ring[Math.floor(N / 8)], [6, -12]); break;
      }
      case 'sphere': {
        if (this.dim !== 3) break;
        const geo = new THREE.SphereGeometry(v.r, 64, 48).translate(...v.c); this.addMesh(geo, { color: col, opacity: .07, hi, id });
        const c = V(...v.c), pairs = [];
        const ring = (axis, k = 0) => { const pts = []; for (let i = 0; i <= 96; i++) { const t = i / 96 * Math.PI * 2, rr = v.r * Math.cos(k), z = v.r * Math.sin(k); const p = axis === 2 ? [rr * Math.cos(t), rr * Math.sin(t), z] : axis === 0 ? [z, rr * Math.cos(t), rr * Math.sin(t)] : [rr * Math.cos(t), z, rr * Math.sin(t)]; pts.push(V(v.c[0] + p[0], v.c[1] + p[1], v.c[2] + p[2])); } for (let i = 0; i < 96; i++) pairs.push(pts[i], pts[i + 1]); };
        for (const k of [0, .5, -.5]) ring(2, k); ring(0); ring(1);
        this.addSegs(pairs, { color: lc, width: sel ? 2 : 1, opacity: sel ? .8 : .35, order: 5 });
        label(c.clone().add(V(0, 0, v.r)), [6, -10]); break;
      }
      case 'cyl': case 'cone': {
        if (this.dim !== 3) break;
        const a = V(...v.a), b = V(...v.b), ax = b.clone().sub(a), h = ax.length(); if (h < 1e-9) break;
        const geo = v.t === 'cyl' ? new THREE.CylinderGeometry(v.r, v.r, h, 64, 1) : new THREE.ConeGeometry(v.r, h, 64, 1);
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), ax.clone().normalize());
        geo.applyQuaternion(q); const center = a.clone().add(b).multiplyScalar(.5);
        geo.translate(center.x, center.y, center.z);
        this.addMesh(geo, { color: col, opacity: .08, hi, id });
        const u = ax.clone().normalize(), e1 = V(...G.planeBasis([u.x, u.y, u.z])[0]), e2 = u.clone().cross(e1), ring = (c, r) => { const P = []; for (let i = 0; i <= 96; i++) { const t = i / 96 * Math.PI * 2; P.push(c.clone().addScaledVector(e1, r * Math.cos(t)).addScaledVector(e2, r * Math.sin(t))); } const pr = []; for (let i = 0; i < 96; i++) pr.push(P[i], P[i + 1]); return pr; };
        const pairs = [...ring(a, v.r)];
        if (v.t === 'cyl') pairs.push(...ring(b, v.r)); else pairs.push(b, b);
        const gens = [], N = 12; for (let i = 0; i < N; i++) { const t = i / N * Math.PI * 2, d = e1.clone().multiplyScalar(Math.cos(t)).addScaledVector(e2, Math.sin(t)); gens.push(a.clone().addScaledVector(d, v.r), v.t === 'cyl' ? b.clone().addScaledVector(d, v.r) : b.clone()); }
        this.addSegs(pairs, { color: lc, width: w, order: 6 }); this.addSegs(gens, { color: lc, width: sel ? 1.6 : 1, opacity: sel ? .8 : .3, order: 5 });
        this.pushPick(id, pairs.length > 2 ? pairs : []);
        label(center, [6, -10]); break;
      }
      case 'solid': {
        const V3 = v.verts.map(M);
        if (v.faces.length && this.dim === 3) {
          this.addMesh(this.trisGeo(v.faces.map(f => f.map(i => V3[i]))), { color: col, opacity: .075, hi, id });
        }
        const pairs = []; for (const [i, j] of v.edges) pairs.push(...(this.dim === 4 ? this.sub4(v.verts[i], v.verts[j]) : [V3[i], V3[j]]));
        if (this.dim === 3 && v.faces.length && this.opts.hidden) {
          const depthMesh = new THREE.Mesh(this.trisGeo(v.faces.map(f => f.map(i => V3[i]))), new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2, side: THREE.DoubleSide }));
          depthMesh.renderOrder = 1; this.content.add(depthMesh);
          this.addSegs(pairs, { color: lc, width: w * .75, opacity: .6, dashed: true, hidden: true, order: 3 });
          this.addSegs(pairs, { color: lc, width: w, depth: true, order: 4 });
        } else this.addSegs(pairs, { color: lc, width: w, order: 6 });
        this.pushPick(id, pairs);
        label(V3.reduce((s, p) => s.add(p), V()).multiplyScalar(1 / V3.length).add(V(0, 0, 0)), [0, 0]); break;
      }
      case 'basis': {
        const A = M(v.p), cols = AXIS_COLORS;
        v.vs.forEach((e, i) => { const B = M(G.add(v.p, e)); segs([A, B], { color: sel ? inkCss() : cols[i % 4], width: w + 1 }); this.arrowHead(A, B, cols[i % 4], 14); this.addLabel(`b${id}_${i}`, `${o.name}<sub>${i + 1}</sub>`, A.clone().lerp(B, .55), 'cl cl-basis', [4, -10]).el.style.color = cols[i % 4]; });
        break;
      }
      case 'angle': {
        if (!v.vertex) break;
        const B = v.vertex, u = G.unit(G.sub(v.a, B)), w2 = G.unit(G.sub(v.b, B)), r = .5 * Math.min(G.dist(v.a, B), G.dist(v.b, B), this.range * .25) + 0.2, arc = [];
        const perp = G.unit(G.sub(w2, G.mul(u, G.dot(u, w2)))); if (G.isZero(perp)) break;
        for (let i = 0; i <= 24; i++) { const t = v.v * i / 24; arc.push(M(G.add(B, G.add(G.mul(u, r * Math.cos(t)), G.mul(perp, r * Math.sin(t)))))); }
        const pr = []; for (let i = 0; i < 24; i++) pr.push(arc[i], arc[i + 1]);
        segs(pr, { color: lc, width: w * .8 });
        const exactDeg = G.deg(v.v); label(arc[12], [6, -8]);
        const L = this.labels.get('o' + id); if (L) L.el.innerHTML = `${o.name} = ${G.dec(exactDeg, 2)}°`; break;
      }
    }
  }
  sub4(a, b) { const out = [], N = 20; for (let i = 0; i < N; i++) out.push(this.map(G.lerp(a, b, i / N)), this.map(G.lerp(a, b, (i + 1) / N))); return out; }

  // ---------- Dessin à main levée ----------
  drawStrokes() {
    for (const s of this.state.strokes) {
      if (s.mode !== 'world' || s.pts.length < 2) continue;
      this.polyline(s.pts.map(p => V(...p)), { color: s.color, width: s.width, order: 6, opacity: .95 });
    }
  }
  drawInk() {
    const c = this.inkCtx, W = this.ink.width, H = this.ink.height; c.clearRect(0, 0, W, H);
    c.lineCap = c.lineJoin = 'round';
    for (const s of this.state.strokes) {
      if (s.mode !== 'screen' || s.pts.length < 2) continue;
      c.strokeStyle = s.color; c.lineWidth = s.width * 2; c.beginPath();
      s.pts.forEach(([x, y], i) => i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H)); c.stroke();
    }
  }

  // ---------- Aperçu des outils ----------
  setPreview(p) {
    this.clearGroup(this.preview); this.state.preview = p; if (!p) return;
    const pairs = []; for (const [a, b] of p.segs || []) pairs.push(this.map(a), this.map(b));
    this.addSegs(pairs, { color: '#f2c14e', width: 1.8, opacity: .85, dashed: true, order: 9, parent: this.preview });
    for (const q of p.pts || []) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: '#f2c14e', depthTest: false, transparent: true, opacity: .8 }));
      const pos = this.map(q); m.position.copy(pos); m.scale.setScalar(this.pxScale(pos) * 5); m.renderOrder = 9; this.preview.add(m);
    }
  }

  // ---------- Sélection et projection écran ----------
  screen(v) { const p = v.clone().project(this.cam), w = this.host.clientWidth, h = this.host.clientHeight; return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, z: p.z }; }
  ndc(x, y) { return new THREE.Vector2(x / this.host.clientWidth * 2 - 1, -(y / this.host.clientHeight) * 2 + 1); }
  pick(x, y) {
    let best = null, bd = 12;
    for (const q of this.pickPts) { const s = this.screen(q.p); if (s.z > 1) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = { id: q.id, kind: 'pt' }; } }
    if (best) return best;
    bd = 7;
    for (const q of this.pickSegs) {
      const a = this.screen(q.a), b = this.screen(q.b); if (a.z > 1 && b.z > 1) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
      const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y); if (d < bd) { bd = d; best = { id: q.id, kind: 'line' }; }
    }
    if (best) return best;
    this.ray.setFromCamera(this.ndc(x, y), this.cam);
    const hit = this.ray.intersectObjects(this.pickGroup.children, false)[0];
    return hit ? { id: hit.object.userData.id, kind: 'fill' } : null;
  }
  // intersection du rayon écran avec un plan (point p, normale n, 3D)
  rayPlane(x, y, p, n) {
    this.ray.setFromCamera(this.ndc(x, y), this.cam);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(V(...n).normalize(), V(...p)), out = V();
    return this.ray.ray.intersectPlane(pl, out) ? out : null;
  }
  // point le plus proche du rayon sur la droite verticale passant par a (déplacement en z)
  rayVertical(x, y, a) {
    this.ray.setFromCamera(this.ndc(x, y), this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction, w = a.clone().sub(o);
    const b = d.z, e = d.dot(w), den = 1 - b * b;
    return Math.abs(den) < 1e-6 ? null : a.z + (b * e - w.z) / den;
  }

  // ---------- Boucle ----------
  start() {
    if (this.active) return; this.active = true; this.resize();
    this.renderer.setAnimationLoop(() => {
      if (!this.active) return;
      this.onFrame && this.onFrame();
      const w = this.host.clientWidth, h = this.host.clientHeight;
      this.lineMats.forEach(m => m.resolution.set(w, h));
      for (const a of this.arrows) a.m.scale.setScalar(a.px * this.pxScale(a.pos));
      this.controls.update();
      this.renderer.render(this.scene, this.cam); this.labelRenderer.render(this.scene, this.cam); this.drawInk();
    });
  }
  stop() { this.active = false; this.renderer.setAnimationLoop(null); }
}
