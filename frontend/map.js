// Map drawing
const LABEL_SIDES = ['right', 'bottom', 'left', 'top', 'top-right', 'top-left', 'bottom-right', 'bottom-left']; // Label spots, in order of preference

class MapView {
    routeCache = new Map(); // Line geometry per view
    pending = new Map(); // Views whose lines are being worked out
    static RESPACE_MS = 700; // Lane glide duration
    static DOT = { L: [1.15, 1.15], M: [.8, .73], S: [.55, .25] }; // Dot width in rem at zoom z: a + b * z
    static NAME = { L: z => (.76 + .29 * z) / 1.05, M: z => (.72 + .12 * z) / .84, S: z => (.72 - .04 * z) / .68 }; // Name scale at zoom z
    static part(share) { return share ? 1 - share.b + share.a : 1; } // How much of a run draws in: a changed route's stretch running today is there already
    static spot(side, { r, w, h }) { const k = r * .71 + 2; return { right: [r + 6, -h / 2], left: [-r - 6 - w, -h / 2], bottom: [-w / 2, r + 2], top: [-w / 2, -r - 2 - h], 'top-right': [k, -k - h], 'top-left': [-k - w, -k - h], 'bottom-right': [k, k], 'bottom-left': [-k - w, k] }[side]; } // A name's corner beside its dot of radius r
    static around(grid, cx, cy, n, fn) { for (let x = cx - n; x <= cx + n; x++) for (let y = cy - n; y <= cy + n; y++) for (const k of grid.get(x * 65536 + y) || []) fn(k); } // Each segment in the cells near one
    static pageKey() { return `${pageW()}|${pageH()}`; } // Sizes read from the styles hold for one page size
    static lines() { return [...view.routes, ...view.regional]; } // Every line: routes, then commuter lines
    static sample(c) { return (view.pinList || []).find(q => pinClass(q) === c); } // A dot of size class c, to read its styles
    static endsAt(r, c) { return r.stops[0] === c || r.stops.at(-1) === c; } // Route r starts or ends at station c

    render(data) { // Build the whole map from network.json
        const focus = net.load(data);
        lanesThread.start([...view.routes, ...view.regional]); // Commuter lines numbered on from the routes
        view.home = camera.home();
        const linked = START_ROUTE && view.routes.find(r => slug(r.label) === slug(START_ROUTE) || slug(r.name) === slug(START_ROUTE));
        if (linked) { const later = view.routes.filter(o => o.label === linked.label && net.buildout(o)), shown = later[0] || linked; Object.assign(view, { linked: shown, era: later.length ? 'buildout' : 'today', selected: shown.i, zoom: shown.i }); } // A route running today only, eg a temporary one
        view.cam = camera.target();

        const { plan, startOf, drawn, fromFlip } = intro.plan();
        [ui.static, ui.edge] = ['map-static', 'map-edge'].map((c, n) => [ui.static, ui.edge][n] ?? ui.dim.parentNode.insertBefore(svg('svg', { class: c, 'aria-hidden': 'true' }), ui.dim)); // Own layers: not repainted by hover/draw-in
        this.drawFocus(focus);
        relief.load(data.density);
        ui.base.replaceChildren(...this.routeLayers(plan));
        ui.pins.replaceChildren(...this.stationDots(data.cities, this.stationDrawTimes(drawn, startOf, fromFlip)));
        view.pinList = [...ui.pins.children];
        this.snapKey = null; // New dots: snapped afresh
        this.lineGroups = $$('.route, .glow, .under'); // Cached for focusRoutesAndStations
        sidebar.build();
        programs.build();
        sidebar.picks();
        controls.sync();
        this.layout();
        this.focusRoutesAndStations();
        if (view.switchAt != null) this.prepare('buildout'); // Precompute the flip before the intro's pause ends
    }

    withEra(era, fn) { const was = view.era; view.era = era; try { return fn(); } finally { view.era = was; } } // Run as if another era showed
    prepare(era) { this.withEra(era, () => { this.geometry(view.frame.s); net.colorsFor(); }); } // Precompute another era's lines and colors for this view

    drawFocus(focus) { // The states, the focus state's fill, and its outline and glow
        const states = svg('g'), defs = svg('defs');
        defs.innerHTML = ['blue', 'sky'].map(c => `<radialGradient id="fade-${c}" class="fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"><stop offset=".55"/><stop offset="1" stop-opacity="0"/></radialGradient>`).join(''); // States fade toward the edges: far cheaper than a mask
        view.allStates.filter(st => st !== focus).forEach(st => states.append(svg('path', { d: ringsPath(st.rings), class: 'state', 'data-id': st.id })));
        ui.static.replaceChildren(defs, states, svg('path', { d: ringsPath(focus.rings), class: 'state focus', 'data-id': focus.id }));
        const edge = ringsPath(focus.rings);
        ui.edge.replaceChildren(...[8, 7, 6, 5, 4, 3, 2, 1].map(g => svg('path', { d: edge, class: 'focus-glow', style: `--g:${g}` })), svg('path', { d: edge, class: 'focus-edge', 'data-id': focus.id })); // Glow: a few soft strokes
        camera.fades = null; // New gradients: found afresh
    }

    recolor() { [...this.lineGroups.filter(g => g.dataset.i), ...$$('[data-i]', ui.legendBody)].forEach(el => el.style.setProperty('--c', view.routes[el.dataset.i].color)); } // Lines and the sidebar take the routes' colors for this view

    routeLayers(plan) { // SVG for every route, over the commuter lines
        const layers = ['glow', 'under', 'route'].map(n => svg('g', { class: 'layer-' + n }));
        this.routeEls = new Map(); // Each route's line group, by route
        [...view.regional, ...view.routes].forEach(r => {
            const local = r.lane === Lanes.EDGE, style = local ? `--c:var(--commuter);--w:${r.w}` : `--c:${r.color};--w:${r.w}`, extra = (local ? ' regional' : view.instant.has(r.i) ? ' no-fade' : '') + (!local && net.comingSoon(r) ? ' soon' : '');
            const [glow, under, line] = ['glow', 'under', 'route'].map((n, l) => layers[l].appendChild(svg('g', { class: n + extra, [local ? 'data-r' : 'data-i']: local ? r.k : r.i, style })));
            this.routeEls.set(r.i, line);
            const start = local ? 0 : plan.get(r.i); // Commuter lines don't draw in: they fade with their era
            let done = 0;
            r.els = r.runs.map((run, n) => {
                const len = lengthOf(run), share = r.drawFrom?.[n], part = MapView.part(share), timing = { pathLength: 1, style: `--d:${(start + done / r.speed).toFixed(2)}s;--t:${Math.max(.05, part * len / r.speed).toFixed(2)}s` + (share ? `;--dash:${(share.b - share.a).toFixed(4)};--from:${(-share.a).toFixed(4)}` : '') }; // A changed route: today's stretch already there, drawn on outward from it
                done += len * part;
                const els = [svg('path', timing), ...['casing', 'line'].map(c => svg('path', { class: c, ...timing }))];
                glow.append(els[0]);
                under.append(els[1]);
                line.append(els[2]);
                return els;
            });
        });

        return layers;
    }

    stationDrawTimes(drawn, startOf, fromFlip = new Set()) { // Station -> seconds until its line reaches it
        const reached = {}; // Timed from the start, or from the flip for buildout-only stations
        const time = (routes, skip) => routes.forEach(r => {
            let before = 0;
            r.runs.forEach((run, n) => {
                const share = r.drawFrom?.[n], len = lengthOf(run), part = MapView.part(share), start = startOf(r) + before / r.speed, when = x => !share ? x * len / r.speed : x > share.b ? (x - share.b) / (1 - share.b) * part * len / r.speed : x < share.a ? (share.a - x) / share.a * part * len / r.speed : 0; // A changed route grows from both ends of today's stretch at once
                r.stops.forEach(name => {
                    const p = net.cityXY(name);
                    if (!p || skip.has(name)) return;
                    let along = 0, best = 6, at = null;
                    for (let k = 1; k < run.length; k++) {
                        const a = run[k - 1], b = run[k], len = dist(a, b), d = segDist(p, a, b);
                        if (d < best) { best = d; at = along + Math.max(0, Math.min(len, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len || 1))); }
                        along += len;
                    }

                    if (at !== null) reached[name] = Math.min(reached[name] ?? Infinity, start + when(at / (len || 1)));
                });

                before += len * part;
            });
        });

