// Header controls
class Controls {
    sync() { // Header buttons match the view
        $$('button[data-type]', ui.modes).forEach(b => b.setAttribute('aria-pressed', net.hasType(b.dataset.type)));
        this.showEra(view.era);
        const empty = view.routes.length > 0 && !view.routes.some(net.shown);
        ui.hint.classList.toggle('empty', empty);
        ui.hint.textContent = empty ? 'No routes match this view' : '';
    }

    showEra(era, group = ui.era) { choose(group, 'era', era); } // An era switch shows `era`

    setView(change) { // Change types/era and refresh
        if (!view.cam || Object.entries(change).every(([k, v]) => view[k] === v)) return;
        const { zoom, era } = view;
        Object.assign(view, change);
        if (view.era !== era) timeJump.set(view.era, true);
        this.sync();
        if (view.selected !== null && !net.shownAt(view.selected)) view.selected = null;
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
