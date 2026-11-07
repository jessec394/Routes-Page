// Station search
class StationSearch extends Finder {
    trigger = $('.station-search input'); // The sidebar's box
    sort = 'az'; // 'az' | 'state'
    era = 'buildout'; // Network the list shows: 'today' | 'buildout'
    shut = { az: new Set(), state: new Set() }; // Groups folded away, per sort
    at = -1; // Highlighted result

    constructor() {
        super('', 'Find a station', '<h2>Find a Station</h2>', '<div class="finder-bar"><label class="finder-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg><input type="search" placeholder="Station, city, address or ZIP code" aria-label="Station name, or a city, address or ZIP code to find stations near" autocomplete="off" spellcheck="false" aria-controls="finder-list"></label>' + eraSwitch('finder-era') +
            segmented('finder-sort', 'Sort', 'sort', [['az', 'A–Z'], ['state', 'By State']], 'az') + '</div>' +
            '<div class="finder-list" id="finder-list"></div><p class="finder-count"></p>');
        [this.input, this.list, this.switch, this.eraSwitch, this.count] = [$('input', this.el), $('.finder-list', this.el), $('.finder-sort', this.el), $('.finder-era', this.el), $('.finder-count', this.el)];
        this.input.addEventListener('input', () => this.render());
        this.input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
            else if (e.key === 'Enter' && this.trip) { e.preventDefault(); this.goTrip(); }
            else if (e.key === 'Enter' && this.hits()[this.at]) { e.preventDefault(); this.go(this.hits()[this.at].dataset.city); }
            else if (e.key === 'Enter' && this.input.value.trim()) { e.preventDefault(); this.findNear(this.input.value.trim()); } // No station by that name: stations near the place
        });

        this.el.addEventListener('click', e => {
            const era = e.target.closest('.finder-era button')?.dataset.era;
            if (era && era !== this.era) { this.era = era; choose(this.eraSwitch, 'era', era); return this.render(); }
            const sort = e.target.closest('.finder-sort button')?.dataset.sort;
            if (sort && sort !== this.sort) { this.sort = sort; choose(this.switch, 'sort', sort); this.list.scrollTop = 0; return this.render(); }
            const head = e.target.closest('.fold-head');
            if (head) return void toggleFold(head, this.shut[this.sort]);
            if (e.target.closest('.trip-row')) return this.goTrip();
            if (e.target.closest('.near-row')) return this.findNear(this.input.value.trim());
            const hit = e.target.closest('.search-hit');
            if (hit) this.go(hit.dataset.city);
        });

        this.el.addEventListener('keydown', e => { // Typing anywhere in the window goes to its box
            if (e.target === this.input || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key.length === 1 || e.key === 'Backspace') this.input.focus();
            else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.target.closest('.fold-head')) { e.preventDefault(); this.input.focus(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
        });

        this.list.addEventListener('pointerover', e => { const li = e.target.closest('.search-hit'); if (li) { this.at = this.hits().indexOf(li); this.mark(false); } });
    }

    entries() { // Every station on the map, once, with what it needs for matching and listing
        const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return this.all ??= Object.keys(view.cities).filter(n => mainOf(n) === n).map(n => {
            const st = net.stateIdOf(n) || '', name = baseName(n), stName = STATE_NAMES[st] || st || 'Other'; // No parenthetical: the state beside it tells it apart
            return { n, name, st, stName, letter: fold(name)[0]?.toUpperCase() || '#', first: fold(name), key: fold(name) };
        }).sort((a, b) => a.name.localeCompare(b.name) || a.stName.localeCompare(b.stName));
    }

    served(era) { // Station -> its routes in an era, worked out once per era and route types
        const key = `${era}|${view.types}`;
        if (this.servedKey?.[era] === key) return this.servedBy[era];
        const was = view.era;
        view.era = era;
        let colors;
        try { colors = net.colorsFor(); } finally { view.era = was; }
        const by = new Map();
        for (const r of view.routes) if (net.inEra(era, r)) for (const n of r.stops) for (const t of twinsOf(n)) { const m = mainOf(t), list = bucket(by, m); if (!list.some(o => o.label === r.label)) list.push({ label: r.label, color: colors.get(r.g) ?? r.color }); }
        (this.servedKey ??= {})[era] = key;
        return (this.servedBy ??= {})[era] = by;
    }

    colorsAt(n) { return (this.served(this.era).get(n) || []).slice(0, 6).map(r => `<b style="--c:${r.color}"></b>`).join(''); } // Its routes' colors in the list's era

    render() { // The list: grouped by letter or state, matching what's typed
        const q = this.input.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), words = q.split(/\s+/).filter(Boolean);
        const served = this.served(this.era), found = this.entries().filter(e => served.has(e.n) && words.every(w => e.key.includes(w))); // Only stations that era's trains call at
        if (q) found.sort((a, b) => (b.first.startsWith(q) - a.first.startsWith(q)) || a.name.localeCompare(b.name)); // Names starting with it first
        const byState = this.sort === 'state', groups = new Map();
        for (const e of found) { const g = byState ? e.stName : e.letter; bucket(groups, g).push(e); }
        const order = [...groups.keys()].sort((a, b) => byState ? (b === (STATE_NAMES[view.focus] || '')) - (a === (STATE_NAMES[view.focus] || '')) || a.localeCompare(b) : q ? 0 : a.localeCompare(b)); // By state: the featured one first
        const row = e => `<li class="search-hit size-${sizeOf(view.cities[e.n])}${building(e.n, this.era) ? ' building' : ''}" data-city="${esc(e.n)}"><i></i><span class="hit-name">${listName(e.n)}${stopTag(e.n, this.era)}</span>${byState ? `<span class="links">${this.colorsAt(e.n)}</span>` : (FLAGS.has(e.st) ? `<small class="hit-state">${esc(e.stName)}${flag(e.st)}</small>` : '')}</li>`; // A–Z: the state and its flag, by state: the routes' colours
        const raw = this.input.value.trim(), near = this.nearAt?.q === raw ? this.nearAt : null, pin = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg>';
        const nearRow = n => `<li class="search-hit size-${sizeOf(view.cities[n.name])}" data-city="${esc(n.name)}"><i></i><span class="hit-name">${listName(n.name)}${stopTag(n.name, this.era)}</span><small>${[net.stateIdOf(n.name), `${n.miles < 1 ? '<1' : Math.round(n.miles)} mi`].filter(Boolean).map(esc).join(' · ')}</small><span class="links">${this.colorsAt(mainOf(n.name))}</span></li>`;
        const nearBlock = !raw ? `<p class="near-row wait">${pin}<span>Type a city, address or ZIP code to find the stations near it</span></p>` : !near ? `<button class="near-row" type="button">${pin}<span>Stations near <b>“${esc(raw)}”</b></span><em>City, address or ZIP code</em></button>` // Asked for, not looked up as you type
            : near.wait ? `<p class="near-row wait">${pin}<span>Looking up “${esc(raw)}”…</span></p>`
            : !near.here ? `<p class="near-row wait">${pin}<span>${near.error ? 'Couldn’t look that up just now. Try again in a moment.' : `Couldn’t find “${esc(raw)}”. Try a city and state, or a ZIP code.`}</span></p>`
            : foldSection(`Near ${esc(near.label)}`, `${reach.change(near.here)}<ul>${reach.nearest(near.here, this.era, 8).map(nearRow).join('')}</ul>`, { key: 'near', open: true });
        const ends = raw.match(/^(.+?)\s+to\s+(.+)$/i), from = ends && trips.find(ends[1], true), to = ends && trips.find(ends[2], true); // "Columbus to Chicago"
        this.trip = from && to && from !== to ? [from, to] : null;
        const tripRow = this.trip ? `<button class="near-row trip-row" type="button">${pin}<span>Trip from <b>${esc(baseName(from))}</b> to <b>${esc(baseName(to))}</b></span></button>` : '';
        this.list.innerHTML = tripRow + nearBlock + (found.length ? order.map(g => foldSection(`${byState ? flag(STATE_IDS[g]) : ''}${esc(g)} <span class="count">${groups.get(g).length}</span>`, `<ul>${groups.get(g).map(row).join('')}</ul>`, { key: g, open: !!q || !this.shut[this.sort].has(g) })).join('')
            : near?.here ? '' : '<p class="search-none">No station by that name</p>');
        this.count.textContent = `${found.length} station${found.length === 1 ? '' : 's'}`;
        this.at = q && this.hits().length ? 0 : -1;
        this.mark();
    }

    async findNear(q) { // Stations near a place typed in
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

    open(text = '') {
        if (!has(document.body, 'drawn')) return;
        choose(this.switch, 'sort', this.sort);
        this.era = view.era;
        choose(this.eraSwitch, 'era', this.era);
        this.input.value = text;
        this.render();
        this.reveal(this.input);
        this.list.scrollTop = 0;
    }

    closed() { this.trigger.value = ''; }

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

    goTrip() { const [from, to] = this.trip; this.go(from); later(still ? .05 : 1, () => stationModal.tripTo(to)); } // Open the first station with the way to the second

    bind() {
        const start = () => { const t = this.trigger.value; this.trigger.blur(); this.open(t); };
        this.trigger.addEventListener('pointerdown', e => { e.preventDefault(); start(); }); // The sidebar's box opens the window
        this.trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); start(); } });
        this.trigger.addEventListener('input', start);
        addEventListener('keydown', e => { // "/" opens it from anywhere but a text box
            if (e.key !== '/' || Modal.open.length || e.target.closest?.('input, textarea, [contenteditable]')) return;
            e.preventDefault();
            this.open();
        }, true);
    }
}