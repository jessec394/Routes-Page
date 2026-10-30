// Who the trains reach: people in the featured state living within 10 miles of one of its own served stations (census tracts, the same data as the population maps)
class Reach {
    static MILES = 10; // How near counts as near (straight line, from each tract's census internal point)
    static R = Reach.MILES * 1.609 / 1.113 * 1.15; // Search radius in map units (1 unit = 0.01 deg of latitude, about 1.11 km), a little wide: the exact test is in miles
    static PEOPLE = { AL: 'Alabamians', AZ: 'Arizonans', AR: 'Arkansans', CA: 'Californians', CO: 'Coloradans', CT: 'Connecticuters', DE: 'Delawareans', FL: 'Floridians', GA: 'Georgians', IA: 'Iowans', ID: 'Idahoans', IL: 'Illinoisans', IN: 'Hoosiers', KS: 'Kansans', KY: 'Kentuckians', LA: 'Louisianans', MA: 'Massachusettsans', MD: 'Marylanders', ME: 'Mainers', MI: 'Michiganders', MN: 'Minnesotans', MO: 'Missourians', MS: 'Mississippians', MT: 'Montanans', NC: 'North Carolinians', ND: 'North Dakotans', NE: 'Nebraskans', NH: 'New Hampshirites', NJ: 'New Jerseyans', NM: 'New Mexicans', NV: 'Nevadans', NY: 'New Yorkers', OH: 'Ohioans', OK: 'Oklahomans', OR: 'Oregonians', PA: 'Pennsylvanians', RI: 'Rhode Islanders', SC: 'South Carolinians', SD: 'South Dakotans', TN: 'Tennesseans', TX: 'Texans', UT: 'Utahns', VA: 'Virginians', VT: 'Vermonters', WA: 'Washingtonians', WI: 'Wisconsinites', WV: 'West Virginians', WY: 'Wyomingites', DC: 'Washingtonians' };
    box = $('.reach'); // Sidebar figure
    big = $('.time-jump-reach'); // Under the intro's big date
    data = {}; // State -> promise of { pop: tract people, near: tract -> station indices, total }
    shown = null; // Number on screen now
    target = null;

    constructor() {
        $('.reach-why', this.box).addEventListener('click', () => this.explain());
        const near = $('.near-me');
        near.addEventListener('click', () => this.nearMe());
    }

    people(id = view.focus) { return Reach.PEOPLE[id] || `people in ${STATE_NAMES[id] || id}`; }

    stations() { return this.names ??= Object.keys(view.cities).filter(n => view.served[n]?.length && net.cityXY(n)); } // Every station some route calls at (twins apart: each has its own spot)

    miles([lon1, lat1], [lon2, lat2]) { // Great-circle distance
        const r = Math.PI / 180, h = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
        return 7917.5 * Math.asin(Math.min(1, Math.sqrt(h))); // (Earth's diameter in miles)
    }

    centroid(ring) { // A packed outline's (1/10000 deg steps) area centre, [lon, lat]: for data built before tracts carried their census point
        const pts = [];
        for (let i = 0, lon = 0, lat = 0; i < ring.length; i += 2) pts.push([(lon += ring[i]) / 1e4, (lat += ring[i + 1]) / 1e4]);
        let a = 0, x = 0, y = 0;
        pts.forEach(([x0, y0], k) => { const [x1, y1] = pts[(k + 1) % pts.length], c = x0 * y1 - x1 * y0; a += c; x += (x0 + x1) * c; y += (y0 + y1) * c; });
        return a ? [x / (3 * a), y / (3 * a)] : pts[0];
    }

