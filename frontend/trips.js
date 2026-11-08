// Connections and trips between stations
class Trips {
    graphs = new Map(); // Era and route types -> who calls where

    graph(era) { // Station -> routes calling there, and each route's calls in order, twins as one place
        return remember(this.graphs, `${era}|${view.types}`, () => {
            const at = new Map(), calls = new Map();
            for (const r of view.routes) {
                if (!net.inEra(era, r)) continue;
                const list = [...new Set(r.stops.map(mainOf))].filter(n => net.cityXY(n) && !(era === 'today' && unbuilt(n))); // Today's trains pass stations still being built
                calls.set(r.i, list);
                list.forEach(n => bucket(at, n).push(r.i));
            }

            return { at, calls };
        });
    }

    static changeBox(title, rows, note) { // Present day beside the full buildout, a few numbers
        const cell = v => typeof v === 'number' ? v.toLocaleString('en-US') : esc(v);
        return `<section class="change-box" aria-label="${esc(title)}"><p class="change-head">${esc(title)}</p><table><thead><tr><th></th><th>Present Day</th><th>Full Buildout</th></tr></thead><tbody>` +
            rows.map(([k, a, b]) => `<tr><th scope="row">${esc(k)}</th><td>${cell(a)}</td><td${b !== a ? ' class="up"' : ''}>${cell(b)}</td></tr>`).join('') + `</tbody></table>${note ? `<p class="change-new">${note}</p>` : ''}</section>`;
    }

    reach(name, era) { // Places reachable with no change, and with one
        const { at, calls } = this.graph(era), home = mainOf(name), direct = new Set(), once = new Set();
        for (const i of at.get(home) || []) calls.get(i).forEach(n => direct.add(n));
        direct.delete(home);
        for (const n of direct) for (const i of at.get(n) || []) for (const m of calls.get(i)) if (m !== home && !direct.has(m)) once.add(m);
        return { direct, once };
    }

    network(name, era, once) { // The routes and stations within reach, for the main map
        return remember(this.nets ??= new Map(), `${mainOf(name)}|${era}|${once}|${view.types}`, () => {
            const { at, calls } = this.graph(era), routes = new Set(at.get(mainOf(name)) || []);
            if (once) for (const i of [...routes]) for (const n of calls.get(i)) for (const j of at.get(n) || []) routes.add(j);
            return { routes: [...routes], stops: new Set([...routes].flatMap(i => calls.get(i))) };
        });
    }

    trip(a, b, era) { // Fewest changes, then the shortest ride
        const { at, calls } = this.graph(era), A = mainOf(a), B = mainOf(b);
        const leg = (i, from, to) => { // One ride along a route's calls
            const c = calls.get(i), x = c.indexOf(from), y = c.indexOf(to), part = x < y ? c.slice(x, y + 1) : c.slice(y, x + 1).reverse();
            return { i, from, to, calls: part, stops: part.length - 1, km: part.reduce((t, n, k) => k ? t + dist(net.cityXY(part[k - 1]), net.cityXY(n)) : 0, 0) * KM };
        };

        let paths = (at.get(A) || []).map(i => ({ i, at: A, legs: [], km: 0 }));
        const used = new Set(paths.map(p => p.i));
        for (let change = 0; change < 4 && paths.length && A !== B; change++) {
            const done = paths.filter(p => calls.get(p.i).includes(B)).map(p => { const l = leg(p.i, p.at, B); return { legs: [...p.legs, l], km: p.km + l.km }; });
            if (done.length) return done.sort((x, y) => x.km - y.km)[0].legs;
            const next = new Map(); // Each route once, by its shortest way on
            for (const p of paths) for (const n of calls.get(p.i)) {
                if (n === p.at) continue;
                const l = leg(p.i, p.at, n);
                for (const j of at.get(n) || []) if (!used.has(j) && !(next.get(j)?.km <= p.km + l.km)) next.set(j, { i: j, at: n, legs: [...p.legs, l], km: p.km + l.km });
            }

            next.forEach((_, j) => used.add(j));
            paths = [...next.values()];
        }

        return null;
    }

