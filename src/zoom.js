// Zoom par paliers (10 % → 200 %) : barre, boutons − / +, molette.
export const PALIERS = [10, 15, 25, 33, 50, 67, 75, 100, 125, 150, 200];
export const clampZoom = p => Math.max(PALIERS[0], Math.min(PALIERS[PALIERS.length - 1], p));
const nearest = p => PALIERS.reduce((b, x) => Math.abs(x - p) < Math.abs(b - p) ? x : b, PALIERS[0]);

// Palier suivant (d > 0) ou précédent (d < 0) à partir de p
export function nextPalier(p, d) {
  if (d > 0) return PALIERS.find(x => x > p + .01) ?? p;
  return [...PALIERS].reverse().find(x => x < p - .01) ?? p;
}

// Monte la barre dans el. get() → pourcentage courant ; set(pct) → l'applique.
// Renvoie sync(pct) pour mettre la barre à jour quand le zoom change ailleurs (molette, vue).
export function mountZoom(el, get, set) {
  const id = el.id + '-paliers';
  el.classList.add('zoombar');
  el.innerHTML = `<button type="button" data-d="-1" aria-label="Dézoomer (palier précédent)">−</button>
    <input type="range" min="0" max="${PALIERS.length - 1}" step="1" list="${id}" aria-label="Zoom : 10 % à 200 %">
    <datalist id="${id}">${PALIERS.map((_, i) => `<option value="${i}"></option>`).join('')}</datalist>
    <output aria-live="polite"></output>
    <button type="button" data-d="1" aria-label="Zoomer (palier suivant)">+</button>`;
  const range = el.querySelector('input'), out = el.querySelector('output');
  const sync = p => { range.value = PALIERS.indexOf(nearest(p)); out.textContent = `${Math.round(p)} %`; };
  range.addEventListener('input', () => set(PALIERS[+range.value]));
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(nextPalier(get(), +b.dataset.d))));
  sync(get());
  return { sync };
}
