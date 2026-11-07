// Ridership: Amtrak's yearly figures, each shown as Amtrak reports it, never one route's set against another's combined
class Ridership {
    load() { return this.data ??= getJSON('data/ridership.json').catch(() => null).then(d => (this.now = d)); } // None until maintenance/update_ridership.py has run
    riders(n) { return this.now?.stations.riders[n] || 0; } // A station's riders last year, once loaded with the map

    units(d, label) { return (d?.routes.labels[label] || []).map(k => d.routes.units[k]); } // The figures covering a route
    own(d, label) { const u = this.units(d, label); return u.length === 1 && u[0].labels.length === 1 ? u[0] : null; } // Its figure, if it's this route's alone
    short(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString('en-US'); } // 738K, 12.0M
    count(n) { return `<b title="${n.toLocaleString('en-US')}">${this.short(n)}</b>`; }
    change(u, d) { return u.prior ? `<span class="riders-change">${u.riders >= u.prior ? '+' : '−'}${Math.abs(100 * (u.riders / u.prior - 1)).toFixed(1)}% on ${esc(d.routes.prior)}</span> · ` : ''; } // Against the year before, kept whole
    source(d, what) { return `<a href="${esc(d[what].url)}" target="_blank" rel="noopener">Amtrak</a>`; } // Where the figures come from
    others(u, label) { const o = u.labels.filter(l => l !== label); return o.length ? `with the ${o.map(esc).join(' and the ')}` : ''; } // Routes a figure also covers

    forRoute(el, r, era) { // A route card: its riders in the last year, as reported; only for the route as it runs today, not an extension or expansion of it
        if (!el || era !== 'today') return;
        this.load().then(d => {
            const units = this.units(d, r.label);
            if (!units.length || !el.isConnected) return;
            const one = units.length === 1 && units[0];
            el.innerHTML = one ? `<p class="times-sum">${this.count(one.riders)} riders in ${esc(d.routes.year)}</p>` +
                    `<p class="riders-note">${this.change(one, d)}${one.labels.length > 1 ? `Counted ${this.others(one, r.label)}, as Amtrak reports them · ` : ''}${this.source(d, 'routes')}</p>`
                : `<p class="times-sum">Riders in ${esc(d.routes.year)} <small>reported in parts</small></p><ul class="riders-parts">${units.map(u => `<li>${this.count(u.riders)}<span>${esc(u.name)}${u.labels.length > 1 ? `, ${this.others(u, r.label)}` : ''}</span></li>`).join('')}</ul><p class="riders-note">As Amtrak reports them · ${this.source(d, 'routes')}</p>`; // Each part under Amtrak's own name: not added up
            el.hidden = false;
        });
    }

    forStation(el, name) { // A station window: trains boarded and left there in the last year
        if (!el) return;
        this.load().then(d => {
            const n = d && twinsOf(name).map(t => d.stations.riders[t]).find(Boolean);
            if (!n || !el.isConnected) return;
            el.innerHTML = `<b>${n.toLocaleString('en-US')}</b><span>boardings and alightings in <span class="nowrap">${esc(d.stations.year)} <small class="cite">(${this.source(d, 'stations')})</small></span></span>`; // The source in brackets after the words, wrapping with the year
            el.hidden = false;
        });
    }

    forCompare(sides) { // The comparison's row: both routes' own figures, or a word on why one is missing
        return this.load().then(d => {
            if (!d) return { vals: [null, null], note: '' };
            const vals = sides.map(v => v.era === 'today' ? this.own(d, v.label)?.riders ?? null : null);
            const shared = sides.filter((v, k) => v.era === 'today' && vals[k] == null && this.units(d, v.label).length).map(v => v.label); // Running, but counted with other routes
            return { vals, year: d.routes.year, note: shared.length ? ` Riders: Amtrak counts ${shared.join(' and ')} together with other routes, so ${shared.length > 1 ? 'they aren’t' : 'it isn’t'} compared.` : '' };
        });
    }
}