// Joshua Nunez
// Runs before the page paints, so there is no flash of the wrong theme.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('agencyos-theme'); } catch (e) { /* storage unavailable */ }
  if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
}());
