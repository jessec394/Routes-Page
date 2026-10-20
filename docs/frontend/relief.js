// Population relief: route card minimap, expanded view, station backdrop
class Relief { // Sends views to its drawing thread (reliefWorker, below) and shows the results
    static LIFT = 9; // Tallest rise, in map units (1 unit = 0.01 deg of latitude, about 1.1 km)
    static INSET = 1.8; // Tracts stop this far inside each state border (about 2 km)
    static MAX_ZOOM = 8; // Closest zoom (x the route's own view)
    static DOTS = { L: 4.2, M: 3.4, S: 2.6 }; // Station dot radius (px) by size
    static MARGIN = .25; // Extra drawn on each side, so small zooms and pans show no blank edges
    maps = {}; // State -> data version
    scale = 0; // Density of a full-height tract (one scale for every state)
    boxes = new Map(); // Route group -> its bounds in map units
    showRoute = true; // Route shown in the expanded view (the minimap always shows it)
    live = null; // The relief being shown (card or expanded): elements, view and gesture state
    card = null; // The card's relief, while the expanded one is open
    viewer = null; // Expanded view (made on first use)
    seq = 0; // Message counter (stale replies are dropped)
    jobs = new Map(); // One-off pictures (paint) waiting for the worker
    requested = new Set(); // States already asked for

    load(info) { this.maps = info?.states || {}; this.scale = info?.scale || 1; }

    world() { // Bounds of every state with data (how far the large view can zoom out and pan)
        return this.worldBox ??= (() => {
            const b = view.allStates.filter(s => this.maps[s.id]).map(s => s.box);
            return [Math.min(...b.map(v => v[0])) - 2, Math.min(...b.map(v => v[2])) - 2, Math.max(...b.map(v => v[1])) + Relief.LIFT + 2, Math.max(...b.map(v => v[3])) + Relief.LIFT + 2];
        })();
    }

    routeBox(i) { // The route with some room around it (and for the rise)
        const label = view.routes[i].label;
        if (!this.boxes.has(label)) {
            const pts = net.members(i).flatMap(m => view.routes[m].runs.flat()), [x0, x1, y0, y1] = bounds(pts), pad = Math.max(x1 - x0, y1 - y0) * .1 + 4;
            this.boxes.set(label, [x0 - pad, y0 - pad, x1 + pad + Relief.LIFT, y1 + pad + Relief.LIFT]);
        }

        return this.boxes.get(label);
    }

    covers(box) { return !!window.OffscreenCanvas && this.statesIn(box).length > 0; } // Population data for any of this area

    lineFor(px) { return Math.max(1.5, px / 320); } // Route width (px) for a picture this wide

    paint(canvases, area, key, routes, wait = true) { // One-off relief and routes of an area (station backdrop); resolves to the rise, or null
        const w = this.worker(), seq = ++this.seq, [c] = canvases;
        return w ? new Promise(done => {
            this.jobs.set(seq, data => {
                this.jobs.delete(seq);
                if (!data) return done(null); // Failed
                const { peak, bitmaps } = data;
                if (!c.isConnected) { bitmaps.forEach(b => b.close()); return done(null); }
                canvases.forEach((el, n) => el.getContext('bitmaprenderer').transferFromImageBitmap(bitmaps[n]));
                done(peak);
            });
            w.postMessage({ type: 'draw', key, seq, list: this.stateList(this.statesIn(area)), wait, routes, stops: [], view: area, width: c.width, height: c.height,
                lift: Relief.LIFT, inset: Relief.INSET, scale: this.scale, line: this.lineFor(c.width) });
        }) : Promise.resolve(null);
    }

    statesIn([x0, y0, x1, y1]) { return view.allStates.filter(s => this.maps[s.id] && s.box[0] <= x1 && s.box[1] + Relief.LIFT >= x0 && s.box[2] <= y1 && s.box[3] + Relief.LIFT >= y0).map(s => s.id); } // States with data in (or rising into) a view