    load(id = view.focus) { // A state's tracts and the stations within 10 miles of each (once)
        if (!relief.maps[id]) return Promise.resolve(null); // No population data for it
        return this.data[id] ??= getJSON(`data/states/${id}/density.json?v=${relief.maps[id]}`).then(({ tracts, ids, points, source }) => {
            const names = this.stations(), R = Reach.R, cell = R, grid = new Map(), key = (x, y) => Math.floor(x / cell) * 65536 + Math.floor(y / cell);
            const ll = names.map(n => [+view.cities[n].lon, +view.cities[n].lat]), xy = names.map(n => net.cityXY(n));
            const inside = names.map(n => net.stateIdOf(n) === id); // Only the state's own stations count
            xy.forEach(([x, y], k) => { if (!inside[k]) return; const g = key(x, y); (grid.get(g) ?? grid.set(g, []).get(g)).push(k); });
            const pop = new Float64Array(tracts.length), near = [], pts = [];
            let total = 0, official = 0;
            tracts.forEach(([, people, ring], t) => {
                const pt = points?.[t] || this.centroid(ring); // The Census Bureau's own point inside the tract (else its outline's centre)
                if (points?.[t]) official++;
                const [x, y] = view.xy(pt), cx = Math.floor(x / cell), cy = Math.floor(y / cell), list = [];
                for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) for (const k of grid.get(i * 65536 + j) || []) if (this.miles(pt, ll[k]) <= Reach.MILES) list.push(k);
                pop[t] = people;
                near.push(list);
                pts.push(pt);
                total += people;
            });
            return { id, raw: tracts, pop, near, pts, ll, inside, ids: ids || null, total, source: source || null, official: official === tracts.length };
        }).catch(e => { console.warn(`Station reach: ${e}`); return null; });
    }

    servedIn(era) { // Stations with a route shown in an era (as the route type toggles stand), as flags by station index
        const on = new Uint8Array(this.stations().length);
        this.stations().forEach((n, k) => { on[k] = !(era === 'today' && unbuilt(n)) && view.served[n].some(i => net.inEra(era, view.routes[i])); }); // (A station still being built: no stop today)
        return on;
    }

    forRoute(el, list) { // A route card: people in the featured state within 10 miles of the route's own stops there (and how many have no station near today)
        const id = view.focus, live = list.length && net.present(list[0]); // (Today's route: a station still being built isn't a stop yet)
        this.load(id).then(d => {
            if (!d || !el.isConnected) return;
            const names = this.stations(), index = this.index ??= new Map(names.map((n, k) => [n, k])), mine = new Uint8Array(names.length);
            list.flatMap(r => r.stops).flatMap(twinsOf).forEach(n => { const k = index.get(n); if (k !== undefined && d.inside[k] && !(live && unbuilt(n))) mine[k] = 1; });
            if (!mine.some(Boolean)) return; // No stops in the state: nothing to say
            const today = this.servedIn('today');
            let near = 0, fresh = 0;
            d.near.forEach((ks, t) => { if (!ks.some(k => mine[k])) return; near += d.pop[t]; if (!ks.some(k => today[k])) fresh += d.pop[t]; });
            const place = STATE_NAMES[id] || id;
            el.innerHTML = `<b>${Math.round(near).toLocaleString('en-US')}</b><span>${esc(this.people(id))} within ${Reach.MILES} mi of a station</span>` +
                (!live && fresh >= 1 ? `<em>+${this.short(fresh)} with no station near them today</em>` : '');
            el.title = `People in ${place}'s census tracts within ${Reach.MILES} miles of this route's stations in ${place}; overlapping stations count each person once.`;
            el.hidden = false;
        });
    }

    forStation(el, name) { // A station's window: people within 10 miles of it (every state with census data its 10 miles reach into)
        const [x, y] = net.cityXY(name), R = Reach.MILES * 1.609 / 1.113 * 1.2, own = net.stateIdOf(name), pt = [+view.cities[name].lon, +view.cities[name].lat];
        if (!el || !relief.maps[own]) return; // (No census data for its state)
        const ids = view.allStates.filter(s => relief.maps[s.id] && s.box[0] <= x + R && s.box[1] >= x - R && s.box[2] <= y + R && s.box[3] >= y - R).map(s => s.id);
        (this.around ??= new Map()).get(name) ?? this.around.set(name, Promise.all(ids.map(id => this.load(id))).then(all => all.reduce((sum, d) => sum + (d ? d.pts.reduce((s, p, t) => s + (this.miles(pt, p) <= Reach.MILES ? d.pop[t] : 0), 0) : 0), 0)));
        this.around.get(name).then(n => {
            if (!el.isConnected || !n) return;
            el.innerHTML = `<b>${Math.round(n).toLocaleString('en-US')}</b> people within ${Reach.MILES} miles`;
            el.title = `People in census tracts whose point is within ${Reach.MILES} miles of this station (US Census Bureau)`;
            el.hidden = false;
        });
    }

    count(d, on) { let sum = 0; d.near.forEach((list, t) => { if (list.some(k => on[k])) sum += d.pop[t]; }); return sum; } // People near any of these stations

    update(animate = true) { // The sidebar figure for the era and route types shown now
        const id = view.focus;
        this.load(id).then(d => {
            if (id !== view.focus) return;
            this.box.hidden = !d;
            if (!d) return;
            const now = this.count(d, this.servedIn(view.era)), today = view.era === 'today' ? now : this.count(d, this.servedIn('today'));
            $('.reach-who', this.box).textContent = this.people(id);
            if (this.youAt && !ui.static?.querySelector('.you')) this.drawYou(); // (Another state featured: its layer redrawn)
            Object.assign(this, { base: today, total: d.total });
                        if (this.playing) return; // (The intro counts it up as the lines draw)
            this.roll(now, animate && !still && this.shown !== null);
        });
    }

    short(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n); } // 1.24M, 380K

    paint(n) { // Show a figure: the number, the gain over today's and the state's share
        this.shown = n;
        const text = Math.round(n).toLocaleString('en-US'), gain = $('.reach-gain', this.box), up = n - (this.base ?? n);
        $('.reach-num', this.box).textContent = $('b', this.big).textContent = text;
        gain.hidden = up < 1;
        gain.textContent = `+${this.short(up)} vs. today`;
        $('.reach-share', this.box).textContent = this.total ? `${Math.round(100 * n / this.total)}% of ${STATE_NAMES[view.focus] || 'the state'}` : '';
    }

    roll(to, animate) { // Count the shown number to `to`
        if (to === this.target && this.shown === to) return;
        this.target = to;
        cancelAnimationFrame(this.frame);
        if (!animate) return this.paint(to);
        const from = this.shown ?? to, t0 = performance.now(), MS = 1100;
        const step = now => {
            const t = Math.min(1, (now - t0) / MS);
            this.paint(from + (to - from) * (1 - (1 - t) ** 3));
            if (t < 1) this.frame = requestAnimationFrame(step);
        };

        this.frame = requestAnimationFrame(step);
    }

    intro() { // With the big date: today's figure, ready to count up
        this.load().then(d => {
            if (!d || document.body.classList.contains('drawn')) return;
            const today = this.count(d, this.servedIn('today'));
            Object.assign(this, { base: today, total: d.total });
            this.roll(today, false);
            $('span', this.big).textContent = `${this.people()} live within ${Reach.MILES} miles of a station`;
            this.big.hidden = false;
        });
    }

    play(arrivalAt, t0) { // The intro's buildout: the figure climbs as each new station's line reaches it (arrivalAt: seconds after t0 for a spot, or null)
        this.playing = true;
        this.load().then(d => {
            if (!d) return this.ended();
            const names = this.stations(), today = this.servedIn('today'), later = this.servedIn('buildout'), latest = [];
            const at = names.map((n, k) => { if (today[k] || !later[k]) return null; const t = arrivalAt(...net.cityXY(n)); if (t !== null) latest.push(t); return t; });
            const end = Math.max(0, ...latest), events = [];
            let base = 0;
            d.near.forEach((list, t) => {
                if (list.some(k => today[k])) return void (base += d.pop[t]);
                const times = list.filter(k => later[k]).map(k => at[k] ?? end);
                if (times.length) events.push([Math.min(...times), d.pop[t]]);
            });

            events.sort((a, b) => a[0] - b[0]);
            const last = base + events.reduce((s, e) => s + e[1], 0);
            Object.assign(this, { base, total: d.total });
            let k = 0, aim = base;
            this.paint(base);
            const step = now => { // Each arrival raises the aim; the number chases it (a steady tick, not jumps)
                if (!this.playing) return;
                const sec = (now - t0) / 1000;
                while (k < events.length && events[k][0] <= sec) aim += events[k++][1];
                this.paint(aim - this.shown < 1 ? aim : this.shown + (aim - this.shown) * .12);
                if (k < events.length || this.shown < aim) this.frame = requestAnimationFrame(step);
                else { this.target = last; this.big.classList.add('done'); this.ended(); }
            };

            cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(step);
        });
    }

    ended() { this.playing = false; this.doneAt = performance.now(); this.onDone?.(); } // The intro's count has finished

    settled() { return this.playing ? Promise.race([new Promise(done => { this.onDone = done; }), wait(8000)]) : Promise.resolve(); } // When the intro's count is finished (at once if it isn't counting)

    stop() { if (this.playing) { this.ended(); this.update(false); } } // Intro skipped: straight to the figure

    // How it's counted: a window with the state's population relief (hover a tract: its census ID and people), the figures and the method, and where the data comes from
    explain() {
        const id = view.focus;
        this.load(id).then(d => {
            if (!d) return;
            if (!this.win) {
                this.win = Object.assign(document.createElement('div'), { className: 'finder reach-why-view', hidden: true });
                this.win.setAttribute('role', 'dialog');
                this.win.setAttribute('aria-labelledby', 'reach-why-title');
                document.body.append(this.win);
                this.win.addEventListener('click', e => {
                    if (e.target === this.win || e.target.closest('.close')) this.closeExplain();
                });
                addEventListener('keydown', e => { if (e.key === 'Escape' && this.win && !this.win.hidden) { e.stopImmediatePropagation(); this.closeExplain(); } }, true);
            }

            const today = this.servedIn('today'), later = this.servedIn('buildout'), names = this.stations(), place = STATE_NAMES[id] || id, who = this.people(id);
            const fig = on => { const n = this.count(d, on); return { n, share: Math.round(100 * n / d.total), tracts: d.near.filter(l => l.some(k => on[k])).length, stations: new Set(d.near.flatMap(l => l.filter(k => on[k]))).size }; };
            const a = fig(today), b = fig(later), num = n => Math.round(n).toLocaleString('en-US');
            const own = new Map(); // Station -> people in this state within 10 miles of it (on its own: neighbours overlap)
            d.near.forEach((list, t) => list.forEach(k => { if (today[k] || later[k]) own.set(k, (own.get(k) || 0) + d.pop[t]); }));
            const rows = [...own].sort((x, y) => y[1] - x[1]).map(([k, n]) => `<tr><td>${listName(names[k])}</td><td>${num(n)}</td><td>${today[k] ? '<span class="tag now">Existing</span>' : '<span class="tag new">New</span>'}</td></tr>`).join('');
            const src = d.source || {}, acs = src.population || '', year = acs.match(/(\d{4})/)?.[1], tl = (src.tracts || '').match(/^tl_(\d{4})_(\d{2})_/), fips = tl?.[2] || d.ids?.[0]?.slice(0, 2);
            const acsURL = acs && fips ? `https://data.census.gov/table/${acs}?g=040XX00US${fips}$1400000` : 'https://data.census.gov/table?q=B01003';
            const tigerURL = `https://www.census.gov/cgi-bin/geo/shapefiles/index.php?year=${tl?.[1] || ''}&layergroup=Census+Tracts`;
            this.win.innerHTML = `<div class="finder-panel reach-why-panel"><div class="finder-head"><p class="reach-why-big" id="reach-why-title"><b>${num(a.n)}</b><span class="arrow" aria-label="to">→</span><b class="to">${num(b.n)}</b><span class="who">${b.share}% of ${esc(who)} within ${Reach.MILES} mi of a station</span></p><div class="reach-why-tools"><button class="close" aria-label="Close">×</button></div></div><div class="reach-why-body">` +
                `<figure class="reach-map"><div class="reach-layers"><canvas role="img" aria-label="Population density of ${esc(place)} by census tract"></canvas><canvas></canvas></div><canvas class="reach-hl"></canvas><div class="reach-tip" hidden></div><span class="relief-spin" aria-hidden="true"></span><button class="reach-reset" type="button" hidden>Reset view</button>` +
                `<figcaption><span><i class="ring"></i>${Reach.MILES} miles from a station</span><span>Tap a station or tract for details</span></figcaption></figure>` +
                `` +
                `<table class="reach-why-sum"><thead><tr><th></th><th>Present Day</th><th>Full Buildout</th></tr></thead><tbody>` +
                `<tr><th>${esc(who)} within ${Reach.MILES} mi</th><td>${num(a.n)}</td><td>${num(b.n)}</td></tr>` +
                `<tr><th>Share of all ${esc(who)}</th><td>${a.share}%</td><td>${b.share}%</td></tr>` +
                `<tr><th>Census tracts counted</th><td>${num(a.tracts)}</td><td>${num(b.tracts)}</td></tr>` +
                `<tr><th>Stations serving them</th><td>${num(a.stations)}</td><td>${num(b.stations)}</td></tr>` +
                `</tbody></table><p class="note">${esc(place)}: ${num(d.total)} people in ${num(d.pop.length)} populated tracts</p>` +
                `<h3>Where the data comes from</h3><ul class="reach-why-src">` +
                `<li><a href="${acsURL}" target="_blank" rel="noopener">Population of every census tract in ${esc(place)}<span>US Census Bureau · ACS 5-year estimates${year ? ` ${year}` : ''}, table B01003 ↗</span></a></li>` +
                `<li><a href="${tigerURL}" target="_blank" rel="noopener">Census tract boundaries and points<span>US Census Bureau · TIGER/Line Shapefiles${tl ? ` ${tl[1]}` : ''}, Census Tracts ↗</span></a></li></ul>` +
                `<h3>Stations by nearby population</h3><p class="note">Each station is counted on its own; nearby stations' catchment areas may overlap, so potential riders add up to more than the totals.</p><p class="note">A tract is counted whole or not at all; some people in a counted tract may live a little over ${Reach.MILES} miles away, and some in an uncounted one a little under.</p>` +
                `<table class="reach-why-stations"><thead><tr><th>Station</th><th>People</th><th>Service</th></tr></thead><tbody>${rows}</tbody></table>` +
                `</div></div>`;
            this.win.hidden = false;
            cover(true);
            if (!still) $('.finder-panel', this.win).animate([{ opacity: 0, transform: 'translateY(.8rem) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
            $('.close', this.win).focus();
            this.relief(d, $('.reach-map', this.win));
        });
    }

    relief(d, fig) { // The state in 3D (the population maps' drawing; zoom and pan), its stations' 10-mile rings, and a tract's details on hover
        const st = view.allStates.find(s => s.id === d.id), px = dpr(), LIFT = Relief.LIFT, R = Reach.MILES * 1.609 / 1.113, MARGIN = .25;
        if (!st || !window.OffscreenCanvas) return fig.remove();
        const [bx0, bx1, by0, by1] = st.box, pad = 4, w = bx1 - bx0 + LIFT + 2 * pad, h = by1 - by0 + LIFT + 2 * pad;
        const W = fig.clientWidth, H = Math.round(Math.min(W * Math.min(.85, Math.max(.45, h / w)), innerHeight * .5, 440)); // (Leaves room to read on below)
        fig.style.height = `${H}px`;
        const s0 = Math.min(W / w, H / h), cx = (bx0 + bx1 + LIFT) / 2, cy = (by0 + by1 + LIFT) / 2, home = [cx - W / s0 / 2, cy - H / s0 / 2, cx + W / s0 / 2, cy + H / s0 / 2]; // Map units, shaped to the figure
        const layers = $('.reach-layers', fig), [c0, c1, hl] = $$('canvas', fig), reset = $('.reach-reset', fig), tip = $('.reach-tip', fig);
        [c0, c1].forEach(c => { c.width = Math.round(W * px * (1 + 2 * MARGIN)); c.height = Math.round(H * px * (1 + 2 * MARGIN)); }); // Drawn a little past the view: small pans show no blank edges
        hl.width = Math.round(W * px); hl.height = Math.round(H * px);
        const on = this.servedIn('buildout'), names = this.stations(); // (Always the full buildout, whatever the map shows)
        const stops = names.map((n, k) => { if (!on[k] || !d.inside[k]) return null; const [x, y] = net.cityXY(n); return { name: n, k, x, y, r: Relief.DOTS[sizeOf(view.cities[n])] * px * .8, people: 0 }; }).filter(Boolean);
        const byK = new Map(stops.map(p => [p.k, p]));
        d.near.forEach((list, t) => list.forEach(k => { if (byK.has(k)) byK.get(k).people += d.pop[t]; })); // Each station's own reach (neighbours share people)
        const M = this.map = { view: home.slice(), drawn: null, busy: false, again: false };

        const draw = () => { // The view (and its margin) from the drawing thread; one at a time, the latest view wins
            if (M.busy) return void (M.again = true);
            M.busy = true;
            const area = relief.around(M.view, MARGIN);
            relief.paint([c0, c1], area, `reach:${d.id}`, [], !M.drawn, { ids: [d.id], stops }).then(peak => {
                M.busy = false;
                if (this.map !== M) return;
                if (peak === null && !M.drawn) return fig.classList.add('failed');
                M.drawn = area;
                fig.classList.add('ready');
                stretch(layers, M.drawn, M.view);
                if (M.again) { M.again = false; draw(); }
            });
        };

        // Tracts in map units, tallest first (the first whose raised top is under the pointer is the one seen)
        const scale = relief.scale || 1, height = dens => Math.min(1, Math.log1p(dens / 50) / Math.log1p(scale / 50)) ** 2.5; // (As the drawing thread raises them)
        const tracts = d.raw.map(([dens, , ...parts], t) => {
            const path = new Path2D();
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            parts.forEach(flat => { for (let i = 0, lon = 0, lat = 0; i < flat.length; i += 2) { lon += flat[i]; lat += flat[i + 1]; const [x, y] = view.xy([lon / 1e4, lat / 1e4]); i ? path.lineTo(x, y) : path.moveTo(x, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } path.closePath(); });
            return { t, dens, path, box: [x0, y0, x1, y1], up: height(dens) * LIFT };
        }).sort((a, b) => b.up - a.up);
        const test = new OffscreenCanvas(1, 1).getContext('2d'); // Hit tests in map units (x100, for precision)
        test.setTransform(100, 0, 0, 100, 0, 0);

        const ctx = hl.getContext('2d'), border = new Path2D(ringsPath(st.rings)); // (Rings stop at the state line: only its own stations count, only its own people)
        let shown = null, pinned = null, at = null, frame = 0, last = null; // Tract shown (hovered or picked), the picked one, and where its box points (map units)
        const overlay = () => { // Rings, and the shown tract, for the view as it is now
            const v = M.view, s = W / (v[2] - v[0]);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, hl.width, hl.height);
            ctx.setTransform(s * px, 0, 0, s * px, -v[0] * s * px, -v[1] * s * px);
            ctx.save();
            ctx.clip(border, 'evenodd');
            ctx.setLineDash([3 / s, 3 / s]);
            Object.assign(ctx, { lineWidth: 1.2 / s, strokeStyle: 'rgb(255 255 255 / .45)' });
            stops.forEach(p => { if (p !== shown && p.x + R > v[0] && p.x - R < v[2] && p.y + R > v[1] && p.y - R < v[3]) { ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 2 * Math.PI); ctx.stroke(); } });
            ctx.setLineDash([]);
            if (shown?.name) { // A station: its 10 miles, solid and glowing (inside the state)
                const glow = shown === pinned ? '#e0402c' : '#fff';
                ctx.beginPath();
                ctx.arc(shown.x, shown.y, R, 0, 2 * Math.PI);
                Object.assign(ctx, { fillStyle: 'rgb(255 255 255 / .08)', strokeStyle: glow, lineWidth: 2.2 / s, shadowColor: glow, shadowBlur: 12 * px });
                ctx.fill();
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.beginPath();
                ctx.arc(shown.x, shown.y, 6 / s, 0, 2 * Math.PI);
                Object.assign(ctx, { fillStyle: '#fff', strokeStyle: glow, lineWidth: 2 / s });
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
            if (shown && !shown.name) { ctx.translate(shown.up, shown.up); Object.assign(ctx, { fillStyle: 'rgb(255 255 255 / .28)', strokeStyle: shown === pinned ? '#e0402c' : '#fff', lineWidth: (shown === pinned ? 2.5 : 2) / s }); ctx.fill(shown.path, 'evenodd'); ctx.stroke(shown.path); }
        };

        const num = n => Math.round(n).toLocaleString('en-US'), eras = [['Present Day', this.servedIn('today')], ['Full Buildout', this.servedIn('buildout')]];
        const nearest = (pt, on) => { let best = Infinity, k0 = -1; d.ll.forEach((p, k) => { if (on[k] && d.inside[k]) { const m = this.miles(pt, p); if (m < best) { best = m; k0 = k; } } }); return k0 < 0 ? null : [names[k0], best]; };
        const spot = e => { const r = hl.getBoundingClientRect(), v = M.view, u = (v[2] - v[0]) / r.width; return [v[0] + (e.clientX - r.left) * u, v[1] + (e.clientY - r.top) * u]; }; // Pointer -> map units
        const stopAt = ([mx, my]) => { const v = M.view, reach = 12 * (v[2] - v[0]) / W; let best = null, near = reach; stops.forEach(p => { const dd = Math.hypot(p.x - mx, p.y - my); if (dd < near) { near = dd; best = p; } }); return best; }; // A station dot under the pointer (12px)
        const itemAt = p => stopAt(p) || tractAt(p);
        const tractAt = ([mx, my]) => tracts.find(t => mx - t.up >= t.box[0] && mx - t.up <= t.box[2] && my - t.up >= t.box[1] && my - t.up <= t.box[3] && test.isPointInPath(t.path, (mx - t.up) * 100, (my - t.up) * 100, 'evenodd')) || null;
        const place = () => { // The box beside its spot, on the figure's roomier side
            if (!shown || !at) return;
            if (shown.name) at = [shown.x, shown.y]; // (A station's box points at the station)
            const v = M.view, k = W / (v[2] - v[0]), x = (at[0] - v[0]) * k, y = (at[1] - v[1]) * k, right = x > W / 2;
            tip.hidden = x < 0 || x > W || y < 0 || y > H; // (Panned out of view)
            tip.style.transform = `translate(${right ? `calc(${x - 14}px - 100%)` : `${x + 14}px`}, ${Math.max(4, Math.min(H - tip.offsetHeight - 4, y - 30))}px)`;
        };

        const today = this.servedIn('today');
        const show = (hit, where) => { // Light a station's 10 miles or outline a tract, and describe it (null: nothing)
            at = where;
            if (hit !== shown) {
                shown = hit;
                overlay();
                tip.hidden = !hit;
                if (hit?.name) tip.innerHTML = `<strong>${listName(hit.name)}</strong><span>${num(hit.people)} ${esc(this.people(d.id))} within ${Reach.MILES} mi</span><span class="${today[hit.k] ? 'in' : 'out'}">${today[hit.k] ? 'Existing service' : 'New in the Full Buildout'}</span>`;
                else if (hit) {
                    const t = hit.t, lines = eras.map(([label, on]) => { const n = nearest(d.pts[t], on), inside = d.near[t].some(k => on[k]); return `<span class="${inside ? 'in' : 'out'}">${label}: ${inside ? 'counted' : 'not counted'}${n ? ` · ${esc(baseName(n[0]))}, ${n[1].toFixed(1)} mi` : ''}</span>`; });
                    tip.innerHTML = `<strong>${num(d.pop[t])} people</strong>${d.ids ? `<code>Tract ${esc(d.ids[t])}</code>` : ''}<span>${num(hit.dens * 2.59)} per sq mi</span>${lines.join('')}`;
                }
            } else if (hit) overlay();
            place();
        };

        const hover = () => { frame = 0; const p = last && spot(last); hl.classList.toggle('on-stop', !!(p && stopAt(p))); if (!pinned) show(p && itemAt(p), p); }; // (A picked tract stays until another is picked)
        const hoverSoon = e => { last = e; frame ||= requestAnimationFrame(hover); };
        const moveTo = (x0, y0, vw, vh) => { // Zoom or pan: the last picture stretched over the new view, the rings redrawn, a sharp picture asked for
            M.view = held(M.view, home, x0, y0, vw, vh);
            if (M.drawn) stretch(layers, M.drawn, M.view);
            reset.hidden = M.view.every((v, n) => Math.abs(v - home[n]) < (home[2] - home[0]) * .01);
            overlay();
            place();
            draw();
        };

        const gesture = panZoom(fig, hl, { view: () => M.view, width: vw => Math.min(home[2] - home[0], Math.max((home[2] - home[0]) / 10, vw)), move: moveTo, hover: hoverSoon, down: () => { if (!pinned) { last = null; hover(); } } }); // Out to the whole state, in to 10x
        hl.addEventListener('pointerleave', () => { if (!gesture.pointers.size) { last = null; frame ||= requestAnimationFrame(hover); } });
        hl.addEventListener('click', e => { // Tap or click: pick a station or tract (its box stays, for phones too); again, or off the state, to let go
            const p = spot(e), hit = itemAt(p);
            pinned = hit && hit !== pinned ? hit : null;
            shown = null; // (Redrawn in its picked style)
            show(pinned || (e.pointerType === 'mouse' ? hit : null), p);
        });
        hl.addEventListener('dblclick', () => moveTo(...home.slice(0, 2), home[2] - home[0], home[3] - home[1]));
        reset.addEventListener('click', () => moveTo(...home.slice(0, 2), home[2] - home[0], home[3] - home[1]));
        overlay();
        draw();
    }

    // Near me: where the visitor is, the nearest station today and after the buildout (anywhere in the country)
    nearMe() { // Ask where: a city, address or ZIP code
        this.near ??= this.nearPanel();
        this.near.hidden = false;
        $('.near-body', this.near).innerHTML = '';
        $('input', this.near).focus();
    }

    nearPanel() { // The box: where to look from, then the answer (top right of the map)
        const el = Object.assign(document.createElement('div'), { className: 'near-panel', hidden: true });
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Stations near a place');
        el.innerHTML = '<p class="kicker">Stations near you</p><button class="close" aria-label="Close">×</button>' +
            '<form class="near-form" autocomplete="off"><input type="search" name="near-q" placeholder="City, address or ZIP code" aria-label="Place to search near" autocomplete="off" data-lpignore="true" data-1p-ignore enterkeyhint="search"><button type="submit">Go</button></form><div class="near-body" aria-live="polite"></div>';
        el.addEventListener('click', e => {
            if (e.target.closest('.close')) { el.hidden = true; this.youAt = null; return this.drawYou(); }
            const go = e.target.closest('[data-city]');
            if (go) stationModal.open(go.dataset.city);
        });
        $('form', el).addEventListener('submit', e => { e.preventDefault(); this.lookUp($('input', el).value.trim()); });
        $('.stage').append(el);
        return el;
    }

    async geocode(q) { // A place typed in -> { here: [lon, lat], label } (a station's own name needs no lookup); null: not found; throws: couldn't ask
        const fold = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        const station = Object.keys(view.cities).find(n => fold(n) === fold(q) || fold(place(n)) === fold(q));
        if (station) return { here: [+view.cities[station].lon, +view.cities[station].lat], label: place(station) };
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&addressdetails=0&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } }); // OpenStreetMap's place search (free, no key): US places only
        if (!r.ok) throw new Error(`${r.status}`);
        const [hit] = await r.json();
        return hit ? { here: [+hit.lon, +hit.lat], label: hit.display_name.replace(/, United States$/, '').split(', ').slice(0, 3).join(', ') } : null;
    }

    nearest(here, era, n = 1) { // The n stations nearest a spot with a route in an era (as the route types stand): [{ name, miles }]
        const on = this.servedIn(era);
        return this.stations().flatMap((name, k) => on[k] ? [{ name, miles: this.miles(here, [+view.cities[name].lon, +view.cities[name].lat]) }] : []).sort((a, b) => a.miles - b.miles).slice(0, n);
    }

    async lookUp(q) { // The near-you box: look the place up, then answer
        const body = $('.near-body', this.near);
        if (!q) return;
        const seq = this.lookSeq = (this.lookSeq || 0) + 1;
        body.innerHTML = '<p class="near-wait">Looking it up…</p>';
        try {
            const hit = await this.geocode(q);
            if (seq !== this.lookSeq) return; // (A newer search took over)
            if (!hit) return void (body.innerHTML = '<p>Couldn’t find that place. Try a city and state, or a ZIP code.</p>');
            this.showNear(hit.here, hit.label);
        } catch { if (seq === this.lookSeq) body.innerHTML = '<p>Couldn’t look that up just now. Try again in a moment.</p>'; }
    }

    showNear(here, label) { // The answer for a place, the map flown to it, and the place marked
        const best = era => this.nearest(here, era)[0] || null;
        const now = best('today'), later = best('buildout'), row = (label, s) => `<li><span>${label}</span>${s ? `<button data-city="${esc(s.name)}"><b>${listName(s.name)}${net.stateIdOf(s.name) ? `<small>${esc(net.stateIdOf(s.name))}</small>` : ''}</b><em>${s.miles < 1 ? 'under a mile' : `${Math.round(s.miles)} mi`}</em></button>` : '<b>None</b>'}</li>`;
        const same = now && later && now.name === later.name;
        $('.near-body', this.near).innerHTML = `<p class="near-where"><b>${esc(label)}</b></p><ul>${row(same ? 'Present & Buildout' : 'Present Day', now)}${same ? '' : row('Full Buildout', later)}</ul>` +
            '';
        this.youAt = view.xy(here);
        this.drawYou();
        const [x, y] = this.youAt, far = later ? net.cityXY(later.name) : [x, y], dx = Math.abs(far[0] - x), dy = Math.abs(far[1] - y);
        map.reset();
        view.back = { cx: (x + far[0]) / 2, cy: (y + far[1]) / 2, hx: Math.max(70, dx * .75), hy: Math.max(42, dy * .75), side: 0 }; // You and the buildout's nearest station, together
        view.wide = false;
        camera.move(still ? 0 : .9);
    }

    drawYou() { // The visitor's spot and their 10 miles, on the map (under the lines)
        ui.static?.querySelector('.you')?.remove();
        if (!this.youAt) return;
        const [x, y] = this.youAt, R = Reach.MILES * 1.609 / 1.113, g = svg('g', { class: 'you' });
        g.append(svg('circle', { class: 'you-ring', cx: x, cy: y, r: R }), svg('circle', { class: 'you-dot', cx: x, cy: y, r: 1 }));
        ui.static?.append(g);
    }

    closeExplain() { if (this.win && !this.win.hidden) { this.win.hidden = true; this.map = null; cover(false); } }
}
