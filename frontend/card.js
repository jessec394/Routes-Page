// Route/city card
class InfoCard {
    embedCode(r) { // Code for another site's page: this route's map, alone
        const q = new URLSearchParams({ r: slug(r.label) }), state = new URLSearchParams(location.search).get('state');
        if (state) q.set('state', state);
        return `<iframe src="${location.origin}${location.pathname.replace(/[^/]*$/, '')}?${q}&embed" title="${esc(r.label)} · All Aboard Ohio" width="100%" height="560" style="border:0;border-radius:12px" loading="lazy" allowfullscreen></iframe>`;
    }

    shareURL(r) { return shareLink('r', r.label); } // Link to a route

    syncURL() { const r = view.routes[view.selected]; setParam('r', r && slug(r.label), 's'); } // Address bar follows the open route

    stopItem(n, r) { // One stop in a route card
        const others = net.uniqueGroups(net.routesAt(n).filter(j => view.routes[j].label !== r.label));
        return `<li class="size-${sizeOf(view.cities[n])}${building(n) ? ' building' : ''}" data-city="${esc(n)}"><i></i><span class="stop-name" title="${esc(baseName(n))}${building(n) ? ' (under construction)' : ''}"><span class="nm">${esc(baseName(n))}</span>${view.cities[n]?.airport ? PLANE : ''}</span>` +
            (others.length ? `<span class="links${others.length > 4 ? ' many' : ''}" title="Also served by ${esc(others.map(o => o.label).join(', '))}">${others.slice(0, others.length > 4 ? 3 : 4).map(o => `<b style="--c:${o.color}"></b>`).join('')}${others.length > 4 ? `<em>+${others.length - 3}</em>` : ''}</span>` : '') + '</li>'; // Up to four colours, or three and a count: names on hover
    }

    columns(lists, rows) { // Column per branch: the first runs straight
        const spans = lists.map((s, b) => { const own = rows.map((n, r) => s.includes(n) && !lists.slice(0, b).some(t => t.includes(n)) ? r : -1).filter(r => r >= 0); return own.length ? [own[0] - 1, own.at(-1) + 1] : null; }); // A row either side for the curves
        const taken = [];
        return lists.map((_, b) => {
            if (!b) return 0;
            let c = 1;
            while (spans[b] && taken.some(([k, lo, hi]) => k === c && lo <= spans[b][1] && hi >= spans[b][0])) c++;
            if (spans[b]) taken.push([c, ...spans[b]]);
            return c;
        });
    }

    hub(lists) { // Branches that all leave one station in different directions
        if (common(lists) !== 1) return null;
        const lat = n => +view.cities[n]?.lat || 0, home = lat(lists[0][0]), mean = s => s.slice(1).reduce((t, n) => t + lat(n), 0) / (s.length - 1);
        const up = lists.filter(s => mean(s) > home), down = lists.filter(s => mean(s) <= home);
        return up.length && down.length ? { up, down } : null;
    }

    merge(lists) { // All branches' stops in one order
        const rows = [...lists[0]];
        lists.slice(1).forEach(stops => {
            let at = -1, pending = [];
            stops.forEach(n => {
                const k = rows.indexOf(n, at + 1);
                if (k < 0) return pending.push(n);
                rows.splice(k, 0, ...pending);
                at = k + pending.length;
                pending = [];
            });

            rows.splice(pending.length < rows.length - at - 1 ? at + 1 : rows.length, 0, ...pending); // A branch's own ending
        });

        return rows;
    }

    stopList(list, r, color = r.color) { // A route's stops, its branches merged into one list
        this.split = net.split(list.map(b => b.i)); // Twin stations it calls at both of: named in full
        const lanes = [...list].sort((a, b) => b.stops.length - a.stops.length), hub = list.length > 1 && this.hub(lanes.map(b => b.stops)); // Longest branch on the left
        const rows = hub ? [...this.merge(hub.up.map(s => [...s].reverse())), ...this.merge(hub.down).slice(1)] : list.length > 1 ? this.merge(lanes.map(b => b.stops)) : list[0].stops; // Hub: northbound branches above it, the rest below
        const order = hub ? [...hub.up, ...hub.down] : lanes.map(b => b.stops), cols = hub ? [...this.columns(hub.up, rows), ...this.columns(hub.down, rows)] : this.columns(order, rows); // Each side numbers its own columns from the left
        this.branches = list.length > 1 ? { rows, cols, stops: order.map(s => new Set(s)), ends: order.map(s => [s[0], s.at(-1)].map(n => rows.indexOf(n)).sort((a, b) => a - b)) } : null;
        return `<ol tabindex="0" aria-label="Stops" class="stops${list.length > 1 ? ' branched' : ''}" style="--c:${color};--cols:${this.branches ? Math.max(...this.branches.cols) + 1 : 1}">${rows.map(n => this.stopItem(n, r)).join('')}</ol>`;
    }

