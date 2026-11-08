// Time jump: today's date spins forward to the buildout, then docks in the banner
class TimeJump {
    static RUN = 2.1; // Calendar speeding up until it's an unreadable blur
    static BLURRED = 1.4; // Holding at full blur
    static SETTLE = .6; // Sharpening onto 20XX
    static ROW = 1.25; // Tile height, matches .cell b in styles.css
    static DIGITS = '0123456789'; // What year tiles spin through
    when = $('.when'); // Docked date in the banner
    now = new Date();
    prefix = `${this.now.toLocaleString('en-US', { month: 'short' }).toUpperCase().slice(0, 3)} ${String(this.now.getDate()).padStart(2, '0')} `; // Eg "OCT 11 "
    today = this.prefix + this.now.getFullYear(); // Eg "OCT 11 2026"
    future = this.prefix + '20XX'; // Some year to come, eg "OCT 11 20XX"

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

    show(cell, g, now, quick) { // Show a glyph
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
        const cells = $$('.cell', root), target = this.future.replace(/ /g, ''), MAX_BLUR = .18; // Blur once unreadable
        const start = new Date(this.now.getFullYear(), this.now.getMonth(), this.now.getDate()), decade = Math.floor(start.getFullYear() / 10) * 10 + 10;
        const blurFrom = new Date(decade - 2, 0, 1), blurFull = new Date(decade + 2, 0, 1), decadeEnd = new Date(decade + 10, 0, 1); // Eg sharp until 2028, unreadable by 2032, never past 2039
        const settle = TimeJump.SETTLE * 1000, run = Math.max(500, duration - settle - TimeJump.BLURRED * 1000), speed = 2.5 * (blurFull - start) / run; // Top speed
        const month = d => d.toLocaleString('en-US', { month: 'short' }).toUpperCase().slice(0, 3);
        const text = d => `${month(d)}${String(d.getDate()).padStart(2, '0')}${d.getFullYear()}`; // Tile characters, eg "OCT112026"
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
                    if (b < MAX_BLUR * .6 || now - lastSwap > 45) { // Once it's too blurred to read, fewer glyph swaps
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
        if (!animate || !shown) { this.when.innerHTML = this.markup(text); this.when.setAttribute('aria-label', this.spoken(text)); return this.when.classList.add('on'); }
        this.roll(this.when, shown, text);
    }

    spinDocked(duration) { this.when.dataset.text = this.future; return this.travel(this.when, duration); } // Intro: the banner's date itself speeds through the years to 20XX as the buildout draws
    stop() { this.halted = true; this.set(view.era, false); } // Intro skipped: no big date, final date in the banner
}

// Intro sequence
class Intro {
    static BEAT = .5; // Seconds between the switch flip and the buildout starting to draw
    static PAUSE = 1; // Today's map, already drawn, holds this long before the switch flips to the buildout
    static SPLASH = 5; // Seconds the splash shows at least, the title played out and the first clip buffering meanwhile: not for links, embeds or a skip
    locked = [ui.top, $('.stage')]; // Nothing interactive until the intro ends
    timers = new Set(); // Pending intro steps

    after(sec, fn) { // Run fn `sec` seconds into the intro, unless it's skipped
        const id = later(sec, () => { this.timers.delete(id); fn(); });
        this.timers.add(id);
    }

    skip() { // Jump straight to the finished map
        if (this.done) return;
        if (!has(document.body, 'ready')) { this.wantSkip = true; this.endSplash?.(); return; } // Not shown yet: skip once it is, the splash cut short
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

        map.finishGlide();
        timeJump.stop();
        ui.era.classList.remove('grow');
        ui.map.classList.remove('flash');
        document.getAnimations().forEach(a => { if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish(); }); // Entrances and draw-ins jump to their end
        this.finish();
    }

