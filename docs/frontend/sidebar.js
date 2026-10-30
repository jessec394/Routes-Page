// Routes sidebar
class Sidebar {
    scope = 'focus'; // Listed routes: 'focus' (the featured state's) or 'national' (everything else)
    auto = false; // Scope switched by a selection on the map (it goes back to the state's list when cleared)
    shut = new Set(); // Collapsed sections, by name

    place() { return view.focus === 'DC' ? 'D.C.' : STATE_NAMES[view.focus] || view.focus; } // The focus state's name, short enough for its button

    build() { // Sidebar: scope switch, then the routes grouped by status
        if (!this.lists) {
            this.switch?.remove();
            this.switch = Object.assign(document.createElement('div'), { className: 'scope segmented', innerHTML: `<button role="radio" data-scope="focus">${esc(this.place())}</button><button role="radio" data-scope="national">National</button>` });
            this.switch.setAttribute('role', 'radiogroup');
            this.switch.setAttribute('aria-label', 'Routes to list');
            this.switch.addEventListener('click', e => { const scope = e.target.closest('button')?.dataset.scope; if (scope) this.show(scope); });
            ui.legendBody.before(this.switch); // (Above the list, not scrolled with it)
            ui.legendBody.innerHTML = '<div class="legend-lists"></div>';
            this.lists = $('.legend-lists', ui.legendBody);
            this.switch.hidden = !view.routes.some(r => r.context); // Nothing national to list
            setTimeout(() => measureSwitch(this.switch), 3000);
        }

        const national = this.scope === 'national';
        const groups = [...view.groups.values()].flatMap(ids => [...new Map(ids.map(i => [net.proposed(view.routes[i]), view.routes[i]])).values()]) // One entry per version: today's route and its proposal are listed apart
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

    section(tag, title, body, n) { // A heading (with how many routes) that folds its routes away (click it)
        const open = !this.shut.has(title);
        return `<section class="fold${open ? '' : ' shut'}"><${tag}><button class="fold-head" data-fold="${esc(title)}" aria-expanded="${open}"><span>${esc(title)}${n ? ` <span class="count">${n}</span>` : ''}</span><i aria-hidden="true"></i></button></${tag}><div class="fold-body"><div>${body}</div></div></section>`;
    }

    fold(head) { // Open or close a section
        const sect = head.closest('.fold'), open = sect.classList.toggle('shut') === false;
        head.setAttribute('aria-expanded', open);
        open ? this.shut.delete(head.dataset.fold) : this.shut.add(head.dataset.fold);
        setTimeout(() => this.edges(), 320); // Once it has folded
    }

    edges() { // Fade the list's edges only where there's more to scroll to (next frame: sizes read now force a full layout)
        this.edgesAt ||= requestAnimationFrame(() => {
            this.edgesAt = 0;
            const b = ui.legendBody;
            b.classList.toggle('scrolled', b.scrollTop > 2);
            b.classList.toggle('more', b.scrollTop + b.clientHeight < b.scrollHeight - 2);
        });
    }

    show(scope, quiet, auto = false) { // List the other scope's routes (quiet: the map is already updating its highlights)
        this.auto = auto;
        if (scope === this.scope) return;
        this.scope = scope;
        this.build();
        ui.legendBody.scrollTop = 0;
        if (!quiet) map.focusRoutesAndStations(); // Highlights for the new buttons
        requestAnimationFrame(() => brandMap.place()); // (It measures the sidebar: next frame, after the change)
    }

    highlight(active) { // Dim hidden routes; mark the hovered/selected one
        const picked = view.selected !== null && view.routes[view.selected];
        if (picked && picked.context !== (this.scope === 'national')) this.show(picked.context ? 'national' : 'focus', true, true); // Selected on the map: list its scope
        else if (!picked && this.auto && this.scope === 'national') this.show('focus', true); // Cleared: back to the state's routes
        (this.buttons || []).forEach(b => {
            const i = +b.dataset.i;
            b.classList.toggle('off', !net.siblings(i).some(net.shownAt));
            b.classList.toggle('on', !!active && net.siblings(i).some(m => active.includes(m)) && (view.hover !== null || view.selected !== null));
        });
    }

    picks() { // Phones upright: the programs, as a row of small tabs under the search (their tabs on the map's foot have no room there)
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
            if (phoneLayout()) { view.legend = !view.legend; return this.sync(); } // Phones upright: the sheet opens over the map (which stays where it is)
            view.legend = !view.legend;
            this.sync();
            if (view.cam) camera.move();
        });

