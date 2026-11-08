// Every route as text: for screen readers, small screens and anyone who'd rather read than pan
class NetworkList extends Finder {
    era = 'buildout'; // 'today' | 'buildout'
    shut = new Set(); // Route types folded away

    constructor() {
        super('net-list', '#net-list-title', '<h2 id="net-list-title">All Routes</h2>', `<div class="finder-bar">${eraSwitch('finder-era')}</div><div class="finder-list net-list-body"></div><p class="finder-count" aria-live="polite"></p>`);
        [this.body, this.eraSwitch, this.count] = [$('.net-list-body', this.el), $('.finder-era', this.el), $('.finder-count', this.el)];
        this.el.addEventListener('click', e => {
            const era = e.target.closest('.finder-era button')?.dataset.era;
            if (era && era !== this.era) { this.era = era; choose(this.eraSwitch, 'era', era); this.body.scrollTop = 0; return this.render(); }
            const head = e.target.closest('.fold-head');
            if (head) return void toggleFold(head, this.shut);
            const go = e.target.closest('[data-i]');
            if (go) { this.close(); if (this.era !== view.era) { view.eraChosen = true; controls.setView({ era: this.era }); } sidebar.pick(+go.dataset.i, true); }
        });
    }

    open(era = view.era) {
        this.era = era;
        choose(this.eraSwitch, 'era', era);
        this.render();
        this.reveal();
    }

    render() { // Each route of the era, by type, with its status, states and stations
        const inEra = r => this.era === 'today' ? net.present(r) : net.buildout(r), stations = new Set(), byType = new Map();
        for (const [label, ids] of view.groups) { const members = ids.map(i => view.routes[i]).filter(inEra); if (members.length) bucket(byType, members[0].type).push([label, members]); }
        const route = ([label, members]) => {
            const r = members[0], states = [...new Set(members.flatMap(m => m.stops).map(net.stateIdOf))].filter(Boolean), many = members.length > 1;
            members.forEach(m => m.stops.forEach(n => stations.add(mainOf(n))));
            const stops = m => `<ol class="nl-stops">${m.stops.map(n => `<li>${esc(place(n))}</li>`).join('')}</ol>`;
            return `<article class="nl-route" style="--c:${r.color}"><h4 aria-level="4"><span class="swatch" aria-hidden="true"></span>${esc(label)}</h4>` +
                `<p class="nl-meta"><b class="is-${statusKind(r.status)}">${esc(statusText(r.status, r))}</b> · ${plural(new Set(members.flatMap(m => m.stops.map(mainOf))).size, 'station')}</p>` +
                (states.length ? `<p class="nl-states">${states.map(id => `<span>${flag(id)}${esc(STATE_NAMES[id] || id)}</span>`).join('')}</p>` : '') +
                (many ? members.map(m => `<p class="nl-branch">${esc(m.name)}</p>${stops(m)}`).join('') : stops(r)) + // Each branch its own stops
                `<button class="nl-go" type="button" data-i="${r.i}">Show on the map<span aria-hidden="true"> →</span></button></article>`;
        };

        const types = [...byType].sort((a, b) => a[0].localeCompare(b[0]));
        this.body.innerHTML = types.map(([type, list]) => foldSection(`${esc(type)} <span class="count">${list.length}</span>`, list.sort((a, b) => a[0].localeCompare(b[0])).map(route).join(''), { key: type, shut: this.shut })).join('');
        const routes = types.reduce((t, [, list]) => t + list.length, 0);
        this.count.textContent = `${plural(routes, 'route')} · ${plural(stations.size, 'station')} · ${this.era === 'today' ? 'Present day' : 'Full buildout'}`;
    }
}