    plan() { // Draw-in start times
        const phase1 = view.routes.filter(r => net.inEra('today', r)), phase2 = view.routes.filter(r => net.inEra('buildout', r) && !phase1.includes(r));
        const LEAD = still ? 0 : view.linked ? .25 : 1.2; // Let the header/sidebar enter first
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

        const plan1 = new Map(phase1.map(r => [r.i, -100])), plan2 = this.drawPlan(phase2, phase1); // Today's routes already in place
        shift(plan2, still ? 0 : Intro.BEAT); // Beat after the flip
        const labels = new Set(phase2.map(r => r.label)), heirs = new Map(); // Today's routes going by another name in the buildout, eg renamed: handed to the buildout route mostly along their track
        phase1.filter(t => !labels.has(t.label) && !net.inEra('buildout', t)).forEach(t => {
            const fit = r => Math.min(...t.runs.map(run => { const s = Intro.shared(run, r.runs); return s ? s.b - s.a : 0; })); // How much of today's route it follows
            const [heir, share] = phase2.filter(r => !phase1.some(o => o.label === r.label)).map(r => [r, fit(r)]).sort((x, y) => y[1] - x[1])[0] ?? [];
            if (share >= .8) bucket(heirs, heir.label).push(t);
        });

        const before = r => [...phase1.filter(t => t.label === r.label), ...heirs.get(r.label) ?? []]; // A buildout route's versions running today
        phase2.forEach(r => {
            const was = before(r);
            if (!was.length) return;
            if (r.today === false && !net.proposed(r)) plan2.set(r.i, -100); // Carrying on unchanged: there from the start
            else if (plan2.get(r.i) > -100) { // Changing: today's stretch stays, the rest draws on from it
                const parts = r.runs.map(run => Intro.shared(run, was.flatMap(t => t.runs)));
                if (!parts.some(Boolean)) return;
                r.drawFrom = parts;
            } else return;
            view.instant.add(r.i);
            was.forEach(t => view.instant.add(t.i)); // Today's version gives way at once
        });

        const temps = phase1.filter(t => statusKind(t.status) === 'temporary' && t.lane !== t.g); // Temporary route + its partner swap instantly
        phase2.filter(r => temps.some(t => t.lane === r.g)).forEach(r => { plan2.set(r.i, -100); view.instant.add(r.i); });
        temps.forEach(t => view.instant.add(t.i));
        const natural = endOf(phase2, plan2) - Intro.BEAT, wanted = TimeJump.RUN + TimeJump.BLURRED + TimeJump.SETTLE;
        if (!still && phase2.length && natural < wanted) { // Stretch the buildout's draw-in to last as long as the date sequence
            const f = wanted / natural;
            phase2.forEach(r => { if (plan2.get(r.i) > -100) { plan2.set(r.i, Intro.BEAT + (plan2.get(r.i) - Intro.BEAT) * f); r.speed /= f; } });
        }

        const ready = still ? 0 : Intro.PAUSE;
        view.switchAt = phase2.length ? ready : null;
        view.drawEnd = phase2.length ? view.switchAt + endOf(phase2, plan2) : ready;
        const plan = new Map(view.routes.map(r => [r.i, plan1.get(r.i) ?? plan2.get(r.i) ?? 0])); // Phase 2 counts from the flip
        return { plan, drawn: [...phase1, ...phase2], startOf: r => plan2.has(r.i) ? Math.max(0, plan.get(r.i)) : plan.get(r.i), fromFlip: new Set(plan2.keys()) }; // Buildout lines start counting when the era flips
    }

    static shared(run, was, near = 3, gap = 12) { // The longest stretch of a run along old track, short detours included: { a, b } as shares of its length, or null
        const pts = resample(run, 1.5), at = [0], on = pts.map(p => was.some(w => { for (let k = 1; k < w.length; k++) if (segDist(p, w[k - 1], w[k]) <= near) return true; return false; }));
        for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + dist(pts[k], pts[k - 1]));
        const total = at.at(-1) || 1;
        let best = null, start = -1, last = -1;
        for (let k = 0; k < pts.length; k++) {
            if (!on[k]) continue;
            if (start < 0 || at[k] - at[last] > gap) start = k; // Off it too long: a new stretch begins
            last = k;
            if (!best || at[k] - at[start] > best.len) best = { len: at[k] - at[start], a: at[start] / total, b: at[k] / total };
        }

        if (!best || best.len / total < .05) return null;
        return { a: best.a < .01 ? 0 : best.a, b: best.b > .99 ? 1 : best.b }; // Today's stretch shows at once, the rest draws on outward from both its ends
    }

