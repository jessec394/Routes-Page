// Page mode
const params = new URLSearchParams(location.search);
const START_ROUTE = params.get('route'); // ?route=<name> opens straight to a route
const FOCUS = (params.get('state') || 'OH').toUpperCase(); // ?state=PA features another state's routes
document.body.classList.toggle('link', !!START_ROUTE);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches; // User prefers reduced motion
const NARROW = 900, SHORT = 520, SPEED = 480; // Phone breakpoints (px: narrow, or short as on a phone on its side); draw-in speed (map units/s)
let introDone; // Resolves introFinished
const introFinished = new Promise(r => { introDone = r; }); // The intro has ended

// Shared state
const ui = Object.fromEntries(Object.entries({ // Page elements
    map: '.map', base: '.map-base', pins: '.pins', tip: '.map > .tip', card: '.card',
    body: '.card-body', hint: '.hint', top: '.top', modes: '.modes', era: '.era',
    dock: '.dock', legend: '.legend', legendToggle: '.legend-toggle', legendBody: '.legend-body'
}).map(([k, s]) => [k, $(s)]));

try { ['routes-types', 'routes-shut', 'routes-plain'].forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem('routes-lite'); } catch { } // Nothing is remembered between visits (clears what older versions saved)

if (!document.body.dataset.lite && ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 2)) document.body.dataset.lite = 1; // Low-power device: lighter map effects
const TYPES = ['state', 'long-distance']; // Route types (header toggles)
const view = { // All map state
    routes: [], cities: {}, served: {}, hover: null, selected: null, city: null, zoom: null,
    types: TYPES.join(' '),
    era: 'today', // Intro starts on "Present Day"
    legend: true, // Sidebar open to start, phones too (it steps aside once a route is picked there)
    wasWide: pageW() > NARROW
};

const PROGRAMS = ['Corridor ID Program', 'FRA Long-Distance Study', 'Funded', 'Unofficial']; // Sidebar order for proposed routes' programs (any others follow, A-Z, then 'Other')
const programsOf = r => (r.status.split(':')[1] || '').split(',').map(p => p.trim()).filter(Boolean); // "Proposed: A, B" -> ['A', 'B'] (a route may be in several)

