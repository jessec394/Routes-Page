// Route/city card
class InfoCard {
    query(route) { const q = new URLSearchParams(location.search); route ? q.set('route', route) : q.delete('route'); return q.size ? `?${q}` : ''; } // Address query with the route set or cleared (keeps ?state=)
    shareURL(r) { return `${location.origin}${location.pathname}${this.query(slug(r.label))}`; } // Link to a route

    async copyText(text) { // Copy to clipboard (with fallback)
        try { await navigator.clipboard.writeText(text); return true; } catch { }
        const t = Object.assign(document.createElement('textarea'), { value: text }); // Non-secure fallback
        document.body.append(t);
        t.select();
        const ok = document.execCommand('copy');
        t.remove();
        return ok;
    }

    syncURL() { // Address bar follows the open route
        const r = view.selected !== null ? view.routes[view.selected] : null, want = this.query(r && slug(r.label));
        if (location.search !== want) history.replaceState(null, '', location.pathname + want + location.hash);
    }

    stopItem(n, r) { // One stop in a route card
        const others = net.uniqueGroups(net.routesAt(n).filter(j => view.routes[j].label !== r.label));
        return `<li class="size-${sizeOf(view.cities[n])}" data-city="${esc(n)}"><i></i><span class="stop-name">${nameHTML(n)}</span>` +
            (others.length ? `<span class="links${others.length > 4 ? ' many' : ''}" title="Also served by ${esc(others.map(o => o.label).join(', '))}">${others.slice(0, others.length > 4 ? 3 : 4).map(o => `<b style="--c:${o.color}"></b>`).join('')}${others.length > 4 ? `<em>+${others.length - 3}</em>` : ''}</span>` : '') + '</li>'; // Up to four colours, or three and a count: names on hover
    }

    columns(lists, rows) { // Column per branch: the first runs straight; the rest reuse any column free while they're on their own
        const spans = lists.map((s, b) => { const own = rows.map((n, r) => s.includes(n) && !lists.slice(0, b).some(t => t.includes(n)) ? r : -1).filter(r => r >= 0); return own.length ? [own[0] - 1, own.at(-1) + 1] : null; }); // (A row either side for the curves)
        const taken = [];
        return lists.map((_, b) => {
            if (!b) return 0;
            let c = 1;
            while (spans[b] && taken.some(([k, lo, hi]) => k === c && lo <= spans[b][1] && hi >= spans[b][0])) c++;
            if (spans[b]) taken.push([c, ...spans[b]]);
            return c;
        });
    }

    hub(lists) { // Branches that all leave one station in different directions: { up: northbound, down: the rest }, or null
        if (common(lists) !== 1) return null;
        const lat = n => +view.cities[n]?.lat || 0, home = lat(lists[0][0]), mean = s => s.slice(1).reduce((t, n) => t + lat(n), 0) / (s.length - 1);
        const up = lists.filter(s => mean(s) > home), down = lists.filter(s => mean(s) <= home);
        return up.length && down.length ? { up, down } : null;
    }