        time(drawn.filter(r => !fromFlip.has(r.i)), new Set());
        time(drawn.filter(r => fromFlip.has(r.i)), new Set(Object.keys(reached)));
        return reached;
    }

    stationDots(cities, reached) { // Station dot buttons
        const rank = { L: 0, M: 1, S: 2 };
        const context = new Set(cities.filter(c => net.contextOnly(c.name)).map(c => c.name)); // Drawn first, so featured stations sit on top
        return cities.filter(c => twinsOf(c.name).some(n => view.served[n]) || sizeOf(c) !== 'S').sort((a, b) => context.has(b.name) - context.has(a.name) || rank[sizeOf(b)] - rank[sizeOf(a)]).map(c => {
            const pin = document.createElement('button'), [x, y] = view.xy([c.lon, c.lat]);
            Object.assign(pin, { tabIndex: -1, className: `pin size-${sizeOf(c)}${net.gap(c.name) ? ' unplanned' : ''}`, _wx: x, _wy: y, _ctx: +context.has(c.name), _size: rank[sizeOf(c)] }); // Not in the Tab order; ordered with featured on top
            Object.assign(pin.dataset, { city: c.name, x, y });
            const at = Math.min(...twinsOf(c.name).map(n => reached[n] ?? Infinity)); // A twin's dot: when a line reaches either
            pin.style.setProperty('--appear', `${(at === Infinity ? 0 : at).toFixed(2)}s`);
            const paren = c.name.slice(place(c.name).length).trim(); // A twin's own part of its name
            pin.innerHTML = `<i></i><span>${nameHTML(c.name)}${paren && view.twins.has(c.name) ? `<b class="paren"> ${esc(paren)}</b>` : ''}</span>`;
            pin.setAttribute('aria-label', `${place(c.name)}, ${net.gap(c.name) ? 'no service planned' : plural(net.uniqueGroups(twinsOf(c.name).flatMap(n => view.served[n] || [])).length, 'route')}`);
            return pin;
        });
    }

    layout(same) { // Redraw for the current camera
        if (!view.cam) return;
        ui.map.classList.remove('panning'); // Backdrop away: everything drawn for this view
        this.mapRect = null; // Measured again on the next pointer move
        if (camera.trip) { cancelAnimationFrame(view.tween); camera.land(); } // A jump: any camera move ends here
        const m = same && same !== 'resize' ? camera.quick() : camera.measure(), f = camera.frameFor(view.cam, m), { s } = f;
        if (view.topH !== m.topH) document.body.style.setProperty('--top', `${view.topH = m.topH}px`);
        this.zoomClasses(f, m);
        camera.applyFrame(f);
        view.frame = f;
        camera.placePins(f);
        const key = this.viewKey(s), settle = () => { this.drawRoutes(s); ui.map.classList.remove('moving'); }; // Lines land with the new view: one repaint
        clearTimeout(view.settleTimer);
        if (!view.placed || this.routeCache.has(key)) settle(); // Precomputed: no need to wait
        else {
            const from = this.routeCache.get(this.lineKey)?.job.s;
            if (same !== 'resize' && this.lineKey && MapView.lineSet(this.lineKey) === MapView.lineSet(key) && this.respace(s, true)) { // Only the same lines at a new zoom
                this.respacedFor = Math.abs(Math.log(s / from)) < Math.log(2) ? key : null; // Zoomed by hand
                ui.map.classList.remove('moving');
                this.gridDue = true; // Names wait for the full layout: placed once, not twice
            }

            view.settleTimer = setTimeout(settle, same === 'resize' ? 120 : 0); // Resizing: wait for it to stop
        }

        view.placed = true;
        if (!isMoving()) this.arrangeSoon();
    }

    zoomClasses(f, m, quiet, rough) { // Dot styles for how far out the view is: rough mid-move
        const home = camera.frameFor({ ...view.cam, ...view.home }, m).s, whole = camera.frameFor({ ...view.cam, ...camera.network() }, m).s;
        ui.map.classList.toggle('wide', f.s < home * .55); // Zoomed well out: smaller dots and names
        if (has(ui.map, 'far') !== f.s < whole * 1.6) { ui.map.classList.toggle('far'); camera.pinFrame = null; if (!quiet) this.fadePins(); } // Out near the whole country: medium and small stations hidden
        [this.homeS, this.wholeS] = [home, whole];
        this.grow(f.s, false, rough);
    }

    zAt(s) { // 1 at the local view and closer, 0 well out, below 0 out toward the whole country
        const r = s / (this.homeS || s), t = Math.min(1, Math.max(0, Math.log(r / .3) / Math.log(1 / .3)));
        return +(r >= .3 ? t * t * (3 - 2 * t) : -.35 * Math.min(1, Math.log(.3 / r) / Math.log(2))).toFixed(3);
    }

    grow(s, force, rough) { // Dots and names scale with the zoom
        if (camera.flying && !force) return;
        const n = rough ? 10 : 40, z = Math.round(this.zAt(s) * n) / n; // Steps too small to see: fewer restyles, fewer still mid-move, where each resizes every dot
        if (z === view.z) return;
        view.z = z;
        this.applyZ(); // Dots on screen now
    }

    applyZ(pins = (view.pinList || []).filter(p => p._on)) { // Size dots and names for the zoom, per dot in plain properties
        const z = view.z ?? 1;
        if (this.dotKey !== MapView.pageKey()) pins = view.pinList || []; // New page size: all of them
        for (const p of pins) {
            if (p._z === z && p._zk === this.dotKey) continue;
            const c = pinClass(p), fixed = this.dotR(c, z, true);
            p._z = z;
            p._zk = this.dotKey;
            p.style.width = p.style.height = fixed ? '' : `${(2 * this.dotR(c, z)).toFixed(2)}px`; // Small screens: fixed in styles.css
            p.lastChild.style.scale = MapView.NAME[c](z).toFixed(4);
            if (c === 'L') p.firstChild.style.borderWidth = fixed ? '' : `${(2.5 + .5 * z).toFixed(2)}px`;
        }
    }

    dotR(c, z, fixed) { // Dot radius in pixels at zoom z
        const key = MapView.pageKey();
        if (this.dotKey !== key && view.pinList?.length) { // Read from the styles once per page size
            this.dotKey = key;
            this.rem = remPx();
            this.dotFixed = {};
            for (const k of ['L', 'M', 'S']) {
                const p = MapView.sample(k), v = p && getComputedStyle(p).getPropertyValue('--dot').trim(); // A formula, or a fixed size
                if (v && !v.includes('calc')) this.dotFixed[k] = parseFloat(v) * (v.endsWith('rem') ? this.rem : 1);
            }
        }

        if (fixed) return c in (this.dotFixed || {});
        return (this.dotFixed?.[c] ?? (MapView.DOT[c][0] + MapView.DOT[c][1] * z) * this.rem) / 2;
    }

    // Route geometry
    viewKey(s, f = view.frame) { const { W, H } = f; return `${view.types}|${view.era}|${s.toFixed(4)}|${W}x${H}`; } // Cache key for a zoom's lines
    eraGeometry(era) { return this.withEra(era, () => this.geometry(view.frame.s)); } // Another era's lines for this view
    sameView(key) { return key.split('|').filter((_, n) => n !== 1).join('|'); } // Key without the era
    static lineSet(key) { return key.split('|').slice(0, 2).join('|'); } // Key's types and era: the lines shown, at any zoom

    geometry(s, f = view.frame) { // Promise of a view's laid-out lines
        const key = this.viewKey(s, f);
        if (this.routeCache.has(key)) return Promise.resolve(this.routeCache.get(key));
        if (this.pending.has(key)) return this.pending.get(key);
        const majors = $$('.pin.size-L:not(.gone)', ui.pins).map(p => [+p.dataset.x, +p.dataset.y]); // Big stations: lanes spread around them
        const job = this.geometryJob = { key, s, laid: [...view.routes.filter(net.shown), ...view.regional.filter(net.regionalShown)].map(r => r.i), ctx: { radius: this.dotR('L', this.zAt(s)), home: this.homeS || s, majors } };
        const promise = lanesThread.run(job).then(c => {
            this.pending.delete(key);
            return remember(this.routeCache, key, () => ({ ...c, job }));
        });

        this.pending.set(key, promise);
        return promise;
    }

    respace(s, force) { // Mid-zoom: lanes kept the same distance apart on screen until the move settles
        const c = this.routeCache.get(this.lineKey);
        if (!c?.spread || this.glide || (!force && Math.abs(Math.log(s / (this.spacedAt || s))) < .15)) return false; // Within 15%: under a pixel off, not worth restyling every line
        this.spacedAt = s;
        const radius = this.dotR('L', this.zAt(s)); // Big stations' dots at this zoom
        MapView.lines().forEach(r => c.spread[r.i].forEach((b, n) => {
            if (!b) return;
            const pts = [];
            for (let k = 0; k < b.length / Lanes.N; k++) pts.push(Lanes.at(b, k, s, radius, c.home));
            const d = pathOf(pts);
            r.els[n].forEach(el => { MapView.setD(el, d); el._d = null; }); // Null: the next drawRoutes always sets its own
        }));

        this.syncLit();
        return true;
    }

    crossfade(apply) { // Swap lines at once, cross-fading old and new drawings on the GPU
        if (still || !isDrawn()) return apply();
        ui.ghost?.remove();
        const shot = this.backdropAt?.f === view.frame && has(ui.backdrop, 'ready') && this.backdropAt.sig === this.backdropSig(); // The backdrop already pictures the old lines here
        const ghost = shot ? ui.backdrop : ui.ghost = ui.base.cloneNode(true); // The old drawing
        if (shot) { ghost.getAnimations().forEach(a => a.cancel()); ghost.style.transform = ''; ghost.classList.add('ghosting'); }
        else { ghost.setAttribute('class', 'map-ghost'); ui.dim.after(ghost); }
        ui.base.classList.add('swap'); // Routes change without their own fades, lanes without gliding
        this.noGlide = true;
        apply();
        this.fadePins();
        const hold = ui.base.animate([{ opacity: 0 }], { duration: 1, fill: 'forwards' }); // New drawing hidden until its lanes are in
        const go = () => {
            this.drawRoutes(view.frame.s);
            this.noGlide = false;
            ui.base.classList.remove('swap');
            hold.cancel();
            ui.base.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); // New lines in first
            ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 160, easing: 'ease-in', fill: 'both' }).finished.then(a => { // ...then the old ones out: no dip where they match
                if (shot) { ghost.classList.remove('ghosting'); a.cancel(); return; }
                ghost.remove();
                if (ui.ghost === ghost) ui.ghost = null;
            });
        };

        if (this.routeCache.has(this.viewKey(view.frame.s))) requestAnimationFrame(go);
        else Promise.race([this.geometry(view.frame.s), wait(800)]).then(() => requestAnimationFrame(go)); // Worked out first
    }

    static filled(at) { // Times for points no new line reaches: between their neighbours', else 0
        const known = at.flatMap((t, k) => t === null ? [] : [k]);
        if (!known.length) return at.map(() => 0);
        return at.map((t, k) => {
            if (t !== null) return t;
            const after = known.find(q => q > k), before = known.findLast(q => q < k);
            return before === undefined ? at[after] : after === undefined ? at[before] : at[before] + (at[after] - at[before]) * (k - before) / (after - before);
        });
    }

    static setD(el, d) { el.setAttribute('d', isDrawn() ? d : lean(d)); } // Full detail once drawn

    static pairUp(a, b, N) { // A line's old and new points matched up for a slide
        const A = toPts(a), B = toPts(b);
        if (A.length === B.length) { // Every Nth point, and the last
            const step = Math.max(1, Math.ceil(A.length / N)), idx = A.flatMap((_, k) => k % step && k !== A.length - 1 ? [] : [k]);
            return { a: idx.map(k => A[k]), b: idx.map(k => B[k]) };
        }

        const even = pts => { // N points spaced evenly by distance along the line
            const L = [0];
            for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
            const total = L.at(-1) || 1, out = [];
            for (let q = 0, k = 1; q < N; q++) {
                const want = total * q / (N - 1);
                while (k < pts.length - 1 && L[k] < want) k++;
                const f = L[k] > L[k - 1] ? Math.min(1, Math.max(0, (want - L[k - 1]) / (L[k] - L[k - 1]))) : 0;
                out.push([pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]);
            }

            return out;
        };

        return { a: even(A), b: even(B) };
    }

    finishGlide() { // Jump a running glide to its end
        if (!this.glide) return;
        cancelAnimationFrame(this.glide.frame);
        this.glide.moves.forEach(({ els }) => els.forEach(el => MapView.setD(el, el._d)));
        this.glide = this.unzip = null;
        this.syncLit();
        ui.base.classList.remove('gliding');
    }

    glideLines(moves) { // Lines slide to their new lanes
        const t0 = this.unzip?.t0 ?? performance.now(), glide = this.glide = { moves }, MOVE = .45, LEAD = .05, end = Math.max(MapView.RESPACE_MS / 1000, ...moves.map(m => m.at ? Math.max(...m.at) + MOVE : 0));
        ui.base.classList.add('gliding');
        const step = now => { // One frame of the glide
            const sec = (now - t0) / 1000, e = ease(Math.min(1, (now - t0) / MapView.RESPACE_MS));
            if (sec >= end) return this.glide === glide && this.finishGlide(); // Done: every line at its new lanes
            moves.forEach(({ els, a, b, at }) => {
                const w = at ? at.map(q => ease(Math.min(1, Math.max(0, (sec - q + LEAD) / MOVE)))) : null; // Starting a beat before the new line arrives
                if (w && (w.every(v => v === 0) || (els.at(-1)._done === glide && w.every(v => v === 1)))) return; // Not reached yet, or already through: nothing to redraw
                if (w && w.every(v => v === 1)) els.at(-1)._done = glide;
                els.at(-1).setAttribute('d', pathOf(a.map((p, k) => { const f = w ? w[k] : e; return [p[0] + (b[k][0] - p[0]) * f, p[1] + (b[k][1] - p[1]) * f]; })));
            });

            this.syncLit();
            glide.frame = requestAnimationFrame(step);
        };

        glide.frame = requestAnimationFrame(step);
    }

    drawRoutes(s) { // Apply line geometry for the current view
        const key = this.viewKey(s), c = this.routeCache.get(key);
        if (!c) return this.geometry(s).then(() => this.viewKey(view.frame.s) === key && this.drawRoutes(view.frame.s)); // Lines stay as they are until the new layout arrives
        const glide = !still && !this.noGlide && this.lineKey && this.lineKey !== key && this.sameView(this.lineKey) === this.sameView(key); // Era change only
        const quiet = this.respacedFor === key && this.spacedAt === s; // Landed by respacing these very lines for this zoom
        this.respacedFor = null;
        if (this.lineKey !== key) this.finishGlide();
        this.lineKey = key;
        this.spacedAt = s;
        const moves = [];
        if (this.unzipNext && glide) { this.unzipNext = false; this.unzipPlan(c); this.gains(); reach.play((x, y) => this.arrivalAt(x, y), this.unzip.t0); } // The intro's flip
        MapView.lines().forEach(r => {
            const from = r.parts;
            r.parts = c.parts[r.i]; // Flat x, y numbers
            c.d[r.i].forEach((d, n) => {
                const els = r.els[n], a = from?.[n], b = r.parts[n];
                if (els[0]._d === d) return;
                els.forEach(el => { el._d = d; });
                if (quiet) return; // Already drawn this way: no second repaint
                if (glide && a && b && !(this.unzip && view.instant.has(r.i)) && (a.length !== b.length || a.some((v, k) => Math.abs(v - b[k]) > .03))) { // Lines whose lanes change slide, through 100 points at most; the intro's swapped-in lines land at once, as they were hidden till now
                    const N = this.unzip ? 240 : 100, move = { els, ...MapView.pairUp(a, b, N) };
                    if (this.unzip) move.at = MapView.filled(move.b.map(([x, y]) => this.arrivalAt(x, y))); // Each point moves as the new lines reach it
                    moves.push(move);
                }
                else els.forEach(el => MapView.setD(el, d));
            });
        });

        if (moves.length) this.glideLines(moves);
        this.syncLit(); // Lifted copies take the new lanes too
        idle(() => { if (this.picks?.key !== this.lineKey && this.lineKey === key) this.pickGrid(); }); // Ready for the pointer, at a quiet moment
        this.snapPins();
        this.lineGridFor(c, view.frame);
        this.backdrop();
        if (isDrawn()) { clearTimeout(this.otherTimer); this.otherTimer = setTimeout(() => idle(() => this.prepare(view.era === 'today' ? 'buildout' : 'today')), 800); } // The other era for this view, ready for a switch
        if (this.warmSig && this.warmSig !== this.warmKey()) { this.warmSig = this.warmKey(); clearTimeout(this.warmTimer); this.warmTimer = setTimeout(() => this.prewarm(), 1500); } // Era or types changed
    }

    backdropSig() { return `${this.lineKey}|${view.selected}|${view.city}`; } // What the backdrop shows

    backdrop() { // Once settled
        const c = this.routeCache.get(this.lineKey), f = view.frame;
        if (!f || !c || still || !this.backdropOn) return; // Not till the map is first moved by hand: made any sooner, it froze the screen as the video began
        const sig = this.backdropSig(), b = this.backdropAt;
        if (b?.sig === sig && (b.f === f || isMoving())) return; // Current
        ui.backdrop ??= ui.dim.parentNode.insertBefore(Object.assign(document.createElement('canvas'), { className: 'map-backdrop', ariaHidden: 'true' }), ui.dim);
        if (b?.sig !== sig) { ui.backdrop.classList.remove('ready'); this.backdropAt = null; } // Out of date: not shown until redrawn
        clearTimeout(this.backdropTimer);
        this.backdropTimer = setTimeout(() => idle(() => { // A quiet moment after it settles
            if (this.backdropSig() !== sig || view.frame !== f || isMoving()) return;
            const q = .5 * Math.min(2, dpr()), K = Lanes.K(f.s, this.homeS || f.s), k = Math.round(K * 40) / 40; // Half the screen's sharpness
            const casing = !this.inks && ui.base.querySelector('.casing'), { deep, commuter } = this.inks ??= { deep: casing ? getComputedStyle(casing).stroke : '#0a1c36', commuter: getComputedStyle(ui.map).getPropertyValue('--commuter').trim() || '#aab9cd' }, lit = r => { const g = r.els?.[0]?.[2]?.parentNode; return g && !has(g, 'gone', 'out') ? g : null; }; // Colours read once: reading them restyles the page
            const lines = [...view.regional.filter(net.regionalShown), ...view.routes.filter(r => net.shownAt(r.i))].map(r => { const g = lit(r); return g ? { i: r.i, color: r.lane === Lanes.EDGE ? commuter : r.color, w: r.w, alpha: has(g, 'off') ? .12 : 1, on: has(g, 'on') } : null; }).filter(Boolean);
            lanesThread.run({ ...c.job, kind: 'backdrop', area: { x0: f.x0 - f.vw, y0: f.y0 - f.vh, vw: 3 * f.vw, vh: 3 * f.vh }, scale: f.s * q, px: k * q, deep, lines }).then(({ bitmap }) => {
                if (!bitmap || this.backdropSig() !== sig || isMoving()) return bitmap?.close(); // Swapped only between moves
                ui.backdrop.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
                ui.backdrop.classList.add('ready', 'warming'); // Drawn faintly for a few frames: the graphics card takes the big picture now, while all is still, not mid-video or mid-drag
                const settle = n => n ? requestAnimationFrame(() => settle(n - 1)) : (ui.backdrop.classList.remove('warming'), this.backdropSig() === sig && (this.backdropAt = { sig, f }));
                settle(4);
            });
        }), 300);
    }

    backdropDue() { return !still && !!this.backdropOn && !!view.frame && this.routeCache.has(this.lineKey) && this.backdropAt?.sig !== this.backdropSig(); } // Its picture of the lines still to come: a big one to hand the graphics card

    backdropCovers(f) { // Whether the backdrop has lines everywhere frame f shows, at about the right size
        const b = this.backdropAt?.f, k = b && f.s / b.s;
        return !!b && has(ui.backdrop, 'ready') && k < 1.6 && k > 1 / 1.6 && f.x0 >= b.x0 - b.vw && f.y0 >= b.y0 - b.vh && f.x0 + f.vw <= b.x0 + 2 * b.vw && f.y0 + f.vh <= b.y0 + 2 * b.vh;
    }

    lineGridFor(c, f) { // Line density on screen for this view, then the names placed around it
        const ahead = view.switchAt != null && view.era === 'today' && !isDrawn(); // The intro: names also clear of the lines about to draw in, so none moves when they do
        const at = `${this.sameView(c.job.key).split('|')[0]}|${view.era}|${c.job.laid.length}|${f.s.toFixed(4)}|${f.x0.toFixed(1)}|${f.y0.toFixed(1)}|${ahead}`; // The view and the lines shown
        if (this.gridAt === at) { this.arrangeSoon(); return this.gridReady; }
        this.gridAt = at;
        this.gridDue = true; // Names wait for it: placed once, around these lines
        const grid = d => lanesThread.run({ ...d.job, s: f.s, kind: 'grid', view: { x0: f.x0, y0: f.y0, vw: f.vw, vh: f.vh } });
        return this.gridReady = Promise.all([grid(c), ahead && this.withEra('buildout', () => this.geometry(f.s, f)).then(grid)]).then(([g, next]) => {
            if (this.gridAt !== at) return;
            this.gridDue = false;
            view.lineGrid = new Map(g.grid);
            for (const [k, n] of next?.grid || []) view.lineGrid.set(k, (view.lineGrid.get(k) || 0) + n);
            this.arrangeSoon();
        });
    }

    warmKey() { return `${view.era}|${view.types}|${view.legend}`; } // What the precomputed views depend on

    prewarm() { // Precompute route views while idle
        const run = this.warmRun = (this.warmRun || 0) + 1;
        this.warmSig = this.warmKey();
        const jobs = [...view.groups.values()].filter(ids => !view.routes[ids[0]].context).map(ids => ids.find(net.shownAt)).filter(i => i !== undefined).map(i => ({ cam: camera.forRoute(i) }));
        const step = deadline => { // One job per idle moment
            const job = jobs.shift();
            if (!job || !view.frame || run !== this.warmRun) return; // Done, or superseded
            if (isMoving() || document.hidden || view.hover !== null || deadline.timeRemaining() < 15) { jobs.unshift(job); return idle(step); } // Wait for a quiet moment
            const f = camera.frameFor({ ...job.cam, left: view.legend ? 1 : 0 }, camera.measure());
            this.geometry(f.s, f).then(() => jobs.length && idle(step)); // One layout at a time, so the thread stays free for the view on screen
        };

        idle(step);
    }

    // Station labels
    pinSizes() { // Dot radius and label size per station
        const key = `${MapView.pageKey()}|${view.fontsReady}`, zKey = `${key}|${view.z}`; // Zoomed-out letter spacing changes names by a hair
        if (view.sizeKey !== key) Object.assign(view, { sizeKey: key, names: this.measureNames() }); // Measured once per page size, unscaled
        if (view.zKey !== zKey) {
            view.zKey = zKey;
            const z = view.z ?? 1;
            view.sizes = new Map(view.pinList.map(p => { const c = pinClass(p), k = MapView.NAME[c](z), [w, h] = view.names.get(p); return [p, { r: this.dotR(c, z), w: w * k, h: h * k }]; }));
        }

        return view.sizes;
    }

    measureNames() { // Each station name's size, from its font
        const ctx = this.measureCtx ??= document.createElement('canvas').getContext('2d'), fonts = {};
        for (const c of ['L', 'M', 'S']) {
            const p = MapView.sample(c), cs = p && getComputedStyle(p.lastChild);
            if (cs) fonts[c] = { font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, gap: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing, size: parseFloat(cs.fontSize) };
        }

        return new Map(view.pinList.map(p => {
            const f = fonts[pinClass(p)], name = p.dataset.city;
            if (!f) return [p, [0, 0]];
            ctx.font = f.font;
            ctx.letterSpacing = f.gap;
            const text = place(name), spaced = 'letterSpacing' in ctx ? 0 : text.length * parseFloat(f.gap); // Older Safari can't space a canvas's letters: added by hand
            return [p, [Math.ceil(ctx.measureText(text).width + spaced + (view.cities[name]?.airport ? f.size * 1.1 : 0)), Math.round(f.size * 1.25)]]; // Airports: the plane after it
        }));
    }

    absorb(pins) { // Hide a twin under its main dot
        const named = new Map(pins.map(p => [p.dataset.city, p]));
        const waiting = new Set([...this.filling || []].map(q => q.dataset.city)), own = t => !waiting.has(t) && !(view.era === 'today' && ownStatus(t) === 'Under construction') && (view.served[t] || []).some(net.shownAt); // Its trains stop here: not yet at one being built, nor at one the intro's new lines haven't reached
        const lead = c => { const all = twinsOf(c); return all.length < 2 || own(mainOf(c)) ? mainOf(c) : all.find(own) ?? all.find(t => !waiting.has(t) && view.served[t]?.length) ?? mainOf(c); }; // The twin this era's trains call at, else the one waiting trains used: Detroit is New Center till the new line reaches Michigan Central
        const twin = p => { const c = p.dataset.city, main = lead(c) !== c && !view.split?.has(c) && named.get(lead(c)); return main && !has(main, 'out') ? main : null; }; // One stop: its leading dot stands for it at any zoom
        for (const p of pins) {
            const under = !has(p, 'out') && !!twin(p);
            if (has(p, 'absorbed') !== under) p.classList.toggle('absorbed', under);
        }
    }

    arrangeSoon() { if (!this.arrangeDue) { this.arrangeDue = true; queueMicrotask(() => { this.arrangeDue = false; this.arrangeStationLabels(); }); } } // Labels once per task, at its end, however many changes ask

    arrangeStationLabels(ahead) { // Pick a side for each label
        if (!ahead && (isMoving() || this.gridDue)) return; // Mid-move the dots aren't where they'll land
        const { W, H } = view.frame, all = (view.pinList || []).filter(p => !has(p, 'gone') && p._x > -60 && p._y > -60 && p._x < W + 60 && p._y < H + 60), size = this.pinSizes(); // Dots on screen
        this.absorb(all);
        const pins = all.filter(p => !has(p, 'absorbed'));
        const ends = new Set(view.routes.filter(net.shown).flatMap(r => [r.stops[0], r.stops.at(-1)])), lines = p => p._lines ?? net.uniqueGroups(net.routesAt(p.dataset.city)).length; // Route ends
        const rank = p => (has(p, 'picked') ? 0 : 3) + (has(p, 'size-L') ? 0 : has(p, 'size-M') ? 1 : 2) - Math.min(lines(p), 9) * .1; // Picked, then L, M, S: busiest first
        const wide = ahead ? ahead.wide : has(ui.map, 'wide'), far = ahead ? ahead.far : has(ui.map, 'far'); // Zoomed out, then out toward the whole country
        const labeled = p => has(p, 'lit', 'picked') || (has(p, 'size-L') && (!far || lines(p) > 1 || ends.has(p.dataset.city))) || (has(p, 'size-M') && pageW() > 960 && !wide); // Far out: only hubs and route ends among the big stations
        const chosen = pins.filter(labeled).sort((a, b) => rank(a) - rank(b) || a.dataset.city.localeCompare(b.dataset.city));
        const memo = this.labelMemo?.frame === view.frame && this.labelMemo.size === size && this.labelMemo.grid === view.lineGrid ? this.labelMemo
            : this.labelMemo = { frame: view.frame, size, grid: view.lineGrid, sides: new Map() }; // Reset when the view changes
        const key = `${view.era}|${view.types}|${pins.length}|` + chosen.map(p => p.dataset.city + (has(p, 'picked') ? '*' : '')).join('|');
        const sides = remember(memo.sides, key, () => this.pickLabelSides(pins, chosen, size));
        const gone = p => p._x < 0 || p._y < 0 || p._x > view.frame.W || p._y > view.frame.H; // Off screen where the move lands
        const sideOf = new Map(chosen.map((p, n) => [p, sides[n] ?? ''])); // Big stations left out hide their names too
        const moved = pins.filter(p => sideOf.has(p) || has(p, 'size-L')).map(p => [p, sideOf.get(p) ?? '']).filter(([p, side]) => p._side !== side && !(ahead && !side && gone(p))); // Write only what changed
        const where = (p, side) => MapView.spot(side, size.get(p)); // Name's corner beside its dot
        const glide = !still && has(document.body, 'ready') && (ahead || !isMoving()) ? moved.filter(([p, side]) => p._side && side && !has(p, 'squeezed')).map(([p, side]) => [p, where(p, p._side), where(p, side)]) : []; // Names already showing slide over
        moved.forEach(([p, side]) => {
            p._side = side;
            LABEL_SIDES.forEach(k => p.classList.toggle('at-' + k, side === k));
            p.classList.toggle('squeezed', !side);
        });

        const z = view.z ?? 1; // Name scale: the slide happens inside it
        glide.forEach(([p, [x, y], [nx, ny]]) => {
            p.lastChild._glide?.cancel(); // A glide still running: this one takes over
            if (Math.abs(x - nx) + Math.abs(y - ny) <= 1) return;
            const k = MapView.NAME[pinClass(p)](z);
            const a = p.lastChild._glide = p.lastChild.animate([{ transform: `translate(${((x - nx) / k).toFixed(1)}px, ${((y - ny) / k).toFixed(1)}px)` }, { transform: 'none' }], { duration: ahead?.time ?? 380, easing: 'cubic-bezier(.3, 0, .2, 1)', fill: 'forwards' });
            if (ahead) { a.pause(); ahead.out.push(a); } // Over the whole move, stepped with the dots
            else a.onfinish = () => { if (p.lastChild._glide === a) { a.cancel(); p.lastChild._glide = null; } }; // Done: let go
        });

        for (const copy of ui.litPins?.children || []) if (copy._src && copy.className !== copy._src.className) copy.className = copy._src.className; // Hovered route's stops keep the same label sides
    }

    labelsAhead(f, time) { // Before a camera move
        const pos = view.pinList.map(p => [p._x, p._y]), saved = view.frame, ahead = { time, out: [], wide: f.s < (this.homeS || f.s) * .55, far: f.s < (this.wholeS || 0) * 1.6 }; // As zoomClasses decides them
        view.pinList.forEach(p => { p._x = (p._wx - f.x0) * f.s; p._y = (p._wy - f.y0) * f.s; });
        view.frame = f;
        try { this.arrangeStationLabels(ahead); } finally { view.frame = saved; view.pinList.forEach((p, k) => { [p._x, p._y] = pos[k]; }); }
        return ahead.out;
    }

    pickLabelSides(pins, chosen, size) { // Side per chosen label
        const { W, H, top, gap, s } = view.frame, placed = []; // Label boxes already placed
        const visible = b => b.x0 >= gap * s + 4 && b.x1 <= W - 4 && b.y0 >= top && b.y1 <= H - 4; // Box fully on screen
        const lines = b => { // Line density under a box
            let n = 0;
            for (let x = Math.floor(b.x0 / 10); x <= Math.floor(b.x1 / 10); x++) for (let y = Math.floor(b.y0 / 10); y <= Math.floor(b.y1 / 10); y++) n += view.lineGrid?.get(x * 4096 + y) || 0;
            return n;
        };

        const CELL = 64, cells = new Map(); // Dots bucketed in a coarse grid, so each check only looks nearby
        const each = (b, fn) => { for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++) for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) fn(x * 4096 + y); };
        pins.forEach(p => { const r = size.get(p).r, d = { p, ...box(p._x - r - 2, p._y - r - 2, 2 * r + 4, 2 * r + 4) }; each(d, k => bucket(cells, k).push(d)); });
        const onDot = (b, p) => { let hit = false; each(b, k => { hit ||= (cells.get(k) || []).some(o => o.p !== p && overlaps(b, o)); }); return hit; }; // Box covers another dot
        return chosen.map(p => {
            const d = size.get(p), spots = Object.fromEntries(LABEL_SIDES.map(k => { const [dx, dy] = MapView.spot(k, d); return [k, box(p._x + dx, p._y + dy, d.w, d.h)]; }));

            const free = k => visible(spots[k]) && !placed.some(o => overlaps(spots[k], o)); // Spot on screen and not over another label
            const cost = k => lines(spots[k]) + LABEL_SIDES.indexOf(k) * .5, cheapest = list => list.sort((a, b) => cost(a) - cost(b))[0]; // Spot crossing the fewest lines
            const stay = list => list.includes(p._side) && cost(p._side) <= cost(list[0]) * 1.5 + 6 ? p._side : list[0]; // Keep its side unless it's now clearly worse
            const open = LABEL_SIDES.filter(k => free(k) && !onDot(spots[k], p)), any = has(p, 'size-L', 'picked') ? LABEL_SIDES.filter(free) : [];
            const side = open.length ? (cheapest(open), stay(open)) : any.length ? (cheapest(any), stay(any)) : undefined;
            if (side) placed.push(spots[side]);
            return side;
        });
    }

    snapPins() { // Stations sit on their own lines
        const lock = view.selected !== null ? net.members(view.selected).filter(net.shownAt) : [], key = `${lock}|${this.lineKey}`;
        if (this.snapKey === key || !view.pinList || !this.lineKey) return;
        this.snapKey = key;
        const { cell, grid, segs } = this.picks?.key === this.lineKey ? this.picks : this.pickGrid(), s = this.spacedAt || view.frame.s, picked = new Set(lock.flatMap(i => view.routes[i].stops));
        this.snapAt = { key, lock, picked, cell, grid, segs, s };
        for (const p of view.pinList) if (!p._away || picked.has(p.dataset.city)) this.snapOne(p); // Off screen: snapped once it comes on, camera.placePins
        if (view.frame && !camera.flying) camera.placePins(camera.pinFrame || view.frame); // Where the dots are showing now
    }

    fresh(p) { if (this.snapAt && p._snapped !== this.snapAt.key) this.snapOne(p); } // A dot coming on screen: onto its lines, if they've moved since

    snapOne(p) { // One station onto its own lines
        const { key, lock, picked, cell, grid, segs, s } = this.snapAt;
        p._snapped = key;
        p._hx ??= p._wx; p._hy ??= p._wy; // Its true spot
        const c = p.dataset.city, mine = picked.has(c) ? lock : net.routesAt(c), reach = Math.max((mine === lock ? 40 : 24) / s, mine.some(i => MapView.endsAt(view.routes[i], c)) ? 7 : 2.6), n = Math.ceil(reach / cell); // Within about 24px, or about 3 km close up
        const cx = Math.floor(p._hx / cell), cy = Math.floor(p._hy / cell);
        const near = new Map(); // Nearest point on each of its lines
        if (mine.length) MapView.around(grid, cx, cy, n, k => {
            const o = k * 5, r = view.routes[segs[o]];
            if (!mine.includes(segs[o])) return;
            const ax = segs[o + 1], ay = segs[o + 2], dx = segs[o + 3] - ax, dy = segs[o + 4] - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p._hx - ax) * dx + (p._hy - ay) * dy) / l)) : 0;
            const qx = ax + dx * t, qy = ay + dy * t, d = (qx - p._hx) ** 2 + (qy - p._hy) ** 2;
            if (d < reach * reach && !(near.get(r.lane)?.d <= d)) { const l1 = Math.sqrt(l) || 1; near.set(r.lane, { d, x: qx, y: qy, w: r.w, dx: dx / l1, dy: dy / l1, through: t > 0 && t < 1 ? 1 : 0, ends: MapView.endsAt(r, c) }); }
        });

        const found = [...near.values()], first = found.reduce((a, q) => (!a || q.d < a.d ? q : a), null);
        const lead = found.filter(q => q.d <= (first?.d ?? 0) + (12 / s) ** 2).reduce((a, q) => (!a || q.through > a.through ? q : a), null) || first; // Square to a line running on through here
        const nx = lead ? -lead.dy : 0, ny = lead ? lead.dx : 0, across = q => (q.x - first.x) * nx + (q.y - first.y) * ny; // Measured across the lines
        const over = first ? found.filter(q => Math.abs(across(q)) <= 12 / s && (q.ends || Math.abs((q.x - first.x) * first.dx + (q.y - first.y) * first.dy) <= 30 / s)) : []; // Its lines running together here
        let ends = null; // Its two outermost lines here, side to side
        for (const a of over) for (const b of over) { const d = (across(a) - across(b)) ** 2; if (a !== b && (!ends || d > ends.d)) ends = { a, b, d }; }
        if (ends) { const m = (across(ends.a) + across(ends.b)) / 2; ends.mid = [first.x + nx * m, first.y + ny * m]; ends.rot = Math.atan2(ny, nx); } // Square across the lines, centred between the outer two
        const to = { x: ends ? ends.mid[0] : over.length ? over[0].x : p._hx, y: ends ? ends.mid[1] : over.length ? over[0].y : p._hy, span: 0, rot: 0 }; // Centred over the lines that stop here
        const span = ends && pinClass(p) === 'S' ? Math.sqrt(ends.d) : 0; // A small station on several lines: a capsule across them all
        const K = Lanes.K(s, this.homeS || s), lineW = ends ? 5 * Math.max(ends.a.w, ends.b.w) * K : 0, wide = span * s + lineW; // Across its lines, edge to edge
        if (wide >= 10.5 * K || wide > 2 * this.dotR('S', this.zAt(s)) - 1) Object.assign(to, { span, rot: ends.rot }); // From two state-supported lines' width up, or wherever a round dot wouldn't cover them
        clearTimeout(p._wait);
        const at = this.unzip && (Math.abs(to.x - p._wx) + Math.abs(to.y - p._wy) > .3 / s || Math.abs(to.span - (p._span || 0)) * s > .5) ? this.arrivalAt(to.x, to.y) : null, wait = at === null ? 0 : at - this.sinceFlip();
        if (wait > .1) p._wait = later(wait - .05, () => this.shapePin(p, to, s, true)); // Moves when the intro's new lines reach it
        else this.shapePin(p, to, s);
    }

    shapePin(p, to, s, live) { // A dot to its spot on its lines, round or a capsule across them
        const dot = p.firstChild, from = p._t;
        [p._wx, p._wy] = [to.x, to.y];
        if (to.span) Object.assign(dot.style, { width: `calc(100% + ${(to.span * s).toFixed(1)}px)`, marginLeft: `${(-to.span * s / 2).toFixed(1)}px`, rotate: `${(to.rot * 180 / Math.PI).toFixed(1)}deg`, borderRadius: '999px' });
        else if (p._span) Object.assign(dot.style, { width: '', marginLeft: '', rotate: '', borderRadius: '' });
        [p._span, p._rot] = [to.span, to.rot];
        if (!live || !view.frame || camera.flying) return;
        const f = camera.pinFrame || view.frame, t = `translate(${((to.x - f.x0) * f.s).toFixed(0)}px, ${((to.y - f.y0) * f.s).toFixed(0)}px)`;
        if (from && from !== t && p._on) p.animate([{ transform: from }, { transform: t }], { duration: 400, easing: 'cubic-bezier(.3, .1, .2, 1)' });
        p.style.transform = p._t = t;
    }

    unzipPlan(c) { // When the intro's new lines reach each spot
        const cell = 20 / c.job.s, grid = new Map(), keyOf = (x, y) => Math.floor(x / cell) * 65536 + Math.floor(y / cell);
        for (const r of view.routes) {
            if (!net.shownAt(r.i) || net.inEra('today', r)) continue; // New in the buildout
            (c.parts[r.i] || []).forEach((f, n) => {
                const el = r.els[n]?.[2], d = parseFloat(el?.style.getPropertyValue('--d')) || 0, t = parseFloat(el?.style.getPropertyValue('--t')) || 0;
                if (d < 0) return; // Swapped in at once, not drawn
                const pts = toPts(f), total = lengthOf(pts);
                for (let k = 1, L = 0; k < pts.length; k++) { // Points a quarter cell apart, each with the moment the line reaches it
                    const [[ax, ay], [bx, by]] = [pts[k - 1], pts[k]], l = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(l / (cell / 4)));
                    for (let q = 0; q < steps; q++) { const x = ax + (bx - ax) * q / steps, y = ay + (by - ay) * q / steps; bucket(grid, keyOf(x, y)).push(x, y, d + (total ? (L + l * q / steps) / total : 0) * t); }
                    L += l;
                }
            });
        }

        this.unzip = { t0: performance.now(), grid, cell, keyOf, reach: 18 / c.job.s };
    }

    gains() { // The intro's new stations fill in and ripple as their lines arrive
        this.filling = new Set((view.pinList || []).filter(p => has(p, 'idle') && net.routesAt(p.dataset.city).length));
        for (const p of this.filling) {
            const at = this.arrivalAt(p._wx, p._wy) ?? 0;
            later(Math.max(0, at - this.sinceFlip()), () => { this.filling.delete(p); p.classList.toggle('idle', !net.routesAt(p.dataset.city).length); if (view.twins.has(p.dataset.city)) this.arrangeSoon(); });
        }

        if ([...this.filling].some(p => view.twins.has(p.dataset.city))) this.arrangeSoon(); // A twin still waiting: the old one stays on show

        if (still) return;
        const today = new Set(view.routes.filter(r => net.inEra('today', r)).flatMap(r => r.stops).flatMap(twinsOf));
        for (const p of view.pinList || []) {
            const c = p.dataset.city;
            if (net.stateIdOf(c) !== view.focus || today.has(c) || !net.routesAt(c).length || has(p, 'gone', 'absorbed')) continue;
            const at = this.arrivalAt(p._wx, p._wy);
            if (at === null) continue;
            later(Math.max(0, at - this.sinceFlip()), () => {
                if (isDrawn() || !p.isConnected) return;
                p.firstChild.animate([{ boxShadow: '0 0 0 0 rgb(255 255 255 / .85)' }, { boxShadow: '0 0 0 16px rgb(255 255 255 / 0)' }], { duration: 1100, easing: 'ease-out', iterations: 2 }); // A ring ripples out
                p.lastChild.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: .3 }, { transform: 'scale(1)' }], { duration: 1000, easing: 'ease-out' }); // ...and its name pops
            });
        }
    }

    sinceFlip() { return (performance.now() - this.unzip.t0) / 1000; } // Seconds since the intro's new lines began

    arrivalAt(x, y) { // When the intro's new lines first reach this spot
        const { grid, cell, keyOf, reach } = this.unzip;
        let best = null;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const list = grid.get(keyOf(x + i * cell, y + j * cell)) || [];
            for (let k = 0; k < list.length; k += 3) if (Math.abs(list[k] - x) < reach && Math.abs(list[k + 1] - y) < reach && (best === null || list[k + 2] < best)) best = list[k + 2];
        }

        return best;
    }

    refocus(id) { // Feature another state, as Ohio is by default
        if (id === view.focus) return;
        this.drawFocus(net.focusOn(id));
        view.home = camera.home(true);
        view.pinList.forEach(p => { p._ctx = +net.contextOnly(p.dataset.city); });
        view.pinList.sort((a, b) => b._ctx - a._ctx || b._size - a._size); // Featured stations on top again
        ui.pins.append(...view.pinList);
        Object.assign(sidebar, { scope: 'focus', lists: null }); // Rebuilt with the state's name
        sidebar.build();
        reach.update();
        const url = new URL(location.href);
        url.searchParams.set('state', id);
        history.replaceState(null, '', url); // A shared link features it too
        Object.assign(view, { selected: null, city: null, hover: null, zoom: null, back: null, wide: false });
        this.focusRoutesAndStations();
        camera.move();
        clearTimeout(this.warmTimer);
        this.warmTimer = setTimeout(() => this.prewarm(), 1500); // Its routes' views, ready ahead
    }

    at(e) { const f = view.frame, r = this.mapRect ??= rectOf(ui.map), { x, y } = toPage(e); return [f.x0 + (x - r.left) / f.s, f.y0 + (y - r.top) / f.s]; } // Pointer -> map coordinates

    routeAt(e) { // The line under the pointer, from the drawn lines
        const f = view.frame, picks = f && this.picks?.key === this.lineKey ? this.picks : f && this.lineKey && this.pickGrid();
        if (!picks) return null;
        const p = this.at(e), reach = (e.pointerType === 'touch' ? 22 : 12) / f.s, { cell, grid, segs } = picks, n = Math.ceil(reach / cell), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
        let best = null, near = reach;
        MapView.around(grid, cx, cy, n, k => {
            const o = k * 5, i = segs[o], el = this.routeEls.get(i);
            if (i === best || !el || has(el, 'gone', 'out')) return;
            const d = segDist(p, [segs[o + 1], segs[o + 2]], [segs[o + 3], segs[o + 4]]) + (i >= view.routes.length ? 4 / f.s : 0); // An Amtrak line beside a commuter one wins
            if (d < near) { near = d; best = i; }
        });

        return best;
    }

    pickGrid() { // The drawn lines' segments by grid cell
        const s = this.spacedAt || view.frame.s, cell = 24 / s, step = 3 / s, grid = new Map(), segs = []; // Points 3px apart are plenty for a 12px reach
        for (const r of MapView.lines()) for (const f of r.parts || []) for (let k = 2, ax = f[0], ay = f[1]; k + 1 < f.length; k += 2) {
            const bx = f[k], by = f[k + 1], n = segs.length / 5;
            if (k + 3 < f.length && Math.abs(bx - ax) + Math.abs(by - ay) < step) continue;
            segs.push(r.i, ax, ay, bx, by);
            for (let x = Math.floor(Math.min(ax, bx) / cell); x <= Math.floor(Math.max(ax, bx) / cell); x++) for (let y = Math.floor(Math.min(ay, by) / cell); y <= Math.floor(Math.max(ay, by) / cell); y++) bucket(grid, x * 65536 + y).push(n);
            ax = bx; ay = by;
        }

        return this.picks = { key: this.lineKey, cell, grid, segs: Float64Array.from(segs) };
    }

    pinAt(e, tight) { // The dot under the pointer, from the dots' spots
        if (!view.pinList || !view.frame || !e.clientX && !e.clientY) return null;
        const r = this.mapRect ??= rectOf(ui.map), { x, y } = toPage(e), px = x - r.left, py = y - r.top, far = has(ui.map, 'far');
        let best = null, near = Infinity, top = null;
        for (const p of view.pinList) {
            const dx = p._x - px, dy = p._y - py;
            if (!p._on || dx > 40 || dx < -40 || dy > 40 || dy < -40 || has(p, 'gone', 'out', 'absorbed') || (far && !has(p, 'size-L') && !has(p, 'picked', 'ping'))) continue; // Far out, a hovered line's small stops show but don't take the pointer
            const r = view.sizes?.get(p)?.r || 6, d = dx * dx + dy * dy, reach = tight ? r + (e.pointerType === 'touch' ? 8 : 3) : Math.max(e.pointerType === 'touch' ? 20 : 12, r + 2);
            if (d <= r * r) top = p; // Right on its dot: the last such is drawn on top, so a big station over a small one wins
            if (d < reach * reach && d <= near) { near = d; best = p; } // Ties: the later dot, drawn on top
        }

        return top ?? best;
    }

    under(e) { const tight = this.pinAt(e, true), i = tight ? null : this.routeAt(e); return tight ? [tight, null] : i !== null ? [null, i] : [this.pinAt(e), null]; } // What the pointer is on: [dot, line]

    setHot(pin) { if (this.hot !== pin) { this.hot?.classList.remove('hot'); (this.hot = pin)?.classList.add('hot'); } } // The hovered dot: on top, named, ringed

    pinTip(pin) { // A station's tooltip
        const key = `${pin.dataset.city}|${view.era}|${view.types}|${view.split?.has(pin.dataset.city)}`;
        if (this.pinTipKey === key) return this.pinTipHTML;
        const c = pin.dataset.city, today = view.era === 'today', tag = tagOf(c);
        const about = has(pin, 'building') ? `<em class="building-text">${esc(ownStatus(c))}</em>` : net.gap(c) ? '<em>No service planned</em>'
            : !net.routesAt(c).length ? `<em>${today && seasonal(c) ? 'Seasonal stop' : this.commuterAt(c) ? `Commuter rail${today ? '' : ' planned'}` : `No service ${today ? 'today' : 'planned'}`}</em>` // No intercity trains
            : `<em>${plural(net.uniqueGroups(net.routesAt(c)).length, 'route')}${tag ? ` · ${esc(tag)}` : ''}</em>`;
        this.pinTipKey = key;
        return this.pinTipHTML = `<strong>${nameHTML(c, view.split?.has(c))}</strong>${about}`;
    }

    stateAt(e) { const p = this.at(e); return view.allStates.find(st => p[0] >= st.box[0] && p[0] <= st.box[1] && p[1] >= st.box[2] && p[1] <= st.box[3] && insideRings(p, st.rings))?.id.toUpperCase(); } // State under the pointer

    // Highlight state
    locked() { return view.trip ? view.trip.legs.map(l => l.i) : view.conn ? trips.network(view.conn.from, view.conn.era, view.conn.once).routes : view.selected !== null ? net.members(view.selected) : view.city ? net.routesAt(view.city) : null; } // The trip's, picked route's or station's routes

    commuterAt(c) { return remember(this.commuters ??= new Map(), `${c}|${view.era}`, () => net.commuter(c, view.era)); } // Commuter trains there in the era shown: not dashed

    focusRoutesAndStations() { // Highlight/dim routes and stations
        if (view.city && !net.routesAt(view.city).length) view.city = null;
        const lock = this.locked(), active = view.hover !== null ? net.members(view.hover) : lock; // Stations off the lock disappear
        const split = view.split = net.split((active || []).filter(net.shownAt)); // Twins the routes in view call at both of: told apart
        const stopsOf = ids => new Set((ids || []).flatMap(i => view.routes[i].stops).flatMap(n => split.has(n) ? [n] : twinsOf(n))); // Stops of routes
        const lockStops = view.trip ? new Set(view.trip.legs.flatMap(l => l.calls).flatMap(twinsOf)) : view.conn ? new Set([...trips.network(view.conn.from, view.conn.era, view.conn.once).stops].flatMap(twinsOf)) : stopsOf(lock), stops = active === lock ? lockStops : stopsOf(active); // A trip: only the stations it passes
        (this.lineGroups || []).forEach(g => { // Map lines follow the selection only
            if (g.dataset.r) { g.classList.toggle('gone', !net.regionalShown(view.regional[g.dataset.r])); return g.classList.toggle('off', !!lock); } // Commuter lines: by era, stepping back for a selection
            const i = +g.dataset.i, on = !lock || lock.includes(i);
            toggles(g, { gone: !net.shownAt(i), on: lock && on, off: !on });
            if (has(g, 'route')) g.classList.toggle('out', !on);
        });

        const ends = new Set((view.trip ? [view.trip.from, view.trip.to] : view.conn ? [view.conn.from] : []).flatMap(twinsOf)); // A trip's two ends, or where connections start
        (view.pinList || []).forEach(p => { // Hover only changes the hovered route's dots
            const c = p.dataset.city, away = lock && !lockStops.has(c), none = !net.routesAt(c).length;
            toggles(p, { out: away, gone: none && has(p, 'size-S'), lit: active && stops.has(c), off: away, picked: c === view.city || ends.has(c), full: split.has(c), // Always show medium and large stations
                building: view.era === 'today' && ownStatus(c), // Its own: Detroit's New Center isn't hollow for Michigan Central being built
                idle: !has(p, 'unplanned') && (none && !this.commuterAt(c) || (this.unzipNext || this.filling?.has(p)) && has(p, 'idle')) }); // No trains in this era: dashed, kept so through the intro's flip till its lines arrive
        });

        sidebar.highlight(active);
        this.snapPins();
        this.backdrop();
        if (view.frame) this.arrangeSoon();
        this.liftHovered();
        card.show();
    }

    liftHovered() { // A picked or hovered route
        if (!ui.litLines) {
            ui.dim.after(ui.litLines = svg('svg', { class: 'map-lit', 'aria-hidden': 'true' }));
            ui.pins.after(ui.litPins = Object.assign(document.createElement('div'), { className: 'pins-lit', ariaHidden: 'true' }));
        }

        const hover = view.hover !== null, lock = this.locked() || [];
        const ids = new Set(isDrawn() ? [...(hover ? net.members(view.hover) : []), ...lock].filter(net.shownAt) : []), lit = [ui.litLines, ui.litPins]; // Not while lines draw in
        ui.dim.classList.toggle('dim', ids.size > 0); // Its wrapper fades: an SVG fading itself repaints every line
        ui.pins.classList.toggle('dim', hover);
        if (this.liftTimer) this.liftTimer = clearTimeout(this.liftTimer);
        if (ids.size) {
            this.litPairs = [];
            const rides = new Set(view.trip?.legs.map(l => l.i));
            const lines = [...(view.trip ? this.tripLines() : []), ...this.lineGroups.filter(g => g.tagName !== 'DIV' && ids.has(+g.dataset.i) && !rides.has(+g.dataset.i) && !g.dataset.r).map(g => { // Glows, casings, then lines
                const copy = this.liftOf(g, true);
                [...g.children].forEach((el, k) => this.litPairs.push([el, copy.children[k]]));
                return copy;
            })];

            ui.litLines.setAttribute('viewBox', ui.base.getAttribute('viewBox'));
            ui.litLines.style.cssText = ui.base.style.cssText; // Same line widths and camera transform
            ui.litLines.replaceChildren(...lines);
            ui.litPins.replaceChildren(...(hover ? (view.pinList || []).filter(p => has(p, 'lit') && !has(p, 'out', 'gone') && !has(p, 'absorbed')).map(p => Object.assign(p.cloneNode(true), { _src: p })) : []));
            lit.forEach(el => el.classList.remove('fading'));
        } else if (lit.some(el => el.firstChild)) {
            this.litPairs = [];
            lit.forEach(el => el.classList.add('fading')); // Fade out while the layers below come back
            this.liftTimer = setTimeout(() => { this.liftTimer = 0; lit.forEach(el => el.replaceChildren()); }, 300);
        }
    }

    liftOf(g, deep) { const copy = g.cloneNode(deep); copy.setAttribute('class', g.classList[0] + (has(g, 'soon') ? ' soon' : '') + ' on'); return copy; } // A line group's lifted copy: a funded route's dashed too

    syncLit() { // The lifted copies follow their lines' new lanes
        for (const [src, copy] of this.litPairs || []) { const d = src.getAttribute('d'); if (copy.getAttribute('d') !== d) copy.setAttribute('d', d); }
        for (const [el, l] of view.trip ? this.tripLit || [] : []) { const cut = this.legPath(l); if (cut) el.setAttribute('d', cut.d); }
    }

    legPath(l) { // The stretch of a route a trip rides: the drawn part passing nearest both its ends, cut there
        const parts = view.routes[l.i].parts || [], a = net.cityXY(l.from), b = net.cityXY(l.to);
        const near = (f, q) => { let at = 0, d = Infinity; for (let k = 0; k < f.length; k += 2) { const e = (f[k] - q[0]) ** 2 + (f[k + 1] - q[1]) ** 2; if (e < d) [at, d] = [k, e]; } return [at, d]; };
        let best = null;
        parts.forEach((f, n) => { const [i, di] = near(f, a), [j, dj] = near(f, b); if (!best || di + dj < best.d) best = { n, d: di + dj, i: Math.min(i, j), j: Math.max(i, j) }; });
        if (!best) return null;
        const pts = toPts(parts[best.n].slice(best.i, best.j + 2));
        return { n: best.n, d: pathOf(pts.length > 1 ? pts : [pts[0], pts[0]]) };
    }

    tripLines() { // A trip's lifted lines: only the stretches it rides, glows, casings, then lines
        this.tripLit = [];
        return this.lineGroups.filter(g => g.tagName !== 'DIV' && !g.dataset.r).flatMap(g => view.trip.legs.filter(l => l.i === +g.dataset.i).map(l => {
            const cut = this.legPath(l), copy = this.liftOf(g, false);
            if (!cut) return copy;
            const el = g.children[cut.n].cloneNode(false);
            el.setAttribute('d', cut.d);
            copy.append(el);
            this.tripLit.push([el, l]);
            return copy;
        }));
    }

    // Selection
    focusRoute(i) { // Select a route and zoom to it
        const trip = view.trip || view.conn;
        [view.selected, view.trip, view.conn] = [i, null, null];
        if (i === view.zoom && !trip) return;
        if (view.zoom == null && !trip) view.back = { ...view.cam };
        view.zoom = i;
        camera.move();
    }

    selectRoute(i) { // Select a route
        const back = view.backTo, was = view.selected; // A route or trip opened from a station's window
        if (back && (back.to || back.conn ? i !== null : i === null ? was === null || !net.siblings(back.route).includes(was) : !net.siblings(back.route).includes(i))) view.backTo = null; // Somewhere else since: forgotten
        if (i !== null) this.stepAside();
        view.city = view.hover = null;
        this.focusRoute(i);
        this.focusRoutesAndStations();
        this.fadePins(); // Lines dim and brighten by their layer's own transition
        if (i === null && view.backTo) { const { station, to } = view.backTo; view.backTo = null; stationModal.open(station); if (to) stationModal.tripTo(to); } // Closed: back to the station it was opened from
    }

    showTrip(t, station) { this.showPlan({ trip: t }, t.era, t.legs.map(l => l.i), station && { station, to: t.to }); } // A trip's routes and stations, its plan in the card
    showConn(c, station) { this.showPlan({ conn: c }, c.era, trips.network(c.from, c.era, c.once).routes, station && { station, conn: true }); } // Everywhere a station reaches

    showPlan(plan, era, rides, back) { // A trip or a station's reach on the map, turning on what it needs
        const need = {}, off = rides.map(i => view.routes[i].typeKey).filter(k => !net.hasType(k));
        if (off.length) need.types = TYPES.filter(k => net.hasType(k) || off.includes(k)).join(' ');
        if (era !== view.era) need.era = era;
        this.stepAside();
        if (view.zoom == null && !view.trip && !view.conn) view.back = { ...view.cam };
        Object.assign(view, { trip: null, conn: null, ...plan, selected: null, zoom: null, city: null, hover: null, backTo: back || null });
        if (Object.keys(need).length) controls.setView(need);
        else { this.focusRoutesAndStations(); camera.move(); }
        this.fadePins();
    }

    fadePins() { if (isDrawn() && !still) ui.pins.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' }); } // Dots changed at once: one fade for the whole layer

    reset() { this.selectRoute(null); } // Clear the selection
    stepAside() { if (pageW() <= NARROW && view.legend) { view.legend = false; sidebar.sync(); } } // A phone: the list steps aside for the map and its card
    hoverRoute(i) { // Highlight the hovered route
        if (i === view.hover) return;
        view.hover = i;
        clearTimeout(this.prefetchTimer);
        if (i !== null) this.prefetchTimer = setTimeout(() => relief.prefetch(i), 400); // Lingered on: likely the next click, so its population map starts loading; not for every line the pointer crosses
        this.hoverFrame ||= requestAnimationFrame(() => { this.hoverFrame = 0; this.focusRoutesAndStations(); });
    }

    hoverLocal(l) { // A hovered commuter line glows
        if (this.hotLocal === (this.hotLocal = l?.label ?? null)) return;
        this.lineGroups.forEach(g => { if (g.dataset.r) g.classList.toggle('hot', view.regional[g.dataset.r].label === this.hotLocal); });
    }

    tip(text, e) { // Hover tooltip: only what changed is written, each write restyling it
        if (ui.tip.hidden !== !text) ui.tip.hidden = !text;
        if (!text) return;
        if (ui.tip._html !== text) ui.tip.innerHTML = ui.tip._html = text;
        const { x, y } = toPage(e), at = `${x}px ${y}px`;
        if (ui.tip._at !== at) ui.tip.style.translate = ui.tip._at = at;
    }

    bind() { // Map lines and station dots
        const wake = () => { if (this.backdropOn) return; this.backdropOn = true; this.backdrop(); }; // First hand on the map: its backdrop for panning
        ['pointerdown', 'wheel', 'touchstart'].forEach(t => ui.map.addEventListener(t, wake, { passive: true, capture: true }));
        introFinished.then(() => later(3, () => ui.map.addEventListener('pointerover', wake, { passive: true, once: true }))); // Or just passing over, so it's ready before the first drag: not while the video starts
        $$('[data-zoom]').forEach(b => b.addEventListener('click', wake));
        let moved = null; // Latest pointer move, handled once per frame
        ui.map.addEventListener('pointermove', e => {
            if (!moved) requestAnimationFrame(() => { const ev = moved; moved = null; if (ev) this.pointerMove(ev); });
            moved = e;
        });

        ui.map.addEventListener('pointerleave', () => { moved = null; this.tip(); this.hoverRoute(null); this.hoverLocal(null); this.setHot(null); ui.map.classList.remove('pointing'); });
        this.pointerMove = e => {
            const idle = !isMoving() && e.pointerType !== 'touch', [pin, hit] = idle ? this.under(e) : [null, null];
            const local = hit >= view.routes.length ? view.regional[hit - view.routes.length] : null, i = local ? null : hit; // A commuter line, or a route
            this.setHot(pin);
            if (has(ui.map, 'pointing') !== (!!pin || i !== null)) ui.map.classList.toggle('pointing', !!pin || i !== null);
            this.hoverRoute(i);
            this.hoverLocal(pin ? null : local);
            if (pin) return this.tip(this.pinTip(pin), e);
            if (local) return this.tip(`<span class="swatch" style="--c:var(--commuter)"></span><strong>${esc(local.name)}</strong><em>${esc(local.operator)}</em>`, e);
            if (i === null) return this.tip();
            const key = `${i}|${view.era}|${view.types}`; // Tooltip text is built once per route and view
            if (this.tipKey !== key) {
                const r = view.routes[i], stops = new Set(net.members(i).filter(net.shownAt).flatMap(m => view.routes[m].stops)).size;
                this.tipKey = key;
                this.tipHTML = `<span class="swatch" style="--c:${r.color}"></span><strong>${esc(r.label)}</strong><em>${esc(statusText(r.status, r))} · ${plural(stops, 'stop')}</em>`;
            }

            this.tip(this.tipHTML, e);
        };

        ui.map.addEventListener('click', e => { // A dot opens its station, a line selects it, another state gets featured, empty map clears
            if (!isDrawn()) return;
            const [pin, i] = this.under(e);
            if (pin) { this.tip(); return stationModal.open(pin.dataset.city); }
            if (i !== null && i < view.routes.length) { this.tip(); return this.selectRoute(i !== view.selected ? i : null); }
            if (i !== null) return; // A commuter line: nothing
            const id = view.frame && this.stateAt(e);
            if (id && id !== view.focus) this.refocus(id);
            else if (view.selected !== null || view.city || view.trip || view.conn) this.reset();
            else if (id) { Object.assign(view, { back: null, wide: false }); camera.move(); } // The featured state again: back to its own view
        });
    }
}