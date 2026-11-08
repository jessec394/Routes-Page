// Routes sidebar
class Sidebar {
    scope = 'focus'; // Listed routes: 'focus' or 'national'
    auto = false; // Scope switched by a selection on the map
    shut = new Set(); // Collapsed sections, by name

    place() { return view.focus === 'DC' ? 'D.C.' : STATE_NAMES[view.focus] || view.focus; } // The focus state's name, short enough for its button

    build() { // Sidebar: scope switch, then the routes grouped by status
        if (!this.lists) {
            this.switch?.remove();
            this.switch = Object.assign(document.createElement('div'), { className: 'scope segmented', innerHTML: `<button role="radio" data-scope="focus">${esc(this.place())}</button><button role="radio" data-scope="national">National</button>` });
            this.switch.setAttribute('role', 'radiogroup');
            this.switch.setAttribute('aria-label', 'Routes to list');
            this.switch.addEventListener('click', e => { const scope = e.target.closest('button')?.dataset.scope; if (scope) this.show(scope); });
            ui.legendBody.before(this.switch); // Above the list, not scrolled with it
            ui.legendBody.innerHTML = '<div class="legend-lists"></div><button class="list-open" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>Show all routes</button><button class="list-open keys-open" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>Keyboard shortcuts</button>';
            this.lists = $('.legend-lists', ui.legendBody);
            $('.list-open', ui.legendBody).addEventListener('click', () => netList.open());
            $('.keys-open', ui.legendBody).addEventListener('click', () => keyHelp.open());
            this.switch.hidden = !view.routes.some(r => r.context); // Nothing national to list
            setTimeout(() => measureSwitch(this.switch), 3000);
        }

        const national = this.scope === 'national';
        const groups = [...view.groups.values()].flatMap(ids => [...new Map(ids.map(i => [net.proposed(view.routes[i]), view.routes[i]])).values()]) // One entry per version
            .filter(r => r.context === national).sort((a, b) => a.label.localeCompare(b.label));
        const item = r => { const kind = statusKind(r.status); return routeItem(r, esc(r.type) + (TAGS[kind] ? ` · <b class="is-${kind}">${TAGS[kind]}</b>` : ''), false); }; // One sidebar entry
        const list = items => `<ul>${items.map(item).join('')}</ul>`; // Entries as a list
        const existing = groups.filter(r => !net.proposed(r)), left = groups.filter(r => !existing.includes(r));
        const found = [...new Set(left.flatMap(programsOf))], titles = [...PROGRAMS.filter(p => found.includes(p)), ...found.filter(p => !PROGRAMS.includes(p)).sort()]; // Programs listed, known ones first
        const proposed = [...titles.map(title => [title, left.filter(r => programsOf(r).includes(title))]), ['Other', left.filter(r => !programsOf(r).length)]] // A route in several programs is listed under each
            .map(([title, items]) => items.length ? this.section('h5', title, list(items), items.length) : '').join('');

        this.lists.innerHTML = (existing.length ? this.section('h4', 'Existing Routes', list(existing), existing.length) : '') + (proposed ? this.section('h4', 'Proposed Routes', proposed, left.length) : '');
        this.buttons = $$('button[data-i]', this.lists);
        choose(this.switch, 'scope', this.scope);
        this.edges();
    }

    section(tag, title, body, n) { return foldSection(`<span>${esc(title)}${n ? ` <span class="count">${n}</span>` : ''}</span>`, body, { key: title, shut: this.shut, tag, level: 0 }); } // A heading that folds its routes away

    fold(head) { toggleFold(head, this.shut); setTimeout(() => this.edges(), 320); } // Open or close a section, then measure it once it has

    edges() { // Fade the list's edges only where there's more to scroll to
        this.edgesAt ||= requestAnimationFrame(() => {
            this.edgesAt = 0;
            const b = ui.legendBody;
            b.classList.toggle('scrolled', b.scrollTop > 2);
            b.classList.toggle('more', b.scrollTop + b.clientHeight < b.scrollHeight - 2);
        });
    }

    show(scope, quiet, auto = false) { // List the other scope's routes
        this.auto = auto;
        if (scope === this.scope) return;
        this.scope = scope;
        this.build();
        ui.legendBody.scrollTop = 0;
        if (!quiet) map.focusRoutesAndStations(); // Highlights for the new buttons
        requestAnimationFrame(() => brandMap.place()); // It measures the sidebar: next frame, after the change
    }

    highlight(active) { // Dim hidden routes
        const picked = view.selected !== null && view.routes[view.selected];
        if (picked && picked.context !== (this.scope === 'national')) this.show(picked.context ? 'national' : 'focus', true, true); // Selected on the map: list its scope
        else if (!picked && this.auto && this.scope === 'national') this.show('focus', true); // Cleared: back to the state's routes
        (this.buttons || []).forEach(b => {
            const i = +b.dataset.i;
            b.classList.toggle('off', !net.siblings(i).some(net.shownAt));
            b.classList.toggle('on', !!active && net.siblings(i).some(m => active.includes(m)) && (view.hover !== null || view.selected !== null));
        });
    }

    picks() { // Phones upright
        const el = $('.picks');
        if (!el || !view.routes.length) return;
        if (phoneLayout()) $('.station-search input').placeholder = 'Search stations, routes, places';
        const progs = programs.tabs ? [...programs.tabs.children].map(b => programs.program(b.dataset.program)) : [];
        el.innerHTML = `<div class="picks-row">${progs.map(p => `<button class="pick" data-program="${esc(p.name)}" style="--a:${p.accent}">${esc(p.short)}</button>`).join('')}</div>`;
    }

