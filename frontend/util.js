// Helpers
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)]; // Query one / all
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject(`${url} (${r.status})`)); // Fetch JSON, reject on HTTP errors
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`); // Escape text for HTML
const svg = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }; // SVG element with attributes
const wait = ms => new Promise(r => setTimeout(r, ms)); // Resolves after ms
const idle = (fn, timeout) => window.requestIdleCallback ? requestIdleCallback(fn, timeout && { timeout }) : setTimeout(() => fn({ timeRemaining: () => 50 }), 50); // Run fn when the page is quiet
const later = (sec, fn) => setTimeout(fn, sec * 1000); // Run fn after `sec` seconds
const play = v => v.play().catch(() => {}); // Play a video, ignoring autoplay errors
const has = (el, a, b, c) => { const l = el.classList; return l.contains(a) || (b !== undefined && l.contains(b)) || (c !== undefined && l.contains(c)); }; // Any of up to 3 classes
const toggles = (el, on) => { for (const k in on) el.classList.toggle(k, !!on[k]); }; // Classes on or off, by name
const isDrawn = () => has(document.body, 'drawn'), isMoving = () => has(ui.map, 'moving'); // The intro's lines all in; the map mid-move

const FLAGS = new Set((document.body.dataset.flags || '').split(' ').filter(Boolean)); // States with a flag picture, from preview.py
const flag = (id, name) => { // A state's flag: named on hover where nothing beside it says the state
    const img = FLAGS.has(id) ? `<img class="flag" src="data/flags/${id}.webp" alt="${name ? esc(name) : ''}" decoding="async">` : '';
    return img && name ? `<span class="flag-named" data-tip="${esc(name)}">${img}</span>` : img;
};
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // "Chicago - Cleveland" -> "chicago-cleveland"
const shareLink = (kind, name) => { // A route's or station's own page
    const state = new URLSearchParams(location.search).get('state');
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}${kind}/${slug(name)}/${state ? `?state=${encodeURIComponent(state)}` : ''}`;
};

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); // Letters and digits only, for loose matching
const baseName = name => String(name).replace(/\s*\([^)]*\)\s*$/, ''); // "Stockton" -> "Stockton"
const listName = n => esc(baseName(n)) + (view.cities[n]?.airport ? PLANE : ''); // A station in a list: no parenthetical
const place = (name, full) => !full && view.twins?.has(name) ? baseName(name) : String(name).replace(/\s*\([A-Z]{2}\)\s*$/, ''); // "Springfield" -> "Springfield"
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`; // -> "3 stops"
const folderOf = f => f?.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''; // "Columbus/Bridge.mp4" -> "Columbus"
const common = lists => { let n = 0; while (lists.every(s => s[n] !== undefined && s[n] === lists[0][n])) n++; return n; }; // Length of the lists' shared start
const spans = (arr, fn) => { for (let k = 0; k < arr.length; k++) if (arr[k]) { let e = k; while (arr[e + 1]) e++; fn(k, e); k = e; } }; // Calls fn for each run of truthy items
const ease = t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // Ease-in-out cubic, 0..1
const GLIDE = 'cubic-bezier(.65, 0, .35, 1)'; // Same ease, for CSS and animate
const ms = n => still ? 0 : n; // Animation length, or none for reduced motion
const dpr = () => Math.min(2, devicePixelRatio || 1); // Canvas pixels per CSS pixel

// Geometry
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); // Distance between two points
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]; // Dot product
const segDist = (p, a, b) => { // Distance from p to segment a-b
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

const KM = 1.113; // Kilometres per map unit: a hundredth of a degree of latitude
const lengthOf = run => run.reduce((t, p, i) => i ? t + dist(p, run[i - 1]) : 0, 0); // Polyline length
const bounds = pts => [0, 1].flatMap(a => [Math.min(...pts.map(p => p[a])), Math.max(...pts.map(p => p[a]))]); // [x0, x1, y0, y1]
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; // Two boxes intersect
const box = (x, y, w, h) => ({ x0: x, x1: x + w, y0: y, y1: y + h }); // Box from corner and size
const simplify = (pts, tol) => { // Drop points that move the line less than tol
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
        const [a, b] = stack.pop();
        let far = -1, most = tol;
        for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > most) { most = d; far = i; } }
        if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }

    return pts.filter((_, i) => keep[i]);
};

const pathOf = pts => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L'); // Points -> SVG path data
const lean = (d, max = 240) => { // Safari dashes a path of over 256 segments in pieces: fewer points while the lines draw in
    const n = d.match(/-?[\d.]+/g), k = n ? n.length / 2 : 0;
    if (k <= max || d.indexOf('M', 1) > 0) return d;
    return pathOf(Array.from({ length: max }, (_, q) => { const i = Math.round(q * (k - 1) / (max - 1)); return [+n[2 * i], +n[2 * i + 1]]; }));
};
const curveOf = (pts, r = Infinity) => { // Points -> a smooth SVG path
    if (pts.length < 3) return pathOf(pts);
    const f = p => p[0].toFixed(1) + ',' + p[1].toFixed(1), toward = (a, b) => { const t = Math.min(.5, r / (dist(a, b) || 1)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    let d = `M${f(pts[0])}`;
    for (let k = 1; k < pts.length - 1; k++) d += `L${f(toward(pts[k], pts[k - 1]))}Q${f(pts[k])} ${f(toward(pts[k], pts[k + 1]))}`;
    return d + `L${f(pts.at(-1))}`;
};

const ringsPath = rings => rings.map(r => pathOf(r) + 'Z').join(''); // Polygon rings -> closed SVG path
const resample = (run, step) => { // Polyline with points at most `step` apart
    const out = [run[0]];
    for (let i = 1; i < run.length; i++) {
        const [ax, ay] = run[i - 1], [bx, by] = run[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }

    return out;
};

const insideRings = ([x, y], rings) => rings.some(ring => { // Point in polygon
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[j];
        if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) hit = !hit;
    }

    return hit;
});

const remember = (cache, key, make) => { if (!cache.has(key)) { cache.set(key, make()); if (cache.size > 30) cache.delete(cache.keys().next().value); } return cache.get(key); }; // Small cache that forgets its oldest entry past 30
const bucket = (map, key) => map.get(key) ?? map.set(key, []).get(key); // A map's list for this key, made if new

// Page geometry
const pageEl = () => document.querySelector('.page'); // Everything above the background video
let pageSize = null; // Cached: reading it after a class change forces a full restyle
addEventListener('resize', () => { pageSize = null; }); // Runs before main.js's resize handler
const pageDims = () => pageSize ??= { w: pageEl().clientWidth, h: pageEl().clientHeight };
const pageW = () => pageDims().w, pageH = () => pageDims().h; // Upright page size
const phoneLayout = () => pageW() <= 600 && pageH() > pageW(); // A narrow upright screen: the phone layout
const rectOf = el => el.getBoundingClientRect(); // Element box

const flight = (from, to) => `translate(${(from.left - to.left).toFixed(1)}px, ${(from.top - to.top).toFixed(1)}px) scale(${(from.height / to.height).toFixed(4)})`; // Transform placing box `to` over box `from`
const toPts = f => { const out = []; for (let k = 0; k + 1 < f.length; k += 2) out.push([f[k], f[k + 1]]); return out; }; // Flat x, y numbers -> points
const pinClass = p => has(p, 'size-L') ? 'L' : has(p, 'size-M') ? 'M' : 'S'; // Station dot size class
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; // Root font size

// Controls: each kind built and wired here, once, for every part of the page
const segmented = (cls, label, key, options, on) => `<div class="${cls} segmented" role="radiogroup" aria-label="${label}">${options.map(([v, text]) => `<button role="radio" data-${key}="${v}" aria-checked="${v === on}">${text}</button>`).join('')}</div>`; // A row of choices, one picked: options are [value, label]
const eraSwitch = (cls, label = 'Network') => segmented(cls, label, 'era', [['today', 'Present Day'], ['buildout', 'Full Buildout']], 'buildout'); // Present Day or Full Buildout
$$('[data-era-switch]').forEach(el => { el.outerHTML = eraSwitch(el.className, el.getAttribute('aria-label')); }); // The page's own, filled in before anything looks for them

const choose = (group, key, value) => { // Pick one of a segmented row, its highlight sliding over
    $$('button', group).forEach(b => b.setAttribute('aria-checked', b.dataset[key] === value));
    const on = $('[aria-checked="true"]', group);
    if (!on) return;
    const spot = group._spots?.get(on) ?? (on.offsetWidth ? (group._spots ??= new Map()).set(on, [on.offsetLeft, on.offsetWidth]).get(on) : null); // Measured once: the switch doesn't change size
    if (spot) { group.style.setProperty('--tx', `${spot[0]}px`); group.style.setProperty('--tw', `${spot[1]}px`); }
    else if (!group._retry) { group._retry = true; requestAnimationFrame(() => { group._retry = false; if (on.offsetWidth) choose(group, key, value); }); } // Not on screen yet: measured once it shows
};

const measureSwitch = group => idle(() => $$('button', group).forEach(b => b.offsetWidth && (group._spots ??= new Map()).set(b, [b.offsetLeft, b.offsetWidth]))); // Ahead of time, at a quiet moment
addEventListener('resize', () => $$('.segmented').forEach(g => { g._spots = null; })); // Except when the window does

const press = (b, on = b.getAttribute('aria-pressed') !== 'true') => { b.setAttribute('aria-pressed', on); return on; }; // A toggle button flipped, or set: whether it's now on

const foldSection = (head, body, { key = '', shut, open = !shut?.has(key), cls = '', sect = '', tag = 'h4', level = 3 } = {}) => // A heading that folds what's under it away: shut, the keys of those folded
    `<section class="fold${sect && ` ${sect}`}${open ? '' : ' shut'}"><${tag}${level ? ` aria-level="${level}"` : ''}${cls && ` class="${cls}"`}><button class="fold-head"${key && ` data-fold="${esc(key)}"`} aria-expanded="${open}">${head}<i aria-hidden="true"></i></button></${tag}><div class="fold-body"><div>${body}</div></div></section>`;
const toggleFold = (head, shut) => { const open = head.closest('.fold').classList.toggle('shut') === false; head.setAttribute('aria-expanded', open); shut?.[open ? 'delete' : 'add'](head.dataset.fold); return open; }; // Open or close a fold, noted in shut

const edgeFade = el => { el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2); el.classList.toggle('more-above', el.scrollTop > 2); }; // A list scrolling in place
const edgeWatch = new ResizeObserver(entries => entries.forEach(e => edgeFade(e.target))); // Its room changes as what's beside it arrives, eg a station's times
const fadeEdges = (root = document) => (root.matches?.('.scroller') ? [root] : $$('.scroller', root)).forEach(el => { edgeFade(el); if (!el.dataset.watched) { el.dataset.watched = 1; edgeWatch.observe(el); } });

const ICONS = { share: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', embed: 'M8 7l-5 5 5 5M16 7l5 5-5 5', print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z' }; // Share, copy link, embed and print
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

const copyText = async text => { // Copy to clipboard
    try { await navigator.clipboard.writeText(text); return true; } catch { }
    const t = Object.assign(document.createElement('textarea'), { value: text }); // Non-secure fallback
    document.body.append(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
};

const copyFrom = (button, text, done) => { // Copy, the button's label saying how it went for a moment
    const label = $('span', button), was = label.dataset.was ??= label.textContent;
    copyText(text).then(ok => { label.textContent = ok ? done : 'Copy failed'; later(1.8, () => { label.textContent = was; }); });
};

const shareMenu = (id, cls, print) => `<div class="share"><button class="${cls}" type="button" data-menu aria-expanded="false" aria-controls="${id}">${icon('share')}<span>Share</span></button><div class="share-menu" id="${id}" hidden>` + // Copy a link or embed code, or print: its choices data-share="link | embed | print"
    [['link', 'Copy link'], ['embed', 'Copy embed code'], ['print', print]].map(([k, text]) => `<button type="button" data-share="${k}">${icon(k)}<span>${text}</span></button>`).join('') + '</div></div>';

const menu = { // The menu open under its [data-menu] button, one at a time: shut by a tap elsewhere, Escape or a choice
    on: null, // Its button
    toggle(b, open = b !== menu.on) {
        if (open && menu.on) menu.shut();
        const list = document.getElementById(b.getAttribute('aria-controls'));
        b.setAttribute('aria-expanded', open);
        if (list) list.hidden = !open;
        menu.on = open && list ? b : null;
        if (menu.on) $('button, a', list).focus();
    },
    shut(refocus) { const b = menu.on; if (b) { menu.toggle(b, false); if (refocus && b.isConnected) b.focus(); } return !!b; } // Whether one was open
};

addEventListener('click', e => { const b = e.target.closest?.('[data-menu]'); if (b) menu.toggle(b); });
addEventListener('pointerdown', e => menu.on && !e.target.closest?.('.share') && menu.shut());

class Combo { // Text boxes with their matches listed under them, each naming its list in aria-controls: arrows move through the list, Enter or a click picks, Escape or leaving shuts it
    static open = null; // The box whose list shows

    constructor(root, box, { find, pick, shut }) { // find(box, text): fill its list; pick(box, option); shut(box): after its list closes
        Object.assign(this, { pick, after: shut });
        root.addEventListener('input', e => e.target.matches?.(box) && find(e.target, e.target.value));
        root.addEventListener('keydown', e => e.target.matches?.(box) && this.key(e, e.target));
        root.addEventListener('focusout', e => e.target.matches?.(box) && this.shut(e.target));
        root.addEventListener('mousedown', e => e.target.closest('[role="listbox"]') && e.preventDefault()); // The box keeps focus
        root.addEventListener('click', e => { const li = e.target.closest('[role="option"]'), input = li && $(`[aria-controls="${li.parentNode.id}"]`, root); if (input?.matches(box)) pick(input, li); });
    }

    static list(input) { return document.getElementById(input.getAttribute('aria-controls')); }
    static shutOpen() { const c = Combo.open; if (c) c.combo.shut(c.input); return !!c; } // Escape: whether a list was open

    fill(input, html, marked) { // Its matches, one marked for Enter; none shuts it
        const ul = Combo.list(input);
        ul.innerHTML = html;
        ul.hidden = !html;
        input.setAttribute('aria-expanded', !!html);
        input.removeAttribute('aria-activedescendant');
        Combo.open = html ? { combo: this, input } : Combo.open?.input === input ? null : Combo.open;
        if (marked) this.mark(input, marked);
    }

    shut(input) { this.fill(input, ''); this.after?.(input); }

    mark(input, li) { // One match marked for Enter
        $$('[aria-selected="true"]', li.parentNode).forEach(o => o.setAttribute('aria-selected', 'false'));
        li.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
    }

    key(e, input) { // Up and down the list, Enter to pick
        const ul = Combo.list(input), opts = ul.hidden ? [] : $$('[role="option"]', ul), at = opts.findIndex(o => o.getAttribute('aria-selected') === 'true');
        if (!opts.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.mark(input, opts[(at + (e.key === 'ArrowDown' ? 1 : opts.length - (at < 0 ? 0 : 1))) % opts.length]); }
        else if (e.key === 'Enter') { e.preventDefault(); this.pick(input, opts[Math.max(at, 0)]); }
    }
}

// Windows
const cover = on => document.body.classList.toggle('covered', on); // A window over the map: the map stops drawing under it
const RISE = [[{ opacity: 0, transform: 'translateY(.8rem) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' }]; // A window coming up over the map

class Modal { // A window over the map: closed by its ×, a click beside it or Escape, the focus then handed back; enter, leave, escape and closed are its own to change
    static open = []; // Windows open, the top one last
    hold = false; // Pause the background video while it's open

    constructor(el, label) { // Label: "#id" of its heading, or a name
        this.el = el;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        if (label) el.setAttribute(...(label[0] === '#' ? ['aria-labelledby', label.slice(1)] : ['aria-label', label]));
        el.addEventListener('click', e => (e.target === el || e.target.closest('.close')) && this.close());
    }

    isOpen() { return Modal.open.includes(this); }

    reveal(focus, from = document.activeElement) { // Open on top, the focus on `focus` or its ×, then back to `from` once it closes
        if (!this.isOpen()) { this.opener = from; Modal.open.push(this); }
        this.el.hidden = false;
        cover(true);
        if (this.hold) bg.pause();
        this.enter();
        (focus || $('.close', this.el))?.focus({ preventScroll: true });
    }

    close() {
        if (!this.isOpen()) return;
        Modal.open = Modal.open.filter(m => m !== this);
        cover(Modal.open.length > 0);
        this.leave(() => {
            if (this.isOpen()) return; // Opened again on its way out
            this.el.hidden = true;
            if (this.hold && !Modal.open.some(m => m.hold)) bg.resume();
            this.closed?.();
            this.opener?.focus?.({ preventScroll: true });
        });
    }

    enter() { if (!still) this.el.firstElementChild?.animate(...RISE); } // Its way in
    leave(done) { done(); } // Its way out, then done
    escape() { this.close(); } // Escape: anything picked inside it lets go first, where that applies
    static escape() { Modal.open.at(-1)?.escape(); return Modal.open.length > 0; } // The top window's Escape: whether there was one
}

addEventListener('keydown', e => { // Tab stays within the top window
    const top = Modal.open.at(-1), at = document.activeElement;
    if (e.key !== 'Tab' || !top) return;
    const stops = $$('a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])', top.el).filter(el => el.getClientRects().length && el.tabIndex >= 0);
    if (stops.length && (!top.el.contains(at) || at === (e.shiftKey ? stops[0] : stops.at(-1)))) { e.preventDefault(); (e.shiftKey ? stops.at(-1) : stops[0]).focus(); }
});

class Finder extends Modal { // A window with a heading and ×, then its body
    constructor(cls, label, head = '', body = '') {
        const el = Object.assign(document.createElement('div'), { className: `finder ${cls}`.trim(), hidden: true });
        el.innerHTML = `<div class="finder-panel"><div class="finder-head">${head}<button class="close" aria-label="Close">×</button></div>${body}</div>`;
        document.body.append(el);
        super(el, label);
    }
}

// Pointer gestures
const toPage = e => ({ x: e.clientX, y: e.clientY }); // Pointer position
const panZoom = (el, surface, o) => { // Wheel, drag and pinch
    const state = { pointers: new Map(), dragged: false }, size = v => [v[2] - v[0], v[3] - v[1]];
    let start = null, box = null;
    const at = e => { // Pointer -> element pixels and map units
        if (!box || e.timeStamp - box.t > 300) box = { r: rectOf(el), w: el.clientWidth, t: e.timeStamp };
        box.t = e.timeStamp;
        const { r } = box, p = toPage(e), v = o.view(), x = p.x - r.left, y = p.y - r.top, u = size(v)[0] / box.w;
        return { x, y, mx: v[0] + x * u, my: v[1] + y * u };
    };

    const restart = () => { start = { view: o.view().slice(), pts: [...state.pointers.values()].map(p => ({ ...p })) }; };
    const zoom = (v, w, mx, my) => { const k = w / size(v)[0]; o.move(mx - (mx - v[0]) * k, my - (my - v[1]) * k, w, size(v)[1] * k); }; // New width, keeping still
    el.addEventListener('wheel', e => {
        if (o.off?.()) return;
        e.preventDefault();
        const p = at(e), v = o.view();
        zoom(v, o.width(size(v)[0] * Math.exp(e.deltaY * [1, 40, 800][e.deltaMode] * .0015)), p.mx, p.my); // Firefox counts some wheels in lines or pages: as pixels
    }, { passive: false });

    surface.addEventListener('pointerdown', e => {
        if (o.off?.() || e.button) return;
        state.pointers.set(e.pointerId, at(e));
        restart();
        state.dragged = false;
        o.down?.();
    });

    surface.addEventListener('pointermove', e => {
        if (!state.pointers.has(e.pointerId)) return o.hover?.(e);
        state.pointers.set(e.pointerId, at(e));
        const [a, b] = state.pointers.values(), [s0, s1] = start.pts, v = start.view, u = size(v)[0] / box.w;
        if (b && s1) { // Pinch: zoom about the starting midpoint, which follows the fingers
            const w = o.width(size(v)[0] * Math.hypot(s0.x - s1.x, s0.y - s1.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)), k = w / size(v)[0];
            const mx = v[0] + (s0.x + s1.x) / 2 * u, my = v[1] + (s0.y + s1.y) / 2 * u;
            o.move(mx - (a.x + b.x) / 2 * u * k, my - (a.y + b.y) / 2 * u * k, w, size(v)[1] * k);
        } else if (s0) { // Drag
            if (!state.dragged && Math.hypot(a.x - s0.x, a.y - s0.y) > 3) { state.dragged = true; surface.setPointerCapture(e.pointerId); } // Captured only once it's a drag, so plain clicks still reach what's under them
            if (state.dragged) o.move(v[0] - (a.x - s0.x) * u, v[1] - (a.y - s0.y) * u, ...size(v));
        }
    });

    const lift = e => { state.pointers.delete(e.pointerId); restart(); };
    surface.addEventListener('pointerup', lift);
    surface.addEventListener('pointercancel', lift);
    el.addEventListener('click', e => { if (state.dragged) { state.dragged = false; e.stopPropagation(); } }, true); // A drag isn't a click
    return state; // Live: pointers down, and whether the last press dragged
};

const held = (view, world, x0, y0, w, h) => { // A view moved to but kept over `world`
    const hold = (v, lo, hi, size) => size >= hi - lo ? (lo + hi - size) / 2 : Math.min(hi - size, Math.max(lo, v));
    x0 = hold(x0, world[0], world[2], w);
    y0 = hold(y0, world[1], world[3], h);
    return [x0, y0, x0 + w, y0 + h];
};

const stretch = (el, drawn, shown) => { // Transform an element showing area `drawn` so it lines up with view `shown`
    const [a0, b0, a1] = drawn, [x0, y0, x1] = shown, u = el.parentNode.clientWidth / (x1 - x0);
    el.style.transform = `translate(${((a0 - x0) * u).toFixed(2)}px, ${((b0 - y0) * u).toFixed(2)}px) scale(${((a1 - a0) / (x1 - x0)).toFixed(5)})`;
};

// Shared markup
const CREDIT = 'US Census Bureau | Data and Maps'; // Population data source
const credit = link => `<p class="relief-credit">Source: ${link ? `<a href="https://data.census.gov" target="_blank" rel="noopener">${CREDIT}</a>` : CREDIT}</p>`;
const trainHTML = (cars, cls) => `<div class="${cls}" aria-hidden="true"><span class="train">${cars.map(c => `<img src="frontend/trains/${c}.webp" alt="" decoding="async">`).join('')}</span></div>`; // Cars coupled in a row, from their pictures in frontend/trains
const ARRIVING = ['charger-rear', ...Array(6).fill('venture-side')]; // A train pulling in nose-left from the right: as many cars show as fit
const routeItem = (r, note = '', go = true) => `<li><button data-i="${r.i}" style="--c:${r.color}" class="${r.typeKey}"><span class="swatch"></span>` + // Route button for lists
    `<span class="name">${esc(r.label)}${note && `<small>${note}</small>`}</span>${go ? '<span class="go">→</span>' : ''}</button></li>`;