    merge(lists) { // All branches' stops in one order; a branch's own stops go just before it rejoins
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
            rows.splice(pending.length < rows.length - at - 1 ? at + 1 : rows.length, 0, ...pending); // A branch's own ending: the shorter one first, so the other runs on past it briefly
        });
        return rows;
    }

    routeCard(r) { // Route card HTML
        const list = net.members(r.i).map(i => view.routes[i]).filter(net.shown);
        if (!list.length) list.push(r);
        const trunk = common(list.map(b => b.stops)), split = list.length > 1 && trunk ? list[0].stops[trunk - 1] : null;
        const lanes = [...list].sort((a, b) => b.stops.length - a.stops.length), hub = list.length > 1 && this.hub(lanes.map(b => b.stops)); // Longest branch on the left
        const rows = hub ? [...this.merge(hub.up.map(s => [...s].reverse())), ...this.merge(hub.down).slice(1)] : list.length > 1 ? this.merge(lanes.map(b => b.stops)) : list[0].stops; // Hub: northbound branches above it (read upwards), the rest below
        const order = hub ? [...hub.up, ...hub.down] : lanes.map(b => b.stops), cols = hub ? [...this.columns(hub.up, rows), ...this.columns(hub.down, rows)] : this.columns(order, rows); // Each side numbers its own columns from the left
        this.branches = list.length > 1 ? { rows, cols, stops: order.map(s => new Set(s)), ends: order.map(s => [s[0], s.at(-1)].map(n => rows.indexOf(n)).sort((a, b) => a - b)) } : null; // Drawn once the list is on the page
        const notes = [split && `Splits at ${esc(place(split))}`, !list.every(b => b.traced) && 'Line approximated'].filter(Boolean); // Only when there's something to say
        return `<div class="card-head" style="--c:${r.color}"><span class="swatch"></span><div>` +
            `<p class="kicker">${esc(r.type)} route</p><h3>${esc(r.label)}</h3><p class="status is-${statusKind(r.status)}">${esc(statusText(r.status))}</p>` +
            (notes.length ? `<p class="meta">${notes.join(' · ')}</p>` : '') + `</div></div>${relief.markup(r.i)}` +
            `<ol class="stops${list.length > 1 ? ' branched' : ''}" style="--c:${r.color};--cols:${this.branches ? Math.max(...this.branches.cols) + 1 : 1}">${rows.map(n => this.stopItem(n, r)).join('')}</ol>` +
            '<div class="card-actions"><button class="act" data-copy="link"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span>Share link</span></button></div>';
    }

    drawBranches(ol, { rows, cols, stops, ends }) { // Branch diagram beside the stop list: a column per branch (cols), joining where they share stops
        const GAP = 22, X0 = 12, items = $$('li', ol), ys = items.map(li => li.offsetTop + li.offsetHeight / 2), H = ol.scrollHeight;
        const callers = rows.map(n => stops.map((s, b) => s.has(n) ? b : -1).filter(b => b >= 0)); // Branches stopping at each row
        const left = r => Math.min(...callers[r].map(b => cols[b])); // Shared stops pull every branch that calls there into the leftmost column
        const calls = stops.map(s => rows.map((n, r) => s.has(n) ? r : -1).filter(r => r >= 0)); // Rows each branch stops at
        const at = (b, r) => { // Between two stops on a shared line it stays on it (past another branch's own stops), else its own column
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

    cityCard(name) { // City card HTML
        const list = net.uniqueGroups(net.routesAt(name));
        return `<div class="card-head"><span class="dot"></span><div><p class="kicker">Station city</p><h3>${esc(place(name))}</h3>` +
            `<p class="meta">${plural(list.length, 'route')}</p></div></div><ul class="route-links">${list.map(r => routeItem(r)).join('')}</ul>`;
    }

    show() { // Show/refresh the card
        const key = view.selected !== null ? `r${view.routes[view.selected].label}:${view.types}:${view.era}` : view.city ? `c${view.city}:${view.types}:${view.era}` : '';
        if (ui.card.hidden !== !key) { ui.card.hidden = !key; ui.card.parentNode.classList.toggle('carded', !!key); } // Only touch the DOM on a change
        this.syncURL();
        if (!key || ui.card.dataset.key === key) return;
        ui.card.dataset.key = key;
        ui.body.innerHTML = view.selected !== null ? this.routeCard(view.routes[view.selected]) : this.cityCard(view.city);
        if (view.selected !== null) { const fig = $('.relief', ui.body), i = view.selected; requestAnimationFrame(() => fig.isConnected && relief.fill(fig, i)); } // Next frame: measuring it now would lay the page out an extra time
        if (this.branches) this.drawBranches($('.stops', ui.body), this.branches);
        if (!still) ui.card.animate([{ opacity: 0, translate: '0 .75rem' }, { opacity: 1, translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }

    bind() {
        ui.card.addEventListener('click', e => {
            if (e.target.closest('.close')) return map.reset();
            const act = e.target.closest('.act[data-copy]'), stop = e.target.closest('.stops li[data-city]'), b = e.target.closest('.route-links button');
            if (act && view.selected !== null) {
                const label = $('span', act);
                this.copyText(this.shareURL(view.routes[view.selected])).then(ok => {
                    label.textContent = ok ? 'Link copied' : 'Copy failed';
                    later(1.8, () => { label.textContent = 'Share link'; });
                });
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
