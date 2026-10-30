// Camera
class Camera {
    home(near = this.near) { // Default regional view (near: a state picked on the map, framed closer)
        this.near = near;
        const own = view.routes.filter(r => !r.context), base = own.filter(r => r.typeKey === 'state'), pts = [...view.fp, ...(base.length ? base : own).flatMap(r => r.xy)]; // Featured routes only
        const [x0, x1, y0, y1] = bounds(view.fp), c = [(x0 + x1) / 2, (y0 + y1) / 2]; // Centred on the focus state
        const size = a => a ? y1 - y0 : x1 - x0, half = a => Math.max(Math.min(Math.max(...pts.map(p => Math.abs(p[a] - c[a]))), size(a) * (near ? .75 : 1.25)), size(a) * .58) * 1.06; // Half-extent on one axis: long routes don't pull it far past the state, and all of the state shows
        const { w, h } = this.room({ side: 0, left: view.legend ? 1 : 0 }, this.measure()), s = Math.max(Math.min(w / (2 * half(0)), h / (2 * half(1))), Math.min(w / (x1 - x0) / 1.5, h / (y1 - y0) / 1.5)); // A tall or narrow map still fills with the state (not the far ends of its routes)
        const fill = phoneLayout() ? Math.min(w / ((x1 - x0) * 1.12), h / ((y1 - y0) * 1.12)) : 0; // Phones upright: the state itself fills the map (its routes run off the edges)
        return { cx: c[0], cy: c[1] - (fill > s ? (y1 - y0) * .1 : 0), hx: w / (2 * Math.max(s, fill)), hy: h / (2 * Math.max(s, fill)), side: 0 };
    }