    adds(list) { // A planned route's stations no train stops at today
        if (list.some(net.present)) return '';
        const fresh = new Set(list.flatMap(b => b.stops).filter(n => view.cities[n] && !runsToday(n)).map(mainOf)).size; // A stop moved to a new station counts as new
        return fresh ? `Adds ${plural(fresh, 'new station')}` : 'Every station already has trains';
    }

    routeCard(r) { // Route card HTML
        const list = net.members(r.i).map(i => view.routes[i]).filter(net.shown);
        if (!list.length) list.push(r);
        const stops = this.stopList(list, r);
        const notes = [this.adds(list), !list.every(b => b.traced || b.today) && 'Line approximated'].filter(Boolean); // Only when there's something to say
        return `<div class="card-head" style="--c:${r.color}"><span class="swatch"></span><div>` +
            `<p class="kicker">${esc(r.type)} route</p><h3>${esc(r.label)}</h3><p class="status is-${statusKind(r.status)}">${esc(statusText(r.status, r))}</p>` + (FLAGS.size ? `<p class="card-flags">${[...new Set(list.flatMap(b => b.stops).map(net.stateIdOf))].filter(Boolean).map(id => flag(id, STATE_NAMES[id] || id)).join('')}</p>` : '') + // The states it runs through

            (notes.length ? `<p class="meta">${notes.join(' · ')}</p>` : '') + `</div></div>${this.trainOf(r)}<div class="card-times" hidden></div><div class="card-riders" hidden></div><div class="card-reach" hidden></div>${relief.markup(r.i)}` +
            stops +
            `<div class="card-actions">${shareMenu('share-menu', 'act', 'Print route sheet')}` +
            '<button class="act" data-compare><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg><span>Compare</span></button></div>';
    }

    trainOf(r) { const cars = view.trains[r.label]; return cars ? trainHTML(cars, 'card-train') : ''; } // Its train, where network.json names one: pulling in from the right, the rest of it fading back

    drawBranches(ol, { rows, cols, stops, ends }) { // Branch diagram beside the stop list
        const GAP = 22, X0 = 12, items = $$('li', ol), ys = items.map(li => li.offsetTop + li.offsetHeight / 2), H = ol.scrollHeight;
        const callers = rows.map(n => stops.map((s, b) => s.has(n) ? b : -1).filter(b => b >= 0)); // Branches stopping at each row
        const left = r => Math.min(...callers[r].map(b => cols[b])); // Shared stops pull every branch that calls there into the leftmost column
        const calls = stops.map(s => rows.map((n, r) => s.has(n) ? r : -1).filter(r => r >= 0)); // Rows each branch stops at
        const at = (b, r) => { // Between two stops on a shared line it stays on it, else its own column
            if (stops[b].has(rows[r])) return X0 + GAP * left(r);
            const prev = calls[b].findLast(k => k < r), next = calls[b].find(k => k > r);
            return X0 + GAP * (prev !== undefined && next !== undefined && left(prev) === left(next) ? left(prev) : cols[b]);
        };

        const lines = stops.map((_, b) => { // Each branch down its column, easing across when it changes
            const [from, to] = ends[b];
            let d = `M${at(b, from)},${ys[from]}`;
            for (let r = from + 1; r <= to; r++) {
                const x0 = at(b, r - 1), x1 = at(b, r), y0 = ys[r - 1], y1 = ys[r], m = (y0 + y1) / 2;
                d += x0 === x1 ? `L${x1},${y1}` : `C${x0},${m} ${x1},${m} ${x1},${y1}`;
            }

            return `<path d="${d}" data-b="${b}"/>`;
        }).join('');

        const R = { L: 7.6, M: 6, S: 4.8 }, dotX = rows.map((_, r) => X0 + GAP * left(r));
        const dots = rows.map((n, r) => `<circle cx="${dotX[r]}" cy="${ys[r]}" r="${R[sizeOf(view.cities[n])]}" data-b="${callers[r].join(' ')}"/>`).join('');
        items.forEach((li, r) => { li.style.setProperty('--x', (dotX[r] - X0) / GAP); li.dataset.b = callers[r].join(' '); }); // Names step right with their branch
        ol.insertAdjacentHTML('afterbegin', `<svg class="branch-map" width="${X0 * 2 + GAP * Math.max(...cols)}" height="${H}" aria-hidden="true">${lines}${dots}</svg>`);
        const map = ol.firstChild, light = li => { // Hovering a stop: its branches stay, the rest dull
            const on = li?.dataset.b?.split(' ');
            $$('[data-b]', map).forEach(el => el.classList.toggle('dull', !!on && !el.dataset.b.split(' ').some(b => on.includes(b))));
            items.forEach(x => x.classList.toggle('dull', !!on && !x.dataset.b.split(' ').some(b => on.includes(b))));
        };

        ol.addEventListener('pointerover', e => light(e.target.closest('li')));
        ol.addEventListener('pointerleave', () => light(null));
    }

