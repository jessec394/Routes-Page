// Time jump: today's date spins forward to the buildout, then docks in the banner
class TimeJump {
    static EXPAND = .9; // Banner date growing to centre stage (s)
    static HOLD = .35; // Pause on today's date before the switch flips (s)
    static RUN = 2.1; // Calendar speeding up until it's an unreadable blur (s)
    static BLURRED = 1.4; // Holding at full blur (s)
    static SETTLE = .6; // Sharpening onto 20XX (s)
    static LINGER = .4; // Pause on the future date before it docks (s)
    static DOCK = .85; // Flight back to the banner (s)
    static ROW = 1.25; // Tile height (em), matches .cell b in styles.css
    static DIGITS = '0123456789'; // What year tiles spin through
    big = $('.time-jump'); // Big centred date (intro only)
    when = $('.when'); // Docked date in the banner
    now = new Date();
    prefix = `${this.now.toLocaleString('en-US', { month: 'short' }).toUpperCase().slice(0, 3)} ${String(this.now.getDate()).padStart(2, '0')} `; // E.g. "OCT 11 "
    today = this.prefix + this.now.getFullYear(); // E.g. "OCT 11 2026"
    future = this.prefix + '20XX'; // Some year to come, e.g. "OCT 11 20XX"

    textOf(era) { return era === 'today' ? this.today : this.future; }
    spoken(text) { return text.replace(/ 20XX$/, ', in the future'); } // "OCT 11 20XX" -> "OCT 11, in the future"
    markup(text) { // One flip tile per character
        return [...text].map(c => c === ' ' ? '<span class="gap"></span>' : `<span class="cell${c === 'X' ? ' x' : ''}"><span class="strip"><b>${c}</b></span></span>`).join('');
    }

    sequence(from, to, spins) { // Glyphs a tile scrolls through, ending on `to`
        const set = TimeJump.DIGITS, i = Math.max(0, set.indexOf(from)), n = set.length;
        const steps = spins * n + (set.includes(to) ? (set.indexOf(to) - i + n) % n : 5), out = [from];
        for (let k = 1; k <= steps; k++) out.push(set[(i + k) % n]);
        if (!set.includes(to)) out.push(to);
        return out;
    }