    sync() { // Sidebar open state
        ui.legend.classList.toggle('open', view.legend);
        ui.legendToggle.setAttribute('aria-expanded', view.legend);
        if (this.switch) choose(this.switch, 'scope', this.scope); // Measured again now it may be visible
        brandMap.place();
    }

    bind() {
        ui.legendToggle.addEventListener('click', () => {
            if (pageW() > NARROW) return; // Fixed open on desktop
            if (phoneLayout()) { view.legend = !view.legend; return this.sync(); } // Phones upright: the sheet opens over the map
            view.legend = !view.legend;
            this.sync();
            if (view.cam) camera.move();
        });

        $('.picks')?.addEventListener('click', e => { const b = e.target.closest('.pick'); if (!b || !has(document.body, 'drawn')) return; programs.open(b.dataset.program, b); });
        ui.legendBody.addEventListener('pointerover', e => { const b = e.target.closest('button[data-i]'); map.hoverRoute(b && !has(b, 'off') ? +b.dataset.i : null); });
        ui.legendBody.addEventListener('pointerleave', () => map.hoverRoute(null));
        ui.legendBody.addEventListener('scroll', () => this.edges(), { passive: true });
        ui.legendBody.addEventListener('click', e => {
            const b = e.target.closest('button[data-i]'), head = e.target.closest('.fold-head');
            if (head) return this.fold(head);
            if (b) this.pick(+b.dataset.i);
        });
    }

    pick(i, keep) { // Select a route, turning on its type and era if off
        const r = view.routes[i], need = {};
        if (!net.hasType(r.typeKey)) need.types = controls.toggleType(r.typeKey, true);
        if (!net.siblings(r.i).some(m => net.inEra(view.era, view.routes[m]))) need.era = view.era === 'today' ? 'buildout' : 'today';
        controls.setView(need);
        map.selectRoute(net.siblings(r.i).includes(view.selected) && !keep ? null : net.siblings(r.i).find(net.shownAt));
    }
}

// Static brand map
class BrandMap {
    static RATIO = 353 / 392; // Map image aspect
    el = $('.brand'); // Docked map
    viewer = Object.assign(new Modal($('.brand-map-view'), 'All Aboard Ohio rail map'), { enter: () => this.flyOut(), leave: done => this.flyBack(done) }); // Full-size viewer, flying out of the docked map and back
    isOpen() { return this.viewer.isOpen(); }

    dockRect() { // Spot at the foot of the sidebar, or null
        if (pageW() <= NARROW || pageH() < 720 || !view.legend) return null; // Short screens: the list gets the room
        const w = Math.min(ui.legend.offsetWidth - 48, 260, pageH() * .26 / BrandMap.RATIO), h = w * BrandMap.RATIO; // At most about a quarter of the height
        return h >= 100 ? { w, h, left: (ui.legend.offsetWidth - w) / 2, top: pageH() - 20 - h } : null;
    }

    place() { // Dock the map in the sidebar
        if (!has(document.body, 'settled')) return;
        const d = this.dockRect(), b = this.el;
        ui.legend.style.setProperty('--dock', d ? `${(d.h + 36).toFixed(0)}px` : '0px'); // Room kept under the list
        sidebar.edges();
        if (d && !has(b, 'docked')) { pageEl().append(b); b.classList.add('docked'); } // Leaving the splash: straight to its spot
        b.classList.toggle('away', !d);
        b.tabIndex = d ? 0 : -1;
        if (d) Object.assign(b.style, { width: `${d.w.toFixed(1)}px`, left: `${d.left.toFixed(1)}px`, top: `${d.top.toFixed(1)}px` });
    }

    flyOut() { // The big map grows out of the docked one
        const v = this.viewer.el, img = $('.brand-big', v);
        this.el.style.visibility = 'hidden';
        v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(350), easing: 'ease-out' });
        img.animate([{ transform: flight(rectOf(this.el), rectOf(img)) }, { transform: 'none' }], { duration: ms(650), easing: GLIDE });
    }

    flyBack(done) { // And shrinks back into it
        const v = this.viewer.el, img = $('.brand-big', v);
        img.animate([{ transform: 'none' }, { transform: flight(rectOf(this.el), rectOf(img)) }], { duration: ms(550), easing: GLIDE, fill: 'forwards' }).finished.then(() => {
            done();
            this.el.style.visibility = '';
            v.getAnimations({ subtree: true }).forEach(a => a.cancel());
        });

        v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(450), delay: ms(150), easing: 'ease-in', fill: 'forwards' });
    }

    static HUBS = [['Toledo', .306, .136], ['Cleveland', .676, .181], ['Columbus (OH)', .408, .558], ['Dayton', .204, .601], ['Cincinnati', .14, .759]]; // The map art's named stations

    hubAt(e) { // The named station under the pointer on the docked map, or null
        const r = this.el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const near = BrandMap.HUBS.map(([n, hx, hy]) => [n, Math.hypot((x - hx) * r.width, (y - hy) * r.height)]).sort((a, b) => a[1] - b[1])[0];
        return near && near[1] < 16 ? near[0] : null;
    }

    preview(name) { // Its station on the main map picked out
        if (name === this.hot) return;
        this.hot = name;
        view.pinList?.forEach(p => { const on = !!name && p.dataset.city === name; if (on !== has(p, 'ping')) p.classList.toggle('ping', on); });
    }

    bind() {
        this.el.addEventListener('click', () => has(this.el, 'docked') && this.viewer.reveal(null, this.el));
        this.viewer.el.addEventListener('click', () => this.viewer.close()); // A tap anywhere on it
        this.el.addEventListener('pointermove', e => has(this.el, 'docked') && e.pointerType === 'mouse' && this.preview(this.hubAt(e))); // Hovering a city on the Ohio map shows it on the big one
        this.el.addEventListener('pointerleave', () => this.preview(null));
    }
}