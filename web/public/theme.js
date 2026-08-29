/**
 * Applies the saved theme before the first paint, so there is no flash of the
 * wrong background. Loaded as a blocking classic script from the same origin,
 * which keeps the CSP at script-src 'self' with no inline allowance.
 */
(function () {
  try {
    var stored = localStorage.getItem('twm-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((!stored || stored === 'system') && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0a100f' : '#f6f8f8');
  } catch (error) {
    /* private mode without storage: fall back to the light theme */
  }
})();
