// nav-menu.js
// On phones the section links fold into a menu button (top right).
// The button opens and closes them; a tap outside, a link tap or Escape closes them.

const btn = document.querySelector('.nav-toggle');
const nav = document.getElementById('section-nav');

if (btn && nav) {
  const isOpen = () => document.body.classList.contains('nav-open');
  const set = (open) => {
    document.body.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); set(!isOpen()); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('click', (e) => { if (isOpen() && !nav.contains(e.target)) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { set(false); btn.focus(); }
  });
}
