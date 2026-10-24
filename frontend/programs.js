// Program windows: tabs on the map open a near-fullscreen map of a program's (or today's) routes and projects
class ProgramView {
    static LIST = [ // Tabs: today's network, then each program (as routes' types name it), with short names and a blurb
        { name: 'Current Network', short: 'Current Network', brief: 'Current', kicker: 'Today', accent: 'var(--sky)', today: true, about: 'Amtrak routes running today, including temporary and suspended routes.', link: ['https://www.amtrak.com/train-routes', 'Amtrak routes and destinations'] },
        { name: 'Corridor ID Program', short: 'Corridor ID', tab: 'Corridor ID Program', unit: ['new route/extension', 'new routes/extensions'], accent: 'var(--red)', about: 'The Federal Railroad Administration\'s Corridor Identification and Development Program: upgrading and expanding the state-supported Amtrak network.', link: ['https://railroads.dot.gov/corridor-ID-program', 'FRA Corridor ID Program'] },
        { name: 'FRA Long-Distance Study', short: 'Long-Distance Study', brief: 'LD Study', list: true, unit: ['new route', 'new routes'], accent: 'var(--blue)', about: 'The Federal Railroad Administration\'s Long-Distance Service Study: adding and restoring long-distance Amtrak services.', link: ['https://railroads.dot.gov/rail-network-development/planning/systems-planning/amtrak-daily-long-distance-service-study', 'FRA Long-Distance Study'] },
        { name: 'Unofficial', title: 'Unofficial Routes', short: 'Unofficial Routes', brief: 'Unofficial', list: true, unit: ['new route', 'new routes'], accent: 'var(--gold)', about: 'Routes proposed by AAO that are not planned or under study.' },
        { name: 'Other Projects', short: 'Other Projects', unit: ['new route', 'new routes'], accent: 'var(--rose)', other: true, about: 'Planned passenger rail outside the federal programs above, such as state-funded projects.' }
    ];

    el = $('.program'); // The window
    tabs = $('.program-tabs'); // Tabs on the map
    svg = $('.program-svg'); // Its map
    info = $('.program-info'); // Its sidebar
    switch = $('.program-switch'); // Program switch on its map
    tip = $('.program-tip'); // Route name under the pointer
    cur = null; opener = null; picked = null; // Program shown, what had focus, routes picked (labels)
    isOpen() { return !this.el.hidden; }
    program(name) { return ProgramView.LIST.find(p => p.name === name); }
    routesOf(name) { // Every branch (running routes too, if their type names the program)
        const p = this.program(name), federal = ProgramView.LIST.filter(q => !q.today && !q.other).map(q => q.name); // (Unofficial included)
        if (p.today) { const fund = view.routes.filter(r => statusKind(r.status) === 'funded'), soon = new Set(fund.map(r => r.label)); return [...view.routes.filter(r => !net.proposed(r) && !soon.has(r.label)), ...fund]; } // Funded routes stand in for today's version (the extension dashed)
        if (p.other) return view.routes.filter(r => statusKind(r.status) === 'proposed' && !programsOf(r).some(q => federal.includes(q))); // Planned, in neither program (and not just an idea)
        return view.routes.filter(r => programsOf(r).includes(name));
    }
    listed(name) { return net.uniqueGroups(this.routesOf(name).map(r => r.i)).sort((a, b) => a.label.localeCompare(b.label)); } // One entry per route

