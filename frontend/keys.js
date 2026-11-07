// Keyboard shortcuts, and the window listing them
const KEYS = [ // Key, what it does, and how
    ['/', 'Find a station', () => search.open()],
    ['T', 'Switch between present day and full buildout', () => { view.eraChosen = true; controls.setView({ era: view.era === 'today' ? 'buildout' : 'today' }); }],
    ['S', 'Present day beside the full buildout', () => split.toggle()],
    ['C', 'Compare routes', () => view.selected !== null ? compare.open(view.selected) : compare.openLink('cleveland-cincinnati,missouri-river-runner')], // The picked route, else a proposed Ohio corridor beside a running one
    ['L', 'Show all routes', () => netList.open()],
    ['+', 'Zoom in', () => $('[data-zoom="1"]').click()],
    ['−', 'Zoom out', () => $('[data-zoom="-1"]').click()],
    ['Esc', 'Close the top window, or step back', null],
    ['?', 'These shortcuts', () => keyHelp.open()]
];

class KeyHelp extends Finder {
    constructor() {
        super('key-help', '#key-help-title', '<h2 id="key-help-title">Keyboard Shortcuts</h2>', `<dl class="key-list">${KEYS.map(([k, what]) => `<div><dt>${k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join('')}</dt><dd>${esc(what)}</dd></div>`).join('')}</dl>`);
        this.el.addEventListener('keydown', e => { if (e.key === '?') { e.preventDefault(); this.close(); } });
    }

    open() { this.reveal(); }
}

addEventListener('keydown', e => { // Only on the map itself: not while typing, nor with a window open
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || !has(document.body, 'drawn') || EMBED) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable], [role="slider"]') || has(document.body, 'covered')) return;
    const key = { '=': '+', '-': '−' }[e.key] ?? e.key, hit = KEYS.find(([k, , go]) => go && k.toLowerCase() === key.toLowerCase()); // = and - are + and − without Shift
    if (!hit) return;
    e.preventDefault();
    hit[2]();
});