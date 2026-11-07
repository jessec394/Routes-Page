// Start-up
const netList = new NetworkList(), split = new SplitView(), keyHelp = new KeyHelp(), net = new Network(), bg = new BackgroundVideo(), camera = new Camera(), map = new MapView(), controls = new Controls(), relief = new Relief();
const sidebar = new Sidebar(), card = new InfoCard(), brandMap = new BrandMap(), stationModal = new StationModal(), programs = new ProgramView(), nowShowing = new NowShowing(), timeJump = new TimeJump(), intro = new Intro(), search = new StationSearch(), reach = new Reach(), times = new TrainTimes(), ridership = new Ridership(), trips = new Trips(), compare = new Compare();
[camera, map, controls, sidebar, card, brandMap, stationModal, programs, nowShowing, search].forEach(c => c.bind());
document.fonts.ready.then(() => { view.fontsReady = true; controls.sync(); });
addEventListener('keydown', e => { // Escape: the innermost thing open closes, the "?" pop-up first, else the map steps back
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (helpPinned) pinHelp(null);
    else if (!has(document.body, 'drawn')) intro.skip();
    else if (!menu.shut(true) && !Combo.shutOpen() && !Modal.escape()) relief.isOpen() ? relief.collapse() : map.reset();
}, true); // Before anything inside gets it

const TYPE_HELP = [ // What the route types mean
    ['State-Supported', 'State-supported routes serve corridors under 750 miles. They are largely funded by state governments in partnership with Amtrak. Most state-supported services run multiple round trips per day providing a competitive travel option between nearby cities.'],
    ['Long-Distance', 'Long-distance routes run across several states and are funded by the federal government. These trains run only once per day (or less) with some regions like Ohio seeing no daytime service at all.']
];

const helpTip = $('.help-tip'); // Pop-up: what the route types mean, or a project's full name
let helpPinned = null; // The "?" whose pop-up stays open
const showHelp = el => {
    if (!el || (el.hasAttribute('data-clipped') && el.scrollWidth <= el.clientWidth)) return void (helpTip.hidden = true); // A name only when it's cut short
    helpTip.innerHTML = el.matches('.help-btn') ? TYPE_HELP.map(([title, text]) => `<p><b>${title}</b><br>${esc(text)}</p>`).join('') : esc(el.dataset.help);
    helpTip.hidden = false;
    const r = rectOf(el), w = helpTip.offsetWidth, h = helpTip.offsetHeight, below = r.bottom + 10 + h < pageH(); // Below it, or above where there's no room
    helpTip.style.translate = `${Math.round(Math.min(pageW() - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)))}px ${Math.round(below ? r.bottom + 10 : r.top - 10 - h)}px`;
};

const pinHelp = b => { // Open the "?" pop-up, or close it
    helpPinned?.setAttribute('aria-expanded', false);
    helpPinned = b;
    b?.setAttribute('aria-expanded', true);
    showHelp(b);
};

let helpAt = 0;
addEventListener('pointerover', e => { // Hover: the "?", or a cut-off project title's full name
    if (helpPinned) return;
    const el = e.pointerType === 'mouse' && e.target.closest?.('[data-clipped], .help-btn');
    clearTimeout(helpAt);
    if (el) helpAt = setTimeout(() => showHelp(el), 350);
    else showHelp(null);
});

addEventListener('pointerdown', e => { clearTimeout(helpAt); if (!e.target.closest?.('.help-btn, .help-tip')) helpPinned ? pinHelp(null) : showHelp(null); }); // Clicking away closes it
addEventListener('click', e => { const b = e.target.closest?.('.help-btn'); if (b) pinHelp(helpPinned === b ? null : b); }); // The "?"

const videoSwitch = $('.video-switch'); // Footage on or off
videoSwitch.addEventListener('click', () => { bg.setOff(!bg.off); press(videoSwitch, !bg.off); });
const homeOfSwitch = videoSwitch.parentNode, placeSwitch = () => { // Phones upright
    const sheet = phoneLayout() && !EMBED;
    if (sheet && videoSwitch.parentNode !== ui.legend) $('.modes', ui.legend).after(videoSwitch);
    else if (!sheet && videoSwitch.parentNode !== homeOfSwitch) homeOfSwitch.append(videoSwitch);
};

placeSwitch();
addEventListener('resize', placeSwitch);
const footage = $('.footage'), liftTag = () => { // Where the program tabs reach under the footage tag, it sits above them instead
    footage.classList.remove('lifted');
    const v = footage.getBoundingClientRect(), btns = $$('.program-tabs button'), tabs = btns.map(b => b.getBoundingClientRect()).filter(r => r.width && r.right > 0 && r.left < innerWidth);
    const under = v.width && tabs.some(r => r.left < v.right + 8 && r.right > v.left - 8);
    if (under) footage.style.setProperty('--tabs-h', `${Math.max(...btns.map(b => b.offsetHeight))}px`); // Their own height: not where they are mid-entrance
    footage.classList.toggle('lifted', !!under);
};

new ResizeObserver(() => requestAnimationFrame(liftTag)).observe(footage); // It grows as it names the footage
new ResizeObserver(() => requestAnimationFrame(liftTag)).observe(ui.tabs ?? $('.program-tabs'));
addEventListener('resize', () => requestAnimationFrame(liftTag));
let resizeQueued = false; // One layout per frame while resizing
addEventListener('resize', () => {
    const wide = ui.map.clientWidth > NARROW;
    if (!EMBED && view.wasWide !== wide && view.legend !== wide) { view.legend = wide; sidebar.sync(); if (view.cam) view.cam.left = +wide; }
    view.wasWide = wide;
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; controls.sync(); controls.fit(); if (view.home) view.home = camera.home(); map.layout('resize'); brandMap.place(); }); // The home view fits the new shape
});

sidebar.sync();
EMBED ? bg.setOff(true) : bg.init(); // Embedded: no footage
const embedOpen = $('.embed-open'); // Embedded: a way out to the whole page, where it is now
embedOpen.hidden = !EMBED;
embedOpen.addEventListener('click', () => { const q = new URLSearchParams(location.search); q.delete('embed'); embedOpen.href = `${location.pathname}${`${q}` ? `?${q}` : ''}`; }); // Not q.size: Safari before 17 lacks it
intro.start(); // Phones upright too: the page has its own upright layout
introFinished.then(() => later(5, () => relief.warm())); // Population data for the featured state, before it's asked for: clear of the video's first seconds
$('[data-split]').addEventListener('click', () => split.toggle()); // Present day beside the full buildout