    tripCard(t) { // A trip: each ride's two ends, the stops between folded away
        const changes = t.legs.length - 1, miles = Math.round(t.legs.reduce((s, l) => s + l.km, 0) * .621 / 5) * 5;
        const legs = t.legs.map((l, k) => {
            const r = view.routes[l.i], mid = l.calls.slice(1, -1);
            return `<section class="trip-leg" style="--c:${r.color}"><button class="trip-leg-head" data-i="${r.i}"><span class="swatch"></span><span><b>To ${esc(baseName(l.to))}</b><small>${esc(r.label)}</small></span><span class="go">→</span></button>` +
                `<ol class="stops" style="--c:${r.color}">${this.stopItem(l.from, r)}${mid.length ? `<li class="more"><button type="button" aria-expanded="false">${plural(mid.length, 'stop')} between</button></li>` + mid.map(n => this.stopItem(n, r).replace('<li class="', '<li class="mid ')).join('') : ''}${this.stopItem(l.to, r)}</ol></section>` +
                (k < changes ? `<p class="trip-change">Transfer at ${esc(baseName(l.to))}</p>` : '');
        }).join('');

        this.branches = null;
        return `<div class="card-head"><span class="dot"></span><div><p class="kicker">Trip</p><h3>${esc(baseName(t.from))} to ${esc(baseName(t.to))}</h3>` +
            `<p class="meta">${changes ? plural(changes, 'transfer') : 'No transfer needed'} · about ${miles.toLocaleString('en-US')} mi</p></div></div><div class="trip-plan">${legs}</div>`;
    }

    connCard(c) { // Everywhere a station reaches: no change, or up to one
        const { direct, once } = trips.reach(c.from, c.era), rides = net.uniqueGroups(trips.network(c.from, c.era, c.once).routes), here = new Set(trips.network(c.from, c.era, false).routes.map(i => view.routes[i].label));
        this.branches = null;
        return `<div class="card-head"><span class="dot"></span><div><p class="kicker">Connections</p><h3>From ${esc(baseName(c.from))}</h3><p class="meta">${c.era === 'today' ? 'Present day' : 'Full buildout'} · ${plural(rides.length, 'route')}</p></div></div>` +
            segmented('conn-pick', 'Stations shown', 'once', [[0, `No transfer <b>${direct.size.toLocaleString('en-US')}</b>`], [1, `One transfer <b>${(direct.size + once.size).toLocaleString('en-US')}</b>`]], +c.once) +
            `<ul class="route-links">${rides.filter(r => here.has(r.label)).map(r => routeItem(r)).join('')}${c.once ? `<li class="route-links-head">Then transfer to</li>${rides.filter(r => !here.has(r.label)).map(r => routeItem(r)).join('')}` : ''}</ul>`; // Routes from here first
    }

