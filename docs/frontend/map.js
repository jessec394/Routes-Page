// Map drawing
const LABEL_SIDES = ['right', 'bottom', 'left', 'top', 'top-right', 'top-left', 'bottom-right', 'bottom-left']; // Label spots, in order of preference

class MapView {
    routeCache = new Map(); // Line geometry per view
    pending = new Map(); // Views whose lines are being worked out
    static RESPACE_MS = 700; // Lane glide duration
    static DOT = { L: [1.15, 1.15], M: [.8, .73], S: [.55, .25] }; // Dot width in rem at zoom z: a + b * z (styles.css --dot)
    static NAME = { L: z => (.76 + .29 * z) / 1.05, M: z => (.72 + .12 * z) / .84, S: z => (.72 - .04 * z) / .68 }; // Name scale at zoom z

    render(data) { // Build the whole map from network.json
        const focus = net.load(data);
        lanesThread.start([...view.routes, ...view.regional]); // (Commuter lines numbered on from the routes)
        view.home = camera.home();
        const linked = START_ROUTE && view.routes.find(r => slug(r.label) === slug(START_ROUTE) || slug(r.name) === slug(START_ROUTE));
        if (linked) Object.assign(view, { linked, era: statusKind(linked.status) === 'temporary' ? 'today' : 'buildout', selected: linked.i, zoom: linked.i });
        else if (!still) { view.wide = true; document.body.classList.add('flat'); } // Intro opens on the whole country (intro.js zooms in); its lines are already drawn
        view.cam = camera.target();

        const { plan, startOf, drawn, fromFlip } = intro.plan();
        [ui.static, ui.edge] = ['map-static', 'map-edge'].map((c, n) => [ui.static, ui.edge][n] ?? ui.base.parentNode.insertBefore(svg('svg', { class: c, 'aria-hidden': 'true' }), ui.base)); // Own layers: not repainted by hover/draw-in
        this.drawFocus(focus);
        relief.load(data.density);
        ui.base.replaceChildren(...this.routeLayers(plan));
        ui.pins.replaceChildren(...this.stationDots(data.cities, this.stationDrawTimes(drawn, startOf, fromFlip)));
        view.pinList = [...ui.pins.children];
        this.snapKey = null; // (New dots: snapped afresh)
        this.lineGroups = $$('.route, .glow, .under'); // Cached for focusRoutesAndStations
        sidebar.build();
        programs.build();
        controls.sync();
        this.layout();
        this.focusRoutesAndStations();
        if (view.switchAt != null && !view.wide) this.prepare('buildout'); // Precompute the flip during the splash (intro.js does it after an overview)
    }

    prepare(era) { // Precompute another era's lines for this view
        const was = view.era;
        view.era = era;
        try { this.precompute(view.frame); net.colorsFor(); } finally { view.era = was; }
    }

    precompute(f) { this.geometry(f.s, f); } // Cache a view's lines

    drawFocus(focus) { // The states, the focus state's fill, and its outline and glow
        const states = svg('g'), defs = svg('defs');
        defs.innerHTML = ['blue', 'sky'].map(c => `<radialGradient id="fade-${c}" class="fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"><stop offset=".55"/><stop offset="1" stop-opacity="0"/></radialGradient>`).join(''); // States fade toward the edges (camera.draw centres it): far cheaper than a mask
        view.allStates.filter(st => st !== focus).forEach(st => states.append(svg('path', { d: ringsPath(st.rings), class: 'state', 'data-id': st.id })));
        ui.static.replaceChildren(defs, states, svg('path', { d: ringsPath(focus.rings), class: 'state focus', 'data-id': focus.id }));
        const edge = ringsPath(focus.rings);
        ui.edge.replaceChildren(...[8, 7, 6, 5, 4, 3, 2, 1].map(g => svg('path', { d: edge, class: 'focus-glow', style: `--g:${g}` })), svg('path', { d: edge, class: 'focus-edge', 'data-id': focus.id })); // Glow: a few soft strokes (far cheaper to redraw than a blur)
        camera.fades = null; // (New gradients: found afresh)
    }

    recolor() { // Lines and the sidebar take the routes' colors for this view
        this.lineGroups.forEach(g => { if (g.dataset.i) g.style.setProperty('--c', view.routes[g.dataset.i].color); });
        $$('[data-i]', ui.legendBody).forEach(b => b.style.setProperty('--c', view.routes[b.dataset.i].color));
    }

