// Header controls
class Controls {
    sync() { // Header buttons match the view
        $$('button[data-type]', ui.modes).forEach(b => b.setAttribute('aria-pressed', net.hasType(b.dataset.type)));
        this.showEra(view.era);
        document.body.classList.toggle('era-today', view.era === 'today'); // (Funded new routes dashed on Present Day)
        const empty = view.routes.length > 0 && !view.routes.some(net.shown);
        ui.hint.classList.toggle('empty', empty);
        ui.hint.textContent = empty ? 'No routes match this view' : '';
        if (view.cam) reach.update();
        this.stats();
        this.fit();
    }

    fit() { // The banner: the switch centred (clear of the logo); the title, then the counts, step aside where they'd meet it
        const top = ui.top, box = $('.era-box', top), logo = $('.logo', top), W = top.clientWidth;
        if (!box || !W) return;
        const half = box.offsetWidth / 2, clear = logo.offsetLeft + logo.offsetWidth + 2.2 * parseFloat(getComputedStyle(document.documentElement).fontSize) + half; // (Past the logo's stripes)
        const x = Math.min(W - half - 12, Math.max(W / 2, clear));
        top.style.setProperty('--era-x', `${x}px`);
        const left = x - half - 20, right = x + half + 20, title = $('.title', top), stats = $('.top-stats', top); // Title left of the switch, counts right of it
        [title, stats].forEach(el => el?.classList.remove('is-hidden'));
        if (title?.offsetWidth && title.offsetLeft + title.offsetWidth > left) title.classList.add('is-hidden');
        if (stats?.offsetWidth && stats.offsetLeft < right) stats.classList.add('is-hidden');
    }

    stats() { // In the banner where there's room: how big the network shown is
        const shown = view.routes.filter(net.shown), routes = new Set(shown.map(r => r.label)).size, stations = new Set(shown.flatMap(r => r.stops)).size;
        $('.top-stats').innerHTML = routes ? `<b>${routes}</b> route${routes === 1 ? '' : 's'}<i aria-hidden="true"></i><b>${stations}</b> station${stations === 1 ? '' : 's'}` : '';
    }

    showEra(era, group = ui.era) { choose(group, 'era', era); } // An era switch shows `era`

    setView(change) { // Change types/era and refresh
        if (!view.cam || Object.entries(change).every(([k, v]) => view[k] === v)) return;
        const { zoom, era } = view;
        Object.assign(view, change);
        if (view.era !== era) timeJump.set(view.era, true);
        this.sync();
        if (view.selected !== null && !net.shownAt(view.selected)) { // The route's version in this view (its present-day or buildout self), else none
            const was = view.routes[view.selected], twins = view.routes.filter(o => o.label === was.label && net.shownAt(o.i)), twin = twins.find(o => o.name === was.name) || twins[0];
            if (twin && view.zoom === view.selected) view.zoom = twin.i;
            view.selected = twin ? twin.i : null;
        }
        if (view.zoom != null && !net.members(view.zoom).some(net.shownAt)) view.zoom = null;
        view.hover = null;
        map.crossfade(() => {
            if (net.recolor()) map.recolor(); // (Colors picked for what this view shows)
            map.focusRoutesAndStations();
            zoom !== view.zoom || view.zoom != null ? camera.move() : map.layout();
        });
    }

    toggleType(type, on) { return TYPES.filter(t => t === type ? on : net.hasType(t)).join(' '); } // Types string with one type on/off

    bind() {
        ui.modes.addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (b) this.setView({ types: this.toggleType(b.dataset.type, b.getAttribute('aria-pressed') !== 'true') }); });
        ui.era.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { view.eraChosen = true; this.setView({ era: b.dataset.era }); } });
    }
}