    worker() { // Started on first use; none in very old browsers
        if (this.thread !== undefined) return this.thread;
        this.thread = window.Worker && window.OffscreenCanvas ? new Worker(URL.createObjectURL(new Blob([`(${reliefWorker})()`], { type: 'text/javascript' }))) : null; // Its code comes from this file
        this.thread?.addEventListener('message', ({ data }) => {
            if (data.type === 'drawn') this.jobs.has(data.seq) ? this.jobs.get(data.seq)(data) : this.drawn(data);
            else if (data.type === 'loaded') { // A state arrived: redraw the views it shows up in
                if (this.live?.drawn && this.statesIn(this.around(this.live.view, Relief.MARGIN)).includes(data.id)) this.redraw();
                this.onLoad?.(data.id);
            } else if (data.type === 'error') { console.warn(`Population map: ${data.error}`); this.jobs.get(data.seq)?.(null); if (this.live?.waiting === data.seq) this.fail(); }
        });
        this.thread?.addEventListener('error', e => { // The drawing thread failed to start or crashed
            e.preventDefault();
            console.warn(`Population map: drawing thread failed (${e.message || 'no details'}).`);
            this.thread = null;
            this.fail();
        });
        return this.thread;
    }

    stateList(ids) { return ids.map(id => ({ id, url: new URL(`data/states/${id}/density.json?v=${this.maps[id]}`, location.href).href, rings: view.allStates.find(s => s.id === id).rings, proj: view.proj })); }
    around([x0, y0, x1, y1], m) { const w = (x1 - x0) * m, h = (y1 - y0) * m; return [x0 - w, y0 - h, x1 + w, y1 + h]; } // A view grown by m on each side
    request(box) { idle(() => this.stateList(this.statesIn(box).filter(id => !this.requested.has(id))).forEach(st => { this.requested.add(st.id); this.worker()?.postMessage({ type: 'load', ...st }); })); } // Start loading the states in a box
    prefetch(i) { this.request(this.routeBox(i)); } // Hovered: likely the next click

    markup(i, big = false) { // Figure, sized before the picture arrives (empty without data)
        if (!window.OffscreenCanvas || !this.statesIn(this.routeBox(i)).length) return ''; // No population data along this route
        const [x0, y0, x1, y1] = this.routeBox(i), ar = Math.min(2.4, Math.max(big ? .7 : .9, (x1 - x0) / (y1 - y0))).toFixed(3); // Shaped to the route, within limits
        return `<figure class="relief${big ? ' big' : ''}${big && !this.showRoute ? ' no-route' : ''}" style="aspect-ratio:${ar};--ar:${ar}">` +
            '<div class="relief-layers"><canvas role="img" aria-label="Population density along the route"></canvas><canvas class="relief-route"></canvas></div>' +
            '<div class="relief-tip" hidden></div><span class="relief-spin" aria-hidden="true"></span>' +
            `<div class="relief-tools">${big ? `<button class="relief-toggle" type="button" aria-pressed="${this.showRoute}"><i></i>Route</button>` : ''}<button class="relief-reset" type="button" hidden>Reset</button>` +
            (big ? '' : '<button class="relief-expand" type="button" title="Expand" aria-label="Expand"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/></svg></button>') + '</div>' +
            `${credit(big)}</figure>`;
    }

    expand() { // Open the relief large, over the map (the card's stays as it is underneath)
        const i = view.selected;
        if (!this.live || i === null || this.isOpen()) return;
        this.viewer ??= (() => {
            const el = Object.assign(document.createElement('div'), { className: 'relief-viewer', hidden: true });
            el.addEventListener('click', e => { if (e.target === el || e.target.closest('.relief-close')) this.collapse(); });
            pageEl().append(el);
            return el;
        })();
        this.viewer.innerHTML = `<div class="relief-viewer-box"><header><div><p class="kicker">Population density</p><h3>${esc(view.routes[i].label)}</h3></div>` +
            `<button class="relief-close" type="button" aria-label="Close">×</button></header>${this.markup(i, true)}</div>`;
        this.viewer.hidden = false;
        this.card = this.live;
        this.fill($('.relief', this.viewer), i, true);
    }

    collapse() { // Back to the card's relief
        if (!this.isOpen()) return;
        this.hover(null);
        this.viewer.hidden = true;
        this.viewer.replaceChildren();
        this.live = this.card?.fig.isConnected ? this.card : null;
        this.card = null;
    }

