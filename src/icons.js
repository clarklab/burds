// ---------------------------------------------------------------------------
// Inline SVG icon set — replaces the emoji that used to stand in for icons.
//
// These are hand-built in the Material Symbols *outlined* style (24x24 grid,
// 2px round strokes) so they're crisp, tintable via `currentColor`, and — most
// importantly — bundled in the app shell. The game is offline-first (the service
// worker precaches everything and there's no network mid-round), so pulling the
// Google font at runtime is a non-starter; embedding the paths keeps the icons
// available with zero network. Game-specific glyphs that Material doesn't have
// (the turd, the scatter spread, the machine gun) are custom in the same style.
// ---------------------------------------------------------------------------

// Each entry is the inner markup of a `0 0 24 24` SVG. `.ic` supplies the shared
// outline style; glyphs that want a solid fill override per-element.
export const ICON_PATHS = {
  // drag / steer — a horizontal double-arrow
  swipe: '<line x1="4" y1="12" x2="20" y2="12"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>',

  // a swirl turd (custom)
  turd: '<path fill="currentColor" stroke="none" d="M10.8 4.1c1.5-.6 3.2.5 3.2 2 0 .3-.1.6-.2.9 1.8-.1 3.3 1 3.3 2.5 0 .5-.2 1-.5 1.4 1.6.4 2.8 1.5 2.8 2.9 0 .5-.2 1-.5 1.4 1.1.4 1.8 1.3 1.8 2.4 0 1.7-1.7 2.4-4.2 2.4H5.5c-2.5 0-4.2-.7-4.2-2.4 0-1.1.7-2 1.8-2.4-.3-.4-.5-.9-.5-1.4 0-1.4 1.2-2.5 2.8-2.9-.3-.4-.5-.9-.5-1.4 0-1.5 1.5-2.6 3.3-2.5-.1-.3-.2-.6-.2-.9 0-1.1.8-2 2-2.3z"/>',

  // lightning bolt (solid)
  bolt: '<path fill="currentColor" stroke="none" d="M13 2L4 13.5h5.5L8.5 22 20 9.5h-5.8z"/>',

  // flame (solid)
  fire: '<path fill="currentColor" stroke="none" d="M12 2.5c2.6 3.4 5.2 5.5 5.2 9.4A5.2 5.2 0 0 1 6.8 12c0-1.9.9-3.4 2-4.8.2 1 .9 1.7 1.8 1.7C9.4 6.9 10.4 5 12 2.5z"/>',

  // concentric bullseye
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',

  // trophy cup
  trophy: '<path d="M7 4h10v3.5a5 5 0 0 1-10 0z"/><path d="M7 5.2H4v1.3A3.5 3.5 0 0 0 7.5 10"/><path d="M17 5.2h3v1.3A3.5 3.5 0 0 1 16.5 10"/><line x1="12" y1="12.5" x2="12" y2="16.5"/><path d="M8.3 20.5a3.7 3.7 0 0 1 7.4 0z"/>',

  // checkmark
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',

  // back arrow
  back: '<line x1="20" y1="12" x2="5" y2="12"/><path d="M11 6l-6 6 6 6"/>',

  // beach parasol
  beach: '<line x1="12" y1="3" x2="12" y2="21"/><path d="M3.5 11a8.5 8.5 0 0 1 17 0z"/><line x1="12" y1="21" x2="16" y2="21"/>',

  // wedding chapel — building with a cross
  church: '<line x1="12" y1="2" x2="12" y2="5.5"/><line x1="10.2" y1="3.4" x2="13.8" y2="3.4"/><path d="M6.5 21V10.5L12 7l5.5 3.5V21"/><line x1="4" y1="21" x2="20" y2="21"/><path d="M10.3 21v-4a1.7 1.7 0 0 1 3.4 0v4"/>',

  // music note
  music: '<circle cx="7" cy="17.5" r="2.6" fill="currentColor" stroke="none"/><circle cx="16" cy="15.5" r="2.6" fill="currentColor" stroke="none"/><path d="M9.6 17.5V6.5l9-2v11"/><path d="M9.6 8.5l9-2"/>',

  // scatter — a fan of pellets spreading upward (custom)
  scatter: '<circle cx="12" cy="20" r="1.7" fill="currentColor" stroke="none"/><line x1="12" y1="18.5" x2="6" y2="6"/><line x1="12" y1="18.5" x2="12" y2="5"/><line x1="12" y1="18.5" x2="18" y2="6"/><circle cx="6" cy="4.6" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="3.6" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="4.6" r="1.7" fill="currentColor" stroke="none"/>',

  // machine gun — streaking rounds (custom)
  machinegun: '<line x1="3" y1="8.5" x2="15" y2="8.5"/><line x1="3" y1="14" x2="12" y2="14"/><circle cx="19" cy="8.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1.8" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1.8" fill="currentColor" stroke="none"/><line x1="3" y1="19" x2="6" y2="19"/>',

  // skull (wall of death / metal)
  skull: '<path d="M19.5 11.2C19.5 6.9 16.1 3.5 12 3.5S4.5 6.9 4.5 11.2c0 2.4 1.1 4 2.5 5.1V18a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 18v-1.7c1.4-1.1 2.5-2.7 2.5-5.1z"/><circle cx="9" cy="11" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.8" fill="currentColor" stroke="none"/><path d="M11 15.5h2"/>',

  // burst / impact star (solid)
  burst: '<path fill="currentColor" stroke="none" d="M12 1.5l2.3 6 5.7-2.3-2.3 5.7 6 2.3-6 2.3 2.3 5.7-5.7-2.3-2.3 6-2.3-6-5.7 2.3 2.3-5.7-6-2.3 6-2.3-2.3-5.7 5.7 2.3z"/>',
};

// Build an <svg> string for a named icon. `size` in px, `cls` for extra classes.
export function iconSvg(name, { size = 24, cls = '' } = {}) {
  const inner = ICON_PATHS[name] || '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${inner}</svg>`;
}
