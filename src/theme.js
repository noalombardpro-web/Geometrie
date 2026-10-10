// Thème clair / sombre partagé par les deux ateliers. Le choix est mémorisé dans le navigateur.
const KEY = 'atelier-theme';
export const BG = { dark: 0x08090b, light: 0xf3f4ef };
export const INK = { dark: 0xeceee4, light: 0x14181b };
const listeners = new Set();
let theme = 'dark';
try { theme = localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { /* stockage indisponible : sombre par défaut */ }

export const currentTheme = () => theme;
export const inkCss = () => '#' + INK[theme].toString(16).padStart(6, '0');
// Appelle f tout de suite, puis à chaque changement de thème
export function onTheme(f) { listeners.add(f); f(theme); return () => listeners.delete(f); }

export function setTheme(t) {
  theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* ignoré */ }
  document.querySelectorAll('#themeBtn').forEach(b => {
    const label = theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair';
    b.textContent = theme === 'light' ? '☾' : '☀'; b.setAttribute('aria-label', label); b.title = label;
  });
  listeners.forEach(f => f(theme));
}
document.getElementById('themeBtn')?.addEventListener('click', () => setTheme(theme === 'light' ? 'dark' : 'light'));
setTheme(theme);
