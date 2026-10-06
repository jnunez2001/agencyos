// Joshua Nunez
// Runs before the page paints, so there is no flash of the wrong theme.
(function () {
  var theme = null;
  try { theme = localStorage.getItem('agencyos-theme'); } catch (e) { /* storage unavailable */ }
  if (!theme) theme = 'dark'; // Nexus opens dark; the switch in the menu changes it
  document.documentElement.setAttribute('data-theme', theme);
}());
