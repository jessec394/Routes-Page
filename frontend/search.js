// Station search: the sidebar's box opens a window listing every station, A–Z or by state (each letter or state folds away), filtered as you type; choosing one flies there and opens its window
class StationSearch {
    el = $('.station-search'); // The sidebar's box (opens the window)
    trigger = $('input', this.el);
    sort = 'az'; // 'az' | 'state'
    era = 'buildout'; // Network the list shows: 'today' | 'buildout' (starts as the map's)
    shut = { az: new Set(), state: new Set() }; // Groups folded away, per sort
    at = -1; // Highlighted result (keyboard)

    build() { // The window (made on first use)
        if (this.win) return;
        this.win = Object.assign(document.createElement('div'), { className: 'finder', hidden: true });
        this.win.setAttribute('role', 'dialog');
        this.win.setAttribute('aria-label', 'Find a station');
        this.win.innerHTML = '<div class="finder-panel"><div class="finder-head"><h2>Find a Station</h2><button class="close" aria-label="Close">×</button></div>' +
            '<div class="finder-bar"><label class="finder-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" placeholder="Station, city, address or ZIP code" aria-label="Station name, or a city, address or ZIP code to find stations near" autocomplete="off" spellcheck="false" aria-controls="finder-list"></label>' +
            '<div class="finder-era segmented" role="radiogroup" aria-label="Network"><button role="radio" data-era="today" aria-checked="false">Present Day</button><button role="radio" data-era="buildout" aria-checked="true">Full Buildout</button></div>' +
            '<div class="finder-sort segmented" role="radiogroup" aria-label="Sort"><button role="radio" data-sort="az" aria-checked="true">A–Z</button><button role="radio" data-sort="state" aria-checked="false">By State</button></div></div>' +
            '<div class="finder-list" id="finder-list"></div><p class="finder-count"></p></div>';
        document.body.append(this.win);
        [this.input, this.list, this.switch, this.eraSwitch, this.count] = [$('input', this.win), $('.finder-list', this.win), $('.finder-sort', this.win), $('.finder-era', this.win), $('.finder-count', this.win)];
        this.input.addEventListener('input', () => this.render());
        this.input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
            else if (e.key === 'Enter' && this.hits()[this.at]) { e.preventDefault(); this.go(this.hits()[this.at].dataset.city); }
            else if (e.key === 'Enter' && this.input.value.trim()) { e.preventDefault(); this.findNear(this.input.value.trim()); } // No station by that name: stations near the place
        });
        this.win.addEventListener('click', e => {
            if (e.target === this.win || e.target.closest('.close')) return this.close();
            const era = e.target.closest('.finder-era button')?.dataset.era;
            if (era && era !== this.era) { this.era = era; choose(this.eraSwitch, 'era', era); return this.render(); }
            const sort = e.target.closest('.finder-sort button')?.dataset.sort;
            if (sort && sort !== this.sort) { this.sort = sort; choose(this.switch, 'sort', sort); this.list.scrollTop = 0; return this.render(); }
            const head = e.target.closest('.fold-head');
            if (head) { const open = toggleFold(head); this.shut[this.sort][open ? 'delete' : 'add'](head.dataset.fold); return; }
            if (e.target.closest('.near-row')) return this.findNear(this.input.value.trim());
            const route = e.target.closest('.route-hit');
            if (route) { this.close(); if (this.era !== view.era) { view.eraChosen = true; controls.setView({ era: this.era }); } return sidebar.pick(+route.dataset.i, true); }
            const hit = e.target.closest('.search-hit');
            if (hit) this.go(hit.dataset.city);
        });
        this.win.addEventListener('keydown', e => { // Typing anywhere in the window goes to its box (after clicking a heading, say)
            if (e.target === this.input || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key.length === 1 || e.key === 'Backspace') this.input.focus();
            else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.closest('.fold-head')) { e.preventDefault(); this.input.focus(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
        });
        this.list.addEventListener('pointerover', e => { const li = e.target.closest('.search-hit'); if (li) { this.at = this.hits().indexOf(li); this.mark(false); } });
    }

    entries() { // Every station on the map, once (twins as one), with what it needs for matching and listing
        const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return this.all ??= Object.keys(view.cities).filter(n => mainOf(n) === n).map(n => {
            const st = net.stateIdOf(n) || '', name = baseName(n), stName = STATE_NAMES[st] || st || 'Other'; // (No parenthetical: the state beside it tells it apart)
            return { n, name, st, stName, letter: fold(name)[0]?.toUpperCase() || '#', first: fold(name), key: fold(name) };
        }).sort((a, b) => a.name.localeCompare(b.name) || a.stName.localeCompare(b.stName));
    }

    served(era) { // Station -> its routes in an era (with that era's colors), worked out once per era and route types
        const key = `${era}|${view.types}`;
        if (this.servedKey?.[era] === key) return this.servedBy[era];
        const was = view.era;
        view.era = era;
        let colors;
        try { colors = net.colorsFor(); } finally { view.era = was; }
        const by = new Map();
        for (const r of view.routes) if (net.inEra(era, r)) for (const n of r.stops) for (const t of twinsOf(n)) { const m = mainOf(t), list = by.get(m) ?? by.set(m, []).get(m); if (!list.some(o => o.label === r.label)) list.push({ label: r.label, color: colors.get(r.g) ?? r.color }); }
        (this.servedKey ??= {})[era] = key;
        return (this.servedBy ??= {})[era] = by;
    }

    colorsAt(n) { return (this.served(this.era).get(n) || []).slice(0, 6).map(r => `<b style="--c:${r.color}"></b>`).join(''); } // Its routes' colors in the list's era

    render() { // The list: grouped by letter or state, matching what's typed (all groups open while searching)
        const q = this.input.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), words = q.split(/\s+/).filter(Boolean);
        const served = this.served(this.era), found = this.entries().filter(e => served.has(e.n) && words.every(w => e.key.includes(w))); // (Only stations that era's trains call at)
        if (q) found.sort((a, b) => (b.first.startsWith(q) - a.first.startsWith(q)) || a.name.localeCompare(b.name)); // Names starting with it first
        const byState = this.sort === 'state', groups = new Map();
        for (const e of found) { const g = byState ? e.stName : e.letter; (groups.get(g) ?? groups.set(g, []).get(g)).push(e); }
        const order = [...groups.keys()].sort((a, b) => byState ? (b === (STATE_NAMES[view.focus] || '')) - (a === (STATE_NAMES[view.focus] || '')) || a.localeCompare(b) : q ? 0 : a.localeCompare(b)); // (By state: the featured one first)
        const row = e => `<li class="search-hit size-${sizeOf(view.cities[e.n])}${building(e.n, this.era) ? ' building' : ''}" data-city="${esc(e.n)}"><i></i><span class="hit-name">${listName(e.n)}${building(e.n, this.era) ? BUILDING : ''}</span>${byState ? '' : `<small>${esc(e.stName)}</small>`}<span class="links">${this.colorsAt(e.n)}</span></li>`;
        const raw = this.input.value.trim(), near = this.nearAt?.q === raw ? this.nearAt : null, pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg>';
        const nearRow = n => `<li class="search-hit size-${sizeOf(view.cities[n.name])}" data-city="${esc(n.name)}"><i></i><span class="hit-name">${listName(n.name)}${building(n.name, this.era) ? BUILDING : ''}</span><small>${[net.stateIdOf(n.name), `${n.miles < 1 ? '<1' : Math.round(n.miles)} mi`].filter(Boolean).map(esc).join(' · ')}</small><span class="links">${this.colorsAt(mainOf(n.name))}</span></li>`;
        const nearBlock = !raw ? `<p class="near-row wait">${pin}<span>Type a city, address or ZIP code to find the stations near it</span></p>` : !near ? `<button class="near-row" type="button">${pin}<span>Stations near <b>“${esc(raw)}”</b></span><em>City, address or ZIP code</em></button>` // (Asked for, not looked up as you type)
            : near.wait ? `<p class="near-row wait">${pin}<span>Looking up “${esc(raw)}”…</span></p>`
            : !near.here ? `<p class="near-row wait">${pin}<span>${near.error ? 'Couldn’t look that up just now. Try again in a moment.' : `Couldn’t find “${esc(raw)}”. Try a city and state, or a ZIP code.`}</span></p>`
            : foldSection(`Near ${esc(near.label)}`, `<ul>${reach.nearest(near.here, this.era, 8).map(nearRow).join('')}</ul>`, { key: 'near', open: true });
        const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), seen = new Set();
        const routes = q ? view.routes.filter(r => net.inEra(this.era, r) && !seen.has(r.label) && seen.add(r.label) && words.every(w => fold(`${r.label} ${r.name}`).includes(w))).slice(0, 8) : []; // Routes by name too
        const routeBlock = routes.length ? foldSection(`Routes <span class="count">${routes.length}</span>`, `<ul>${routes.map(r => `<li class="route-hit" data-i="${r.i}" style="--c:${(this.served(this.era), r.color)}"><i></i><span class="hit-name">${esc(r.label)}</span><small>${esc(r.type)}</small></li>`).join('')}</ul>`, { key: 'routes', open: true }) : '';
        this.list.innerHTML = routeBlock + nearBlock + (found.length ? order.map(g => foldSection(`${esc(g)} <span class="count">${groups.get(g).length}</span>`, `<ul>${groups.get(g).map(row).join('')}</ul>`, { key: g, open: !!q || !this.shut[this.sort].has(g) })).join('')
            : near?.here ? '' : '<p class="search-none">No station by that name</p>');
        this.count.textContent = `${found.length} station${found.length === 1 ? '' : 's'}`;
        this.at = q && this.hits().length ? 0 : -1;
        this.mark();
    }

    async findNear(q) { // Stations near a place typed in (looked up only when asked: Enter with no station by that name, or the button)
        if (!q) return;
        const at = this.nearAt = { q, wait: true };
        this.render();
        try { Object.assign(at, await reach.geocode(q) || {}); } catch { at.error = true; }
        at.wait = false;
        if (this.nearAt === at && this.isOpen()) { this.render(); this.at = this.hits().length ? 0 : -1; this.mark(); }
    }

    hits() { return $$('.fold:not(.shut) .search-hit', this.list); } // Rows in open groups
    step(by) { const n = this.hits().length; if (n) { this.at = (this.at + by + n) % n; this.mark(); } }
    mark(scroll = true) { // Highlight the keyboard's pick
        this.hits().forEach((li, k) => li.classList.toggle('on', k === this.at));
        if (scroll) this.hits()[this.at]?.scrollIntoView({ block: 'nearest' });
    }

    isOpen() { return !!this.win && !this.win.hidden; }

    open(text = '') {
        if (!document.body.classList.contains('drawn')) return;
        this.build();
        this.win.hidden = false;
        cover(true);
        choose(this.switch, 'sort', this.sort);
        this.era = view.era;
        choose(this.eraSwitch, 'era', this.era);
        this.input.value = text;
        this.render();
        this.list.scrollTop = 0;
        if (!still) $('.finder-panel', this.win).animate([{ opacity: 0, transform: 'translateY(.8rem) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
        this.input.focus();
    }

    close() {
        if (!this.isOpen()) return;
        this.win.hidden = true;
        cover(false);
        this.trigger.value = '';
    }

    go(n) { // Fly to a station and open its window
        this.close();
        if (this.era !== view.era) { view.eraChosen = true; controls.setView({ era: this.era }); } // The map shows the network it was found in
        map.reset();
        const [x, y] = net.cityXY(n);
        view.back = { cx: x, cy: y, hx: 70, hy: 42, side: 0 };
        view.wide = false;
        camera.move(still ? 0 : .9);
        later(still ? 0 : .95, () => stationModal.open(n));
    }

    bind() {
        const start = () => { const t = this.trigger.value; this.trigger.blur(); this.open(t); };
        this.trigger.addEventListener('pointerdown', e => { e.preventDefault(); start(); }); // The sidebar's box opens the window: tapped or clicked, or typed into (not just tabbed onto: keyboards pass through it)
        this.trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); start(); } });
        this.trigger.addEventListener('input', start);
        addEventListener('keydown', e => { // "/" opens it from anywhere but a text box; Escape closes it first
            if (e.key === 'Escape' && this.isOpen()) { e.stopImmediatePropagation(); return this.close(); }
            if (e.key !== '/' || this.isOpen() || e.target.closest?.('input, textarea, [contenteditable]') || stationModal.isOpen() || programs.isOpen()) return;
            e.preventDefault();
            this.open();
        }, true);
    }
}