    places() { // Station list for the trip box: "Toledo, OH" -> station
        return this.byLabel ??= new Map(search.entries().map(e => [`${e.name}${e.st ? `, ${e.st}` : ''}`, e.n]));
    }

    matches(text) { // Names starting with what's typed, then words starting with it, then the rest containing it
        const t = text.trim().toLowerCase();
        if (!t) return [];
        const rank = k => { const i = k.toLowerCase().indexOf(t); return i < 0 ? 9 : !i ? 0 : /[\s(/-]/.test(k[i - 1]) ? 1 : 2; };
        return [...this.places()].map(e => [rank(e[0]), e]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0] || a[1][0].localeCompare(b[1][0])).slice(0, 6).map(([, e]) => e);
    }

    find(text, loose) { // A station from what's typed
        const t = text.trim().toLowerCase(), list = [...this.places()];
        const hit = t && (list.find(([k]) => k.toLowerCase() === t) || list.find(([, n]) => baseName(n).toLowerCase() === t) || (loose && list.find(([k]) => k.toLowerCase().startsWith(t))));
        return hit?.[1] ?? null;
    }

    markup(name, era) { // A station's connections: how many it reaches directly, beside the heading, and the trip box
        const n = this.reach(name, era).direct.size, words = `${n} ${n === 1 ? 'station' : 'stations'}`;
        const sum = n ? `<button class="conn-go" type="button" data-once="0" title="Show them on the map" aria-label="${words} reached directly: show on the map"><b>${n}</b> ${n === 1 ? 'station' : 'stations'}<span class="conn-map" aria-hidden="true">→</span></button>` : '<span class="none">No trains from here</span>';
        return `<section class="conn-sec"><div class="conn-head"><h4 aria-level="3">Connections</h4>${sum}</div><div class="trip-find"><label class="trip-box"><span>Trip to</span><input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="trip-list" placeholder="Another station" aria-label="Plan a trip to another station" autocomplete="off"></label><ul class="trip-list" id="trip-list" role="listbox" aria-label="Stations" hidden></ul></div><div class="trip-out" aria-live="polite"></div></section>`;
    }

    show(out, from, to, era) { // The way from one station to another, and how the other era compares
        if (!to) return void (out.innerHTML = '');
        const legs = this.trip(from, to, era), other = era === 'today' ? 'buildout' : 'today', then = this.trip(from, to, other), when = e => e === 'today' ? 'today' : 'with the full buildout';
        const changes = legs => !legs.length ? 'Same station' : legs.length === 1 ? 'No transfer needed' : plural(legs.length - 1, 'transfer');
        const miles = legs => Math.round(legs.reduce((t, l) => t + l.km, 0) * .621 / 5) * 5;
        this.last = legs?.length ? { from, to, era, legs } : null; // What the button below shows on the map
        const body = !legs ? `<p class="none">No way to reach ${esc(place(to))} by train ${when(era)}.</p>`
            : `<p class="trip-sum"><b>${changes(legs)}</b>${legs.length ? ` · about ${miles(legs).toLocaleString('en-US')} mi` : ''}</p>` + (legs.length ? '<button class="trip-go" type="button"><ol class="trip-steps">' +
            legs.map((l, k) => { const r = view.routes[l.i]; return `<li style="--c:${r.color}"><span class="swatch"></span><span><b>To ${esc(baseName(l.to))}</b><small>${esc(r.label)} · ${k ? `from ${esc(baseName(l.from))} · ` : ''}${plural(l.stops, 'stop')}</small></span></li>`; }).join('') +
            '</ol><span class="trip-go-map">Show on the map <span aria-hidden="true">→</span></span></button>' : '');
        const diff = then && (!legs || then.length !== legs.length) ? `<p class="trip-then">${when(other)[0].toUpperCase() + when(other).slice(1)}: ${changes(then).toLowerCase()}</p>` : !then && legs ? `<p class="trip-then">${when(other)[0].toUpperCase() + when(other).slice(1)}: no way there</p>` : '';
        out.innerHTML = body + diff;
    }
}