    routeLayers(plan) { // SVG for every route, over the commuter lines
        const layers = ['glow', 'under', 'route'].map(() => svg('g'));
        this.routeEls = new Map(); // Each route's line group, by route (routeAt checks it still shows)
        [...view.regional, ...view.routes].forEach(r => {
            const local = r.lane === Lanes.EDGE, style = local ? `--c:var(--commuter);--w:${r.w}` : `--c:${r.color};--w:${r.w}`, extra = local ? ' regional' : view.instant.has(r.i) ? ' no-fade' : '';
            const [glow, under, line] = ['glow', 'under', 'route'].map((n, l) => layers[l].appendChild(svg('g', { class: n + extra, [local ? 'data-r' : 'data-i']: local ? r.k : r.i, style })));
            this.routeEls.set(r.i, line);
            const start = local ? 0 : plan.get(r.i); // (Commuter lines don't draw in: they fade with their era)
            let done = 0;
            r.els = r.runs.map(run => {
                const len = lengthOf(run), timing = { pathLength: 1, style: `--d:${(start + done / r.speed).toFixed(2)}s;--t:${(len / r.speed).toFixed(2)}s` };
                done += len;
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
            r.runs.forEach(run => {
                const start = startOf(r) + before / r.speed;
                r.stops.forEach(name => {
                    const p = net.cityXY(name);
                    if (!p || skip.has(name)) return;
                    let along = 0, best = 6, at = null;
                    for (let k = 1; k < run.length; k++) {
                        const a = run[k - 1], b = run[k], len = dist(a, b), d = segDist(p, a, b);
                        if (d < best) { best = d; at = along + Math.max(0, Math.min(len, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len || 1))); }
                        along += len;
                    }

                    if (at !== null) reached[name] = Math.min(reached[name] ?? Infinity, start + at / r.speed);
                });

                before += lengthOf(run);
            });
        });

        time(drawn.filter(r => !fromFlip.has(r.i)), new Set());
        time(drawn.filter(r => fromFlip.has(r.i)), new Set(Object.keys(reached)));
        return reached;
    }

    stationDots(cities, reached) { // Station dot buttons (medium and large ones even with no route: places still to connect)
        const rank = { L: 0, M: 1, S: 2 };
        const context = new Set(cities.filter(c => net.contextOnly(c.name)).map(c => c.name)); // Drawn first, so featured stations sit on top
        return cities.filter(c => twinsOf(c.name).some(n => view.served[n]) || sizeOf(c) !== 'S').sort((a, b) => context.has(b.name) - context.has(a.name) || rank[sizeOf(b)] - rank[sizeOf(a)]).map(c => {
            const pin = document.createElement('button'), [x, y] = view.xy([c.lon, c.lat]);
            pin.className = `pin size-${sizeOf(c)}`;
            Object.assign(pin.dataset, { city: c.name, x, y });
            Object.assign(pin, { _wx: x, _wy: y, _ctx: +context.has(c.name), _size: rank[sizeOf(c)] }); // For absorb()
            pin.style.setProperty('--appear', `${(reached[c.name] ?? 0).toFixed(2)}s`);
            const paren = c.name.slice(place(c.name).length).trim(); // A twin's own part of its name: shown only when a route calls at both
            pin.innerHTML = `<i></i><span>${nameHTML(c.name)}${paren && view.twins.has(c.name) ? `<b class="paren"> ${esc(paren)}</b>` : ''}</span>`;
            pin.setAttribute('aria-label', `${place(c.name)}, ${plural(net.uniqueGroups(twinsOf(c.name).flatMap(n => view.served[n] || [])).length, 'route')}`);
            return pin;
        });
    }

    layout(same) { // Redraw for the current camera (same: page size unchanged, no re-measuring mid-animation)
        if (!view.cam) return;
        ui.map.classList.remove('panning'); // (Backdrop away: everything drawn for this view)
        this.mapRect = null; // (Measured again on the next pointer move)
        if (camera.trip) { cancelAnimationFrame(view.tween); camera.land(); } // A jump: any camera move ends here
        const m = same ? camera.quick() : camera.measure(), f = camera.frameFor(view.cam, m), { s } = f;
        if (view.topH !== m.topH) document.body.style.setProperty('--top', `${view.topH = m.topH}px`);
        this.zoomClasses(f, m);
        camera.applyFrame(f);
        view.frame = f;
        camera.placePins(f);
        const key = this.viewKey(s), settle = () => { // Lines land with the new view: one repaint
            this.drawRoutes(s);
            ui.map.classList.remove('moving');
        };

        clearTimeout(view.settleTimer);
        if (!view.placed || this.routeCache.has(key)) settle(); // Precomputed (or first draw): no need to wait
        else view.settleTimer = setTimeout(settle, 120); // Wait for resizing to stop
        view.placed = true;
        if (!ui.map.classList.contains('moving')) this.arrangeSoon();
    }

    zoomClasses(f, m, quiet) { // Dot styles for how far out the view is (quiet: no layer fade, a camera move fades its own)
        const home = camera.frameFor({ ...view.cam, ...view.home }, m).s, whole = camera.frameFor({ ...view.cam, ...camera.network() }, m).s;
        ui.map.classList.toggle('wide', f.s < home * .55); // Zoomed well out: smaller dots and names
        if (ui.map.classList.contains('far') !== f.s < whole * 1.6) { ui.map.classList.toggle('far'); if (!quiet) this.fadePins(); } // Out near the whole country: medium and small stations hidden
        this.homeS = home;
        this.wholeS = whole;
        this.grow(f.s);
    }

    zAt(s) { // 1 at the local view and closer, 0 well out, below 0 out toward the whole country (smaller still)
        const r = s / (this.homeS || s), t = Math.min(1, Math.max(0, Math.log(r / .3) / Math.log(1 / .3)));
        return +(r >= .3 ? t * t * (3 - 2 * t) : -.35 * Math.min(1, Math.log(.3 / r) / Math.log(2))).toFixed(3);
    }

    grow(s, force) { // Dots and names scale with the zoom (applyZ); camera moves scale them on the GPU instead (flyPins)
        if (camera.flying && !force) return;
        const z = Math.round(this.zAt(s) * 40) / 40; // Steps too small to see: fewer restyles
        if (z === view.z) return;
        view.z = z;
        this.applyZ(); // Dots on screen now; the rest when the map settles (camera.placePins)
    }

    applyZ(pins = (view.pinList || []).filter(p => p._on)) { // Size dots and names for the zoom, per dot in plain properties (custom ones restyle many times slower)
        const z = view.z ?? 1;
        if (this.dotKey !== `${pageW()}|${pageH()}`) pins = view.pinList || []; // New page size: all of them (dotR measures)
        for (const p of pins) {
            if (p._z === z && p._zk === this.dotKey) continue;
            const c = pinClass(p), fixed = this.dotR(c, z, true);
            p._z = z;
            p._zk = this.dotKey;
            p.style.width = p.style.height = fixed ? '' : `${(2 * this.dotR(c, z)).toFixed(2)}px`; // (Small screens: fixed in styles.css)
            p.lastChild.style.scale = MapView.NAME[c](z).toFixed(4);
            if (c === 'L') p.firstChild.style.borderWidth = fixed ? '' : `${(2.5 + .5 * z).toFixed(2)}px`;
        }
    }

    dotR(c, z, fixed) { // Dot radius in pixels at zoom z (fixed: whether small screens fix it instead)
        const key = `${pageW()}|${pageH()}`;
        if (this.dotKey !== key && view.pinList?.length) { // Read from the styles once per page size
            this.dotKey = key;
            this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
            this.dotFixed = {};
            for (const k of ['L', 'M', 'S']) {
                const p = (view.pinList || []).find(q => pinClass(q) === k), v = p && getComputedStyle(p).getPropertyValue('--dot').trim(); // A formula, or a fixed size
                if (v && !v.includes('calc')) this.dotFixed[k] = parseFloat(v) * (v.endsWith('rem') ? this.rem : 1);
            }
        }

        if (fixed) return c in (this.dotFixed || {});
        return (this.dotFixed?.[c] ?? (MapView.DOT[c][0] + MapView.DOT[c][1] * z) * this.rem) / 2;
    }

    // Route geometry
    viewKey(s, f = view.frame) { const { W, H } = f; return `${view.types}|${view.era}|${s.toFixed(4)}|${W}x${H}`; } // Cache key for a zoom's lines (not where the view sits: a drag reuses them)
    sameView(key) { return key.split('|').filter((_, n) => n !== 1).join('|'); } // Key without the era

    geometry(s, f = view.frame) { // Promise of a view's laid-out lines (cached; worked out by lanesThread)
        const key = this.viewKey(s, f);
        if (this.routeCache.has(key)) return Promise.resolve(this.routeCache.get(key));
        if (this.pending.has(key)) return this.pending.get(key);
        const big = $$('.pin.size-L:not(.gone)', ui.pins), radius = this.dotR('L', this.zAt(s)); // L dot size at that zoom (no layout to wait for)
        const job = this.geometryJob = { key, s, laid: [...view.routes.filter(net.shown), ...view.regional.filter(net.regionalShown)].map(r => r.i), ctx: { radius, home: this.homeS || s, majors: big.map(p => [+p.dataset.x, +p.dataset.y]) } };
        const promise = lanesThread.run(job).then(c => {
            this.pending.delete(key);
            return remember(this.routeCache, key, () => ({ ...c, job }));
        });
        this.pending.set(key, promise);
        return promise;
    }

    respace(s) { // Mid-zoom: lanes kept the same distance apart on screen until the move settles and the full layout lands
        const c = this.routeCache.get(this.lineKey);
        if (!c?.spread || this.glide || Math.abs(Math.log(s / (this.spacedAt || s))) < .15) return; // Within 15%: under a pixel off, not worth restyling every line
        this.spacedAt = s;
        [...view.routes, ...view.regional].forEach(r => c.spread[r.i].forEach((b, n) => {
            if (!b) return;
            const pts = [];
            for (let k = 0; k < b.length / 10; k++) pts.push(Lanes.at(b, k, s, c.radius, c.home));
            const d = pathOf(pts);
            r.els[n].forEach(el => { el.setAttribute('d', d); el._d = null; }); // Null: the next drawRoutes always sets its own
        }));
    }

    crossfade(apply) { // Swap lines at once, cross-fading old and new drawings on the GPU (fades and glides repaint per frame)
        if (still || !document.body.classList.contains('drawn')) return apply();
        ui.ghost?.remove();
        const shot = this.backdropAt?.f === view.frame && has(ui.backdrop, 'ready') && this.backdropAt.sig === this.backdropSig(); // The backdrop already pictures the old lines here: it stands in (copying hundreds of lines doubled the drawing)
        const ghost = shot ? ui.backdrop : ui.ghost = ui.base.cloneNode(true); // The old drawing
        if (shot) { ghost.getAnimations().forEach(a => a.cancel()); ghost.style.transform = ''; ghost.classList.add('ghosting'); }
        else { ghost.setAttribute('class', 'map-ghost'); ui.base.after(ghost); }
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
            ui.base.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); // New lines in first...
            ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 160, easing: 'ease-in', fill: 'both' }).finished.then(a => { // ...then the old ones out: no dip where they match
                if (shot) { ghost.classList.remove('ghosting'); a.cancel(); return; }
                ghost.remove();
                if (ui.ghost === ghost) ui.ghost = null;
            });
        };

        if (this.routeCache.has(this.viewKey(view.frame.s))) requestAnimationFrame(go);
        else Promise.race([this.geometry(view.frame.s), wait(800)]).then(() => requestAnimationFrame(go)); // Worked out first (on the background thread)
    }

    finishGlide() { // Jump a running glide to its end
        if (!this.glide) return;
        cancelAnimationFrame(this.glide.frame);
        this.glide.moves.forEach(({ els }) => els.forEach(el => el.setAttribute('d', el._d)));
        this.glide = null;
    }

    glideLines(moves) { // Lines slide to their new lanes
        const t0 = performance.now(), glide = this.glide = { moves };
        const step = now => { // One frame of the glide
            const t = Math.min(1, (now - t0) / MapView.RESPACE_MS), e = ease(t);
            moves.forEach(({ els, a, b }) => {
                const d = t === 1 ? els[0]._d : pathOf(a.map((p, k) => [p[0] + (b[k][0] - p[0]) * e, p[1] + (b[k][1] - p[1]) * e]));
                els.forEach(el => el.setAttribute('d', d));
            });

            if (t < 1) glide.frame = requestAnimationFrame(step);
            else if (this.glide === glide) this.glide = null;
        };

        glide.frame = requestAnimationFrame(step);
    }

    drawRoutes(s) { // Apply line geometry for the current view
        const key = this.viewKey(s), c = this.routeCache.get(key);
        if (!c) return this.geometry(s).then(() => this.viewKey(view.frame.s) === key && this.drawRoutes(view.frame.s)); // Lines stay as they are until the new layout arrives
        const glide = !still && !this.noGlide && this.lineKey && this.lineKey !== key && this.sameView(this.lineKey) === this.sameView(key); // Era change only
        if (this.lineKey !== key) this.finishGlide();
        this.lineKey = key;
        this.spacedAt = s;
        const moves = [];
        [...view.routes, ...view.regional].forEach(r => {
            const from = r.parts;
            r.parts = c.parts[r.i]; // (Flat x, y numbers)
            c.d[r.i].forEach((d, n) => {
                const els = r.els[n], a = from?.[n], b = r.parts[n];
                if (els[0]._d === d) return;
                els.forEach(el => { el._d = d; });
                if (glide && a && a.length === b.length && a.some((v, k) => Math.abs(v - b[k]) > .03)) { // Lines whose lanes change slide, through 100 points at most (cheap)
                    const n = a.length / 2, step = Math.max(1, Math.ceil(n / 100)), idx = [];
                    for (let k = 0; k < n; k += step) idx.push(k);
                    if (idx.at(-1) !== n - 1) idx.push(n - 1);
                    moves.push({ els, a: idx.map(k => [a[2 * k], a[2 * k + 1]]), b: idx.map(k => [b[2 * k], b[2 * k + 1]]) });
                }
                else els.forEach(el => el.setAttribute('d', d));
            });
        });

        if (moves.length) this.glideLines(moves);
        if (view.hover !== null) this.liftHovered(); // Hovered copies take the new lanes too
        idle(() => { if (this.picks?.key !== this.lineKey && this.lineKey === key) this.pickGrid(); }); // Ready for the pointer, at a quiet moment
        this.snapPins();
        this.lineGridFor(c, view.frame);
        this.backdrop();
        if (document.body.classList.contains('drawn')) { clearTimeout(this.otherTimer); this.otherTimer = setTimeout(() => idle(() => this.prepare(view.era === 'today' ? 'buildout' : 'today')), 800); } // The other era for this view, ready for a switch
        if (this.warmSig && this.warmSig !== this.warmKey()) { this.warmSig = this.warmKey(); clearTimeout(this.warmTimer); this.warmTimer = setTimeout(() => this.prewarm(), 1500); } // Era or types changed: precompute the new views once the change has played
    }

    backdropSig() { return `${this.lineKey}|${view.selected}|${view.city}`; } // What the backdrop shows (where it sits doesn't date it)

    backdrop() { // Once settled: backdrop of the lines around the view, drawn off the page (shown at a drag's edges)
        const c = this.routeCache.get(this.lineKey), f = view.frame;
        if (!f || !c || still) return;
        const sig = this.backdropSig(), b = this.backdropAt;
        if (b?.sig === sig && (b.f === f || ui.map.classList.contains('moving'))) return; // Current (or a move is on: kept till it settles)
        ui.backdrop ??= ui.base.parentNode.insertBefore(Object.assign(document.createElement('canvas'), { className: 'map-backdrop', ariaHidden: 'true' }), ui.base);
        if (b?.sig !== sig) { ui.backdrop.classList.remove('ready'); this.backdropAt = null; } // Out of date: not shown until redrawn (one that's only elsewhere still helps)
        clearTimeout(this.backdropTimer);
        this.backdropTimer = setTimeout(() => idle(() => { // A quiet moment after it settles
            if (this.backdropSig() !== sig || view.frame !== f || ui.map.classList.contains('moving')) return;
            const q = .5 * Math.min(2, dpr()), K = Lanes.K(f.s, this.homeS || f.s), k = Math.round(K * 40) / 40; // Half the screen's sharpness; line widths as camera.draw sets them
            const casing = ui.base.querySelector('.casing'), deep = casing ? getComputedStyle(casing).stroke : '#0a1c36';
            const commuter = getComputedStyle(ui.map).getPropertyValue('--commuter').trim() || '#aab9cd', lit = r => { const g = r.els?.[0]?.[2]?.parentNode; return g && !has(g, 'gone', 'out') ? g : null; };
            const lines = [...view.regional.filter(net.regionalShown), ...view.routes.filter(r => net.shownAt(r.i))].map(r => { const g = lit(r); return g ? { i: r.i, color: r.lane === Lanes.EDGE ? commuter : r.color, w: r.w, alpha: has(g, 'off') ? .12 : 1, on: has(g, 'on') } : null; }).filter(Boolean);
            lanesThread.run({ ...c.job, kind: 'backdrop', area: { x0: f.x0 - f.vw, y0: f.y0 - f.vh, vw: 3 * f.vw, vh: 3 * f.vh }, scale: f.s * q, px: k * q, deep, lines }).then(({ bitmap }) => {
                if (!bitmap || this.backdropSig() !== sig || ui.map.classList.contains('moving')) return bitmap?.close(); // (Swapped only between moves)
                ui.backdrop.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
                ui.backdrop.classList.add('ready');
                this.backdropAt = { sig, f };
            });
        }), 300);
    }

    backdropCovers(f) { // Whether the backdrop has lines everywhere frame f shows, at about the right size
        const b = this.backdropAt?.f, k = b && f.s / b.s;
        return !!b && has(ui.backdrop, 'ready') && k < 1.6 && k > 1 / 1.6 && f.x0 >= b.x0 - b.vw && f.y0 >= b.y0 - b.vh && f.x0 + f.vw <= b.x0 + 2 * b.vw && f.y0 + f.vh <= b.y0 + 2 * b.vh;
    }

    lineGridFor(c, f) { // Line density on screen for this view (worked out on the background thread), then the names placed around it
        const at = `${c.job.key}|${f.x0.toFixed(1)}|${f.y0.toFixed(1)}`;
        if (this.gridAt === at) { this.arrangeSoon(); return this.gridReady; }
        this.gridAt = at;
        return this.gridReady = lanesThread.run({ ...c.job, kind: 'grid', view: { x0: f.x0, y0: f.y0, vw: f.vw, vh: f.vh } }).then(g => {
            if (this.gridAt !== at) return;
            view.lineGrid = new Map(g.grid);
            this.arrangeSoon();
        });
    }

    warmKey() { return `${view.era}|${view.types}|${view.legend}`; } // What the precomputed views depend on

    prewarm() { // Precompute route views while idle (restarts on era or type changes)
        const run = this.warmRun = (this.warmRun || 0) + 1;
        this.warmSig = this.warmKey();
        const views = [...[...view.groups.values()].filter(ids => !view.routes[ids[0]].context).map(ids => ids.find(net.shownAt)).filter(i => i !== undefined).map(i => ({ cam: camera.forRoute(i) }))];
        const jobs = [...views];
        const step = deadline => { // One job per idle moment
            const job = jobs.shift();
            if (!job || !view.frame || run !== this.warmRun) return; // Done, or superseded
            if (ui.map.classList.contains('moving') || document.hidden || view.hover !== null || deadline.timeRemaining() < 15) { jobs.unshift(job); return idle(step); } // Wait for a quiet moment
            const f = camera.frameFor({ ...job.cam, left: view.legend ? 1 : 0 }, camera.measure());
            this.geometry(f.s, f).then(() => jobs.length && idle(step)); // One layout at a time, so the thread stays free for the view on screen
        };

        idle(step);
    }

    // Station labels
    pinSizes() { // Dot radius and label size per station (names measured once; both follow the zoom)
        const key = `${pageW()}|${pageH()}|${view.fontsReady}`, zKey = `${key}|${view.z}`; // (Zoomed-out letter spacing changes names by a hair: not worth a re-measure)
        if (view.sizeKey !== key) { // Measured once per page size: later zooms work them out, no layout to wait for
            view.sizeKey = key;
            view.names = this.measureNames(); // Unscaled (scale doesn't change layout)
        }

        if (view.zKey !== zKey) {
            view.zKey = zKey;
            const z = view.z ?? 1;
            view.sizes = new Map(view.pinList.map(p => { const c = pinClass(p), k = MapView.NAME[c](z), [w, h] = view.names.get(p); return [p, { r: this.dotR(c, z), w: w * k, h: h * k }]; }));
        }

        return view.sizes;
    }

    measureNames() { // Each station name's size, from its font (dots off screen aren't laid out at all, so they can't be measured)
        const ctx = this.measureCtx ??= document.createElement('canvas').getContext('2d'), fonts = {};
        for (const c of ['L', 'M', 'S']) {
            const p = view.pinList.find(q => pinClass(q) === c), cs = p && getComputedStyle(p.lastChild);
            if (cs) fonts[c] = { font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, gap: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing, size: parseFloat(cs.fontSize) };
        }

        return new Map(view.pinList.map(p => {
            const f = fonts[pinClass(p)], name = p.dataset.city;
            if (!f) return [p, [0, 0]];
            ctx.font = f.font;
            ctx.letterSpacing = f.gap;
            return [p, [Math.ceil(ctx.measureText(place(name)).width + (view.cities[name]?.airport ? f.size * 1.1 : 0)), Math.round(f.size * 1.25)]]; // (Airports: the plane after it)
        }));
    }

    absorb(pins, size) { // Hide a dot under a bigger or featured one covering it, and a twin under its main one
        const kept = new Map(), outranks = (q, p) => q._size < p._size || q._ctx < p._ctx; // Bigger, or featured over context
        const named = new Map(pins.map(p => [p.dataset.city, p])), near = (q, p, k) => Math.hypot(q._x - p._x, q._y - p._y) < k;
        const twin = p => { const c = p.dataset.city, main = mainOf(c) !== c && !view.split?.has(c) && named.get(mainOf(c)); return main && !has(main, 'out') ? main : null; }; // One stop: its main dot stands for it at any zoom
        const cell = 64, cellOf = (x, y) => Math.floor(x / cell) * 65536 + Math.floor(y / cell), covers = (p, r) => { // A kept dot nearby covers it (kept dots by grid cell: not every pair)
            const cx = Math.floor(p._x / cell), cy = Math.floor(p._y / cell);
            for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const q of kept.get(x * 65536 + y) || []) if (outranks(q, p) && near(q, p, size.get(q).r + r * .3)) return true;
            return false;
        };

        [...pins].sort((a, b) => a._ctx - b._ctx || a._size - b._size).forEach(p => {
            const r = size.get(p).r, under = !has(p, 'out') && (!!twin(p) || covers(p, r)); // Mostly covered
            if (!under && !has(p, 'out')) { const k = cellOf(p._x, p._y); (kept.get(k) ?? kept.set(k, []).get(k)).push(p); }
            if (has(p, 'absorbed') !== under) p.classList.toggle('absorbed', under);
        });
    }

    arrangeSoon() { if (!this.arrangeDue) { this.arrangeDue = true; queueMicrotask(() => { this.arrangeDue = false; this.arrangeStationLabels(); }); } } // Labels once per task, at its end, however many changes ask (each pass measures every dot)

    arrangeStationLabels(ahead) { // Pick a side for each label (remembered per view); ahead: for where a camera move lands (labelsAhead)
        if (!ahead && ui.map.classList.contains('moving')) return; // Mid-move the dots aren't where they'll land: placed for it beforehand, settled after (layout)
        const { W, H } = view.frame, all = (view.pinList || []).filter(p => !p.classList.contains('gone') && p._x > -60 && p._y > -60 && p._x < W + 60 && p._y < H + 60), size = this.pinSizes(); // Dots on screen (the rest keep theirs)
        this.absorb(all, size);
        const pins = all.filter(p => !has(p, 'absorbed'));
        const ends = new Set(view.routes.filter(net.shown).flatMap(r => [r.stops[0], r.stops.at(-1)])), lines = p => p._lines ?? net.uniqueGroups(net.routesAt(p.dataset.city)).length; // Route ends; routes calling
        const rank = p => (has(p, 'picked') ? 0 : 3) + (has(p, 'size-L') ? 0 : has(p, 'size-M') ? 1 : 2) - Math.min(lines(p), 9) * .1; // Picked, then L, M, S: busiest first
        const wide = ahead ? ahead.wide : ui.map.classList.contains('wide'), far = ahead ? ahead.far : ui.map.classList.contains('far'); // (Zoomed out, then out toward the whole country)
        const labeled = p => has(p, 'lit', 'picked') || (has(p, 'size-L') && (!far || lines(p) > 1 || ends.has(p.dataset.city))) || (has(p, 'size-M') && pageW() > 960 && !wide); // Far out: only hubs and route ends among the big stations
        const chosen = pins.filter(labeled).sort((a, b) => rank(a) - rank(b) || a.dataset.city.localeCompare(b.dataset.city));
        const memo = this.labelMemo?.frame === view.frame && this.labelMemo.size === size && this.labelMemo.grid === view.lineGrid ? this.labelMemo
            : this.labelMemo = { frame: view.frame, size, grid: view.lineGrid, sides: new Map() }; // Reset when the view changes
        const key = `${view.era}|${view.types}|${pins.length}|` + chosen.map(p => p.dataset.city + (has(p, 'picked') ? '*' : '')).join('|');
        const sides = remember(memo.sides, key, () => this.pickLabelSides(pins, chosen, size));
        const gone = p => p._x < 0 || p._y < 0 || p._x > view.frame.W || p._y > view.frame.H; // Off screen where the move lands: keeps its name while it flies out
        const sideOf = new Map(chosen.map((p, n) => [p, sides[n] ?? ''])); // Big stations left out (far out) hide their names too
        const moved = pins.filter(p => sideOf.has(p) || has(p, 'size-L')).map(p => [p, sideOf.get(p) ?? '']).filter(([p, side]) => p._side !== side && !(ahead && !side && gone(p))); // Write only what changed
        const where = (p, side) => { const { r, w, h } = size.get(p), k = r * .71 + 2; return { right: [r + 6, -h / 2], left: [-r - 6 - w, -h / 2], bottom: [-w / 2, r + 2], top: [-w / 2, -r - 2 - h], 'top-right': [k, -k - h], 'top-left': [-k - w, -k - h], 'bottom-right': [k, k], 'bottom-left': [-k - w, k] }[side]; }; // Name's corner beside its dot (as pickLabelSides boxes it): worked out, not measured, so no layout to wait for
        const glide = !still && document.body.classList.contains('ready') && (ahead || !ui.map.classList.contains('moving')) ? moved.filter(([p, side]) => p._side && side && !has(p, 'squeezed')).map(([p, side]) => [p, where(p, p._side), where(p, side)]) : []; // Names already showing slide over
        moved.forEach(([p, side]) => {
            p._side = side;
            LABEL_SIDES.forEach(k => p.classList.toggle('at-' + k, side === k));
            p.classList.toggle('squeezed', !side);
        });

        const z = view.z ?? 1, ls = { L: MapView.NAME.L(z), M: MapView.NAME.M(z), S: MapView.NAME.S(z) }; // Name scale: the slide happens inside it
        glide.forEach(([p, [x, y], [nx, ny]]) => {
            p.lastChild._glide?.cancel(); // A glide still running: this one takes over (kept on the name: asking the page would force a restyle)
            if (Math.abs(x - nx) + Math.abs(y - ny) <= 1) return;
            const k = ls[has(p, 'size-L') ? 'L' : has(p, 'size-M') ? 'M' : 'S'];
            const a = p.lastChild._glide = p.lastChild.animate([{ transform: `translate(${((x - nx) / k).toFixed(1)}px, ${((y - ny) / k).toFixed(1)}px)` }, { transform: 'none' }], { duration: ahead?.time ?? 380, easing: 'cubic-bezier(.3, 0, .2, 1)', fill: 'forwards' });
            if (ahead) { a.pause(); ahead.out.push(a); } // Over the whole move, stepped with the dots (camera.fly)
            else a.onfinish = () => { if (p.lastChild._glide === a) { a.cancel(); p.lastChild._glide = null; } }; // Done: let go (a held animation keeps the name, and every dot drawn after it, on a GPU layer of its own)
        });

        for (const copy of ui.litPins?.children || []) if (copy._src && copy.className !== copy._src.className) copy.className = copy._src.className; // Hovered route's stops keep the same label sides
    }

    labelsAhead(f, time) { // Before a camera move: names take their sides for where it lands and slide there along the way
        const pos = view.pinList.map(p => [p._x, p._y]), saved = view.frame, ahead = { time, out: [], wide: f.s < (this.homeS || f.s) * .55, far: f.s < (this.wholeS || 0) * 1.6 }; // (as zoomClasses decides them)
        view.pinList.forEach(p => { p._x = (p._wx - f.x0) * f.s; p._y = (p._wy - f.y0) * f.s; });
        view.frame = f;
        try { this.arrangeStationLabels(ahead); } finally { view.frame = saved; view.pinList.forEach((p, k) => { [p._x, p._y] = pos[k]; }); }
        return ahead.out;
    }

    pickLabelSides(pins, chosen, size) { // Side per chosen label (undefined: no room)
        const { W, H, top, gap, s } = view.frame, placed = []; // Label boxes already placed
        const visible = b => b.x0 >= gap * s + 4 && b.x1 <= W - 4 && b.y0 >= top && b.y1 <= H - 4; // Box fully on screen
        const lines = b => { // Line density under a box
            let n = 0;
            for (let x = Math.floor(b.x0 / 10); x <= Math.floor(b.x1 / 10); x++) for (let y = Math.floor(b.y0 / 10); y <= Math.floor(b.y1 / 10); y++) n += view.lineGrid?.get(x * 4096 + y) || 0;
            return n;
        };

        const CELL = 64, cells = new Map(); // Dots bucketed in a coarse grid, so each check only looks nearby
        const each = (b, fn) => { for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++) for (let y = Math.floor(b.y0 / CELL); y <= Math.floor(b.y1 / CELL); y++) fn(x * 4096 + y); };
        pins.forEach(p => { const r = size.get(p).r, d = { p, ...box(p._x - r - 2, p._y - r - 2, 2 * r + 4, 2 * r + 4) }; each(d, k => (cells.get(k) || cells.set(k, []).get(k)).push(d)); });
        const onDot = (b, p) => { let hit = false; each(b, k => { hit ||= (cells.get(k) || []).some(o => o.p !== p && overlaps(b, o)); }); return hit; }; // Box covers another dot
        return chosen.map(p => {
            const { r, w, h } = size.get(p), x = p._x, y = p._y, k = r * .71 + 2; // Diagonal offset (k)
            const spots = {
                right: box(x + r + 6, y - h / 2, w, h), bottom: box(x - w / 2, y + r + 2, w, h), left: box(x - r - 6 - w, y - h / 2, w, h), top: box(x - w / 2, y - r - 2 - h, w, h),
                'top-right': box(x + k, y - k - h, w, h), 'top-left': box(x - k - w, y - k - h, w, h), 'bottom-right': box(x + k, y + k, w, h), 'bottom-left': box(x - k - w, y + k, w, h)
            };

            const free = k => visible(spots[k]) && !placed.some(o => overlaps(spots[k], o)); // Spot on screen and not over another label
            const cost = k => lines(spots[k]) + LABEL_SIDES.indexOf(k) * .5, cheapest = list => list.sort((a, b) => cost(a) - cost(b))[0]; // Spot crossing the fewest lines
            const stay = list => list.includes(p._side) && cost(p._side) <= cost(list[0]) * 1.5 + 6 ? p._side : list[0]; // Keep its side unless it's now clearly worse: names don't hop about with small moves
            const open = LABEL_SIDES.filter(k => free(k) && !onDot(spots[k], p)), any = has(p, 'size-L', 'picked') ? LABEL_SIDES.filter(free) : [];
            const side = open.length ? (cheapest(open), stay(open)) : any.length ? (cheapest(any), stay(any)) : undefined;
            if (side) placed.push(spots[side]);
            return side;
        });
    }

    snapPins() { // Stations sit on their own lines (a bundle's lanes run beside the true spot); a selected route's, on it
        const lock = view.selected !== null ? net.members(view.selected).filter(net.shownAt) : [], key = `${lock}|${this.lineKey}`;
        if (this.snapKey === key || !view.pinList || !this.lineKey) return;
        this.snapKey = key;
        const { cell, grid, segs } = this.picks?.key === this.lineKey ? this.picks : this.pickGrid(), s = this.spacedAt || view.frame.s, picked = new Set(lock.flatMap(i => view.routes[i].stops));
        for (const p of view.pinList) {
            p._hx ??= p._wx; p._hy ??= p._wy; // Its true spot
            const mine = picked.has(p.dataset.city) ? lock : net.routesAt(p.dataset.city), reach = (mine === lock ? 40 : 24) / s, n = Math.ceil(reach / cell); // (Within about 24px; a selected route's, 40px)
            const cx = Math.floor(p._hx / cell), cy = Math.floor(p._hy / cell);
            let best = [p._hx, p._hy], most = reach * reach;
            if (mine.length) for (let x = cx - n; x <= cx + n; x++) for (let y = cy - n; y <= cy + n; y++) for (const k of grid.get(x * 65536 + y) || []) { // Nearest point on one of its lines
                if (!mine.includes(segs[k * 5])) continue;
                const ax = segs[k * 5 + 1], ay = segs[k * 5 + 2], dx = segs[k * 5 + 3] - ax, dy = segs[k * 5 + 4] - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p._hx - ax) * dx + (p._hy - ay) * dy) / l)) : 0;
                const qx = ax + dx * t, qy = ay + dy * t, d = (qx - p._hx) ** 2 + (qy - p._hy) ** 2;
                if (d < most) { most = d; best = [qx, qy]; }
            }

            [p._wx, p._wy] = best;
        }

        if (view.frame && !camera.flying) camera.placePins(camera.pinFrame || view.frame); // (Where the dots are showing now: the lines may be laid out ahead, for where a move lands)
    }

    refocus(id) { // Feature another state, as Ohio is by default (outline, sidebar, camera)
        if (id === view.focus) return;
        this.drawFocus(net.focusOn(id));
        view.home = camera.home(true);
        view.pinList.forEach(p => { p._ctx = +net.contextOnly(p.dataset.city); });
        view.pinList.sort((a, b) => b._ctx - a._ctx || b._size - a._size); // Featured stations on top again
        ui.pins.append(...view.pinList);
        sidebar.scope = 'focus';
        sidebar.lists = null; // (Rebuilt with the state's name)
        sidebar.build();
        const url = new URL(location.href);
        url.searchParams.set('state', id);
        history.replaceState(null, '', url); // A shared link features it too
        Object.assign(view, { selected: null, city: null, hover: null, zoom: null, back: null, wide: false });
        this.focusRoutesAndStations();
        camera.move();
        clearTimeout(this.warmTimer);
        this.warmTimer = setTimeout(() => this.prewarm(), 1500); // Its routes' views, ready ahead
    }

    at(e) { // Pointer -> map coordinates (current frame)
        const f = view.frame, r = this.mapRect ??= rectOf(ui.map), { x, y } = toPage(e);
        return [f.x0 + (x - r.left) / f.s, f.y0 + (y - r.top) / f.s];
    }

    routeAt(e) { // The line under the pointer (12px; a finger 22px), from the drawn lines: cheaper than the page hit-testing
        const f = view.frame, picks = f && this.picks?.key === this.lineKey ? this.picks : f && this.lineKey && this.pickGrid();
        if (!picks) return null;
        const p = this.at(e), reach = (e.pointerType === 'touch' ? 22 : 12) / f.s, { cell, grid, segs } = picks, n = Math.ceil(reach / cell), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
        let best = null, near = reach;
        for (let x = cx - n; x <= cx + n; x++) for (let y = cy - n; y <= cy + n; y++) for (const k of grid.get(x * 65536 + y) || []) {
            const i = segs[k * 5], el = this.routeEls.get(i);
            if (i === best || !el || has(el, 'gone', 'out')) continue;
            const d = segDist(p, [segs[k * 5 + 1], segs[k * 5 + 2]], [segs[k * 5 + 3], segs[k * 5 + 4]]) + (i >= view.routes.length ? 4 / f.s : 0); // (An Amtrak line beside a commuter one wins)
            if (d < near) { near = d; best = i; }
        }

        return best;
    }

    pickGrid() { // The drawn lines' segments by grid cell (once per layout of the lines)
        const s = this.spacedAt || view.frame.s, cell = 24 / s, step = 3 / s, grid = new Map(), segs = []; // (Points 3px apart are plenty for a 12px reach)
        for (const r of [...view.routes, ...view.regional]) for (const f of r.parts || []) for (let k = 2, ax = f[0], ay = f[1]; k + 1 < f.length; k += 2) {
            const bx = f[k], by = f[k + 1], n = segs.length / 5;
            if (k + 3 < f.length && Math.abs(bx - ax) + Math.abs(by - ay) < step) continue;
            segs.push(r.i, ax, ay, bx, by);
            for (let x = Math.floor(Math.min(ax, bx) / cell); x <= Math.floor(Math.max(ax, bx) / cell); x++) for (let y = Math.floor(Math.min(ay, by) / cell); y <= Math.floor(Math.max(ay, by) / cell); y++) (grid.get(x * 65536 + y) ?? grid.set(x * 65536 + y, []).get(x * 65536 + y)).push(n);
            ax = bx; ay = by;
        }

        return this.picks = { key: this.lineKey, cell, grid, segs: Float64Array.from(segs) };
    }

    pinAt(e, tight) { // The dot under the pointer (12px round it, a finger 20px; tight: on the dot), from the dots' spots
        if (!view.pinList || !view.frame || !e.clientX && !e.clientY) return null;
        const r = this.mapRect ??= rectOf(ui.map), { x, y } = toPage(e), px = x - r.left, py = y - r.top, far = has(ui.map, 'far');
        let best = null, near = Infinity;
        for (const p of view.pinList) {
            const dx = p._x - px, dy = p._y - py;
            if (!p._on || dx > 40 || dx < -40 || dy > 40 || dy < -40 || has(p, 'gone', 'out', 'absorbed') || (far && !has(p, 'size-L') && !has(p, 'picked', 'ping'))) continue; // (Far out, a hovered line's small stops show but don't take the pointer: it would flicker)
            const r = view.sizes?.get(p)?.r || 6, d = dx * dx + dy * dy, reach = tight ? r + (e.pointerType === 'touch' ? 8 : 3) : Math.max(e.pointerType === 'touch' ? 20 : 12, r + 2);
            if (d < reach * reach && d <= near) { near = d; best = p; } // (Ties: the later dot, drawn on top)
        }

        return best;
    }

    under(e) { // What the pointer is on: [dot, line] (a dot right under it wins; one merely nearby only where there's no line)
        const tight = this.pinAt(e, true);
        if (tight) return [tight, null];
        const i = this.routeAt(e);
        return i !== null ? [null, i] : [this.pinAt(e), null];
    }

    setHot(pin) { // The hovered dot: on top, named, ringed
        if (this.hot === pin) return;
        this.hot?.classList.remove('hot');
        this.hot = pin;
        pin?.classList.add('hot');
        ui.pins.classList.toggle('hot', !!pin);
    }

    pinTip(pin) { // A station's tooltip (built once per station and view)
        const key = `${pin.dataset.city}|${view.era}|${view.types}|${view.split?.has(pin.dataset.city)}`;
        if (this.pinTipKey !== key) { this.pinTipKey = key; this.pinTipHTML = `<strong>${nameHTML(pin.dataset.city, view.split?.has(pin.dataset.city))}</strong><em>${plural(net.uniqueGroups(net.routesAt(pin.dataset.city)).length, 'route')}</em>`; }
        return this.pinTipHTML;
    }

    stateAt(e) { // State under the pointer (its id), from the current frame
        const p = this.at(e);
        return view.allStates.find(st => p[0] >= st.box[0] && p[0] <= st.box[1] && p[1] >= st.box[2] && p[1] <= st.box[3] && insideRings(p, st.rings))?.id.toUpperCase();
    }

    // Highlight state
    focusRoutesAndStations() { // Highlight/dim routes and stations
        if (view.city && !net.routesAt(view.city).length) view.city = null;
        const active = view.hover !== null ? net.members(view.hover) : view.selected !== null ? net.members(view.selected) : view.city ? net.routesAt(view.city) : null;
        const lock = view.selected !== null ? net.members(view.selected) : view.city ? net.routesAt(view.city) : null; // Stations off this disappear
        const split = view.split = net.split((active || []).filter(net.shownAt)); // Twins the routes in view call at both of: told apart
        const stopsOf = ids => new Set((ids || []).flatMap(i => view.routes[i].stops).flatMap(n => split.has(n) ? [n] : twinsOf(n))); // Stops of routes (a twin's: the station as a whole)
        const stops = stopsOf(active), lockStops = stopsOf(lock);
        (this.lineGroups || []).forEach(g => { // Map lines follow the selection only; hover is drawn by liftHovered
            if (g.dataset.r) { g.classList.toggle('gone', !net.regionalShown(view.regional[g.dataset.r])); return g.classList.toggle('off', !!lock); } // Commuter lines: by era, stepping back for a selection
            const i = +g.dataset.i, on = !lock || lock.includes(i);
            g.classList.toggle('gone', !net.shownAt(i));
            g.classList.toggle('on', !!lock && on);
            g.classList.toggle('off', !on);
            if (g.classList.contains('route')) g.classList.toggle('out', !!lock && !lock.includes(i));
        });

        (view.pinList || []).forEach(p => { // Hover only changes the hovered route's dots (see liftHovered)
            const c = p.dataset.city;
            p.classList.toggle('out', !!lock && !lockStops.has(c));
            p.classList.toggle('gone', !net.routesAt(c).length && p.classList.contains('size-S')); // Always show medium and large stations
            p.classList.toggle('lit', !!active && stops.has(c));
            p.classList.toggle('off', !!lock && !lockStops.has(c));
            p.classList.toggle('picked', c === view.city);
            p.classList.toggle('full', split.has(c));
        });

        sidebar.highlight(active);
        this.snapPins();
        this.backdrop();
        if (view.frame) this.arrangeSoon();
        this.liftHovered();
        card.show();
    }

    liftHovered() { // Hover: dim each layer whole, with the hovered route copied on top
        if (!ui.litLines) {
            ui.base.after(ui.litLines = svg('svg', { class: 'map-lit', 'aria-hidden': 'true' }));
            ui.pins.after(ui.litPins = Object.assign(document.createElement('div'), { className: 'pins-lit', ariaHidden: 'true' }));
        }

        const hover = view.hover !== null, lit = [ui.litLines, ui.litPins];
        [ui.base, ui.pins].forEach(el => el.classList.toggle('dim', hover));
        if (this.liftTimer) this.liftTimer = clearTimeout(this.liftTimer);
        if (hover) {
            const members = net.members(view.hover).filter(net.shownAt);
            const lines = this.lineGroups.filter(g => g.tagName !== 'DIV' && members.includes(+g.dataset.i)).map(g => { // Glows, casings, then lines (document order)
                const copy = g.cloneNode(true);
                copy.setAttribute('class', g.classList[0] + ' on');
                return copy;
            });

            ui.litLines.setAttribute('viewBox', ui.base.getAttribute('viewBox'));
            ui.litLines.style.cssText = ui.base.style.cssText; // Same line widths and camera transform
            ui.litLines.replaceChildren(...lines);
            ui.litPins.replaceChildren(...(view.pinList || []).filter(p => has(p, 'lit') && !has(p, 'out', 'gone') && !p.classList.contains('absorbed')).map(p => Object.assign(p.cloneNode(true), { _src: p })));
            lit.forEach(el => el.classList.remove('fading'));
        } else if (lit.some(el => el.firstChild)) {
            lit.forEach(el => el.classList.add('fading')); // Fade out while the layers below come back
            this.liftTimer = setTimeout(() => { this.liftTimer = 0; lit.forEach(el => el.replaceChildren()); }, 300);
        }
    }

    // Selection
    focusRoute(i) { // Select a route and zoom to it (deselecting returns to where the map was)
        view.selected = i;
        if (i === view.zoom) return;
        if (view.zoom == null) view.back = { ...view.cam };
        view.zoom = i;
        camera.move();
    }

    selectRoute(i) { // Select a route (null clears)
        if (i !== null && pageW() <= NARROW && view.legend) { view.legend = false; sidebar.sync(); } // A phone: the list steps aside for the map and its card
        view.city = view.hover = null;
        this.focusRoute(i);
        this.swapFade(() => this.focusRoutesAndStations());
    }

    swapFade(apply) { // Highlights change at once, the line layer fading back in whole on the GPU (nothing copied: thousands of paths)
        apply();
        if (still || !document.body.classList.contains('drawn')) return;
        ui.base.animate([{ opacity: .45 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
        this.fadePins();
    }

    fadePins() { // Dots changed at once: one fade for the whole layer
        if (document.body.classList.contains('drawn') && !still) ui.pins.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }

    reset() { this.selectRoute(null); } // Clear the selection
    hoverRoute(i) { // Highlight the hovered route (at most once per frame)
        if (i === view.hover) return;
        view.hover = i;
        if (i !== null) relief.prefetch(i); // Likely the next click: start loading its population map
        this.hoverFrame ||= requestAnimationFrame(() => { this.hoverFrame = 0; this.focusRoutesAndStations(); });
    }

    hoverLocal(l) { // A hovered commuter line glows (all of its branches)
        if (this.hotLocal === (l?.label ?? null)) return;
        this.hotLocal = l?.label ?? null;
        this.lineGroups.forEach(g => { if (g.dataset.r) g.classList.toggle('hot', view.regional[g.dataset.r].label === this.hotLocal); });
    }

    tip(text, e) { // Hover tooltip
        ui.tip.hidden = !text;
        if (!text) return;
        if (ui.tip._html !== text) ui.tip.innerHTML = ui.tip._html = text;
        const { x, y } = toPage(e);
        ui.tip.style.translate = `${x}px ${y}px`;
    }

    bind() { // Map lines and station dots (found by map.pinAt and map.routeAt: the page never hit-tests them)
        let moved = null; // Latest pointer move, handled once per frame
        ui.map.addEventListener('pointermove', e => {
            if (!moved) requestAnimationFrame(() => { const ev = moved; moved = null; if (ev) this.pointerMove(ev); });
            moved = e;
        });

        ui.map.addEventListener('pointerleave', () => { moved = null; this.tip(); this.hoverRoute(null); this.hoverLocal(null); this.setHot(null); ui.map.classList.remove('pointing'); });
        this.pointerMove = e => {
            const idle = !ui.map.classList.contains('moving') && e.pointerType !== 'touch', [pin, hit] = idle ? this.under(e) : [null, null];
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
                this.tipHTML = `<span class="swatch" style="--c:${r.color}"></span><strong>${esc(r.label)}</strong><em>${esc(statusText(r.status))} · ${plural(stops, 'stop')}</em>`;
            }

            this.tip(this.tipHTML, e);
        };

        ui.map.addEventListener('click', e => { // A dot opens its station, a line selects it (again: lets go), another state gets featured, empty map clears
            if (!document.body.classList.contains('drawn')) return;
            const [pin, i] = this.under(e);
            if (pin) { this.tip(); return stationModal.open(pin.dataset.city); }
            if (i !== null && i < view.routes.length) { this.tip(); return this.selectRoute(i !== view.selected ? i : null); } // (Commuter lines can't be picked)
            const id = view.frame && this.stateAt(e);
            if (id && id !== view.focus) this.refocus(id);
            else if (view.selected !== null || view.city) this.reset();
        });
    }
}