    isOpen() { return !!this.viewer && !this.viewer.hidden; }

    fill(fig, i, now = false) { // Start a relief: fit, bind gestures, draw (the card's after the camera lands)
        if (!fig) return;
        const members = net.members(i).filter(net.shownAt), px = dpr(), W = fig.clientWidth, H = fig.clientHeight;
        const shape = ([x0, y0, x1, y1]) => { const w = x1 - x0, h = y1 - y0; return w / h < W / H ? [x0 - (h * W / H - w) / 2, y0, x1 + (h * W / H - w) / 2, y1] : [x0, y0 - (w * H / W - h) / 2, x1, y1 + (w * H / W - h) / 2]; }; // Same shape as the figure
        const home = shape(this.routeBox(i)), world = shape(this.world());
        const canvases = $$('canvas', fig);
        canvases.forEach(c => { c.width = Math.round(W * px * (1 + 2 * Relief.MARGIN)); c.height = Math.round(H * px * (1 + 2 * Relief.MARGIN)); }); // Room for the margin
        const stops = [...new Set(members.flatMap(m => view.routes[m].stops))].map(name => {
            const p = net.cityXY(name);
            return p && { name, x: p[0], y: p[1], r: Relief.DOTS[sizeOf(view.cities[name])] * px * (now ? 1.5 : 1) };
        }).filter(Boolean);
        const live = this.live = { fig, canvases, layers: $('.relief-layers', fig), tip: $('.relief-tip', fig), reset: $('.relief-reset', fig), key: members.join(','),
            routes: members.flatMap(m => view.routes[m].runs), stops, dpr: px, home, world, view: home.slice(), drawn: null, peak: 0, waiting: 0, again: false };
        this.bind(live);
        if (now) return this.redraw();
        const go = () => { // The selection's own animation stays smooth
            if (this.live !== live) return;
            if (ui.map.classList.contains('moving')) return setTimeout(go, 100);
            idle(() => this.redraw(), 400);
        };

        setTimeout(go, 150);
    }

    fail() { // Stop the spinner and say so, instead of loading forever
        const L = this.live;
        if (!L) return;
        L.waiting = 0;
        if (!L.drawn) L.fig.classList.add('failed');
    }

    redraw() { // Ask the worker for the current view (one at a time; the latest view wins)
        const L = this.live, w = this.worker();
        if (!L?.fig.isConnected) return;
        if (!w) return this.fail();
        if (L.waiting) { L.again = true; return; }
        L.waiting = ++this.seq;
        const zoom = (L.home[2] - L.home[0]) / (L.view[2] - L.view[0]), area = this.around(L.view, Relief.MARGIN);
        w.postMessage({ type: 'draw', key: L.key, seq: L.waiting, list: this.stateList(this.statesIn(area)), wait: !L.drawn, routes: L.routes, stops: L.stops, view: area, width: L.canvases[0].width, height: L.canvases[0].height,
            lift: Relief.LIFT, inset: Relief.INSET, scale: this.scale, line: this.lineFor(L.fig.clientWidth * L.dpr) * Math.min(1.6, zoom ** .25) });
    }

    drawn({ seq, view: shown, peak, bitmaps }) { // A view is ready: show it and line it up with where the viewer is now
        const L = this.live;
        if (!L || L.waiting !== seq || !L.fig.isConnected) return bitmaps.forEach(b => b.close());
        L.waiting = 0;
        L.canvases.forEach((c, n) => c.getContext('bitmaprenderer').transferFromImageBitmap(bitmaps[n]));
        Object.assign(L, { drawn: shown, peak });
        L.fig.classList.add('ready');
        this.place();
        if (L.fig.classList.contains('big')) this.request(this.around(L.view, 1)); // Load the states around the view ahead of a zoom-out or pan
        if (L.again) { L.again = false; this.redraw(); }
    }

    place() { // Stretch the last picture over the current view until the next arrives
        const L = this.live;
        if (!L?.drawn) return;
        stretch(L.layers, L.drawn, L.view);
        L.reset.hidden = !L.view.some((v, n) => Math.abs(v - L.home[n]) > (L.home[2] - L.home[0]) * .01); // Moved from the route's view
    }