    drawPlan(list, before = []) { // Start times so routes branch off each other
        const starts = new Map(), memo = new Map(), count = {};
        const along = (r, name) => { // Distance along route r to a station
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

    flipEra() { // Switch grows, flips to Full Buildout, lines re-space, then settles
        this.after(Math.max(0, view.switchAt - .5), () => !view.eraChosen && ui.era.classList.add('grow'));
        this.after(view.switchAt + 1.3, () => ui.era.classList.remove('grow'));
        this.after(view.switchAt, () => { // The switch flips first
            if (view.eraChosen || view.era !== 'today') return;
            controls.showEra('buildout');
            ui.map.classList.add('flash');
            setTimeout(() => ui.map.classList.remove('flash'), 1600);
        });

        this.after(view.switchAt + Intro.BEAT, () => { // ...then the buildout draws and the lines re-space
            if (view.eraChosen || view.era !== 'today') return;
            view.era = 'buildout';
            { if (still) timeJump.set(view.era, false); else this.after(.05, () => timeJump.spinDocked(Math.max(1500, (view.drawEnd - view.switchAt - Intro.BEAT - .05) * 1000))); } // The banner's date spins forward to 20XX while the buildout draws
            if (net.recolor()) map.recolor(); // Worked out during the splash
            reach.playing = !still; // Its figure counts up with the lines: map.gains
            controls.sync();
            map.unzipNext = !still; // Lines part as the new ones draw in beside them, dashed stations filling in as they arrive
            map.focusRoutesAndStations();
            map.layout(true);
        });
    }

    settle() { // Lines and dots in their finished styles
        if (has(document.body, 'drawn')) return;
        document.body.classList.add('drawn');
        $$('.soon path').forEach(p => p.removeAttribute('pathLength')); // Funded routes' dashes measured in pixels, not along a path of length 1
        if (!map.glide) [...view.routes, ...view.regional].forEach(r => r.els?.flat().forEach(el => el._d && el.getAttribute('d') !== el._d && el.setAttribute('d', el._d))); // Lines back to full detail
        map.syncLit();
        map.focusRoutesAndStations();
    }

    finish() { // Unlock the page
        if (this.done) return;
        this.done = true;
        this.settle();
        this.locked.forEach(el => { el.inert = false; });
        reach.stop();
        later(5, () => map.prewarm()); // Clear of the video's first seconds
        introDone();
        if (EMBED && view.selected !== null) camera.move(still ? 0 : .6); // Embedded route: framed again now its card is up
        if (!view.linked) this.hint();
    }

    hint() { // What to do next
        if (still) return;
        const inState = r => r.stops.filter(n => net.stateIdOf(n) === view.focus).length, pick = view.routes.filter(r => net.shown(r) && r.typeKey === 'state').sort((a, b) => inState(b) - inState(a))[0];
        const glow = pick && map.lineGroups.filter(g => has(g, 'glow') && +g.dataset.i === pick.i);
        glow?.forEach(g => g.classList.add('hot', 'beckon'));
        const end = () => { removeEventListener('pointerdown', end, true); removeEventListener('wheel', end, true); glow?.forEach(g => g.classList.remove('hot', 'beckon')); };
        addEventListener('pointerdown', end, true);
        addEventListener('wheel', end, true);
        setTimeout(end, 7000);
    }

    start() { // Splash, then draw in once the map and fonts are ready
        this.locked.forEach(el => { el.inert = true; });
        const mapReady = Promise.all([getJSON('data/map.json'), ridership.load()]).then(([data]) => map.render(data)).then(() => view.frame && Promise.race([Promise.all([map.geometry(view.frame.s), view.switchAt != null && map.eraGeometry('buildout')]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))), wait(6000)])).catch(e => console.warn(`Map not loaded: ${e}. Run preview.py.`)); // Its lines laid out before anything shows
        const held = document.body.classList.contains('link') || EMBED ? null : new Promise(r => { this.endSplash = r; setTimeout(r, Intro.SPLASH * 1000 - performance.now()); }); // From the page's first moment
        Promise.all([Promise.race([Promise.allSettled([document.fonts.ready, mapReady]), wait(4000)]), held]).then(() => requestAnimationFrame(() => {
            void ui.map.offsetWidth; // Settle the starting state before transitions turn on
            document.body.classList.add('ready', 'settled');
            later(.6, () => $('.loader')?.remove()); // Faded out: gone, or its glow and sweep would run on unseen for good
            brandMap.place();
            if (view.switchAt != null) this.flipEra();
            timeJump.set(view.era, false); // Date shows in the banner from the start
            this.after((view.drawEnd || 0) + .1, () => this.settle()); // The finished map's styles while everything holds still
            this.after((view.drawEnd || 0) + .3, () => this.finish()); // Unlock
            if (this.wantSkip || START_STATION || START_COMPARE || START_LIST || (EMBED && !START_ROUTE)) this.skip(); // Skip was pressed during the splash, or a station or comparison link
            if (START_COMPARE) compare.openLink(START_COMPARE);
            if (START_LIST && !START_COMPARE) netList.open();
            const linked = START_STATION && StationModal.find(START_STATION);
            if (linked) { const [x, y] = net.cityXY(linked); view.back = { cx: x, cy: y, hx: 70, hy: 42, side: 0 }; camera.move(0); stationModal.open(linked); } // Its window, over the map around it
        }));
    }
}