    projectsOf(name) { // Projects ("project": [title, about]) on routes or single branches, each with its branches
        const found = new Map();
        for (const r of this.routesOf(name)) {
            const [title, about = ''] = Array.isArray(r.project) ? r.project : r.project ? [String(r.project)] : [];
            if (!title) continue;
            const p = found.get(title) ?? found.set(title, { title, about: '', routes: [] }).get(title);
            p.about ||= about;
            p.routes.push(r);
        }

        return [...found.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })); // A-Z by title
    }

    build() { // Tabs for programs with routes (once the network is in)
        this.tabs.innerHTML = ProgramView.LIST.map(p => ({ p, n: this.listed(p.name).length })).filter(({ n }) => n)
            .map(({ p, n }) => `<button data-program="${esc(p.name)}" style="--a:${p.accent}"><strong><span class="full">${esc(p.tab || p.short)}</span><span class="brief">${esc(p.brief || p.short)}</span></strong><small>${n} ${(p.unit || ['route', 'routes'])[+(n !== 1)]}</small></button>`).join('');
        this.tabs.hidden = !this.tabs.children.length;
        this.switch.innerHTML = [...this.tabs.children].map(b => `<button role="radio" data-program="${esc(b.dataset.program)}">${esc(this.program(b.dataset.program).short)}</button>`).join('');
    }

    open(name, from) { // Open the window from its tab
        this.opener = document.activeElement;
        this.el.hidden = false;
        this.box = null; // (Measured afresh)
        cover(true);
        bg.pause();
        this.show(name);
        measureSwitch(this.switch);
        const panel = $('.program-panel', this.el), a = from?.getBoundingClientRect(), b = panel.getBoundingClientRect();
        if (a && !still) panel.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: .4 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2, .8, .2, 1)' }); // Grows out of the tab
        $('.close', this.el).focus({ preventScroll: true });
    }

    close() { // Shrink back into its tab
        if (!this.isOpen()) return;
        const panel = $('.program-panel', this.el), tab = $(`button[data-program="${CSS.escape(this.cur)}"]`, this.tabs), a = tab?.getBoundingClientRect(), b = panel.getBoundingClientRect();
        const done = () => { this.el.hidden = true; this.el.classList.remove('closing'); cover(false); bg.resume(); this.tip.hidden = true; this.opener?.focus?.({ preventScroll: true }); };
        if (!a || still) return done();
        this.el.classList.add('closing'); // (Backdrop fades meanwhile)
        panel.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, opacity: 0 }], { duration: 320, easing: 'cubic-bezier(.4, 0, .8, .4)' }).finished.then(done);
    }

    show(name) { // Draw one program's map and sidebar
        const fresh = this.cur !== name;
        this.cur = name;
        this.picked = this.over = null;
        choose(this.switch, 'program', name);
        $$('button', this.tabs).forEach(b => b.classList.toggle('on', b.dataset.program === name));
        this.drawMap(name);
        this.svg.classList.remove('solid');
        this.light(null); // (Nothing picked on the new one)
        this.showStops([]);
        this.info.innerHTML = this.sidebar(name);
        this.marked = null;
        this.info.scrollTop = 0;
        if (fresh && !still) [$('.program-routes', this.svg), $('.program-casings', this.svg), this.info].forEach(el => el?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' })); // Switched: new routes fade in
    }

    colorOf(r) { return this.colors?.get(r.g) ?? r.color; } // A route's color in this window

    paint() { // Colors for the routes this window shows (main map's kept where they work), on everything already drawn
        const off = this.svg.classList, hidden = ['state', 'ld'].filter(t => off.contains('no-' + t)), shown = (this.mine || []).filter(r => !hidden.includes(r.typeKey === 'long-distance' ? 'ld' : 'state'));
        this.colors = remember(this.palettes ??= new Map(), `${this.cur}|${hidden}|${net.palette ? [...net.palette.values()].join() : ''}`, () => net.paint(shown, new Map(shown.map(r => [r.g, r.color]))));
        $$('[data-i]', this.el).forEach(e => { if (e.style.getPropertyValue('--c')) e.style.setProperty('--c', this.colorOf(view.routes[e.dataset.i])); });
        $$('.route-row', this.info).forEach(row => { const b = $('[data-i]', row); if (b) row.style.setProperty('--c', this.colorOf(view.routes[b.dataset.i])); });
    }

    drawMap(name) { // The whole network (same frame for every tab), its routes over the rest
        const mine = this.mine = this.routesOf(name), ids = new Set(mine.map(r => r.i)), others = view.routes.filter(r => !ids.has(r.i) && net.inEra('today', r)); // Context: today's network only (no other program's plans)
        this.paint(); // (Before drawing: the routes take this window's colors)
        const [x0, x1, y0, y1] = bounds([...view.allStates.flatMap(s => s.rings.flat()), ...view.routes.flatMap(r => r.runs.flat())]), pad = (x1 - x0) * .03;
        this.home = this.fit([x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad]);
        this.frame(this.home);
        this.homeS = this.scale(); // (Bundles widen from here as the map zooms in)
        const runs = r => r.runs.map(run => pathOf(run)).join(''); // A route as one path
        this.plans = new Map(mine.map(r => [r.i, this.plan(r, r.runs.map(() => null))])); // Drawn on their own track until the lanes arrive
        this.svg.innerHTML =
            `<g class="program-states">${view.allStates.map(st => `<path class="${st.id.toUpperCase() === view.focus ? 'oh' : ''}" d="${ringsPath(st.rings)}"/>`).join('')}</g>` +
            `<path class="program-others" d="${others.map(runs).join('')}"/>` +
            `<g class="program-casings">${mine.map(r => `<path class="pc${r.typeKey === 'long-distance' ? ' ld' : ''}" data-label="${esc(r.label)}" data-i="${r.i}"/>`).join('')}</g>` + // Every route's outline under every line: in a tight bundle none covers its neighbor
            `<g class="program-routes">${mine.map(r => `<g class="pr${r.typeKey === 'long-distance' ? ' ld' : ''}${statusKind(r.status) === 'suspended' ? ' suspended' : ''}" data-label="${esc(r.label)}" data-i="${r.i}" style="--c:${this.colorOf(r)}">${['line', 'line faint', 'line new', 'line thin', 'line faint thin', 'line new thin'].map(c => `<path class="${c}"/>`).join('')}<path class="hit"/></g>`).join('')}</g>` +
            '<g class="program-lit"></g>' + // Hovered or picked routes, lifted over the rest
            `<g class="program-all">${this.dots([...new Set(mine.flatMap(r => r.stops))])}</g>` + // Every station (the switch shows them, more as the map zooms in)
            '<g class="program-stops"></g>';
        this.extends = mine.filter(r => this.plans.get(r.i).some(run => run.some(piece => !piece.on))).length; // Routes with new track (for the key)
        this.render();
        this.laneUp(name, mine);
    }

    laneUp(name, mine) { // Lay shared track out side by side (on the background thread), then redraw in lanes
        const s = this.laidS = this.scale(), ticket = this.ticket = (this.ticket || 0) + 1, big = [...new Set(mine.flatMap(r => r.stops))].filter(n => sizeOf(view.cities[n]) === 'L').map(n => net.cityXY(n)).filter(Boolean);
        const shown = mine.filter(r => !this.svg.classList.contains(r.typeKey === 'long-distance' ? 'no-ld' : 'no-state')); // (Types switched off leave no gaps in the bundles)
        const job = { key: `program|${name}|${this.svg.className.baseVal.match(/no-\w+/g)?.join() || ''}|${s.toFixed(5)}`, s, laid: shown.map(r => r.i), ctx: { radius: 5, home: s, majors: big } }; // Full-size lanes at this zoom; bundles meet at big stations
        lanesThread.run(job).then(c => {
            if (this.cur !== name || this.ticket !== ticket || !c?.spread) return; // (A newer zoom's lanes are on their way)
            this.plans = new Map(mine.map(r => [r.i, this.plan(r, c.spread[r.i] || [])]));
            this.render();
        });
    }

    dots(names) { // Station dots: a ring, then a fill (round caps: the same few pixels at any zoom)
        const spots = names.map(n => [n, net.cityXY(n)]).filter(([, p]) => p), dot = ([n, p]) => `<path class="size-${sizeOf(view.cities[n])}" data-stop="${esc(n)}" d="M${p[0].toFixed(1)} ${p[1].toFixed(1)}h0"/>`;
        return `<g class="ring">${spots.map(dot).join('')}</g><g class="fill">${spots.map(dot).join('')}</g>`;
    }

    fit([x, y, w, h]) { // An area widened to the map's own shape (so a drag moves it by exactly the pointer's travel)
        const [W, H] = this.dims(), r = H / W;
        return h > w * r ? [x - (h / r - w) / 2, y, h / r, h] : [x, y - (w * r - h) / 2, w, w * r];
    }

    dims() { return this.box ??= [this.svg.clientWidth || 1000, this.svg.clientHeight || 600]; } // The map's size (measured once a showing: reading it forces a layout)
    scale() { const b = this.vb, [w, h] = this.dims(); return Math.min(w / b[2], h / b[3]) || 1; } // Pixels per map unit now

    plan(r, spread) { // A route as pieces, each on today's track (solid) or new (dashed), sampled every few km along its lanes
        const own = view.routes.filter(o => o.label === r.label && !net.proposed(o)); // Today's version of it, if it runs already
        const today = !net.proposed(r), near = today ? () => true : own.length ? this.nearTo(own, r.label) : this.nearTo(view.routes.filter(o => !net.proposed(o)), ''); // Changes to a running route: off its own track (even onto another's); a new route: off any running one
        return r.runs.map((run, n) => {
            const b = spread[n], base = b ? Array.from({ length: b.length / 10 }, (_, k) => [b[10 * k], b[10 * k + 1]]) : run; // Its track (lanes come off it)
            const samples = [];
            base.forEach((p, k) => {
                if (!k) return samples.push({ k: 0, t: 0, p });
                const steps = Math.max(1, Math.ceil(dist(base[k - 1], p) / 3)); // Every 3 km or so
                for (let j = 1; j <= steps; j++) { const t = j / steps; samples.push({ k: k - 1, t, p: [base[k - 1][0] + (p[0] - base[k - 1][0]) * t, base[k - 1][1] + (p[1] - base[k - 1][1]) * t] }); }
            });

            const on = samples.map(x => near(x.p));
            for (let k = 0, j; k < on.length; k = j) { // Stretches under about 10 km take the side of the one before (brief brushes with another line don't count)
                for (j = k; j < on.length && on[j] === on[k]; j++);
                if (k && j - k < 4) for (let m = k; m < j; m++) on[m] = on[k - 1];
            }

            const pieces = [];
            samples.forEach((x, k) => { if (!k || on[k] !== on[k - 1]) pieces.push({ on: on[k], samples: k ? [samples[k - 1]] : [] }); pieces.at(-1).samples.push(x); }); // Pieces share their joins
            return Object.assign(pieces.filter(x => x.samples.length > 1), { b, base });
        });
    }

    nearTo(routes, id) { // Test: within about 5 km of these routes (a grid of their segments, made once per set)
        const cache = this.near ??= new Map();
        return cache.get(id) ?? cache.set(id, (() => {
            const cell = 10, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
            for (const o of routes) for (const run of o.runs) for (let k = 1; k < run.length; k++) {
                const [a, b] = [run[k - 1], run[k]];
                for (let x = Math.floor((Math.min(a[0], b[0]) - 5) / cell); x <= Math.floor((Math.max(a[0], b[0]) + 5) / cell); x++)
                    for (let y = Math.floor((Math.min(a[1], b[1]) - 5) / cell); y <= Math.floor((Math.max(a[1], b[1]) + 5) / cell); y++) (grid.get(`${x},${y}`) ?? grid.set(`${x},${y}`, []).get(`${x},${y}`)).push([a, b]);
            }

            return p => (grid.get(key(...p)) || []).some(([a, b]) => segDist(p, a, b) < 5);
        })()).get(id);
    }

    static GAP = 5.5; // Lane spacing (px)
    static WIDEST = 16; // Widest a bundle gets (px) at the whole-country view: busier ones pack their lanes closer, drawn thinner

    laneAt(b, k, s) { // Point k of a laid-out line at scale s, and whether its bundle packs tight (Lanes.at, this map's spacing)
        const widest = ProgramView.WIDEST * Math.min(4, Math.max(1, Math.sqrt(s / (this.homeS || s)))); // Zoomed in: room to spread out
        const i = k * 10, half = b[i + 6] * ProgramView.GAP, pack = half * 2 > widest ? widest / (half * 2) : 1; // (No pinching at stations: bundles run straight through)
        const calm = b[i + 9], o = ProgramView.GAP * pack / s; // Ends keep their lane too (square sets them level: no hook back to its own track)
        return [b[i] + (b[i + 2] - b[i]) * calm + b[i + 4] * o, b[i + 1] + (b[i + 3] - b[i + 1]) * calm + b[i + 5] * o, pack < .7];
    }

    smooth(at, s) { // Round off the corners a lane picks up where bundles meet and part (ends kept; at most 3px off its track)
        const was = at.map(p => p.slice()), most = 3 / s;
        for (let pass = 0; pass < 4; pass++) {
            let prev = at[0];
            for (let k = 1; k < at.length - 1; k++) {
                const cur = at[k], next = at[k + 1];
                at[k] = [(prev[0] + 2 * cur[0] + next[0]) / 4, (prev[1] + 2 * cur[1] + next[1]) / 4, cur[2]];
                prev = cur;
            }
        }

        at.forEach((p, k) => { const dx = p[0] - was[k][0], dy = p[1] - was[k][1], d = Math.hypot(dx, dy); if (d > most) at[k] = [was[k][0] + dx * most / d, was[k][1] + dy * most / d, p[2]]; });
    }

    square(at, stops, s) { // A line ending in a bundle stops level with the others ending there: square across the track at its last stop
        const n = at.length;
        if (n < 4) return;
        for (const end of [0, n - 1]) {
            const step = end ? -1 : 1, p = at[end], st = [stops[0], stops.at(-1)].map(net.cityXY).filter(Boolean).sort((a, c) => dist(a, p) - dist(c, p))[0];
            if (!st || dist(st, p) * s > 40) continue; // (Not ending at a stop: a branch's fork)
            const q = at[end + step * 3], l = dist(p, q) || 1, d = [(p[0] - q[0]) / l, (p[1] - q[1]) / l]; // Heading out of the end
            const along = k => (at[k][0] - st[0]) * d[0] + (at[k][1] - st[1]) * d[1], to = (k, a) => { at[k] = [at[k][0] - d[0] * a, at[k][1] - d[1] * a, at[k][2]]; };
            for (let k = end; k >= 0 && k < n && along(k) > 0; k += step) to(k, along(k)); // Past the stop: back onto the line across it
            if (along(end) < 0) to(end, along(end)); // Short of it: carried on to it
        }
    }

    render() { // Draw every route at the current zoom (lanes keep the same few pixels apart at any zoom)
        const s = this.scale();
        this.svg.classList.toggle('near', !!this.home && this.vb[2] < this.home[2] / 3); // Zoomed in: medium stations too...
        this.svg.classList.toggle('closer', !!this.home && this.vb[2] < this.home[2] / 9); // ...then small ones
        if (s === this.drawn?.s && this.plans === this.drawn.plans) return; // A pan: the lanes are as they were
        this.drawn = { s, plans: this.plans };
        const casings = new Map($$('.pc', this.svg).map(c => [c.dataset.i, c]));
        for (const g of $$('.pr', this.svg)) {
            const runs = this.plans.get(+g.dataset.i), d = { line: '', new: '', lineThin: '', newThin: '' };
            let outline = '';
            for (const run of runs) {
                const at = run.b ? run.base.map((_, k) => this.laneAt(run.b, k, s)) : run.base.map(p => [p[0], p[1], false]); // Its lanes at this zoom
                if (run.b) { this.smooth(at, s); this.square(at, view.routes[+g.dataset.i].stops, s); }
                const where = x => { const a = at[x.k], c = at[Math.min(x.k + 1, at.length - 1)]; return [a[0] + (c[0] - a[0]) * x.t, a[1] + (c[1] - a[1]) * x.t]; };
                outline += curveOf(at, 8 / s); // (Corners rounded within 8px: lines keep to their stations)
                for (const piece of run) { // Split again where the bundle packs tight (thinner there)
                    let cur = [], tight = null;
                    const flush = () => { if (cur.length > 1) d[(piece.on ? 'line' : 'new') + (tight ? 'Thin' : '')] += curveOf(cur.map(where), 8 / s); };
                    for (const x of piece.samples) {
                        const t = at[x.k][2];
                        if (t !== tight && cur.length) { cur.push(x); flush(); cur = [x]; } else cur.push(x);
                        tight = t;
                    }

                    flush();
                }
            }

            const [line, faint, fresh, thin, faintThin, freshThin, hit] = g.children;
            casings.get(g.dataset.i)?.setAttribute('d', outline);
            hit.setAttribute('d', outline);
            line.setAttribute('d', d.line);
            faint.setAttribute('d', d.new);
            fresh.setAttribute('d', d.new);
            thin.setAttribute('d', d.lineThin);
            faintThin.setAttribute('d', d.newThin);
            freshThin.setAttribute('d', d.newThin);
        }
    }

    frame(to, glide) { // Show map area [x, y, w, h], gliding there from the current one if asked
        const from = this.vb || to;
        this.vb = to;
        cancelAnimationFrame(this.glide);
        const set = b => this.svg.setAttribute('viewBox', b.map(v => v.toFixed(2)).join(' '));
        if (!glide || still) { set(to); if (this.plans) this.render(); return this.relay(); }
        const t0 = performance.now(), k = Math.log(to[2] / from[2]); // Size changes by ratio: an even-feeling zoom
        const step = now => {
            const t = Math.min(1, (now - t0) / 700), e = ease(t), w = from[2] * Math.exp(k * e), h = from[3] * Math.exp(k * e);
            const cx = from[0] + from[2] / 2 + (to[0] + to[2] / 2 - from[0] - from[2] / 2) * e, cy = from[1] + from[3] / 2 + (to[1] + to[3] / 2 - from[1] - from[3] / 2) * e;
            set([cx - w / 2, cy - h / 2, w, h]);
            this.vb = [cx - w / 2, cy - h / 2, w, h];
            this.render(); // Lanes stay the same few pixels apart all the way
            if (t < 1) this.glide = requestAnimationFrame(step);
            else { this.vb = to; this.relay(); }
        };

        this.glide = requestAnimationFrame(step);
    }

    relay() { // Zoom settled far from the one the lanes were laid out (and simplified) for: lay them out again
        clearTimeout(this.relayAt);
        this.relayAt = setTimeout(() => { if (this.cur && this.mine && Math.abs(Math.log(this.scale() / this.laidS)) > .3) this.laneUp(this.cur, this.mine); }, 150);
    }

    pick(labels, entry) { // Pick routes by label (entry: its sidebar item): zoom to them, show their stations (null: let go)
        const same = labels && this.picked && labels.join('|') === this.picked.join('|') && (!entry || entry === this.pinned); // (Another project on the same route: a new pick)
        this.picked = same ? null : labels;
        const on = this.picked && new Set(this.picked), routes = on ? this.routesOf(this.cur).filter(r => on.has(r.label)) : [];
        const card = on && (entry?.isConnected ? entry : $$('[data-labels]', this.info).find(q => q.dataset.labels === this.picked.join('|'))); // The sidebar entry picked
        $$('[data-labels]', this.info).forEach(q => q.classList.toggle('pinned', q === card));
        this.pinned = card || null;
        const layer = $('.program-stops', this.svg);
        layer.innerHTML = this.dots([...new Set(routes.flatMap(r => r.stops))]);
        if (on && !still) layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 300, fill: 'backwards' });
        this.svg.classList.toggle('solid', !!on && !this.program(this.cur).today); // A program's pick: drawn whole and solid, everything else greyed
        $$('.pr, .pc', this.svg).forEach(g => g.classList.toggle('picked', !!on && on.has(g.dataset.label)));
        this.over = null; // (The next hover lights afresh)
        this.light(this.picked);
        this.showStops(routes);
        if (!on) return this.frame(this.home, true);
        const [x0, x1, y0, y1] = bounds(routes.flatMap(r => r.runs.flat())), w = Math.max(x1 - x0, this.home[2] * .08), h = Math.max(y1 - y0, this.home[3] * .08); // (Not closer than about a twelfth of the country)
        const box = $('.program-route', this.el), aside = box.hidden || box.classList.contains('shut') ? 0 : box.offsetWidth + 24, [W] = this.dims(); // The stops panel covers the map's right side: framed in what's left
        const wide = w * 1.3 * W / Math.max(W / 2, W - aside), to = this.fit([(x0 + x1 - wide) / 2, (y0 + y1 - h * 1.3) / 2, wide, h * 1.3]);
        this.frame([to[0] + to[2] * aside / W / 2, to[1], to[2], to[3]], true);
    }

    showStops(routes) { // The picked routes' stops in a panel at the right, drawn as on the main map's card (branches and all)
        const box = $('.program-route', this.el), body = $('.program-route-body', box), byLabel = new Map();
        routes.forEach(r => (byLabel.get(r.label) ?? byLabel.set(r.label, []).get(r.label)).push(r));
        box.hidden = !byLabel.size;
        body.replaceChildren();
        for (const list of byLabel.values()) {
            const r = list[0], stops = card.stopList(list, r, this.colorOf(r)), branches = card.branches;
            body.insertAdjacentHTML('beforeend', `<section><h3><span class="swatch" style="--c:${this.colorOf(r)}"></span>${esc(r.label)}</h3><p class="ends">${this.ends(r, list.map(b => b.i))}</p>${stops}</section>`);
            if (branches) card.drawBranches($('.stops', body.lastElementChild), branches);
        }
        body.scrollTop = 0;
    }

    sidebar(name) { // Program, then its projects
        const p = this.program(name), routes = this.listed(name), projects = p.today || p.list ? [] : this.projectsOf(name), stops = new Set(routes.filter(r => !p.today || !net.proposed(r)).flatMap(r => r.stops)); // (Today's count: stations served now)
        const today = new Set(view.routes.filter(r => !net.proposed(r)).flatMap(r => r.stops)), fresh = [...stops].filter(n => !today.has(n)).length; // A program's: stations no train calls at today
        return `<p class="kicker">${p.kicker || 'Future'}</p><h2 id="program-title">${esc(p.title || name)}</h2><p class="about">${esc(p.about)}</p>` +
            (p.link ? `<a class="program-link" href="${esc(p.link[0])}" target="_blank" rel="noopener">${esc(p.link[1])}<span aria-hidden="true">↗</span></a>` : '') + // Official page (new tab)
            `<p class="program-stats"><span><b>${routes.length}</b> ${routes.length === 1 ? 'route' : 'routes'}</span>${p.today ? `<span><b>${stops.size}</b> stations</span>` : `<span><b>+${fresh}</b> new ${fresh === 1 ? 'station' : 'stations'}</span>`}${projects.length && !p.today ? `<span><b>${projects.length}</b> ${projects.length === 1 ? 'project' : 'projects'}</span>` : ''}</p>` +
            (this.extends ? '<p class="program-key"><span class="solid"></span>Existing segment<span class="dashed"></span>New</p>' : '') + // Key, when some track is new
            (p.today || p.list ? this.routeList(routes) : `<h4 class="projects-head">Projects${projects.length > 1 ? `<button class="fold-all">${projects.every(pr => !this.openCards.has(pr.title)) ? 'Expand all' : 'Collapse all'}</button>` : ''}</h4>` + (projects.length ? `<ul class="projects">${projects.map(pr => `<li class="project${!this.openCards.has(pr.title) ? ' shut' : ''}" role="button" tabindex="0" data-title="${esc(pr.title)}" data-ids="${pr.routes.map(r => r.i).join(' ')}" data-labels="${esc([...new Set(pr.routes.map(r => r.label))].join('|'))}">` +
                    `<span class="project-head"><strong data-help="${esc(pr.title)}" data-clipped>${esc(pr.title)}</strong><button class="project-fold" aria-label="Show or hide details" aria-expanded="${!!this.openCards.has(pr.title)}"><i></i></button></span>` +
                    `<span class="project-body"><span>${pr.about ? `<span class="about">${esc(pr.about)}</span>` : ''}</span></span><span class="chips">${net.uniqueGroups(pr.routes.map(r => r.i)).map(r => `<button data-i="${r.i}" style="--c:${this.colorOf(r)}" title="Show ${esc(r.label)} on the main map">${this.ends(r, pr.routes.filter(o => o.label === r.label).map(o => o.i))}</button>`).join('')}</span></li>`).join('')}</ul>` : '')); // (Folded, a card keeps its title and routes) // (None yet: just the heading)
    }

    routeList(routes) { // Today's routes, A-Z, in folding state-supported and long-distance sections
        const row = r => { // A funded route stands in for today's version: tagged with both
            const own = net.proposed(r) ? view.routes.find(o => o.label === r.label && !net.proposed(o)) : r, kind = statusKind((own || r).status);
            const tags = [own && TAGS[kind] && [kind, TAGS[kind]], statusKind(r.status) === 'funded' && ['funded', own ? TAGS.extension : TAGS.funded]].filter(Boolean);
            return `<li class="route-row is-${kind}" role="button" tabindex="0" data-labels="${esc(r.label)}" style="--c:${this.colorOf(r)}"><span class="swatch"></span><span class="name"><span class="row-name" data-help="${esc(r.label)}" data-clipped>${esc(r.label)}</span><span class="ends">${this.ends(r)}</span>${tags.length ? `<span class="tags">${tags.map(([k, t]) => `<small class="is-${k}">${t}</small>`).join('')}</span>` : ''}</span><button data-i="${r.i}" class="go" title="Show on the main map" aria-label="Show ${esc(r.label)} on the main map">→</button></li>`;
        };

        return [['state', 'State-Supported'], ['long-distance', 'Long-Distance']].map(([key, title]) => [title, routes.filter(r => r.typeKey === key)]).filter(([, list]) => list.length)
            .map(([title, list]) => foldSection(`${title} <span class="count">${list.length}</span>`, `<ul class="route-rows">${list.map(row).join('')}</ul>`)).join('');
    }

    light(labels) { // Light some routes on the map (null: all of them)
        const on = labels && new Set(labels);
        this.svg.classList.toggle('focus', !!on);
        const lit = $('.program-lit', this.svg), up = [], down = [];
        $$('.pc, .pr', this.svg).forEach(g => { const hl = !!on && on.has(g.dataset.label); g.classList.toggle('hl', hl); (hl ? up : down).push(g); });
        down.filter(g => g.parentNode === lit).forEach(g => $(g.classList.contains('pc') ? '.program-casings' : '.program-routes', this.svg).append(g)); // Back down
        lit?.append(...up.filter(g => g.classList.contains('pc')), ...up.filter(g => g.classList.contains('pr'))); // On top: their outlines, then their lines
        const stops = new Set(on ? up.filter(g => g.classList.contains('pr')).flatMap(g => view.routes[g.dataset.i].stops) : []); // Their stations (this tab's version of them) stay solid, over everything
        $$('.program-all path', this.svg).forEach(d => { const mine = stops.has(d.dataset.stop); d.classList.toggle('on', mine); if (mine) d.parentNode.append(d); });
    }

    ends(r, ids = net.siblings(r.i)) { // Where a route (or just these branches of it) runs, every end: "Chicago – Seattle/Portland" (no parentheticals)
        const bare = n => String(n).replace(/\s*\([^)]*\)\s*$/, ''), runs = ids.map(i => view.routes[i].stops).map(s => [s[0], s.at(-1)]);
        const list = names => { const u = [...new Set(names.map(bare))]; return esc(u.slice(0, 3).join('/') + (u.length > 3 ? ` +${u.length - 3}` : '')); }; // At most three a side
        const hub = runs.length > 1 && [...new Set(runs.flat())].find(n => runs.every(e => e.includes(n))); // Where every branch meets
        if (!hub) return `${list(runs.map(e => e[0]))} – ${list(runs.map(e => e[1]))}`;
        const others = [...new Set(runs.map(e => e[0] === hub ? e[1] : e[0]))].filter(n => n !== hub), h = net.cityXY(hub) || [0, 0];
        const way = n => { const p = net.cityXY(n) || h; return [p[0] - h[0], p[1] - h[1]]; }, ref = way(others[0] ?? hub);
        const one = others.filter(n => { const v = way(n); return v[0] * ref[0] + v[1] * ref[1] >= 0; }), two = others.filter(n => !one.includes(n));
        if (two.length) return `${list(one)} – ${list(two)}`; // Branches off both ways (the Northeast Regional): its far ends, either side of the hub
        return runs.filter(e => e[0] === hub).length * 2 >= runs.length ? `${list([hub])} – ${list(others)}` : `${list(others)} – ${list([hub])}`;
    }

    openCards = new Set(); // Opened project cards, by title (folded to start; kept while the page is open)

    foldCard(card, shut) { // Fold a project card down to its title, or open it
        card.classList.toggle('shut', shut);
        $('.project-fold', card).setAttribute('aria-expanded', !shut);
        shut ? this.openCards.delete(card.dataset.title) : this.openCards.add(card.dataset.title);
        const cards = $$('.project', this.info), all = $('.fold-all', this.info);
        if (all) all.textContent = cards.every(c => c.classList.contains('shut')) ? 'Expand all' : 'Collapse all';
    }

    entryFor(i) { // Sidebar entry for a branch: the project naming that branch, else one naming its route, else its row
        const all = $$('[data-labels]', this.info), label = view.routes[i].label;
        return all.find(q => q.dataset.ids?.split(' ').includes(String(i))) ?? all.find(q => q.dataset.labels.split('|').includes(label));
    }

    mark(entry) { // Light the sidebar entry of the line under the pointer
        if (this.marked === entry) return;
        this.marked?.classList.remove('lit');
        this.marked = entry;
        entry?.classList.add('lit');
    }

    escape() { this.picked ? this.pick(null) : this.close(); } // Escape: let go of the pick first, then close

    openOnMap(i) { // Close and show the route on the main map
        this.close();
        sidebar.pick(i, true);
    }

    bind() {
        const box = $('.program-route', this.el), toggle = $('.program-route-toggle', box);
        toggle.addEventListener('click', () => { const shut = box.classList.toggle('shut'); toggle.setAttribute('aria-expanded', !shut); }); // Tucked away to the right, or out
        box.addEventListener('pointerover', e => { const name = e.target.closest('li[data-city]')?.dataset.city; $$('.program-stops [data-stop]', this.svg).forEach(d => d.classList.toggle('hot', d.dataset.stop === name)); }); // A stop in the list: its dot on the map grows
        box.addEventListener('pointerleave', () => $$('.program-stops .hot', this.svg).forEach(d => d.classList.remove('hot')));
        addEventListener('resize', () => { this.box = null; }); // (Measured again when next needed)
        const world = () => [this.home[0], this.home[1], this.home[0] + this.home[2], this.home[1] + this.home[3]];
        panZoom(this.svg, this.svg, { // Drag to pan, scroll or pinch to zoom
            view: () => [this.vb[0], this.vb[1], this.vb[0] + this.vb[2], this.vb[1] + this.vb[3]],
            width: w => Math.min(this.home[2], Math.max(this.home[2] / 40, w)), // Out to the whole country, in to 40x
            move: (x0, y0, w, h) => { const v = held(null, world(), x0, y0, w, h); this.queued = [v[0], v[1], w, h]; this.moveAt ||= requestAnimationFrame(() => { this.moveAt = 0; this.frame(this.queued); }); } // Kept over the country; drawn once a frame
        });
        $('.program-types', this.el).addEventListener('click', e => { // Route types on this map, as on the main map
            const b = e.target.closest('button[data-type]');
            if (!b) return;
            const on = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', on);
            this.svg.classList.toggle('no-' + b.dataset.type, !on);
            this.paint(); // Colors for what's left
            if (this.cur) this.laneUp(this.cur, this.mine); // Lanes closed up round what's left
        });

        $('.program-stations', this.el).addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); this.svg.classList.toggle('stations', on); });
        this.tabs.addEventListener('click', e => { const b = e.target.closest('button[data-program]'); if (b) this.open(b.dataset.program, b); });
        this.el.addEventListener('click', e => {
            if (e.target === this.el || e.target.closest('.close')) return this.close();
            const sw = e.target.closest('.program-switch button')?.dataset.program;
            if (sw) return sw !== this.cur && this.show(sw);
            const card = e.target.closest('.project-fold')?.closest('.project'), all = e.target.closest('.fold-all');
            if (card) return this.foldCard(card, !card.classList.contains('shut')); // A project card folds (no pick)
            if (all) { const cards = $$('.project', this.info), shut = !cards.every(c => c.classList.contains('shut')); cards.forEach(c => this.foldCard(c, shut)); return; } // All of them
            const head = e.target.closest('.fold-head');
            if (head) return void toggleFold(head); // A section folds
            const stop = e.target.closest('[data-stop]');
            if (stop) return stationModal.open(stop.dataset.stop); // A station: its window, over this one
            const b = e.target.closest('button[data-i]'), project = e.target.closest('[data-labels]:not(.pr)'), line = e.target.closest('.pr');
            if (b) return this.openOnMap(+b.dataset.i); // A project's route: off to the main map
            if (project) { const was = project.classList.contains('pinned'); this.pick(project.dataset.labels.split('|'), project); if (project.classList.contains('project')) this.foldCard(project, was); return; } // A project: picked and opened (again: let go, folded)
            if (line) { // A line: its project (that branch's, if it has its own) or row, opened and scrolled into sight; else itself
                const mine = this.entryFor(+line.dataset.i);
                this.pick(mine ? mine.dataset.labels.split('|') : [line.dataset.label], mine);
                if (mine?.classList.contains('project')) this.foldCard(mine, !mine.classList.contains('pinned'));
                mine?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
                return;
            }
            if (this.picked && (e.target.closest('.program-svg') || e.target.closest('.program-info'))) this.pick(null); // Clicked off it
        });

        this.info.addEventListener('keydown', e => { const project = e.target.closest('[data-labels]'); if (project && e.target === project && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); project.click(); } });
        const hover = labels => { const key = labels?.join('|') ?? ''; if (key !== this.over) { this.over = key; this.light(labels ?? this.picked); } }; // (Only when it changes)
        this.info.addEventListener('pointerover', e => { const b = e.target.closest('button[data-i]'), project = e.target.closest('[data-labels]'); hover(b ? [view.routes[+b.dataset.i].label] : project ? project.dataset.labels.split('|') : null); });
        this.info.addEventListener('pointerleave', () => hover(null));
        this.svg.addEventListener('pointermove', e => {
            const stop = e.target.closest('[data-stop]'), name = stop?.dataset.stop;
            if (this.hot !== name) { // A station under the pointer: it grows, and the pop-up names it (not the line beneath)
                $$('.hot', this.svg).forEach(d => d.classList.remove('hot'));
                if (name) $$(`[data-stop="${CSS.escape(name)}"]`, stop.closest('.program-all, .program-stops')).forEach(d => { d.classList.add('hot'); d.parentNode.append(d); }); // (Last: drawn over its neighbors)
                this.hot = name;
            }

            if (stop) { // The line under it lets go
                hover(null);
                this.mark(null);
                this.tip.hidden = false;
                if (this.tip._i !== this.cur + name) { this.tip._i = this.cur + name; // (Counts differ by tab)
                    this.tip.innerHTML = `<strong>${nameHTML(name)}</strong><em>${plural(net.uniqueGroups(this.mine.filter(r => r.stops.includes(name)).map(r => r.i)).length, 'route')}</em>`;
                }
                const { x, y } = toPage(e);
                this.tip.style.translate = `${x}px ${y}px`;
                return;
            }

            const g = e.target.closest('.pr'), entry = g && this.entryFor(+g.dataset.i); // Its project (that branch's own, if any) or row
            hover(entry ? entry.dataset.labels.split('|') : g ? [g.dataset.label] : null);
            this.mark(entry);
            this.tip.hidden = !g;
            if (!g) return;
            const r = view.routes[+g.dataset.i], title = entry?.dataset.title, key = title ? 'p:' + title : r.i;
            if (this.tip._i !== key) { this.tip._i = key; this.tip.innerHTML = `<span class="swatch" style="--c:${this.colorOf(r)}"></span><strong>${esc(title || r.label)}</strong>${title ? '' : `<em>${esc(r.type)}</em>`}`; } // A project's line: just the project's name
            const { x, y } = toPage(e);
            this.tip.style.translate = `${x}px ${y}px`;
        });

        this.svg.addEventListener('pointerleave', () => { this.tip.hidden = true; hover(null); this.mark(null); $$('.hot', this.svg).forEach(d => d.classList.remove('hot')); this.hot = null; });
    }
}