        $('.picks')?.addEventListener('click', e => {
            const b = e.target.closest('.pick');
            if (!b || !document.body.classList.contains('drawn')) return;
            programs.open(b.dataset.program, b);
        });
        ui.legendBody.addEventListener('pointerover', e => { const b = e.target.closest('button[data-i]'); map.hoverRoute(b && !b.classList.contains('off') ? +b.dataset.i : null); });
        ui.legendBody.addEventListener('pointerleave', () => map.hoverRoute(null));
        ui.legendBody.addEventListener('scroll', () => this.edges(), { passive: true });
        ui.legendBody.addEventListener('click', e => {
            const b = e.target.closest('button[data-i]'), head = e.target.closest('.fold-head');
            if (head) return this.fold(head);
            if (b) this.pick(+b.dataset.i);
        });
    }

    pick(i, keep) { // Select a route, turning on its type and era if off (again: cleared, unless `keep`)
        const r = view.routes[i], need = {};
        if (!net.hasType(r.typeKey)) need.types = controls.toggleType(r.typeKey, true);
        if (!net.siblings(r.i).some(m => net.inEra(view.era, view.routes[m]))) need.era = view.era === 'today' ? 'buildout' : 'today';
        controls.setView(need);
        map.selectRoute(net.siblings(r.i).includes(view.selected) && !keep ? null : net.siblings(r.i).find(net.shownAt));
    }
}

// Static brand map (splash map docked in the sidebar)
class BrandMap {
    static RATIO = 353 / 392; // Map image aspect
    el = $('.brand'); // Docked map
    viewer = $('.brand-map-view'); // Full-size viewer
    isOpen() { return !this.viewer.hidden; }

    dockRect() { // Spot at the foot of the sidebar (the route list scrolls above it), or null
        if (pageW() <= NARROW || pageH() < 720 || !view.legend) return null; // (Short screens: the list gets the room)
        const w = Math.min(ui.legend.offsetWidth - 48, 260, pageH() * .26 / BrandMap.RATIO), h = w * BrandMap.RATIO; // At most about a quarter of the height
        return h >= 100 ? { w, h, left: (ui.legend.offsetWidth - w) / 2, top: pageH() - 20 - h } : null;
    }

    place() { // Dock the map in the sidebar
        if (!document.body.classList.contains('settled')) return;
        const d = this.dockRect(), b = this.el;
        ui.legend.style.setProperty('--dock', d ? `${(d.h + 36).toFixed(0)}px` : '0px'); // Room kept under the list
        sidebar.edges();
        if (d && !b.classList.contains('docked')) { pageEl().append(b); b.classList.add('docked'); } // (Leaving the splash: straight to its spot)
        b.classList.toggle('away', !d);
        b.tabIndex = d ? 0 : -1;
        if (d) Object.assign(b.style, { width: `${d.w.toFixed(1)}px`, left: `${d.left.toFixed(1)}px`, top: `${d.top.toFixed(1)}px` });
    }

    openBrandMap() { // Open the full-size viewer
        const v = this.viewer, img = $('.brand-big', v), from = rectOf(this.el);
        v.hidden = false;
        cover(true);
        this.el.style.visibility = 'hidden';
        v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms(350), easing: 'ease-out' });
        img.animate([{ transform: flight(from, rectOf(img)) }, { transform: 'none' }], { duration: ms(650), easing: GLIDE });
        $('.close', v).focus();
    }

    closeBrandMap() { // Close it, shrinking back
        const v = this.viewer, img = $('.brand-big', v);
        img.style.visibility = '';
        const back = img.animate([{ transform: 'none' }, { transform: flight(rectOf(this.el), rectOf(img)) }], { duration: ms(550), easing: GLIDE, fill: 'forwards' });
        v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms(450), delay: ms(150), easing: 'ease-in', fill: 'forwards' });
        back.finished.then(() => {
            v.hidden = true;
            cover(false);
            this.el.style.visibility = '';
            v.getAnimations({ subtree: true }).forEach(a => a.cancel());
            this.el.focus();
        });
    }

    static HUBS = [['Toledo', .306, .136], ['Cleveland', .676, .181], ['Columbus (OH)', .408, .558], ['Dayton', .204, .601], ['Cincinnati', .14, .759]]; // The map art's named stations (spot as a share of its width and height)

    hubAt(e) { // The named station under the pointer on the docked map, or null
        const r = this.el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const near = BrandMap.HUBS.map(([n, hx, hy]) => [n, Math.hypot((x - hx) * r.width, (y - hy) * r.height)]).sort((a, b) => a[1] - b[1])[0];
        return near && near[1] < 16 ? near[0] : null;
    }

    preview(name) { // Its station on the main map picked out (a ring, and the dot drawn over the rest)
        if (name === this.hot) return;
        this.hot = name;
        view.pinList?.forEach(p => { const on = !!name && p.dataset.city === name; if (on !== p.classList.contains('ping')) p.classList.toggle('ping', on); });
    }

    bind() {
        this.el.addEventListener('click', () => this.el.classList.contains('docked') && this.openBrandMap());
        this.viewer.addEventListener('click', () => this.closeBrandMap());
        this.el.addEventListener('pointermove', e => this.el.classList.contains('docked') && e.pointerType === 'mouse' && this.preview(this.hubAt(e))); // Hovering a city on the Ohio map shows it on the big one
        this.el.addEventListener('pointerleave', () => this.preview(null));
    }
}
