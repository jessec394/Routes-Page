// Present day beside the full buildout: today's lines left of a divider, the buildout's right of it
class SplitView {
    on = false;
    x = 0; // The divider, in px from the map's left edge
    static shift(t) { const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/); return m ? [+m[1], +m[3]] : [0, 1]; } // A layer's x shift and scale

    toggle(on = !this.on) {
        if (on === this.on || (on && !has(document.body, 'drawn'))) return;
        this.on = on;
        press($('[data-split]'), on);
        ui.map.classList.toggle('split', on);
        if (!on) return this.stop();
        if (view.era !== 'buildout') { view.eraChosen = true; controls.setView({ era: 'buildout' }); } // The live map shows the buildout
        this.build();
        const r = camera.room(view.cam, camera.quick());
        this.place(r.cxPx);
        this.paint();
        this.loop();
        $('[role="slider"]', this.bar).focus({ preventScroll: true });
    }

    build() { // Today's lines, and the divider with its labels
        if (!ui.past) ui.dim.after(ui.past = svg('svg', { class: 'map-past', 'aria-hidden': 'true' }));
        ui.past.hidden = false;
        if (this.bar) return void (this.bar.hidden = false);
        this.bar = Object.assign(document.createElement('div'), { className: 'split-bar' });
        this.bar.innerHTML = '<span class="split-label" aria-hidden="true">Present Day</span><span class="split-label right" aria-hidden="true">Full Buildout</span>' +
            '<button class="split-handle" type="button" role="slider" aria-label="Divider: present day to its left, full buildout to its right" aria-valuemin="0" aria-valuemax="100"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg></button>';
        ui.map.append(this.bar);
        const drag = e => this.place(e.clientX - rectOf(ui.map).left);
        this.bar.addEventListener('pointerdown', e => {
            e.stopPropagation(); // Not a map drag
            this.bar.setPointerCapture(e.pointerId);
            this.bar.addEventListener('pointermove', drag);
            this.bar.addEventListener('pointerup', () => this.bar.removeEventListener('pointermove', drag), { once: true });
        });

        ['click', 'dblclick', 'wheel'].forEach(type => this.bar.addEventListener(type, e => e.stopPropagation())); // Not a click on the map's lines
        $('[role="slider"]', this.bar).addEventListener('keydown', e => { // Arrows step it, Home and End to the edges
            const W = ui.map.clientWidth, step = e.shiftKey ? W / 10 : W / 40, to = { ArrowLeft: this.x - step, ArrowRight: this.x + step, Home: 0, End: W }[e.key];
            if (to === undefined) return;
            e.preventDefault();
            this.place(to);
        });
    }

    place(x) { // The divider at x
        const W = ui.map.clientWidth;
        this.x = Math.max(0, Math.min(W, x));
        this.bar.style.setProperty('--x', `${this.x}px`);
        const b = $('[role="slider"]', this.bar), pct = Math.round(100 * this.x / (W || 1));
        b.setAttribute('aria-valuenow', pct);
        b.setAttribute('aria-valuetext', `${pct}% present day`);
        this.clipAt = null; // Clipped again on the next frame
    }

    paint() { // Today's lines for the lanes the map shows now
        const era = 'today';
        map.withEra(era, () => map.geometry(view.frame.s)).then(c => {
            if (!this.on || !ui.past) return;
            const colors = map.withEra(era, () => net.colorsFor()), routes = map.withEra(era, () => [...view.regional.filter(net.regionalShown), ...view.routes.filter(net.shown)]);
            const layers = ['under', 'route'].map(n => svg('g', { class: 'layer-' + n }));
            for (const r of routes) {
                const local = r.lane === Lanes.EDGE, style = `--c:${local ? 'var(--commuter)' : colors.get(r.g) ?? r.color};--w:${r.w}`;
                const [under, line] = ['under', 'route'].map((n, l) => layers[l].appendChild(svg('g', { class: n + (local ? ' regional' : ''), style })));
                (c.d[r.i] || []).forEach(d => { under.append(svg('path', { class: 'casing', d, pathLength: 1 })); line.append(svg('path', { class: 'line', d, pathLength: 1 })); });
            }

            ui.past.replaceChildren(...layers);
            ['--k', '--u'].forEach(k => ui.past.style.setProperty(k, ui.base.style.getPropertyValue(k)));
            ui.past.setAttribute('viewBox', ui.base.getAttribute('viewBox'));
            this.clipAt = null;
        });
    }

    loop() { // Each frame: the clip follows the divider through the map's moves (today's lines move with the rest: camera.groups)
        cancelAnimationFrame(this.raf);
        const frame = () => {
            if (!this.on) return;
            if (view.era !== 'buildout') return this.toggle(false); // Present day chosen: the split's done
            const t = ui.base.style.transform, [tx, k] = SplitView.shift(t);
            const local = (this.x - tx) / k, at = `${local.toFixed(1)}|${t}`;
            if (at !== this.clipAt) {
                this.clipAt = at;
                [ui.base, ui.litLines, ui.ghost].forEach(el => el?.style.setProperty('clip-path', `inset(0 0 0 ${local.toFixed(1)}px)`));
                ui.past.style.clipPath = `inset(0 ${(ui.past.clientWidth - local).toFixed(1)}px 0 0)`;
            }

            if (this.paintedFor !== map.lineKey && !has(ui.map, 'moving')) { this.paintedFor = map.lineKey; this.paint(); } // The lines redrawn for a new zoom: today's too
            this.thin();
            this.raf = requestAnimationFrame(frame);
        };

        this.raf = requestAnimationFrame(frame);
    }

    thin() { // Present day's side: small stations hidden, the big ones kept
        const P = camera.pinFrame, at = P && `${this.x.toFixed(0)}|${P.x0}|${P.y0}|${P.s}|${ui.pins.style.transform}|${view.pinList?.length}`;
        if (!P || at === this.thinAt || has(ui.map, 'moving')) return; // Settled moves only: the dots are flying otherwise
        this.thinAt = at;
        const [tx, k] = SplitView.shift(ui.pins.style.transform);
        for (const p of view.pinList || []) if (has(p, 'size-S')) { const left = tx + k * p._x < this.x; if (has(p, 'split-hide') !== left) p.classList.toggle('split-hide', left); }
    }

    stop() {
        cancelAnimationFrame(this.raf);
        $$('.split-hide', ui.pins).forEach(p => p.classList.remove('split-hide'));
        this.thinAt = null;
        [ui.base, ui.litLines, ui.ghost].forEach(el => el?.style.removeProperty('clip-path'));
        if (ui.past) ui.past.hidden = true;
        if (this.bar) this.bar.hidden = true;
        this.paintedFor = null;
    }
}