    widthFor(width) { const L = this.live; return Math.min(L.world[2] - L.world[0], Math.max((L.home[2] - L.home[0]) / Relief.MAX_ZOOM, width)); } // Out to every state, in to MAX_ZOOM x the route view

    panTo(x0, y0, w, h) { // Move the view, held over the states; redraw sharp once the gesture pauses
        const L = this.live;
        L.view = held(L.view, L.world, x0, y0, w, h);
        this.place();
        this.redraw(); // Keeps redrawing through the gesture, one picture at a time
    }

    whole() { const L = this.live; L.view = L.home.slice(); this.place(); this.redraw(); } // Back to the route's view

    bind(L) { // Minimap: hover, click to expand; large view: zoom, pan, toggle, stations
        const { fig } = L, surface = L.canvases[1];
        const hoverSoon = e => { L.lastMove = e; L.hoverFrame ||= requestAnimationFrame(() => { L.hoverFrame = 0; this.hover(L.lastMove); }); }; // At most once a frame
        if (!fig.classList.contains('big')) {
            surface.addEventListener('pointermove', hoverSoon);
            surface.addEventListener('pointerleave', () => this.hover(null));
            fig.addEventListener('click', () => this.expand());
            return;
        }

        const gesture = panZoom(fig, surface, { view: () => L.view, width: w => this.widthFor(w), move: (...v) => this.panTo(...v), hover: hoverSoon, down: () => this.tip(null) }); // Keep the hovered station on press: a click on it opens it
        surface.addEventListener('pointerleave', () => { if (!gesture.pointers.size) this.hover(null); });
        surface.addEventListener('dblclick', () => this.whole());
        surface.addEventListener('click', () => { if (!gesture.dragged && L.station) stationModal.open(L.station); });
        L.reset.addEventListener('click', () => this.whole());
        $('.relief-toggle', fig)?.addEventListener('click', e => {
            this.showRoute = !this.showRoute;
            e.currentTarget.setAttribute('aria-pressed', this.showRoute);
            fig.classList.toggle('no-route', !this.showRoute);
            if (!this.showRoute) this.hover(null);
        });
    }

    hover(e) { // Station under the pointer: name it, light it on the map and in the stop list
        const L = this.live;
        if (!L) return;
        let station = null;
        if (e && L.drawn && !L.fig.classList.contains('no-route')) {
            const r = rectOf(L.fig), p = toPage(e), x = p.x - r.left, y = p.y - r.top, u = L.fig.clientWidth / (L.view[2] - L.view[0]);
            let near = Infinity;
            L.stops.forEach(st => { const d = Math.hypot((st.x + L.peak - L.view[0]) * u - x, (st.y + L.peak - L.view[1]) * u - y); if (d < Math.max(9, st.r / L.dpr + 5) && d < near) { near = d; station = st.name; } });
            L.tipAt = [x, y];
        }

        L.station = station;
        L.canvases[1].classList.toggle('on-station', !!station);
        view.pinList?.forEach(p => p.classList.toggle('ping', p.dataset.city === station));
        $$('.stops li', ui.card).forEach(li => li.classList.toggle('hl', li.dataset.city === station));
        this.tip(station && `<strong>${nameHTML(station)}</strong>`);
    }

    tip(html) { // Station name beside the pointer, on the picture's side
        const L = this.live, t = L?.tip;
        if (!t) return;
        t.hidden = !html;
        if (!html) return;
        if (t._html !== html) t.innerHTML = t._html = html;
        const [x, y] = L.tipAt, right = x > L.fig.clientWidth / 2;
        t.style.transform = `translate(${right ? `calc(${x - 12}px - 100%)` : `${x + 12}px`}, ${Math.max(4, y - 40)}px)`;
    }
}

