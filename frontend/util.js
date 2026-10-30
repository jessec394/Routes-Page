// Helpers
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)]; // Query one / all
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject(`${url} (${r.status})`)); // Fetch JSON, reject on HTTP errors
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`); // Escape text for HTML
const svg = (tag, attrs = {}) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }; // SVG element with attributes
const wait = ms => new Promise(r => setTimeout(r, ms)); // Resolves after ms
const idle = (fn, timeout) => window.requestIdleCallback ? requestIdleCallback(fn, timeout && { timeout }) : setTimeout(() => fn({ timeRemaining: () => 50 }), 50); // Run fn when the page is quiet
const later = (sec, fn) => setTimeout(fn, sec * 1000); // Run fn after `sec` seconds
const play = v => v.play().catch(() => {}); // Play a video, ignoring autoplay errors
const has = (el, a, b, c) => { const l = el.classList; return l.contains(a) || (b !== undefined && l.contains(b)) || (c !== undefined && l.contains(c)); }; // Any of up to 3 classes (no array per call)

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // "Chicago - Cleveland" -> "chicago-cleveland"
const shareLink = (kind, name) => { // A route's (r) or station's (s) own page: shared, it shows that route or station in the link's preview, then opens the map there (backend previews.py)
    const state = new URLSearchParams(location.search).get('state');
    return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}${kind}/${slug(name)}/${state ? `?state=${encodeURIComponent(state)}` : ''}`;
};
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); // Letters and digits only, for loose matching
const baseName = name => String(name).replace(/\s*\([^)]*\)\s*$/, ''); // "Stockton (San Joaquin)" -> "Stockton"
const listName = n => esc(baseName(n)) + (view.cities[n]?.airport ? PLANE : ''); // A station in a list: no parenthetical (its state, beside it, tells it apart)
const place = (name, full) => !full && view.twins?.has(name) ? baseName(name) : String(name).replace(/\s*\([A-Z]{2}\)\s*$/, ''); // "Springfield (OH)" -> "Springfield"; a station with a twin goes by their shared name (full: told apart)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`; // (3, 'stop') -> "3 stops"
const folderOf = f => f?.includes('/') ? f.slice(0, f.lastIndexOf('/')) : ''; // "Columbus (OH)/Bridge.mp4" -> "Columbus (OH)"
const common = lists => { let n = 0; while (lists.every(s => s[n] !== undefined && s[n] === lists[0][n])) n++; return n; }; // Length of the lists' shared start
const spans = (arr, fn) => { for (let k = 0; k < arr.length; k++) if (arr[k]) { let e = k; while (arr[e + 1]) e++; fn(k, e); k = e; } }; // Calls fn(start, end) for each run of truthy items
const ease = t => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // Ease-in-out cubic, 0..1
const GLIDE = 'cubic-bezier(.65, 0, .35, 1)'; // Same ease, for CSS and animate()
const ms = n => still ? 0 : n; // Animation length, or none for reduced motion
const dpr = () => Math.min(2, devicePixelRatio || 1); // Canvas pixels per CSS pixel (capped)

