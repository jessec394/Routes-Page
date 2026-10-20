// Camera
class Camera {
    home(near = this.near) { // Default regional view (near: a state picked on the map, framed closer)
        this.near = near;
        const own = view.routes.filter(r => !r.context), base = own.filter(r => r.typeKey === 'state'), pts = [...view.fp, ...(base.length ? base : own).flatMap(r => r.xy)]; // Featured routes only
        const [x0, x1, y0, y1] = bounds(view.fp), c = [(x0 + x1) / 2, (y0 + y1) / 2]; // Centred on the focus state
        const size = a => a ? y1 - y0 : x1 - x0, half = a => Math.max(Math.min(Math.max(...pts.map(p => Math.abs(p[a] - c[a]))), size(a) * (near ? .75 : 1.25)), size(a) * .58) * 1.06; // Half-extent on one axis: long routes don't pull it far past the state, and all of the state shows
        const { w, h } = this.room({ side: 0, left: view.legend ? 1 : 0 }, this.measure()), s = Math.max(Math.min(w / (2 * half(0)), h / (2 * half(1))), Math.min(w / (x1 - x0) / 1.5, h / (y1 - y0) / 1.5)); // A tall or narrow map still fills with the state (not the far ends of its routes)
        return { cx: c[0], cy: c[1], hx: w / (2 * s), hy: h / (2 * s), side: 0 };
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
        return this.held = { W, H, topH, cardW: ui.card.offsetWidth || Math.min(21 * rem, W - 2 * rem), cardH: ui.card.hidden ? 0 : ui.card.offsetHeight, dockH: ui.dock.offsetHeight };
    }

    room({ side, left }, { W, H, topH, cardW, cardH, dockH }) { // Free area for the map (px): width, height, centre, top
        const wide = W > NARROW, beside = wide || pageH() <= SHORT, padX = W < 700 ? 12 : 40; // (A phone on its side: the card sits beside the map too)
        const right = beside ? side * (cardW + 24) : 0, leftGap = wide ? left * ((view.legendW || 248) + 56) : 0;
        const dock = dockH ? dockH + 24 : 16, card = !beside && cardH ? side * (cardH + 24) : 0;
        const top = topH + 12, bottom = H - Math.max(dock, card);
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
        this.settle = setTimeout(() => { cancelAnimationFrame(this.shownAt); this.shownAt = 0; map.layout(); }, 200);
    }

