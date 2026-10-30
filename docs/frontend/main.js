// Start-up
const net = new Network(), bg = new BackgroundVideo(), camera = new Camera(), map = new MapView(), controls = new Controls(), relief = new Relief();
const sidebar = new Sidebar(), card = new InfoCard(), brandMap = new BrandMap(), stationModal = new StationModal(), programs = new ProgramView(), nowShowing = new NowShowing(), timeJump = new TimeJump(), intro = new Intro(), search = new StationSearch(), reach = new Reach(), times = new TrainTimes();
[camera, map, controls, sidebar, card, brandMap, stationModal, programs, nowShowing, search].forEach(c => c.bind());
document.fonts.ready.then(() => { view.fontsReady = true; controls.sync(); });
addEventListener('keydown', e => { // Escape closes the top layer, or skips the intro
    if (e.key !== 'Escape') return;
    if (helpPinned) pinHelp(null); // The "?" pop-up first
    else if (!document.body.classList.contains('drawn')) intro.skip();
    else if (brandMap.isOpen()) brandMap.closeBrandMap();
    else if (stationModal.isOpen()) stationModal.closeStationModal();
    else if (programs.isOpen()) programs.escape();
    else if (relief.isOpen()) relief.collapse();
    else map.reset();
});

intro.skipButton.addEventListener('click', () => intro.skip());
const TYPE_HELP = [ // What the route types mean (the "?" beside their toggles, on the main map and the program maps)
    ['State-Supported', 'State-supported routes serve corridors under 750 miles. They are largely funded by state governments in partnership with Amtrak. Most state-supported services run multiple round trips per day providing a competitive travel option between nearby cities.'],
    ['Long-Distance', 'Long-distance routes run across several states and are funded by the federal government. These trains run only once per day (or less) with some regions like Ohio seeing no daytime service at all.']
];

const helpTip = $('.help-tip'); // Pop-up: what the route types mean (the "?" beside them), or a project's full name
let helpPinned = null; // The "?" whose pop-up stays open
const showHelp = el => {
    if (!el || (el.hasAttribute('data-clipped') && el.scrollWidth <= el.clientWidth)) return void (helpTip.hidden = true); // (A name only when it's cut short)
    helpTip.innerHTML = el.matches('.help-btn') ? TYPE_HELP.map(([title, text]) => `<p><b>${title}</b><br>${esc(text)}</p>`).join('') : esc(el.dataset.help);
    helpTip.hidden = false;
    const r = rectOf(el), w = helpTip.offsetWidth, h = helpTip.offsetHeight, below = r.bottom + 10 + h < pageH(); // Below it, or above where there's no room
    helpTip.style.translate = `${Math.round(Math.min(pageW() - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)))}px ${Math.round(below ? r.bottom + 10 : r.top - 10 - h)}px`;
};

const pinHelp = b => { // Open the "?" pop-up (it stays, the "?" red), or close it (null)
    helpPinned?.setAttribute('aria-expanded', false);
    helpPinned = b;
    b?.setAttribute('aria-expanded', true);
    showHelp(b);
};

let helpAt = 0;
addEventListener('pointerover', e => { // Hover: the "?" (a click keeps it), or a cut-off project title's full name
    if (helpPinned) return;
    const el = e.pointerType === 'mouse' && e.target.closest?.('[data-clipped], .help-btn');
    clearTimeout(helpAt);
    if (el) helpAt = setTimeout(() => showHelp(el), 350);
    else showHelp(null);
});

addEventListener('pointerdown', e => { clearTimeout(helpAt); if (!e.target.closest?.('.help-btn, .help-tip')) helpPinned ? pinHelp(null) : showHelp(null); }); // Clicking away closes it
addEventListener('click', e => { const b = e.target.closest?.('.help-btn'); if (b) pinHelp(helpPinned === b ? null : b); }); // The "?" (again: closes)

const videoSwitch = $('.video-switch'); // Footage on or off (a plain dark background)
videoSwitch.addEventListener('click', () => { bg.setOff(!bg.off); videoSwitch.setAttribute('aria-pressed', !bg.off); });
const homeOfSwitch = videoSwitch.parentNode, placeSwitch = () => { // Phones upright: the videos switch goes in the sheet (opened), under the route types; elsewhere, on the map
    const sheet = phoneLayout() && !EMBED;
    if (sheet && videoSwitch.parentNode !== ui.legend) $('.modes', ui.legend).after(videoSwitch);
    else if (!sheet && videoSwitch.parentNode !== homeOfSwitch) homeOfSwitch.append(videoSwitch);
};
placeSwitch();
addEventListener('resize', placeSwitch);
const liftSwitch = () => { // Where the program tabs reach under the video switch (any window size), it sits above them instead
    videoSwitch.classList.remove('lifted');
    const v = videoSwitch.getBoundingClientRect(), btns = $$('.program-tabs button'), tabs = btns.map(b => b.getBoundingClientRect()).filter(r => r.width && r.right > 0 && r.left < innerWidth);
    const under = v.width && tabs.some(r => r.left < v.right + 8 && r.right > v.left - 8);
    if (under) videoSwitch.style.setProperty('--tabs-h', `${Math.max(...btns.map(b => b.offsetHeight))}px`); // (Their own height: not where they are mid-entrance)
    videoSwitch.classList.toggle('lifted', !!under);
};
new ResizeObserver(() => requestAnimationFrame(liftSwitch)).observe(ui.tabs ?? $('.program-tabs'));
addEventListener('resize', () => requestAnimationFrame(liftSwitch));

let resizeQueued = false; // One layout per frame while resizing
addEventListener('resize', () => {
    const wide = ui.map.clientWidth > NARROW;
    if (!EMBED && view.wasWide !== wide && view.legend !== wide) { view.legend = wide; sidebar.sync(); if (view.cam) view.cam.left = +wide; }
    view.wasWide = wide;
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; controls.sync(); controls.fit(); if (view.home) view.home = camera.home(); map.layout('resize'); brandMap.place(); }); // (The home view fits the new shape)
});

sidebar.sync();
EMBED ? bg.setOff(true) : bg.init(); // (Embedded: no footage)
const embedOpen = $('.embed-open'); // Embedded: a way out to the whole page, where it is now
embedOpen.hidden = !EMBED;
embedOpen.addEventListener('click', () => { const q = new URLSearchParams(location.search); q.delete('embed'); embedOpen.href = `${location.pathname}${q.size ? `?${q}` : ''}`; });
intro.start(); // (Phones upright too: the page has its own upright layout)