// Geometry
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); // Distance between two points
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]; // Dot product
const segDist = (p, a, b) => { // Distance from p to segment a-b
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

const lengthOf = run => run.reduce((t, p, i) => i ? t + dist(p, run[i - 1]) : 0, 0); // Polyline length
const bounds = pts => [0, 1].flatMap(a => [Math.min(...pts.map(p => p[a])), Math.max(...pts.map(p => p[a]))]); // [x0, x1, y0, y1]
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; // Two boxes intersect
const box = (x, y, w, h) => ({ x0: x, x1: x + w, y0: y, y1: y + h }); // Box from corner and size
const simplify = (pts, tol) => { // Drop points that move the line less than tol (Douglas-Peucker)
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
const curveOf = (pts, r = Infinity) => { // Points -> a smooth SVG path: each corner rounded within r of its point (so the line still passes close by it)
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

const remember = (cache, key, make) => { // Small cache that forgets its oldest entry past 30
    if (!cache.has(key)) { cache.set(key, make()); if (cache.size > 30) cache.delete(cache.keys().next().value); }
    return cache.get(key);
};

// Page geometry
const upright = matchMedia('(orientation: portrait) and (hover: none) and (pointer: coarse)'); // A phone held upright
const rotated = () => false; // (The page is never drawn sideways any more: phones really turn)
const pageEl = () => document.querySelector('.page'); // Everything above the background video
let pageSize = null; // Cached: reading it after a class change forces a full restyle
addEventListener('resize', () => { pageSize = null; }); // Runs before main.js's resize handler
const pageDims = () => pageSize ??= { w: pageEl().clientWidth, h: pageEl().clientHeight };
const pageW = () => pageDims().w, pageH = () => pageDims().h; // Upright page size
const phoneLayout = () => pageW() <= 600 && pageH() > pageW(); // A narrow upright screen: the phone layout (banner in two rows, the list as a sheet at the foot; styles.css 'Phones upright')
const rectOf = el => { // Element box in upright page coordinates
    const r = el.getBoundingClientRect(), W = document.documentElement.clientWidth;
    return rotated() ? { left: r.top, top: W - r.right, right: r.bottom, bottom: W - r.left, width: r.height, height: r.width } : r;
};

const flight = (from, to) => `translate(${(from.left - to.left).toFixed(1)}px, ${(from.top - to.top).toFixed(1)}px) scale(${(from.height / to.height).toFixed(4)})`; // Transform placing box `to` over box `from`
const toPts = f => { const out = []; for (let k = 0; k + 1 < f.length; k += 2) out.push([f[k], f[k + 1]]); return out; }; // Flat x, y numbers -> points
const pinClass = p => p.classList.contains('size-L') ? 'L' : p.classList.contains('size-M') ? 'M' : 'S'; // Station dot size class

const choose = (group, key, value) => { // Segmented switch: check the button whose data-<key> is `value` (highlight slides to it)
    $$('button', group).forEach(b => b.setAttribute('aria-checked', b.dataset[key] === value));
    const on = $('[aria-checked="true"]', group);
    if (!on) return;
    const spot = group._spots?.get(on) ?? (on.offsetWidth ? (group._spots ??= new Map()).set(on, [on.offsetLeft, on.offsetWidth]).get(on) : null); // Measured once (reading it forces the whole page's layout): the switch doesn't change size
    if (spot) { group.style.setProperty('--tx', `${spot[0]}px`); group.style.setProperty('--tw', `${spot[1]}px`); }
    else if (!group._retry) { group._retry = true; requestAnimationFrame(() => { group._retry = false; if (on.offsetWidth) choose(group, key, value); }); } // Not on screen yet (a window opening): measured once it shows
};

const measureSwitch = group => idle(() => $$('button', group).forEach(b => b.offsetWidth && (group._spots ??= new Map()).set(b, [b.offsetLeft, b.offsetWidth]))); // Ahead of time, at a quiet moment

addEventListener('resize', () => $$('.segmented').forEach(g => { g._spots = null; })); // (Except when the window does)

const cover = on => document.body.classList.toggle('covered', on); // A window over the map
const toPage = e => rotated() ? { x: e.clientY, y: document.documentElement.clientWidth - e.clientX } : { x: e.clientX, y: e.clientY }; // Pointer in upright page coordinates
const panZoom = (el, surface, o) => { // Wheel, drag and pinch; o gives view(), width(w) limits and move(x0, y0, w, h)
    const state = { pointers: new Map(), dragged: false }, size = v => [v[2] - v[0], v[3] - v[1]];
    let start = null, box = null;
    const at = e => { // Pointer -> element pixels and map units (its box read once per gesture: reading it forces a layout)
        if (!box || e.timeStamp - box.t > 300) box = { r: rectOf(el), w: el.clientWidth, t: e.timeStamp };
        box.t = e.timeStamp;
        const { r } = box, p = toPage(e), v = o.view(), x = p.x - r.left, y = p.y - r.top, u = size(v)[0] / box.w;
        return { x, y, mx: v[0] + x * u, my: v[1] + y * u };
    };

    const restart = () => { start = { view: o.view().slice(), pts: [...state.pointers.values()].map(p => ({ ...p })) }; };
    const zoom = (v, w, mx, my) => { const k = w / size(v)[0]; o.move(mx - (mx - v[0]) * k, my - (my - v[1]) * k, w, size(v)[1] * k); }; // New width, keeping (mx, my) still
    el.addEventListener('wheel', e => {
        if (o.off?.()) return;
        e.preventDefault();
        const p = at(e), v = o.view();
        zoom(v, o.width(size(v)[0] * Math.exp(e.deltaY * .0015)), p.mx, p.my);
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

const held = (view, world, x0, y0, w, h) => { // A view moved to (x0, y0) but kept over `world` (both [x0, y0, x1, y1])
    const hold = (v, lo, hi, size) => size >= hi - lo ? (lo + hi - size) / 2 : Math.min(hi - size, Math.max(lo, v));
    x0 = hold(x0, world[0], world[2], w);
    y0 = hold(y0, world[1], world[3], h);
    return [x0, y0, x0 + w, y0 + h];
};

const stretch = (el, drawn, shown) => { // Transform an element showing area `drawn` so it lines up with view `shown` (both [x0, y0, x1, y1])
    const [a0, b0, a1] = drawn, [x0, y0, x1] = shown, u = el.parentNode.clientWidth / (x1 - x0);
    el.style.transform = `translate(${((a0 - x0) * u).toFixed(2)}px, ${((b0 - y0) * u).toFixed(2)}px) scale(${((a1 - a0) / (x1 - x0)).toFixed(5)})`;
};

// Shared markup
const CREDIT = 'US Census Bureau | Data and Maps'; // Population data source
const credit = link => `<p class="relief-credit">Source: ${link ? `<a href="https://data.census.gov" target="_blank" rel="noopener">${CREDIT}</a>` : CREDIT}</p>`;
const routeItem = (r, note = '', go = true) => `<li><button data-i="${r.i}" style="--c:${r.color}" class="${r.typeKey}"><span class="swatch"></span>` + // Route button for lists
    `<span class="name">${esc(r.label)}${note && `<small>${note}</small>`}</span>${go ? '<span class="go">→</span>' : ''}</button></li>`;

const foldSection = (head, body, { cls = '', open = true, key = '' } = {}) => `<section class="fold${open ? '' : ' shut'}"><h4 aria-level="3"${cls ? ` class="${cls}"` : ''}><button class="fold-head"${key ? ` data-fold="${esc(key)}"` : ''} aria-expanded="${open}">${head}<i aria-hidden="true"></i></button></h4><div class="fold-body"><div>${body}</div></div></section>`; // A heading that folds what's under it away (click it: toggleFold)
const edgeFade = el => { el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2); el.classList.toggle('more-above', el.scrollTop > 2); }; // A list scrolling in place: faded at an edge with more past it (as the sidebar's list)
const edgeWatch = new ResizeObserver(entries => entries.forEach(e => edgeFade(e.target))); // (Its room changes as what's beside it arrives, e.g. a station's times)
const fadeEdges = (root = document) => (root.matches?.('.scroller') ? [root] : $$('.scroller', root)).forEach(el => { edgeFade(el); if (!el.dataset.watched) { el.dataset.watched = 1; edgeWatch.observe(el); } });
const toggleFold = head => { const open = head.closest('.fold').classList.toggle('shut') === false; head.setAttribute('aria-expanded', open); return open; }; // Open or close a foldSection