const STATE_NAMES = { AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DC: 'District of Columbia', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia', VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming' } // Abbreviation -> state name
const PLANE = '<svg class="plane" viewBox="0 0 24 24" aria-label="airport"><path d="M12 1.6c.9 0 1.6.8 1.6 1.7v5.9l7.8 4.6v2.3l-7.8-2.4v5l2.2 1.6v1.9L12 21.1l-3.8 1.1v-1.9l2.2-1.6v-5l-7.8 2.4v-2.3l7.8-4.6V3.3c0-.9.7-1.7 1.6-1.7z"/></svg>'; // Airport icon
const statusKinds = new Map(); // Status text -> kind (cached: called often)
const statusKind = s => statusKinds.get(s) ?? statusKinds.set(s, /^exists/i.test(s) ? (/temporary/i.test(s) ? 'temporary' : /suspended/i.test(s) ? 'suspended' : 'exists') : /suspended/i.test(s) ? 'suspended' : /funded/i.test(s) ? 'funded' : 'proposed').get(s); // 'exists' | 'temporary' | 'suspended' | 'funded' | 'proposed'
const TAGS = { temporary: 'Temporary', suspended: 'Suspended', funded: 'Funded – Coming Soon', extension: 'Extension Funded' }; // Tags for routes that aren't simply running
const statusText = s => statusKind(s) === 'funded' ? TAGS.funded : s.replace(/^Exists:\s*/, ''); // Status as the page writes it ("Exists: Suspended" is just "Suspended")
const sizeOf = c => (c?.size || 'S').toUpperCase(); // Station size: 'L' | 'M' | 'S'
const nameHTML = (n, full) => esc(place(n, full)) + (view.cities[n]?.airport ? PLANE : ''); // Plane icon after stations marked "airport": true
const twinsOf = n => view.twins?.get(n)?.all ?? [n]; // A station and its twins (same name, a few km apart: one stop on the map)
const mainOf = n => view.twins?.get(n)?.main ?? n; // The one whose dot stands for them all
const clipUrl = f => `data/clips/${f.split('/').map(encodeURIComponent).join('/')}`; // Clip path -> URL
const clipName = src => decodeURIComponent((src || '').replace(/^.*?clips\//, '')); // URL -> clip path
const clipCities = new Map(); // Clips folder -> station (cached)
const clipCity = folder => { // Station a clips folder shows ("Columbus (OH)": the state picks which)
    if (!clipCities.has(folder)) {
        const st = folder.match(/\(([A-Z]{2})\)\s*$/)?.[1], want = norm(place(folder)), names = Object.keys(view.cities);
        clipCities.set(folder, names.find(n => view.cities[n].clips && norm(view.cities[n].clips) === norm(folder)) ?? names.find(n => norm(n) === norm(folder)) ?? names.filter(n => !view.cities[n].clips && norm(place(n)) === want && (!st || net.stateIdOf(n) === st)).sort((a, b) => (net.stateIdOf(b) === 'OH') - (net.stateIdOf(a) === 'OH') || 'LMS'.indexOf(sizeOf(view.cities[a])) - 'LMS'.indexOf(sizeOf(view.cities[b])))[0] ?? null); // (No state given: Ohio's, else the biggest)
    }

    return clipCities.get(folder);
};

// Network data and queries
class Network {
    stateCache = new Map(); // Station -> state abbreviation
    servedBy = new Map(); // Era|types -> station -> shown routes

    load(data) { // Project everything into map coordinates; returns the focus state
        const focus = data.states.find(s => s.id.toUpperCase() === FOCUS) || data.states.find(s => s.id.toUpperCase() === 'OH') || data.states[0]; // Unknown state: Ohio
        const fp = focus.rings.flat(), [lon0, lon1, lat0, lat1] = bounds(fp);
        const cLon = (lon0 + lon1) / 2, cLat = (lat0 + lat1) / 2, k = Math.cos(cLat * Math.PI / 180); // Projection centre, longitude scale
        view.xy = ([lon, lat]) => [(lon - cLon) * k * 100, (cLat - lat) * 100];
        view.proj = { cLon, cLat, k }; // For the relief's drawing thread
        view.cities = Object.fromEntries(data.cities.map(c => [c.name, c]));
        this.findTwins();
        view.focus = focus.id.toUpperCase();
        view.allStates = data.states.map(st => { const rings = st.rings.map(r => r.map(view.xy)); return { id: st.id, rings, box: bounds(rings.flat()) }; });
        view.fp = fp.map(view.xy);
        this.data = data;
        this.buildRoutes(data.routes);
        view.regional = (data.regional || []).map((l, k) => { // Commuter lines: drawn (one shared lane: they overlap, beside Amtrak's), never listed or picked
            const runs = l.lines.map(run => run.map(view.xy)), len = runs.reduce((t, run) => t + lengthOf(run), 0);
            return { i: view.routes.length + k, k, label: `${l.operator} ${l.name}`, operator: l.operator, name: l.name, eras: l.eras, runs, xy: runs.flat(), lane: Lanes.EDGE, w: .62, len, speed: Math.max(SPEED, len / 2.6) };
        });
        this.colorGroups();
        return view.allStates[data.states.indexOf(focus)];
    }

    present = r => ['exists', 'temporary'].includes(statusKind(r.status)); // Existing routes
    hasType = t => (this.types?.key === view.types ? this.types : this.types = { key: view.types, on: new Set(view.types.split(' ')) }).on.has(t); // Route type toggled on
    proposed = r => ['proposed', 'funded'].includes(statusKind(r.status)); // Future versions (funded ones too)
    inEra = (era, r) => this.hasType(r.typeKey) && (era === 'today' ? this.present(r) : statusKind(r.status) !== 'temporary' && (this.proposed(r) || !view.replaced.has(r.label))); // Route shown in 'today'/'buildout' (a proposal replaces today's route of the same name)
    shown = r => this.inEra(view.era, r); // Route shown right now
    shownAt = i => this.shown(view.routes[i]); // Same, by route index
    regionalShown = l => l.eras.includes(view.era); // A commuter line shown now (they show whatever the route types)
    members = i => view.groups.get(view.routes[i].label); // All branches of a route's group
    siblings = i => this.members(i).filter(m => this.proposed(view.routes[m]) === this.proposed(view.routes[i])); // Branches of the same version (today's or the proposal)
    routesAt = name => { // Shown routes serving a station (cached per era and route types)
        const key = view.era + '|' + view.types, now = this.servedBy.get(key) ?? this.servedBy.set(key, new Map()).get(key);
        return now.get(name) ?? now.set(name, [...new Set(twinsOf(name).flatMap(n => view.served[n] || []))].filter(this.shownAt)).get(name); // (Twins: one station)
    };

    findTwins() { // Stations sharing a name within ~15 km ("Detroit", "Detroit (New Center)"): one dot, one name
        const byName = new Map(), rank = n => (n === baseName(n) ? 0 : 3) + 'LMS'.indexOf(sizeOf(view.cities[n])); // The plain name first, then the biggest
        Object.keys(view.cities).forEach(n => (byName.get(baseName(n)) ?? byName.set(baseName(n), []).get(baseName(n))).push(n));
        view.twins = new Map();
        byName.forEach(names => {
            if (names.length < 2) return;
            const xy = n => view.xy([view.cities[n].lon, view.cities[n].lat]), sorted = [...names].sort((a, b) => rank(a) - rank(b));
            sorted.forEach(n => {
                const main = sorted.find(m => dist(xy(m), xy(n)) < 15) ?? n, set = view.twins.get(main) ?? { main, all: [main] };
                if (main !== n) { set.all.push(n); view.twins.set(main, set); view.twins.set(n, set); }
            });
        });
    }

    split(ids) { return new Set(ids.flatMap(i => view.routes[i].stops).filter((n, _, all) => twinsOf(n).filter(t => all.includes(t)).length > 1)); } // Twins these routes call at both of: told apart

    uniqueGroups = ids => [...new Map(ids.map(i => [view.routes[i].label, view.routes[i]])).values()]; // One route per group
    cityXY = name => { const c = view.cities[name]; return c && view.xy([c.lon, c.lat]); }; // Station -> map coordinates

    stateIdOf = name => { // State abbreviation of a given station
        if (!this.stateCache.has(name)) {
            const known = view.cities[name]?.state, p = known === undefined && this.cityXY(name); // (Worked out by serve.py; older map data: here)
            this.stateCache.set(name, known ?? ((p && view.allStates.find(s => insideRings(p, s.rings)))?.id.toUpperCase() || ''));
        }

        return this.stateCache.get(name);
    };

    markContext() { // Context: groups with no stop in the focus state (listed under National)
        view.groups.forEach(ids => {
            const context = !ids.some(i => view.routes[i].stops.some(n => this.stateIdOf(n) === view.focus));
            ids.forEach(i => { view.routes[i].context = context; });
        });
    }

    focusOn(id) { // Feature another state; returns its shape
        const st = view.allStates.find(s => s.id.toUpperCase() === id);
        view.focus = id;
        view.fp = st.rings.flat();
        this.markContext();
        return st;
    }

    contextOnly = name => twinsOf(name).flatMap(n => view.served[n] || []).every(i => view.routes[i].context); // Station served only by context routes

    stateOf = name => STATE_NAMES[this.stateIdOf(name)] || this.stateIdOf(name); // State name of a given station

    buildRoutes(routes) { // Groups, projected lines, served stops, temporary routes' lanes
        this.servedBy.clear();
        view.routes = routes.map((r, i) => ({ ...r, i, label: r.group || r.name }));
        view.groups = new Map();
        view.routes.forEach(r => {
            if (!view.groups.has(r.label)) view.groups.set(r.label, []);
            view.groups.get(r.label).push(r.i);
            r.g = [...view.groups.keys()].indexOf(r.label); // Group number
            r.runs = r.lines.map(run => run.map(view.xy));
            r.stops.forEach(n => (view.served[n] ??= []).push(r.i));
        });

        this.markContext();

        view.replaced = new Set(view.routes.filter(this.proposed).map(r => r.label)); // Names with a proposal: their current route gives way to it in the buildout
        if (!this.data?.snapped) this.snapToTrack(); // (serve.py does it now)
        view.routes.forEach(r => {
            r.w = r.typeKey === 'long-distance' ? .5 : 1; // Line weight: long-distance thinner
            r.xy = r.runs.flat();
            r.box = bounds(r.xy);
            r.len = lengthOf(r.xy);
            r.speed = Math.max(SPEED, r.len / 2.6);
        });

        const pairs = r => new Set(r.stops.slice(1).map((n, k) => [r.stops[k], n].sort().join('|'))); // Consecutive stop pairs
        view.routes.forEach(r => {
            r.lane = r.g;
            if (statusKind(r.status) !== 'temporary') return;
            const mine = pairs(r), best = view.routes.filter(o => o.g !== r.g && o.context === r.context && statusKind(o.status) !== 'temporary')
                .map(o => [o, [...pairs(o)].filter(x => mine.has(x)).length]).sort((a, b) => b[1] - a[1])[0];
            if (best && best[1] >= 3) r.lane = best[0].g;
        });
    }

    snapToTrack() { // Straight routes follow traced track wherever both stops lie on it
        const traced = view.routes.filter(r => r.traced), near = 6; // Map units (~6 km) a station may sit off the track
        const locate = (run, p) => { // Closest point on a run: [distance, position along it, segment, point]
            let best = [Infinity];
            for (let k = 1; k < run.length; k++) {
                const a = run[k - 1], b = run[k], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)), q = [a[0] + t * dx, a[1] + t * dy], d = dist(p, q);
                if (d < best[0]) best = [d, k - 1 + t, k, q];
            }
            return best;
        };

        const between = (a, b) => { // Shortest stretch of traced track joining two stations, or null
            let found = null;
            traced.forEach(t => t.runs.forEach(run => {
                const A = locate(run, a), B = locate(run, b);
                if (A[0] > near || B[0] > near) return;
                const fwd = A[1] <= B[1], [s, e] = fwd ? [A, B] : [B, A];
                const path = [s[3], ...run.slice(s[2], e[2]), e[3]], len = lengthOf(path);
                if (len > dist(a, b) * 1.6 + 10 || (found && len >= found.len)) return; // Not a detour
                found = { len, pts: fwd ? path : path.reverse() };
            }));
            return found?.pts;
        };

        view.routes.filter(r => !r.traced && traced.length).forEach(r => {
            const pts = r.stops.map(this.cityXY).filter(Boolean);
            if (pts.length < 2) return;
            let snapped = 0;
            const run = [pts[0]];
            pts.slice(1).forEach((p, k) => {
                const track = between(pts[k], p);
                if (track) { snapped++; run.push(...track.slice(1, -1)); }
                run.push(p);
            });
            if (snapped) r.runs = [run];
        });
    }

    colorGroups() { // Each route's color for the map as set now (era and types), and one for every route to fall back on
        this.palettes = new Map();
        const all = this.paint(view.routes, null);
        view.routes.forEach(r => { r.base = all.get(r.g); });
        this.recolor();
    }

    colorsFor() { return remember(this.palettes, `${view.era}|${view.types}`, () => this.paint(view.routes.filter(this.shown), this.palette)); } // The routes shown now: their colors (worked out once per era and types)

    recolor() { // Routes take the colors for the map as set now; true if any changed
        const colors = this.palette = this.colorsFor();
        let changed = false;
        view.routes.forEach(r => { const c = colors.get(r.g) ?? r.color ?? r.base; if (r.color !== c) { r.color = c; changed = true; } });
        return changed;
    }

    paint(routes, prev) { // Group -> color: distinct, above all where lines touch or run near (prev: colors kept where they still work)
        const standIn = r => r.lane !== r.g && routes.some(o => o.g === r.lane); // Temporary routes take their partner's color
        const groups = [...new Set(routes.filter(r => !standIn(r)).map(r => r.g))], n = groups.length, at = new Map(groups.map((g, k) => [g, k]));
        const cell = 20, grid = new Map(), w = new Float32Array(n * n); // ~20 km cells
        routes.forEach(r => { const k = at.get(r.g); if (k !== undefined) r.runs.forEach(run => resample(run, cell / 2).forEach(([x, y]) => { const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; (grid.get(key) ?? grid.set(key, new Set()).get(key)).add(k); })); });
        grid.forEach((set, key) => { // Sharing a cell (or the next one) counts fully, running within ~70 km a little
            const [cx, cy] = key.split(',').map(Number);
            for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
                const other = grid.get(`${cx + i},${cy + j}`), v = Math.max(Math.abs(i), Math.abs(j)) <= 1 ? 1 : .12;
                if (other) for (const a of set) for (const b of other) if (a !== b) w[a * n + b] += v;
            }
        });

        const near = w.map(v => v && 2 * Math.log1p(v)), G = 4 / Math.max(n, 1); // Closeness per pair; a little for every pair (distinct overall where there's room)
        const cands = this.swatches ??= Network.swatches(Math.random() * 360), sim = (p, q) => Math.exp(-((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2) / .012); // 1 the same, ~.4 at a just-visible difference
        const byHex = new Map(cands.map(c => [c.hex, c])), was = groups.map(g => byHex.get(prev?.get(g)));
        const pick = new Array(n), cost = (k, c) => { let t = 0; for (let o = 0; o < n; o++) if (o !== k && pick[o]) t += (near[k * n + o] + G) * sim(c, pick[o]); return t - (was[k] === c ? G * .15 : 0); }; // (A color it had already: kept unless it's at all like another's)
        const best = k => { let top = null, low = Infinity; for (const c of cands) { const v = cost(k, c) + Math.random() * 1e-3; if (v < low) { low = v; top = c; } } return top; };
        const load = k => { let t = 0; for (let o = 0; o < n; o++) t += near[k * n + o]; return t; };
        const order = [...groups.keys()].sort((a, b) => load(b) - load(a) || a - b); // Busiest first
        order.forEach(k => { pick[k] = best(k); });
        for (let pass = 0; pass < 2; pass++) order.forEach(k => { pick[k] = best(k); }); // Then each again, knowing all the others
        const out = new Map(groups.map((g, k) => [g, pick[k].hex]));
        routes.filter(standIn).forEach(r => out.set(r.g, out.get(r.lane)));
        return out;
    }

    static swatches(hue0) { // Candidate colors: vivid only (never pale, dull or dark), in OKLab to judge how different they look
        const out = [], lin = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        for (let h = 0; h < 360; h += 8) for (const [sat, light] of [[100, 54], [95, 62]]) {
            const hue = (hue0 + h) % 360, l = light / 100 + (hue > 205 && hue < 265 ? .08 : 0), c = (1 - Math.abs(2 * l - 1)) * sat / 100; // (Blues lifted: dark on the navy otherwise)
            const f = n => { const k = (n + hue / 30) % 12; return l - c / 2 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
            const rgb = [f(0), f(8), f(4)].map(v => Math.min(1, Math.max(0, v))), [r, g, b] = rgb.map(lin);
            const L = Math.cbrt(.4122214708 * r + .5363137383 * g + .0514459929 * b), M = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), S = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
            const ok = { L: .2104542553 * L + .793617785 * M - .0040720468 * S, a: 1.9779984951 * L - 2.428592205 * M + .4505937099 * S, b: .0259040371 * L + .7827717662 * M - .808675766 * S };
            if (ok.L < .6) continue; // Too dark to read on the navy
            out.push({ ...ok, hex: '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') });
        }
        return out;
    }
}
