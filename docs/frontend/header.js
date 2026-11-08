// Header controls
class Controls {
    sync() { // Header buttons match the view
        $$('button[data-type]', ui.modes).forEach(b => press(b, net.hasType(b.dataset.type)));
        this.showEra(view.era);
        document.body.classList.toggle('era-today', view.era === 'today'); // Funded new routes dashed on Present Day
        const empty = view.routes.length > 0 && !view.routes.some(net.shown);
        ui.hint.classList.toggle('empty', empty);
        ui.hint.textContent = empty ? 'No routes match this view' : '';
        if (view.cam) reach.update();
        this.fit();
    }

    fit() { // The banner: the switch centred
        const top = ui.top, box = $('.era-box', top), logo = $('.logo', top), W = top.clientWidth;
        if (!box || !W) return;
        const half = box.offsetWidth / 2, clear = logo.offsetLeft + logo.offsetWidth + 2.2 * remPx() + half; // Past the logo's stripes
        const x = Math.min(W - half - 12, Math.max(W / 2, clear));
        top.style.setProperty('--era-x', `${x}px`);
        top.style.setProperty('--era-end', `${x + half}px`); // Where the train right of it pulls up
        const left = x - half - 20, title = $('.title', top), train = $('.top-train', top); // Title left of the switch, a train right of it
        title?.classList.toggle('is-hidden', !!title.offsetWidth && title.offsetLeft + title.offsetWidth > left);
        train?.classList.toggle('is-hidden', W - x - half < 12 * remPx()); // Room for a cab and a carriage's worth, or none
    }

    showEra(era, group = ui.era) { choose(group, 'era', era); } // An era switch shows `era`

    setView(change) { // Change types/era and refresh
        if (!view.cam || Object.entries(change).every(([k, v]) => view[k] === v)) return;
        const { zoom, era, trip, conn } = view;
        Object.assign(view, change);
        if (view.era !== era) timeJump.set(view.era, true);
        this.sync();
        if (view.selected !== null && !net.shownAt(view.selected)) { // The route's version in this view, else none
            const was = view.routes[view.selected], twins = view.routes.filter(o => o.label === was.label && net.shownAt(o.i)), twin = twins.find(o => o.name === was.name) || twins[0];
            if (twin && view.zoom === view.selected) view.zoom = twin.i;
            view.selected = twin ? twin.i : null;
        }

        if (view.zoom != null && !net.members(view.zoom).some(net.shownAt)) view.zoom = null;
        if (conn && conn.era !== view.era) view.conn = trips.network(conn.from, view.era, conn.once).routes.length ? { ...conn, era: view.era } : null; // Its reach in the other era
        if (trip && trip.era !== view.era) { const legs = trips.trip(trip.from, trip.to, view.era); view.trip = legs?.length ? { ...trip, era: view.era, legs } : null; } // The same trip in the other era, if there's a way
        view.hover = null;
        map.crossfade(() => {
            if (net.recolor()) map.recolor(); // Colors picked for what this view shows
            map.focusRoutesAndStations();
            zoom !== view.zoom || view.zoom != null || trip || conn ? camera.move() : map.layout();
        });
    }

    toggleType(type, on) { return TYPES.filter(t => t === type ? on : net.hasType(t)).join(' '); } // Types string with one type on/off

    bind() {
        ui.modes.addEventListener('click', e => { const b = e.target.closest('button[data-type]'); if (b) this.setView({ types: this.toggleType(b.dataset.type, b.getAttribute('aria-pressed') !== 'true') }); });
        ui.era.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { view.eraChosen = true; this.setView({ era: b.dataset.era }); } });
    }
}