    show(f, m) { // Mid-move: shift each layer's last drawing (cheap); redraw a layer once it drifts, at most every 120 ms
        const now = performance.now(), last = this.lastShow, speed = last && now > last.t ? Math.abs(Math.log(f.s / last.s)) / Math.max(1, (now - last.t) / 16.7) : 0; // Zoom per frame
        this.lastShow = { t: now, s: f.s };
        let drew = false; // One layer redrawn per frame where it can wait: no doubled-up frames
        const back = !this.trip && map.backdropCovers(f) && Math.abs((this.groups()[0].frame?.s || 0) / map.backdropAt.f.s - 1) < 1e-6; // Moved by hand, backdrop at the lines' zoom: edges show it, layers redraw only to zoom
        if (has(ui.map, 'panning') !== back) ui.map.classList.toggle('panning', back);
        if (back) { const b = map.backdropAt.f, k = f.s / b.s; ui.backdrop.style.transform = `translate(${((b.x0 - f.x0) * f.s + b.W * (1 - k)).toFixed(2)}px, ${((b.y0 - f.y0) * f.s + b.H * (1 - k)).toFixed(2)}px) scale(${k.toFixed(5)})`; } // (It starts a screen past the top left)
        for (const g of this.groups()) {
            const b = g.frame || f, stretch = Math.min(g.zoom, 1 + Math.max(.015, speed * g.give)); // Fast zooms stretch further; slow ones redraw early (no visible sharpening at the end)
            const covered = back || (f.x0 >= b.x0 && f.y0 >= b.y0 && f.x0 + f.vw <= b.x0 + b.vw && f.y0 + f.vh <= b.y0 + b.vh); // Nothing blank at the edges
            if ((!covered || (f.s > b.s * stretch && !drew)) && now - (g.at || 0) > 120) { // Zoomed in enough to soften its lines, or out/across past the drawing
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
        const far = has(ui.map, 'far'), checks = [0, .25, .5, .75, 1].map(k => frames[Math.round(k * (frames.length - 1))]);
        const seen = p => checks.some(f => { const x = (p._wx - f.x0) * f.s, y = (p._wy - f.y0) * f.s; return x > -80 && y > -80 && x < f.W + 80 && y < f.H + 80; }); // On screen at some point of the move
        this.flying = (view.pinList || []).filter(p => !has(p, 'gone', 'out', 'absorbed') && !(far && has(p, 'size-S', 'size-M') && !has(p, 'lit', 'picked')) && seen(p)).flatMap(p => { // Only dots that show (the rest are placed when it lands)
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
    }

    land() { // End a camera move's dot animations (their own positions take over)
        this.trip = null;
        this.stopPins();
    }

    stopPins() { // End a GPU dot move (the dots' own positions take over)
        if (!this.flying) return;
        this.flying.forEach(a => a.cancel());
        this.flying = null;
    }

    placePins(f, all = true) { // Position station dots for a frame (mid-move: the layer moves whole until it drifts too far)
        if (this.flying && !all) { const at = this.trip.t * this.trip.time; for (const a of this.flying) a.currentTime = at; return; } // Mid camera move (flyPins)
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
            { get: () => [ui.base, ui.litLines, ui.ghost].filter(Boolean), zoom: 1.1, give: 10, lines: true }, // Routes: their widths and spacing show any stretch (the hover layer is made on first use)
            { get: () => [ui.static, ui.edge], zoom: 1.25, give: 16 } // States and Ohio's outline: thin lines, so a little stretch is invisible (and they're the costliest to redraw)
        ];
    }

    draw(g, f, settled) { // Redraw one layer group for a frame
        const vb = [f.x0, f.y0, f.vw, f.vh].map(v => v.toFixed(1)).join(' ');
        g.frame = f;
        const els = g.get();
        els.forEach(el => { el.style.transform = ''; });
        if (g.vb === vb && !settled) return; // Same view: rewriting it would repaint the whole layer
        if (g.vb !== vb) els.forEach(el => el.setAttribute('viewBox', vb));
        g.vb = vb;
        if (g.lines) {
            view.svgFrame = f;
            const K = Lanes.K(f.s, map.homeS || f.s), k = (Math.round(K * 40) / 40).toFixed(3); // Lines slim down zoomed far out
            if (!has(document.body, 'drawn', 'flat')) els.forEach(el => el.style.setProperty('--u', `${(K / f.s).toFixed(4)}px`)); // --u: one screen pixel in map units (only while lines draw in)
            if ((settled || this.trip) && els.some(el => el.style.getPropertyValue('--k') !== k)) els.forEach(el => el.style.setProperty('--k', k)); // Settled, or a move's redraws (lines thicken on the way, not on landing): restyles every line
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
        panZoom(ui.map, ui.map, {
            off: () => !document.body.classList.contains('drawn'),
            view: () => this.shown(),
            width: w => { const [lo, hi] = limits(); return Math.min(hi, Math.max(lo, w)); },
            move: (x0, y0, w, h) => { const [a0, a1, b0, b1] = this.world ??= bounds(view.allStates.flatMap(s => [[s.box[0], s.box[2]], [s.box[1], s.box[3]]])); const [n0, m0, n1] = held(this.shown(), [a0 - w / 2, b0 - h / 2, a1 + w / 2, b1 + h / 2], x0, y0, w, h); this.drag(n0, m0, n1 - n0); } // The view's centre stays over the states
        });
    }

    move(sec = .9) { // Animate to the target, redrawn along the way (show)
        const from = { ...view.cam }, to = this.target(), time = ms(sec * 1000);
        cancelAnimationFrame(view.tween);
        this.land();
        if (!view.svgFrame || !time) { Object.assign(view.cam, to); return map.layout(); }
        const m = this.measure(), at = e => { const c = {}; for (const k in to) c[k] = k === 'hx' || k === 'hy' ? from[k] * (to[k] / from[k]) ** e : from[k] + (to[k] - from[k]) * e; return c; }; // Size changes by ratio: an even-feeling zoom
        this.fly(e => this.frameFor({ ...view.cam, ...at(e) }, m), time, e => Object.assign(view.cam, at(e)));
    }

    fly(frameAt, time, cam) { // Run a camera move: frames worked out up front (dots via flyPins), lines redrawn on the way
        const n = Math.max(2, Math.round(time / 80)); // A keyframe every 80 ms
        let start = null; // (From the first frame drawn: the dots' setup takes a moment, and no part of the move is skipped)
        const frames = Array.from({ length: n + 1 }, (_, k) => frameAt(ease(k / n))), m = this.measure();
        this.trip = { t: 0, time, frames };
        ui.map.classList.add('moving');
        this.flyPins(this.trip);
        this.flying.push(...map.labelsAhead(frames[n], time)); // Names move once, with the dots (worked out before the first frame moves)
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