    forRoute(i) { // View fitted to one route
        const pts = net.members(i).filter(net.shownAt).flatMap(m => view.routes[m].xy);
        if (!pts.length) return view.home;
        const [x0, x1, y0, y1] = bounds(pts);
        return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hx: Math.max(150, (x1 - x0) * .575), hy: Math.max(105, (y1 - y0) * .575), side: 1 };
    }

    network() { // View fitted to every shown route (kept until the shown routes change: zooming asks for it constantly)
        const shown = view.routes.filter(net.shown), key = shown.map(r => r.i).join();
        if (this.netKey !== key) {
            this.netKey = key;
            const box = shown.reduce((b, r) => [Math.min(b[0], r.box[0]), Math.max(b[1], r.box[1]), Math.min(b[2], r.box[2]), Math.max(b[3], r.box[3])], view.fp.length ? bounds(view.fp) : [Infinity, -Infinity, Infinity, -Infinity]);
            this.net = { cx: (box[0] + box[1]) / 2, cy: (box[2] + box[3]) / 2, hx: (box[1] - box[0]) * .56, hy: (box[3] - box[2]) * .56, side: 0 };
        }

        return { ...this.net };
    }

    target() { return { ...(view.zoom != null ? this.forRoute(view.zoom) : view.wide ? this.network() : view.back || view.home), left: view.legend ? 1 : 0 }; } // Where the camera should be now (back: where a deselected route returns to)

    measure() { // All layout measurements
        const W = ui.map.clientWidth, H = ui.map.clientHeight, topH = ui.top.offsetHeight;
        if (view.legend && ui.legend.offsetWidth > 100) view.legendW = ui.legend.offsetWidth;
        const rem = this.rem ??= parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; // Root font size (fixed)
        return this.held = { W, H, topH, cardW: ui.card.offsetWidth || Math.min(21 * rem, W - 2 * rem), cardH: ui.card.hidden ? 0 : ui.card.offsetHeight, dockH: phoneLayout() && !view.legend && ui.card.hidden ? ui.legend.offsetHeight : ui.dock.offsetHeight }; // (Phones upright: the sheet at the foot takes the room the dock would)
    }

    room({ side, left }, { W, H, topH, cardW, cardH, dockH }) { // Free area for the map (px): width, height, centre, top
        const wide = W > NARROW, beside = wide || pageH() <= SHORT, padX = W < 700 ? 12 : 40; // (A phone on its side: the card sits beside the map too)
        const right = beside ? side * (cardW + 24) : 0, leftGap = wide ? left * ((view.legendW || 248) + 56) : 0;
        const dock = dockH ? dockH + 24 : 16, card = !beside && cardH ? side * (cardH + 24) : 0;
        const top = topH + 12 + (phoneLayout() ? 44 : 0), bottom = H - Math.max(dock, card);
        return { w: W - 2 * padX - right - leftGap, h: Math.max(40, bottom - top), cxPx: (W - right + leftGap) / 2, cyPx: (top + bottom) / 2, top, leftGap };
    }

    frameFor(cam, m) { // Camera -> scale and top-left map coordinate
        const { cx, cy, hx, hy } = cam, { W, H } = m, { w, h, cxPx, cyPx, top, leftGap } = this.room(cam, m);
        const s = Math.min(w / (2 * hx), h / (2 * hy));
        return { s, vw: W / s, vh: H / s, x0: cx - cxPx / s, y0: cy - cyPx / s, W, H, top, cxPx, cyPx, gap: leftGap / s };
    }

    quick() { return this.held ??= this.measure(); } // The latest measurements (reading them afresh forces a layout): kept till the next full redraw
    shown(m = this.quick()) { const f = this.frameFor(view.cam, m); return [f.x0, f.y0, f.x0 + f.vw, f.y0 + f.vh]; } // Current view [x0, y0, x1, y1]

    drag(x0, y0, w) { // Moved by hand: follow the gesture now, settle the lines and labels once it pauses
        const m = this.quick(), r = this.room(view.cam, m), s = m.W / w;
        cancelAnimationFrame(view.tween);
        const flying = this.trip;
        this.land();
        Object.assign(view.cam, { cx: x0 + r.cxPx / s, cy: y0 + r.cyPx / s, hx: r.w / (2 * s), hy: r.h / (2 * s) }); // The camera that frames this view
        ui.map.classList.add('moving');
        if (flying) this.show(this.frameFor(view.cam, m), m); // Taken over mid-move: no frame left where the move was
        this.shownAt ||= requestAnimationFrame(() => { this.shownAt = 0; this.show(this.frameFor(view.cam, m), m); }); // Many wheel/pointer events per frame: draw once
        clearTimeout(this.settle);
        clearTimeout(this.early);
        this.early = setTimeout(() => this.ahead(m), 40); // A pause in the gesture: the lines for this zoom start on the background thread, ready by the time it lands
        const token = this.settle = setTimeout(() => { // Paused: land (once this zoom's lines are in, if they're nearly there: one change, not two)
            const f = this.frameFor(view.cam, m), coming = map.pending.get(map.viewKey(f.s, { ...view.frame, ...f }));
            const land = () => { if (this.settle !== token) return; cancelAnimationFrame(this.shownAt); this.shownAt = 0; map.layout(); };
            coming ? Promise.race([coming, new Promise(done => setTimeout(done, 250))]).then(land, land) : land(); // (Lands even if that layout failed: never left mid-move)
        }, 150);
    }

    ahead(m) { // Lines for where a hand zoom is now, worked out early (one request at a time: the latest zoom next, not a queue of passed ones)
        if (map.pending.size) { this.again = m; return; }
        const f = this.frameFor(view.cam, m);
        map.geometry(f.s, { ...view.frame, ...f }).then(() => { const next = this.again; this.again = null; if (next && has(ui.map, 'moving')) this.ahead(next); });
    }

    show(f, m) { // Mid-move: shift each layer's last drawing (cheap); redraw a layer once it drifts, at most every 180 ms
        const now = performance.now(), last = this.lastShow, speed = last && now > last.t ? Math.abs(Math.log(f.s / last.s)) / Math.max(1, (now - last.t) / 16.7) : 0; // Zoom per frame
        this.lastShow = { t: now, s: f.s };
        let drew = false; // One layer redrawn per frame where it can wait: no doubled-up frames
        const back = !this.trip && map.backdropCovers(f) && Math.abs((this.groups()[0].frame?.s || 0) / map.backdropAt.f.s - 1) < 1e-6; // Moved by hand, backdrop at the lines' zoom: edges show it, layers redraw only to zoom
        if (has(ui.map, 'panning') !== back) ui.map.classList.toggle('panning', back);
        if (back) { const b = map.backdropAt.f, k = f.s / b.s; ui.backdrop.style.transform = `translate(${((b.x0 - f.x0) * f.s + b.W * (1 - k)).toFixed(2)}px, ${((b.y0 - f.y0) * f.s + b.H * (1 - k)).toFixed(2)}px) scale(${k.toFixed(5)})`; } // (It starts a screen past the top left)
        for (const g of this.groups()) {
            const b = g.frame || f, stretch = Math.min(g.zoom, 1 + Math.max(.015, speed * g.give)); // Fast zooms stretch further; slow ones redraw early (no visible sharpening at the end)
            const covered = back || (f.x0 >= b.x0 && f.y0 >= b.y0 && f.x0 + f.vw <= b.x0 + b.vw && f.y0 + f.vh <= b.y0 + b.vh); // Nothing blank at the edges
            if ((!covered || (f.s > b.s * stretch && !drew)) && now - (g.at || 0) > 180) { // Zoomed in enough to soften its lines, or out/across past the drawing
                if (g.lines && !this.trip) map.zoomClasses(f, m); // (A camera move switches them as it lands: they restyle every dot, so not mid-flight)
                this.draw(g, f);
                g.at = now;
                drew = true;
                if (g.lines) map.respace(f.s);
            } else {
                const move = `translate(${((b.x0 - f.x0) * f.s).toFixed(2)}px, ${((b.y0 - f.y0) * f.s).toFixed(2)}px) scale(${(f.s / b.s).toFixed(5)})`;
                g.get().forEach(el => { el.style.transform = move; });
            }
        }

        map.grow(f.s);
        this.placePins(f, false);
    }

    flyPins({ frames, time }) { // A camera move's station dots, worked out up front: each frame just picks a moment (no restyling sizes)
        const end = map.zAt(frames.at(-1).s), size = c => z => map.dotR(c, z) / map.dotR(c, end), grow = { L: size('L'), M: size('M'), S: size('S') }; // Dot sizes, relative to where the move ends
        this.stopPins(); // A move still running: its animations go (left behind, they'd hold dots in the wrong spots)
        [ui.pins, ui.litPins].forEach(l => { if (l?.style.transform) l.style.transform = ''; }); // (A pan's slide: the dots take it from here)
        map.grow(frames.at(-1).s, true); // Dots laid out once at their final size, then scaled along the way
        const zs = frames.map(f => map.zAt(f.s)), last = frames.at(-1), into = last.s > frames[0].s * 1.05;
        const was = has(ui.map, 'far'), thr = (map.wholeS || 0) * 1.6, fade = f => Math.min(1, Math.max(0, (f.s - thr) / (thr * .5))); // Zooming in past "far": medium and small stations fade in as it passes
        if (into) map.zoomClasses(last, this.quick(), true); // Zooming in: the end's dot styles from the start (nothing pops in on landing)
        const glides = map.labelsAhead(last, time); // Names take their sides for where it lands (they slide there with their dots)
        const far = has(ui.map, 'far'), checks = [0, .25, .5, .75, 1].map(k => frames[Math.round(k * (frames.length - 1))]);
        const seen = p => checks.some(f => { const x = (p._wx - f.x0) * f.s, y = (p._wy - f.y0) * f.s; return x > -80 && y > -80 && x < f.W + 80 && y < f.H + 80; }); // On screen at some point of the move
        const going = (view.pinList || []).filter(p => !has(p, 'gone', 'out', 'absorbed') && !(far && has(p, 'size-S', 'size-M') && !has(p, 'lit', 'picked')) && seen(p)); // Only dots that show (the rest are placed when it lands)
        const plain = p => !p._side && !has(p, 'lit', 'picked', 'ping') && !has(p, 'hot'); // Unnamed: drawn on one canvas (else hundreds of GPU layers)
        this.flat = { frames, time, fade, dots: going.filter(plain).map(p => ({ x: p._wx, y: p._wy, c: pinClass(p), alpha: has(p, 'off') ? .25 : 1, arrives: was && !far && has(p, 'size-S', 'size-M'), span: p._span || 0, rot: p._rot || 0, hollow: p.classList.contains('building') })) };
        this.flying = going.filter(p => !plain(p)).flatMap(p => {
            p.classList.add('live');
            map.applyZ([p]); // Its size where the move ends
            if (p._away) p.classList.toggle('away', p._away = false);
            const scale = grow[pinClass(p)], arrives = was && !far && has(p, 'size-S', 'size-M') && !has(p, 'lit', 'picked'); // (Hidden till now: fades in)
            const a = p.animate(frames.map((f, k) => ({ transform: `translate(${((p._wx - f.x0) * f.s).toFixed(1)}px, ${((p._wy - f.y0) * f.s).toFixed(1)}px) scale(${scale(zs[k]).toFixed(3)})`, ...(arrives && { opacity: fade(f).toFixed(2) }) })), { duration: time, fill: 'forwards' });
            a.pause(); // Stepped by the camera move itself (placePins), so dots and lines always show the same moment
            if (!p._side && has(p, 'size-S')) return [a]; // (Small names rarely show: only those already named)
            const name = MapView.NAME[pinClass(p)], b = p.lastChild.animate(zs.map(z => ({ scale: (name(z) / scale(z)).toFixed(4) })), { duration: time, fill: 'forwards' }); // Shown names grow at their own rate, not the dot's
            b.pause();
            return [a, b];
        });

        const flown = new Set(this.flying.map(a => a.effect.target));
        for (const p of view.pinList || []) if (!flown.has(p) && !p._away) { p.classList.toggle('away', p._away = true); p._on = false; } // The rest hide till it lands (a dot just shown would sit where it was last placed)
        this.flying.push(...glides);
        const c = ui.flat ??= ui.pins.parentNode.insertBefore(Object.assign(document.createElement('canvas'), { className: 'map-dots', ariaHidden: 'true' }), ui.pins), d = dpr(), { W, H } = last;
        if (c.width !== Math.round(W * d) || c.height !== Math.round(H * d)) Object.assign(c, { width: Math.round(W * d), height: Math.round(H * d) });
        this.paintFlat(frames[0]);
    }

    paintFlat(f) { // The plain dots of a camera move at frame f, on one canvas (sized and bordered as the page draws them)
        const c = ui.flat, g = c?.getContext('2d'), F = this.flat;
        if (!g) return;
        g.setTransform(dpr(), 0, 0, dpr(), 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        if (!F?.dots.length) return;
        const z = map.zAt(f.s), deep = getComputedStyle(document.documentElement).getPropertyValue('--navy').trim() || '#0d2344', fade = F.fade(f);
        for (const cls of ['S', 'M', 'L']) {
            const r = map.dotR(cls, z), b = Math.min(r * .45, cls === 'L' ? 2.5 + .5 * z : 2);
            for (const dot of F.dots) {
                if (dot.c !== cls) continue;
                const x = (dot.x - f.x0) * f.s, y = (dot.y - f.y0) * f.s;
                if (x < -r || y < -r || x > f.W + r || y > f.H + r) continue;
                g.globalAlpha = dot.alpha * (dot.arrives ? fade : 1);
                if (dot.span) { // A capsule across several lines (as map.snapPins shapes it)
                    const hx = Math.cos(dot.rot) * dot.span * f.s / 2, hy = Math.sin(dot.rot) * dot.span * f.s / 2;
                    g.lineCap = 'round';
                    [[deep, r], ['#fff', Math.max(0, r - b)]].forEach(([color, w]) => { g.strokeStyle = color; g.lineWidth = 2 * w; g.beginPath(); g.moveTo(x - hx, y - hy); g.lineTo(x + hx, y + hy); g.stroke(); });
                    continue;
                }

                if (dot.hollow) { // Under construction: a white ring, see-through (as styles.css draws .pin.building)
                    const w = Math.min(2, b);
                    g.strokeStyle = '#fff';
                    g.lineWidth = w;
                    g.beginPath(); g.arc(x, y, Math.max(0, r - w / 2), 0, 7); g.stroke();
                    continue;
                }

                g.fillStyle = deep;
                g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
                g.fillStyle = '#fff';
                g.beginPath(); g.arc(x, y, Math.max(0, r - b), 0, 7); g.fill();
            }
        }

        g.globalAlpha = 1;
    }

    land() { // End a camera move's dot animations (their own positions take over)
        this.trip = null;
        this.stopPins();
    }

    stopPins() { // End a GPU dot move (the dots' own positions take over)
        if (this.flat) { this.flat = null; this.paintFlat(); }
        if (!this.flying) return;
        this.flying.forEach(a => a.cancel());
        this.flying = null;
    }

    placePins(f, all = true) { // Position station dots for a frame (mid-move: the layer moves whole until it drifts too far)
        if (this.flying && !all) { const at = this.trip.t * this.trip.time; for (const a of this.flying) a.currentTime = at; return this.paintFlat(f); } // Mid camera move (flyPins)
        const P = this.pinFrame, layers = [ui.pins, ui.litPins].filter(Boolean);
        if (!all && P) {
            const k = f.s / P.s, dx = (P.x0 - f.x0) * f.s, dy = (P.y0 - f.y0) * f.s;
            if (k < 1.15 && k > 1 / 1.15 && Math.abs(dx) < f.W * .2 && Math.abs(dy) < f.H * .2) { // Close to where the dots were placed: one transform, no dot restyled
                const t = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${k.toFixed(4)})`;
                layers.forEach(l => { l.style.transform = t; });
                return;
            }
        }

        layers.forEach(l => { if (l.style.transform) l.style.transform = ''; });
        const flew = this.flying;
        this.flying = null;
        const far = !all && ui.map.classList.contains('far'), padX = f.W * .25, padY = f.H * .25; // Dots a quarter screen off it too: the layer slides them in
        for (const pin of view.pinList || []) {
            if (!all && (has(pin, 'gone', 'out', 'absorbed') || (far && has(pin, 'size-S', 'size-M') && !has(pin, 'lit', 'picked')))) continue;
            pin._x = (pin._wx - f.x0) * f.s;
            pin._y = (pin._wy - f.y0) * f.s;
            const on = pin._x > -padX && pin._y > -padY && pin._x < f.W + padX && pin._y < f.H + padY;
            if (!all && !on && !pin._on) continue; // Off screen before and after: left until it settles
            if (pin._on !== on || pin._away === undefined) pin.classList.toggle('away', pin._away = !on); // (Off screen: hidden outright)
            pin._on = on;
            if (has(pin, 'live')) pin.classList.remove('live'); // (A camera move's GPU layer, no longer needed)
            const t = `translate(${pin._x.toFixed(all ? 0 : 1)}px, ${pin._y.toFixed(all ? 0 : 1)}px)`; // Whole pixels once settled: names stay crisp
            if (pin._t !== t) pin.style.transform = pin._t = t; // Skip unchanged dots (no restyle)
        }

        for (const copy of ui.litPins?.children || []) if (copy._src && copy.style.transform !== copy._src._t) copy.style.transform = copy._src._t; // Hovered route's stops follow too
        this.pinFrame = f; // The layer slides and scales from here
        if (all) map.applyZ(view.pinList || []); // Settled: every dot at this zoom's size (only the changed ones restyle)
        flew?.forEach(a => a.cancel()); // After the final spots are set: no jump
    }

    groups() { // The map's moving SVG layers, by how soon a zoom needs them redrawn
        return this.layerGroups ??= [
            { get: () => [ui.base, ui.litLines, ui.ghost].filter(Boolean), zoom: 1.25, give: 10, lines: true }, // Routes: their widths and spacing show any stretch (the hover layer is made on first use)
            { get: () => [ui.static, ui.edge], zoom: 1.6, give: 16 } // States and Ohio's outline: thin lines, so a fair stretch is barely seen (and they're the costliest to redraw)
        ];
    }

    draw(g, f, settled) { // Redraw one layer group for a frame
        const vb = [f.x0, f.y0, f.vw, f.vh].map(v => v.toFixed(1)).join(' ');
        g.frame = f;
        const els = g.get(), lean = !settled && !!g.lines && has(document.body, 'drawn', 'flat'); // Mid-zoom redraws skip the casings and glows (half the work), back on landing (the intro's zoom too)
        els.forEach(el => { el.style.transform = ''; if (el.classList.contains('lean') !== lean) el.classList.toggle('lean', lean); }); // (Not faded back: fading SVG repaints every line each frame)
        if (g.vb === vb && !settled) return; // Same view: rewriting it would repaint the whole layer
        if (g.vb !== vb) els.forEach(el => el.setAttribute('viewBox', vb));
        g.vb = vb;
        if (g.lines) {
            view.svgFrame = f;
            const K = Lanes.K(f.s, map.homeS || f.s), k = (Math.round(K * 40) / 40).toFixed(3); // Lines slim down zoomed far out
            if (!has(document.body, 'drawn', 'flat')) els.forEach(el => el.style.setProperty('--u', `${(K / f.s).toFixed(4)}px`)); // --u: one screen pixel in map units (only while lines draw in)
            if (els.some(el => el.style.getPropertyValue('--k') !== k)) els.forEach(el => el.style.setProperty('--k', k)); // Lines thicken along the way, never on landing (restyles every line: only on a redraw)
        } else {
            const fade = `translate(${(f.x0 + f.vw / 2).toFixed(1)} ${(f.y0 + f.vh / 2).toFixed(1)}) scale(${(f.vw * .58).toFixed(1)} ${(f.vh * .58).toFixed(1)})`; // Same shape the old CSS mask had
            if (!this.fades?.length) this.fades = document.querySelectorAll('.fade');
            for (const el of this.fades) el.setAttribute('gradientTransform', fade);
        }
    }

    applyFrame(f) { // Settled: every layer drawn for this frame
        this.groups().forEach(g => this.draw(g, f, true));
        view.svgFrame = f;
    }

    bind() { // Drag to pan, scroll or pinch to zoom (once the intro is over)
        const limits = () => { const n = this.network(); return [n.hx * .25, n.hx * 4]; }; // Zoom range (x the network's width)
        const o = {
            off: () => !document.body.classList.contains('drawn'),
            view: () => this.shown(),
            width: w => { const [lo, hi] = limits(); return Math.min(hi, Math.max(lo, w)); },
            move: (x0, y0, w, h) => { const [a0, a1, b0, b1] = this.world ??= bounds(view.allStates.flatMap(s => [[s.box[0], s.box[2]], [s.box[1], s.box[3]]])); const [n0, m0, n1] = held(this.shown(), [a0 - w / 2, b0 - h / 2, a1 + w / 2, b1 + h / 2], x0, y0, w, h); this.drag(n0, m0, n1 - n0); } // The view's centre stays over the states
        };
        panZoom(ui.map, ui.map, o);
        $('.zoom-ctl').addEventListener('click', e => { const b = e.target.closest('[data-zoom]'); if (b && !o.off()) this.zoomStep(o, +b.dataset.zoom); }); // The + / − buttons
    }

    zoomStep(o, dir) { // One step in or out about the map's middle, eased over a quarter second (as a wheel would, in small turns)
        cancelAnimationFrame(this.stepping);
        const steps = 14, f = (dir > 0 ? 1 / 1.6 : 1.6) ** (1 / steps);
        let k = 0;
        const tick = () => {
            const v = o.view(), w = v[2] - v[0], h = v[3] - v[1], nw = o.width(w * f), r = nw / w, mx = (v[0] + v[2]) / 2, my = (v[1] + v[3]) / 2;
            const moves = dir > 0 ? nw < w - 1e-6 : nw > w + 1e-6; // (At the limit: no further)
            if (moves) o.move(mx - (mx - v[0]) * r, my - (my - v[1]) * r, nw, h * r);
            if (++k < steps && moves) this.stepping = requestAnimationFrame(tick);
        };
        tick();
    }

    plan(sec) { // A move to the target: its frames, worked out from where the camera is
        const from = { ...view.cam }, to = this.target(), time = ms(sec * 1000), m = this.measure();
        const at = e => { const c = {}; for (const k in to) c[k] = k === 'hx' || k === 'hy' ? from[k] * (to[k] / from[k]) ** e : from[k] + (to[k] - from[k]) * e; return c; }; // Size changes by ratio: an even-feeling zoom
        return { key: JSON.stringify([from, to, time, m.W, m.H]), to, time, at, frameAt: e => this.frameFor({ ...view.cam, ...at(e) }, m) };
    }

    prepareMove(sec) { // Set up a move's dots now, while the map holds still (the intro's zoom: no hitch as it starts), for move(sec) to run as is
        const p = this.plan(sec);
        if (!view.svgFrame || !p.time) return;
        cancelAnimationFrame(view.tween);
        this.land();
        const n = Math.max(2, Math.round(p.time / 80));
        p.frames = Array.from({ length: n + 1 }, (_, k) => p.frameAt(ease(k / n)));
        ui.map.classList.add('moving');
        this.flyPins({ frames: p.frames, time: p.time });
        this.ready = { ...p, flying: this.flying };
    }

    move(sec = .9) { // Animate to the target, redrawn along the way (show)
        const p = this.plan(sec), ready = this.ready;
        this.ready = null;
        cancelAnimationFrame(view.tween);
        if (ready?.key === p.key && this.flying && this.flying === ready.flying) return this.fly(ready.frameAt, ready.time, e => Object.assign(view.cam, ready.at(e)), ready.frames); // Prepared (its dots already set up)
        this.land();
        if (!view.svgFrame || !p.time) { Object.assign(view.cam, p.to); return map.layout(); }
        this.fly(p.frameAt, p.time, e => Object.assign(view.cam, p.at(e)));
    }

    fly(frameAt, time, cam, prepared) { // Run a camera move: frames worked out up front (dots via flyPins, unless prepared: prepareMove), lines redrawn on the way
        const n = prepared ? prepared.length - 1 : Math.max(2, Math.round(time / 80)); // A keyframe every 80 ms
        let start = null; // (From the first frame drawn: the dots' setup takes a moment, and no part of the move is skipped)
        const frames = prepared || Array.from({ length: n + 1 }, (_, k) => frameAt(ease(k / n))), m = this.measure();
        this.trip = { t: 0, time, frames };
        ui.map.classList.add('moving');
        if (!prepared) this.flyPins(this.trip);
        const step = now => { // One frame of the camera move
            start ??= now;
            const t = this.trip.t = Math.min(1, Math.max(0, (now - start) / time));
            cam?.(ease(t));
            if (t >= 1) {
                const end = frames[n], fin = this.frameFor(view.cam, this.measure()); // The page around the map may have shifted meanwhile (a font, a scrollbar)
                if (cam && Math.max(Math.abs(fin.x0 - end.x0) * fin.s, Math.abs(fin.y0 - end.y0) * fin.s, Math.abs(fin.s / end.s - 1) * fin.W) > .5) return this.fly(e => ({ ...fin, s: end.s * (fin.s / end.s) ** e, x0: end.x0 + (fin.x0 - end.x0) * e, y0: end.y0 + (fin.y0 - end.y0) * e, vw: fin.W / (end.s * (fin.s / end.s) ** e), vh: fin.H / (end.s * (fin.s / end.s) ** e) }), ms(400)); // Glide over to it rather than jump
                this.land();
                return map.layout();
            }

            this.show(frameAt(ease(t)), m);
            view.tween = requestAnimationFrame(step);
        };

        view.tween = requestAnimationFrame(step);
    }
}
