/* ============================================================
   WealthForge AI — privacy mode
   Blurs all monetary amounts on screen. Reveals on hover.
   Toggle via nav button or keyboard shortcut (Ctrl+Shift+P).
   ============================================================ */

const Privacy = (() => {
  function isActive() {
    return document.body.classList.contains('privacy-mode');
  }

  function toggle() {
    const active = !isActive();
    document.body.classList.toggle('privacy-mode', active);
    try { localStorage.setItem('wf.privacy', active ? '1' : ''); } catch (e) { /* ignore */ }
    updateButton();
    return active;
  }

  function init() {
    try {
      if (localStorage.getItem('wf.privacy') === '1') {
        document.body.classList.add('privacy-mode');
      }
    } catch (e) { /* ignore */ }
    updateButton();

    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        toggle();
      }
    });
  }

  function updateButton() {
    const btn = document.getElementById('privacy_toggle');
    if (btn) btn.title = isActive() ? 'Show amounts (Ctrl+Shift+P)' : 'Hide amounts (Ctrl+Shift+P)';
    if (btn) btn.textContent = isActive() ? '◉' : '◎';
  }

  return { init, toggle, isActive };
})();

if (typeof globalThis !== 'undefined') globalThis.Privacy = Privacy;