// Drawing thread (runs in a worker, so it can only use what's inside it)
function reliefWorker() {
    const RAMP = [[0, [8, 21, 44]], [.25, [22, 52, 104]], [.42, [60, 110, 190]], [.54, [158, 190, 228]], [.66, [212, 224, 240]], [1, [226, 234, 245]]]; // Height -> colour: navy, blue, then soft white for city cores
    const BASE = 50; // People per km2 where the log scale starts (rural stays low and dark)
    const RISE = 2.5; // Height = brightness ^ RISE: towns rise a little, city cores stand tall
    const SLICE = 1; // Pixels between the layers of a block's sides (keeps them solid)
    const SIDE = .45; // Side brightness (x the top colour)
    const RED = '#e0402c'; // Route line
    const states = {}; // State -> promise of its border and shaped tracts (map units)
    const floors = {}; // Route key -> its height above the ground (0..1)
    const ready = new Set(); // States loaded and shaped
    const probe = new OffscreenCanvas(1, 1).getContext('2d'); // Point-in-tract tests in map units

    const pathOf = rings => { const p = new Path2D(); rings.forEach(r => { p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); }); return p; };
    const mix = (h, dim = 1) => { // Colour for a height (dim < 1: a shaded side)
        const k = RAMP.findIndex(([at]) => at >= h), [a, ca] = RAMP[Math.max(0, k - 1)], [b, cb] = RAMP[Math.max(0, k)], t = b > a ? (h - a) / (b - a) : 0;
        return `rgb(${ca.map((v, n) => Math.round((v + (cb[n] - v) * t) * dim))})`;
    };

    function load({ id, url, rings, proj: { cLon, cLat, k } }) { // Fetch and shape a state once; tells the page when it's ready
        return states[id] ??= fetch(url).then(r => r.json()).then(({ tracts }) => ({
            border: pathOf(rings.map(r => r.flat())),
            tracts: tracts.map(([density, , ...parts]) => {
                const rings = parts.map(flat => { // Packed ring (1/10000 deg steps) -> map units
                    const out = new Float64Array(flat.length);
                    for (let i = 0, lon = 0, lat = 0; i < flat.length; i += 2) {
                        lon += flat[i];
                        lat += flat[i + 1];
                        out[i] = (lon / 1e4 - cLon) * k * 100;
                        out[i + 1] = (cLat - lat / 1e4) * 100;
                    }

                    return out;
                });

                let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                rings.forEach(r => { for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } });
                return { density, path: pathOf(rings), box: [x0, y0, x1, y1] };
            })
        })).then(state => { ready.add(id); postMessage({ type: 'loaded', id }); return state; });
    }

    function shade(tracts, scale) { // Heights and colours, on one scale for every state
        if (tracts.every(t => t.scale === scale)) return;
        tracts.forEach(t => {
            t.scale = scale;
            t.h = Math.min(1, Math.log1p(t.density / BASE) / Math.log1p(scale / BASE)); // Log scale: each tenfold rise in density adds the same height
            t.rise = t.h ** RISE;
            t.color = mix(t.h);
            t.side = mix(t.h, SIDE);
        });
    }

    function floorOf(key, tracts, routes) { // Average height of the tracts under a route
        return floors[key] ??= (() => {
            const heights = [];
            routes.forEach(run => run.forEach((p, n) => {
                if (n % 3) return;
                const t = tracts.find(t => p[0] >= t.box[0] && p[0] <= t.box[2] && p[1] >= t.box[1] && p[1] <= t.box[3] && probe.isPointInPath(t.path, p[0], p[1], 'evenodd'));
                if (t) heights.push(t.rise);
            }));
            return heights.length ? heights.reduce((a, b) => a + b) / heights.length : 0;
        })();
    }

    async function draw({ key, seq, list, wait, routes, stops, view, width, height, lift, inset, line, scale }) { // One view: the relief, and the route on its own layer
        list.forEach(st => load(st).catch(() => {})); // Start any missing states (each says when it's ready)
        const loaded = (await Promise.allSettled((wait ? list : list.filter(st => ready.has(st.id))).map(load))).filter(s => s.status === 'fulfilled').map(s => s.value); // First view: everything; after that, what's here now (a state that fails to load is left out)
        const tracts = loaded.flatMap(s => s.tracts), [vx0, vy0, vx1, vy1] = view, s = width / (vx1 - vx0);
        shade(tracts, scale);
        const layer = () => { const c = new OffscreenCanvas(width, height); return [c, c.getContext('2d', { willReadFrequently: true })]; }; // CPU drawing: leaves the GPU to the video
        const [ground, ctx] = layer(), at = (c, rise) => c.setTransform(s, 0, 0, s, (rise * lift - vx0) * s, (rise * lift - vy0) * s); // Map units -> pixels, raised by `rise`
        const seen = tracts.filter(t => t.box[2] + lift >= vx0 && t.box[0] <= vx1 && t.box[3] + lift >= vy0 && t.box[1] <= vy1); // In or rising into the view
        at(ctx, 0);
        ctx.fillStyle = mix(0);
        loaded.forEach(st => ctx.fill(st.border, 'evenodd')); // Ground
        const levels = Math.max(1, Math.ceil(lift * s / SLICE)), byLevel = Array.from({ length: levels + 1 }, () => []); // Layers one slice apart at this zoom
        seen.forEach(t => byLevel[t.level = Math.round(t.rise * levels)].push(t));
        let rising = seen.filter(t => t.level > 0); // Blocks still growing
        for (let lv = 0; lv <= levels; lv++) { // Layer by layer: sides of taller blocks, then the tops ending here
            at(ctx, lv / levels);
            rising = rising.filter(t => t.level > lv);
            rising.forEach(t => { ctx.fillStyle = t.side; ctx.fill(t.path, 'evenodd'); });
            byLevel[lv].forEach(t => { ctx.fillStyle = t.color; ctx.fill(t.path, 'evenodd'); });
        }

        ctx.strokeStyle = 'rgb(255 255 255 / .3)'; // Crisp rims on the tallest tops
        ctx.lineWidth = .7 / s;
        seen.forEach(t => { if (t.rise >= .3) { at(ctx, t.level / levels); ctx.stroke(t.path); } });

        at(ctx, 0);
        ctx.globalCompositeOperation = 'destination-out'; // Inset from each border
        ctx.lineWidth = Math.max(1.5 / s, 2 * inset);
        ctx.lineJoin = 'round';
        loaded.forEach(st => ctx.stroke(st.border));
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgb(255 255 255 / .25)'; // Faint outline
        ctx.lineWidth = 1 / s;
        loaded.forEach(st => ctx.stroke(st.border));

        // Route layer: a flat line at the average height of the tracts it crosses
        const [track, rc] = layer(), peak = floorOf(key, tracts, routes) * lift;
        const trace = (rise, color, w, alpha = 1) => {
            at(rc, 0);
            Object.assign(rc, { strokeStyle: color, lineWidth: w / s, globalAlpha: alpha, lineJoin: 'round', lineCap: 'round' });
            rc.translate(rise, rise);
            routes.forEach(run => { rc.beginPath(); run.forEach((p, n) => n ? rc.lineTo(p[0], p[1]) : rc.moveTo(p[0], p[1])); rc.stroke(); });
            rc.globalAlpha = 1;
        };

        trace(peak, RED, line * 3.4, .16); // Soft glow
        trace(peak, 'rgb(8 18 38 / .75)', line * 1.8); // Thin dark edge, so the line reads against white city blocks
        trace(peak, RED, line); // The line
        rc.setTransform(1, 0, 0, 1, 0, 0);
        stops.forEach(({ x, y, r }) => { // Station dots
            rc.beginPath();
            rc.arc((x + peak - vx0) * s, (y + peak - vy0) * s, r, 0, Math.PI * 2);
            Object.assign(rc, { fillStyle: '#fff', strokeStyle: mix(0), lineWidth: Math.max(1, r * .4) });
            rc.fill();
            rc.stroke();
        });

        const bitmaps = [ground.transferToImageBitmap(), track.transferToImageBitmap()];
        postMessage({ type: 'drawn', key, seq, view, peak, bitmaps }, bitmaps);
    }

    self.onmessage = ({ data }) => {
        const job = { load, draw }[data.type];
        Promise.resolve(job?.(data)).catch(e => postMessage({ type: 'error', key: data.key, seq: data.seq, error: String(e) }));
    };
}