    cityCard(name) { // City card HTML
        const list = net.uniqueGroups(net.routesAt(name));
        return `<div class="card-head"><span class="dot"></span><div><p class="kicker">Station city</p><h3>${esc(place(name))}</h3>` +
            `<p class="meta">${plural(list.length, 'route')}</p></div></div><ul class="route-links">${list.map(r => routeItem(r)).join('')}</ul>`;
    }

    show() { // Show/refresh the card
        const key = view.conn ? `n${view.conn.from}:${view.conn.era}:${view.conn.once}:${view.types}` : view.trip ? `t${view.trip.from}>${view.trip.to}:${view.trip.legs.map(l => l.i)}` : view.selected !== null ? `r${view.routes[view.selected].label}:${view.types}:${view.era}:${view.focus}` : view.city ? `c${view.city}:${view.types}:${view.era}` : '';
        if (ui.card.hidden !== !key) { ui.card.hidden = !key; ui.card.parentNode.classList.toggle('carded', !!key); } // Only touch the DOM on a change
        this.syncURL();
        if (!key || ui.card.dataset.key === key) return;
        ui.card.dataset.key = key;
        ui.body.innerHTML = view.conn ? this.connCard(view.conn) : view.trip ? this.tripCard(view.trip) : view.selected !== null ? this.routeCard(view.routes[view.selected]) : this.cityCard(view.city);
        if (view.selected !== null) { const fig = $('.relief', ui.body), i = view.selected; requestAnimationFrame(() => fig?.isConnected && relief.fill(fig, i)); } // Next frame: measuring it now would lay the page out an extra time
        if (view.conn) choose($('.conn-pick', ui.body), 'once', String(+view.conn.once)); // Its pill under the picked choice
        if (this.branches && view.selected !== null) this.drawBranches($('.stops', ui.body), this.branches);
        if (view.selected !== null) times.forRoute($('.card-times', ui.body), view.routes[view.selected], view.era);
        if (view.selected !== null) ridership.forRoute($('.card-riders', ui.body), view.routes[view.selected], view.era);
        if (view.selected !== null) reach.forRoute($('.card-reach', ui.body), net.members(view.selected).map(i => view.routes[i]).filter(net.shown)); // Who its stops in the featured state reach
        if (!still) ui.card.animate([{ opacity: 0, translate: '0 .75rem' }, { opacity: 1, translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }

    bind() {
        ui.card.addEventListener('click', e => {
            if (e.target.closest('.close')) return map.reset();
            const act = e.target.closest('[data-share="link"], [data-share="embed"]'), stop = e.target.closest('.stops li[data-city]'), b = e.target.closest('.route-links button');
            if (e.target.closest('.act[data-compare]') && view.selected !== null) return compare.open(view.selected);
            if (e.target.closest('[data-share="print"]') && view.selected !== null) { menu.shut(); return compare.print(view.selected); }
            const pick = e.target.closest('.conn-pick button');
            if (pick && view.conn) return pick.getAttribute('aria-checked') !== 'true' && map.showConn({ ...view.conn, once: pick.dataset.once === '1' }, view.backTo?.station);
            const more = e.target.closest('.stops li.more button');
            if (more) { more.setAttribute('aria-expanded', !!more.closest('ol').classList.toggle('open')); return; }
            const leg = e.target.closest('.trip-leg-head');
            if (leg) return sidebar.pick(+leg.dataset.i, true);
            if (act && view.selected !== null) {
                const r = view.routes[view.selected], embed = act.dataset.share === 'embed';
                copyFrom(act, embed ? this.embedCode(r) : this.shareURL(r), embed ? 'Code copied' : 'Link copied');
            } else if (stop) stationModal.open(stop.dataset.city);
            else if (b) map.selectRoute(+b.dataset.i);
        });

        ui.card.addEventListener('pointerover', e => {
            const li = e.target.closest('.stops li'), b = e.target.closest('.route-links button');
            view.pinList?.forEach(p => p.classList.toggle('ping', !!li && p.dataset.city === li.dataset.city));
            if (b) map.hoverRoute(+b.dataset.i);
        });

        ui.card.addEventListener('pointerleave', () => { $$('.ping', ui.pins).forEach(p => p.classList.remove('ping')); map.hoverRoute(null); });
    }
}