    spin(cell, seq, duration, easing = 'cubic-bezier(.3, .1, .1, 1)') { // Scroll a tile through `seq`, landing on its last glyph
        const strip = $('.strip', cell), to = seq.at(-1);
        cell._anim?.cancel();
        strip.innerHTML = seq.map(g => `<b>${g}</b>`).join('');
        const anim = cell._anim = strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${(1 - seq.length) * TimeJump.ROW}em)` }], { duration: ms(duration), easing, fill: 'forwards' });
        cell.dataset.g = to;
        return anim.finished.then(() => {
            strip.innerHTML = `<b>${to}</b>`;
            anim.cancel();
            cell.classList.toggle('x', to === 'X');
        }, () => {});
    }

    show(cell, g, now, quick) { // Show a glyph: a short flip if there's time, else an instant swap
        if (cell.dataset.g === g) return;
        if (!quick && now - (cell._t || 0) > 120) this.spin(cell, [cell.dataset.g ?? g, g], 110, 'ease-out');
        else { cell._anim?.cancel(); $('.strip', cell).innerHTML = `<b>${g}</b>`; cell.dataset.g = g; }
        cell._t = now;
    }

    roll(root, from, to) { // Docked date: spin the changed tiles to the new text
        const cells = $$('.cell', root), a = from.replace(/ /g, ''), b = to.replace(/ /g, '');
        root.setAttribute('aria-label', this.spoken(to));
        return Promise.all(cells.map((cell, k) => a[k] !== b[k] && this.spin(cell, this.sequence(a[k], b[k], 0), 650 + k * 40)));
    }

    travel(root, duration) { // Intro: dates speed up to a blur, hold, then settle on 20XX
        const cells = $$('.cell', root), target = this.future.replace(/ /g, ''), MAX_BLUR = .18; // Blur (em) once unreadable
        const start = new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()), decade = Math.floor(start.getFullYear() / 10) * 10 + 10;
        const blurFrom = new Date(decade - 2, 0, 1), blurFull = new Date(decade + 2, 0, 1), decadeEnd = new Date(decade + 10, 0, 1); // E.g. sharp until 2028, unreadable by 2032, never past 2039
        const settle = TimeJump.SETTLE * 1000, run = Math.max(500, duration - settle - TimeJump.BLURRED * 1000), speed = 2.5 * (blurFull - start) / run; // Top speed (ms of calendar per ms)
        const month = d => d.toLocaleString('en-US', { month: 'short' }).toUpperCase().slice(0, 3);
        const text = d => `${month(d)}${String(d.getDate()).padStart(2, '0')}${d.getFullYear()}`; // Tile characters, e.g. "OCT112026"
        let shownBlur = -1;
        const blur = b => { if (Math.abs(b - shownBlur) > .002) root.style.setProperty('--blur', `${(shownBlur = b).toFixed(3)}em`); }; // Only repaint when it changes
        cells.forEach((cell, k) => { cell.dataset.g = this.today.replace(/ /g, '')[k]; });
        root.setAttribute('aria-label', this.spoken(this.future));
        return new Promise(done => {
            let t0 = null, prev = +start, lastSwap = 0;
            const step = now => {
                if (this.halted) return done(); // Intro skipped
                t0 ??= now;
                const e = now - t0;
                if (e < duration - settle) { // Running: speeding through real dates, then holding at full blur
                    const d = new Date(e < run ? +start + (e / run) ** 2.5 * (blurFull - start) : +blurFull + ((e - run) * speed) % (decadeEnd - blurFull)), days = Math.abs(d - prev) / 864e5;
                    const b = MAX_BLUR * Math.min(1, Math.max(0, (d - blurFrom) / (blurFull - blurFrom))) ** 1.5;
                    prev = +d;
                    if (b < MAX_BLUR * .6 || now - lastSwap > 45) { // Once it's too blurred to read, fewer glyph swaps (lighter to repaint)
                        const chars = text(d);
                        cells.forEach((cell, k) => this.show(cell, chars[k], now, k < 3 ? days > 20 : k < 5 ? days > 1.5 : days > 200));
                        lastSwap = now;
                    }

                    blur(b);
                    return requestAnimationFrame(step);
                }

                const s = Math.min(1, (e - duration + settle) / settle); // Settling: the target date comes into focus
                cells.forEach((cell, k) => { this.show(cell, target[k], now, true); cell.classList.toggle('x', target[k] === 'X'); });
                blur(MAX_BLUR * (1 - s) ** 2);
                if (s < 1) return requestAnimationFrame(step);
                root.style.removeProperty('--blur');
                done();
            };

            requestAnimationFrame(step);
        });
    }

    set(era, animate) { // Docked date follows the era switch
        const text = this.textOf(era), shown = this.when.dataset.text;
        if (shown === text) return;
        this.when.dataset.text = text;
        if (!animate || !shown) {
            this.when.innerHTML = this.markup(text);
            this.when.setAttribute('aria-label', this.spoken(text));
            return this.when.classList.add('on');
        }

        this.roll(this.when, shown, text);
    }

    stop() { // Intro skipped: no big date, final date in the banner
        this.halted = true;
        this.big.hidden = true;
        this.when.classList.remove('away');
        this.set(view.era, false);
    }

    play() { // Intro: the date grows to centre, spins while the buildout draws, then docks
        const date = $('.time-jump-date', this.big), spinAt = view.switchAt + Intro.BEAT;
        intro.after(view.jumpAt, () => this.expand());
        intro.after(spinAt + .05, () => this.travel(date, (view.drawEnd - spinAt - .05) * 1000)); // Just after the flip's busy moment, so the date doesn't stall as it takes off
        intro.after(view.drawEnd + TimeJump.LINGER, () => this.dock());
    }

    expand() { // Banner date grows out to the centre of the map
        const date = $('.time-jump-date', this.big), from = rectOf(this.when);
        date.innerHTML = this.markup(this.today);
        this.big.classList.add('on');
        if (!from.width) return; // No banner date on small screens: just fade in
        this.when.classList.add('away');
        date.animate([{ transform: flight(from, rectOf(date)) }, { transform: 'none' }], { duration: TimeJump.EXPAND * 1000, easing: GLIDE, fill: 'backwards' });
    }

    dock() { // Big date flies back into the banner
        const big = this.big, date = $('.time-jump-date', big);
        this.set('buildout', false);
        const to = rectOf(this.when), from = rectOf(date);
        big.classList.add('docking');
        if (!to.width) return big.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' }).finished.then(() => { big.hidden = true; }); // Small screens: fade out
        date.animate([{ transform: 'none' }, { transform: flight(to, from) }], { duration: TimeJump.DOCK * 1000, easing: GLIDE, fill: 'forwards' }).finished.then(() => {
            this.when.classList.remove('away');
            big.hidden = true;
        });
    }
}

// Intro sequence
class Intro {
    static BEAT = .5; // Seconds between the switch flip and the buildout starting to draw
    static OVERVIEW = 1.2; // Whole country on screen before zooming in (s, after the page enters)
    static ZOOM = 3.2; // The zoom into the local view (s)
    static SETTLE = 5; // Zoom in, then pause while Ohio's outline traces in (s), before the jump to the future
    locked = [ui.top, $('.stage')]; // Nothing interactive until the intro ends
    timers = new Set(); // Pending intro steps (cleared by skip)
    skipButton = $('.skip-intro');

    after(sec, fn) { // Run fn `sec` seconds into the intro, unless it's skipped
        const id = later(sec, () => { this.timers.delete(id); fn(); });
        this.timers.add(id);
    }

    skip() { // Jump straight to the finished map
        if (this.done) return;
        if (!document.body.classList.contains('ready')) { this.wantSkip = true; return this.cutSplash?.(); } // Still on the splash: end it now, then skip as soon as the map is up
        this.timers.forEach(clearTimeout);
        this.timers.clear();
        if (view.switchAt != null && !view.eraChosen && view.era !== 'buildout') { // Land on Full Buildout, as the intro would
            controls.showEra('buildout');
            view.era = 'buildout';
            if (net.recolor()) map.recolor();
            controls.sync();
            map.layout();
            map.drawRoutes(view.frame.s);
        }

        this.unflat();
        if (view.zoomInAt != null) { // On the country overview or zooming in: straight to the local view
            cancelAnimationFrame(view.tween);
            view.wide = false;
            Object.assign(view.cam, camera.target());
            map.layout();
        }

        map.finishGlide();
        timeJump.stop();
        ui.era.classList.remove('grow');
        ui.map.classList.remove('flash');
        document.getAnimations().forEach(a => { if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish(); }); // Entrances and draw-ins jump to their end
        this.finish();
    }

    plan() { // Draw-in start times: today's routes, the flip, then the buildout
        const phase1 = view.routes.filter(r => net.inEra('today', r)), phase2 = view.routes.filter(r => net.inEra('buildout', r) && !phase1.includes(r));
        const LEAD = still ? 0 : view.linked ? .9 : 1.2; // Let the header/sidebar enter first
        const endOf = (list, plan) => Math.max(0, ...list.map(r => plan.get(r.i) + r.len / r.speed)); // When the last of these routes finishes
        const shift = (plan, dt) => plan.forEach((t, k) => plan.set(k, t + dt)); // Delay every start
        view.instant = new Set(); // Swapped without fading
        if (view.linked) { // Shared link: only that route draws
            const drawn = net.members(view.linked.i).map(i => view.routes[i]).filter(net.shown), own = this.drawPlan(drawn);
            shift(own, LEAD);
            const plan = new Map(view.routes.map(r => [r.i, own.get(r.i) ?? -100])); // Minus 100: already drawn
            Object.assign(view, { switchAt: null, drawEnd: endOf(drawn, own) });
            return { plan, drawn, startOf: r => plan.get(r.i) };
        }

        const overview = !!view.wide, plan1 = overview ? new Map(phase1.map(r => [r.i, -100])) : this.drawPlan(phase1), plan2 = this.drawPlan(phase2, phase1); // Overview: today's routes already in place
        if (!overview) shift(plan1, LEAD);
        shift(plan2, still ? 0 : Intro.BEAT); // Beat after the flip
        const temps = phase1.filter(t => statusKind(t.status) === 'temporary' && t.lane !== t.g); // Temporary route + its partner swap instantly
        phase2.filter(r => temps.some(t => t.lane === r.g)).forEach(r => { plan2.set(r.i, -100); view.instant.add(r.i); });
        temps.forEach(t => view.instant.add(t.i));
        const natural = endOf(phase2, plan2) - Intro.BEAT, wanted = TimeJump.RUN + TimeJump.BLURRED + TimeJump.SETTLE;
        if (!still && phase2.length && natural < wanted) { // Stretch the buildout's draw-in to last as long as the date sequence
            const f = wanted / natural;
            phase2.forEach(r => { if (plan2.get(r.i) > -100) { plan2.set(r.i, Intro.BEAT + (plan2.get(r.i) - Intro.BEAT) * f); r.speed /= f; } });
        }

        view.zoomInAt = overview ? LEAD + Intro.OVERVIEW : null;
        const ready = overview ? view.zoomInAt + Intro.SETTLE : endOf(phase1, plan1) + .3; // Today's map is in place
        view.jumpAt = phase2.length && !still ? ready : null; // Big date appears
        view.switchAt = phase2.length ? (still ? 0 : ready + (view.jumpAt != null ? TimeJump.EXPAND + TimeJump.HOLD : 0)) : null;
        view.drawEnd = phase2.length ? view.switchAt + endOf(phase2, plan2) : Math.max(endOf(phase1, plan1), ready - .3);
        const plan = new Map(view.routes.map(r => [r.i, plan1.get(r.i) ?? plan2.get(r.i) ?? 0])); // Phase 2 counts from the flip
        return { plan, drawn: [...phase1, ...phase2], startOf: r => plan2.has(r.i) ? Math.max(0, plan.get(r.i)) : plan.get(r.i), fromFlip: new Set(plan2.keys()) }; // Buildout lines (and their new stations) start counting when the era flips
    }

    drawPlan(list, before = []) { // Start times so routes branch off each other; `before` = already drawn
        const starts = new Map(), memo = new Map(), count = {};
        const along = (r, name) => { // Distance along route r to a station (cached)
            const key = `${r.i}|${name}`;
            if (!memo.has(key)) {
                const p = net.cityXY(name);
                let best = 25, at = null, run = 0;
                if (p) r.runs.forEach(pts => pts.forEach((q, k) => { if (k) run += dist(q, pts[k - 1]); if (dist(q, p) < best) { best = dist(q, p); at = run; } }));
                memo.set(key, at);
            }

            return memo.get(key);
        };

        before.forEach(r => starts.set(r.i, -1e4));
        if (!before.length) {
            list.forEach(r => { count[r.stops[0]] = (count[r.stops[0]] || 0) + 1; });
            const root = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
            list.forEach(r => r.stops[0] === root && starts.set(r.i, .5));
        }

        const pending = list.filter(r => !starts.has(r.i));
        while (pending.length) {
            let best = { r: pending[0], t: .5 }, found = false;
            pending.forEach(r => starts.forEach((t, j) => {
                const a = along(view.routes[j], r.stops[0]), at = a === null ? null : t + a / view.routes[j].speed;
                if (at !== null && (!found || at < best.t)) { best = { r, t: at }; found = true; }
            }));

            starts.set(best.r.i, Math.max(.2, best.t));
            pending.splice(pending.indexOf(best.r), 1);
        }

        before.forEach(r => starts.delete(r.i));
        return starts;
    }

    landing() { return camera.frameFor({ ...view.cam, ...view.home, left: view.legend ? 1 : 0 }, camera.measure()); } // The local view the intro zooms into

    prepareZoom() { // Before the zoom: the local view's lanes and line density ready (names placed once, for the landing)
        if (!view.wide) return;
        view.wide = false;
        ui.map.classList.add('moving'); // Names stay put for the overview (they're placed for the landing by the move)
        view.frame = this.landing();
        map.drawRoutes(view.frame.s); // (Worked out during the overview: no jump at the end)
        this.gridReady = Promise.race([map.gridReady, wait(500)]);
    }

    zoomIn() { // From the whole country down to the local view
        this.prepareZoom();
        (this.gridReady || Promise.resolve()).then(() => requestAnimationFrame(() => {
            if (this.done) return;
            camera.move(Intro.ZOOM);
            this.after(Intro.ZOOM + .2, () => this.unflat());
        }));
    }

    unflat() { // Lines back to map-unit widths before the buildout draws in (its dashes need them)
        if (!document.body.classList.contains('flat')) return;
        document.body.classList.remove('flat');
        camera.applyFrame(view.svgFrame);
    }

    flipEra() { // Switch grows, flips to Full Buildout, lines re-space, then settles
        this.after(Math.max(0, view.switchAt - .5), () => !view.eraChosen && ui.era.classList.add('grow'));
        this.after(view.switchAt + 1.3, () => ui.era.classList.remove('grow'));
        this.after(view.switchAt, () => { // The switch flips first...
            if (view.eraChosen || view.era !== 'today') return;
            controls.showEra('buildout');
            ui.map.classList.add('flash');
            setTimeout(() => ui.map.classList.remove('flash'), 1600);
        });

        this.after(view.switchAt + Intro.BEAT, () => { // ...then the buildout draws and the lines re-space
            if (view.eraChosen || view.era !== 'today') return;
            view.era = 'buildout';
            if (view.jumpAt == null) timeJump.set(view.era, false);
            if (net.recolor()) map.recolor(); // (Worked out during the splash)
            controls.sync();
            map.focusRoutesAndStations();
            map.layout(true);
        });
    }

    settle() { // Lines and dots in their finished styles (a heavy restyle: done at a still moment)
        if (document.body.classList.contains('drawn')) return;
        document.body.classList.add('drawn');
        map.focusRoutesAndStations();
    }

    finish() { // Unlock the page; start the background videos
        if (this.done) return;
        this.done = true;
        this.skipButton.hidden = true;
        this.settle();
        this.locked.forEach(el => { el.inert = false; });
        setTimeout(() => map.prewarm(), 2500);
        introDone();
    }

    start() { // Splash, then draw in once the map and fonts are ready
        this.locked.forEach(el => { el.inert = true; });
        this.skipButton.hidden = still; // Offer a way past the intro straight away
        const mapReady = getJSON('data/map.json').then(data => map.render(data)).catch(e => console.warn(`Map not loaded: ${e}. Run serve.py.`));
        const splash = Promise.race([wait(START_ROUTE ? 0 : still ? 600 : 2800), new Promise(done => { this.cutSplash = done; })]); // Minimum splash time (skipping cuts it short)
        Promise.all([splash, Promise.race([Promise.allSettled([document.fonts.ready, mapReady]), wait(4000)])]).then(() => requestAnimationFrame(() => {
            void ui.map.offsetWidth; // Settle the starting state before transitions turn on
            document.body.classList.add('ready', 'settled');
            brandMap.place();
            if (view.zoomInAt != null) { // Work out the local view's lines while the country shows, then zoom in
                const ahead = (era = view.era) => idle(() => { // One piece per quiet moment, so the overview stays smooth
                    const saved = [view.frame, view.era];
                    [view.frame, view.era] = [this.landing(), era];
                    try { map.precompute(view.frame); net.colorsFor(); } finally { [view.frame, view.era] = saved; }
                }, 800);
                ahead(); ahead('buildout'); // Today's and the buildout's: nothing heavy left for the zoom, the trace or the flip
                this.after(view.zoomInAt - .5, () => this.prepareZoom()); // Heavy setup while the overview holds still
                this.after(view.zoomInAt, () => this.zoomIn());
            }
            if (view.switchAt != null) this.flipEra();
            timeJump.set(view.era, false); // Date shows in the banner from the start
            if (view.jumpAt != null) timeJump.play();
            this.after((view.drawEnd || 0) + .1, () => this.settle()); // The finished map's styles while everything holds still (the date lingers): one restyle, not a stutter mid-move
            this.after((view.drawEnd || 0) + (view.jumpAt != null ? TimeJump.LINGER + TimeJump.DOCK : .3), () => this.finish()); // Unlock once the date has docked
            if (this.wantSkip) this.skip(); // Skip was pressed during the splash
        }));
    }
}
