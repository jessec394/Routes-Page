// Two routes side by side
class Compare extends Modal {
    picks = [null, null]; // Route version keys shown, left and right
    show = { people: true, route: true }; // Population relief and the routes over it
    ratio = 1.6; // The maps' width over height: taller on phones, as the page lays them out
    static THEME = ['var(--cmp-blue)', 'var(--red)']; // Left blue, right red, whatever the routes' own colours
    constructor() { super(Object.assign(document.createElement('div'), { className: 'compare', hidden: true }), '#compare-title'); this.kit(); } // Built when first opened, the printed page's pictures loaded now

    versions() { // Every route as it runs today, and as planned where that differs
        if (this.list?.types === view.types) return this.list;
        const out = new Map(), of = (label, era) => view.routes.filter(o => o.label === label && (era === 'today' ? net.present(o) : net.buildout(o) && net.proposed(o)));
        for (const r of view.routes) for (const era of ['today', 'buildout']) {
            const key = `${r.label}|${era}`, members = of(r.label, era);
            if (out.has(key) || !members.length) continue;
            if (era === 'buildout' && out.get(`${r.label}|today`)?.members.join() === members.join()) continue; // Planned just as it runs
            out.set(key, { key, label: r.label, era, members, r: members[0] });
        }

        this.list = [...out.values()].sort((a, b) => a.label.localeCompare(b.label) || (a.era === 'today' ? -1 : 1));
        this.list.types = view.types;
        return this.list;
    }

    stats(v) { // What the table shows for a route version
        return v.stats ??= (() => {
            const runs = v.members.flatMap(r => r.runs), stops = [...new Set(v.members.flatMap(r => r.stops.map(mainOf)))].filter(n => view.cities[n]);
            const cell = .6, seen = new Set(); // Track length: shared stretches of branches counted once
            let km = 0;
            for (const run of runs) {
                const mine = [];
                resample(run, 1).forEach((p, k, all) => {
                    const gx = Math.floor(p[0] / cell), gy = Math.floor(p[1] / cell);
                    let dup = false;
                    for (let i = -1; i <= 1 && !dup; i++) for (let j = -1; j <= 1 && !dup; j++) dup = seen.has((gx + i) * 65536 + gy + j); // On an earlier branch
                    if (k && !dup) km += dist(all[k - 1], p);
                    mine.push(gx * 65536 + gy);
                });

                mine.forEach(c => seen.add(c));
            }

            const big = stops.filter(n => sizeOf(view.cities[n]) === 'L').map(n => place(n));
            km *= KM;
            return { km, miles: Math.round(km * .621), stops, big, states: [...new Set(stops.map(n => net.stateIdOf(n)).filter(Boolean))] };
        })();
    }

    people(v) { // Promise of the people within 10 miles of its stations, counted once
        this.tracts ??= getJSON('data/people.json').then(d => {
            const grid = new Map(), t = d.tracts;
            for (let k = 0; k < t.length; k += 3) bucket(grid, `${Math.floor(t[k] / 2500)},${Math.floor(t[k + 1] / 2500)}`).push(k); // Quarter-degree cells
            return { ...d, grid };
        }).catch(() => null);
        return this.tracts.then(d => {
            if (!d) return null;
            const s = this.stats(v), missing = s.states.filter(id => !d.states.includes(id)), got = new Set();
            if (missing.length === s.states.length) return { missing };
            for (const n of s.stops) {
                const c = view.cities[n], at = [+c.lon, +c.lat], gx = Math.floor(at[0] * 4), gy = Math.floor(at[1] * 4);
                for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of d.grid.get(`${gx + i},${gy + j}`) || []) if (!got.has(k) && reach.miles(at, [d.tracts[k] / 1e4, d.tracts[k + 1] / 1e4]) <= d.miles) got.add(k);
            }

            return { n: [...got].reduce((t, k) => t + d.tracts[k + 2], 0), missing };
        });
    }

    suggest(v) { // A route to set beside it
        const want = this.stats(v).km, pool = this.versions().filter(o => o.label !== v.label && (v.era === 'buildout' ? o.era === 'today' : o.era === 'buildout') && o.r.typeKey === v.r.typeKey);
        return (pool.length ? pool : this.versions().filter(o => o.label !== v.label)).sort((a, b) => Math.abs(this.stats(a).km - want) - Math.abs(this.stats(b).km - want))[0];
    }

    open(i) { // From a route card: that route, and a suggestion beside it
        const label = view.routes[i].label, list = this.versions(), mine = list.find(o => o.label === label && o.era === view.era) || list.find(o => o.label === label);
        if (mine) this.show2([mine.key, this.suggest(mine)?.key]);
    }

    planned(v) { return v.era === 'buildout' && this.versions().some(o => o.label === v.label && o.era === 'today'); } // A buildout version of a route running today
    linkKey(v) { return slug(v.label) + (this.planned(v) ? '-planned' : ''); } // "lincoln-service-planned": marked only where it also runs today

    openLink(text) { // From a shared link: ?c=one,other
        const list = this.versions(), keys = (text === START_COMPARE && params.has('swap') ? text.split(',').reverse() : text.split(',')).map(k => { const want = k.replace('~', '-'), plan = list.find(o => o.era === 'buildout' && `${slug(o.label)}-planned` === want); return plan?.key || list.find(o => slug(o.label) === want || `${slug(o.label)}-planned` === want)?.key; }); // Older links: "~planned"
        if (keys.every(Boolean) && keys.length === 2) this.show2(keys);
    }

    show2(keys) { // The window, with these two
        this.build();
        this.picks = keys;
        this.reveal();
        this.render();
    }

    embedCode() { const [a, b] = this.sides(); return `<iframe src="${this.link(true)}&embed" title="${esc(a.label)} and ${esc(b.label)} · All Aboard Ohio" width="100%" height="760" style="border:0;border-radius:12px" loading="lazy"></iframe>`; } // For another site's page: this comparison alone

    close() { if (!EMBED) super.close(); } // Embedded: the comparison is the whole page
    closed() { menu.shut(); this.syncURL(false); }

    build() { // The window
        if (this.el.isConnected) return;
        const toggle = (k, label) => `<button class="cmp-switch" type="button" data-show="${k}" aria-pressed="${this.show[k]}"><i aria-hidden="true"></i>${label}</button>`;
        this.el.innerHTML = `<div class="compare-panel scroller"><div class="compare-head"><h2 id="compare-title">Compare Routes</h2><div class="cmp-tools">${toggle('people', 'Population')}${toggle('route', 'Routes')}` +
            shareMenu('cmp-share-menu', 'cmp-share', 'Print or save as PDF') + '</div><button class="close" aria-label="Close">×</button></div>' +
            '<div class="compare-sides">' + [0, 1].map(k => `<div class="compare-side" data-side="${k}" style="--c:${Compare.THEME[k]}"><p class="cmp-kind"></p><div class="cmp-pick"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>` +
                `<input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cmp-list-${k}" aria-label="${k ? 'Second' : 'First'} route: type to search" autocomplete="off" spellcheck="false">` +
                `<ul class="cmp-list" id="cmp-list-${k}" role="listbox" aria-label="Routes" hidden></ul></div><div class="compare-map"></div></div>`).join('') + '</div>' +
            '<div class="compare-rows"></div><p class="compare-note"></p>' + (EMBED ? '<a class="cmp-full" target="_blank" rel="noopener">Open on All Aboard Ohio’s map →</a>' : '') + '</div>';
        document.body.append(this.el);
        $('.compare-panel', this.el).addEventListener('scroll', e => edgeFade(e.currentTarget), { passive: true }); // Faded where there's more
        this.el.addEventListener('click', e => {
            const flip = e.target.closest('[data-show]'), act = e.target.closest('[data-share]'), what = act?.dataset.share;
            if (flip) { this.show[flip.dataset.show] = press(flip); this.layers(); }
            if (what === 'link') copyFrom(act, this.link(), 'Link copied');
            if (what === 'embed') copyFrom(act, this.embedCode(), 'Embed code copied');
            if (what === 'print') { menu.shut(); this.printPair(); }
        });

        this.picker = new Combo(this.el, '.cmp-pick input', { // Each side's route search
            find: (box, text) => this.dropdown(box, text),
            pick: (box, li) => this.pick(+box.closest('.compare-side').dataset.side, li.dataset.key),
            shut: box => { box.value = this.name(this.sides()[+box.closest('.compare-side').dataset.side]); } // The box shows the route picked
        });

        this.el.addEventListener('focusin', e => { if (e.target.matches('.cmp-pick input')) { e.target.select(); this.dropdown(e.target, ''); } });
    }

    sides() { const list = this.versions(); return this.picks.map(k => list.find(o => o.key === k) || list[0]); } // The two shown

    link(query) { // This comparison's own address: its page, whose link preview pictures both routes, or ?c= for an embed
        const keys = this.sides().map(v => this.linkKey(v)), home = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`, page = `c/${[...keys].sort().join('~')}/`;
        if (query || !this.pages?.has(page)) return `${home}?c=${keys.join(',')}`;
        return `${home}${page}${keys[0] > keys[1] ? '?swap' : ''}`; // Pages are named in key order: ?swap puts them back
    }

    checkPage() { // Its page made by preview.py, ahead of a share
        const keys = this.sides().map(v => this.linkKey(v)), page = `c/${keys.sort().join('~')}/`;
        if (EMBED || this.pages?.has(page)) return;
        fetch(page, { method: 'HEAD' }).then(r => r.ok && (this.pages ??= new Set()).add(page)).catch(() => {});
    }

    syncURL(on = true) { // The address bar follows the comparison shown
        const full = $('.cmp-full', this.el); if (full) full.href = this.link();
        setParam('c', on && this.sides().map(v => this.linkKey(v)).join(','), 'swap'); // ?swap applied: the address now gives the order
    }

    kit() { // The printed page's logo and trains, loaded ahead and moved onto each sheet: a pair prints straight from the tap, before a new picture could load
        const made = html => { const el = Object.assign(document.createElement('div'), { innerHTML: html }).firstChild; $$('img', el).forEach(img => { img.decoding = 'sync'; }); return el; };
        return this.parts ??= { logo: Object.assign(new Image(), { src: 'data/logo.png', alt: 'All Aboard Ohio' }), head: made(trainHTML(ARRIVING, 'print-train')), foot: made(trainHTML(['charger-rear', ...Array(5).fill('venture-side'), 'charger-side'], 'sheet-train')) };
    }

    paper(html) { // The page printed: the logo and a train pulling in at its head, a whole train over its foot
        const sheet = this.sheet ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'print-sheet' }));
        sheet.innerHTML = html;
        const { logo, head, foot } = this.kit();
        $('header', sheet).prepend(logo);
        $('header', sheet).append(head);
        $('footer', sheet).before(foot);
    }

    printPair() { // Both routes on one page, then the browser's print window: straight from the tap, as phones require
        const was = this.ratio;
        this.ratio = 1.3; // Paper: room for taller maps
        const sides = this.sides(), span = this.span(sides, 1.1), color = ['#4ea8f5', '#c75b59'];
        const cell = v => { const w = v?.querySelector('.cmp-bar-fill')?.style.getPropertyValue('--w'); return `<td>${esc(v?.textContent || '—')}${w ? `<i style="--w:${w}"></i>` : ''}</td>`; }; // A figure, with its bar when it has one
        const rows = $$('.cmp-row', this.el).map(row => { const v = $$('.cmp-val', row); return `<tr${has(row, 'words') ? ' class="words"' : ''}>${cell(v[0])}<th>${esc($('.cmp-label', row).textContent)}</th>${cell(v[1])}</tr>`; }).join('');
        this.paper(`<header><div><h1 class="big">Route Comparison</h1></div></header>` +
            `<div class="pair">${sides.map((v, k) => `<figure style="--c:${color[k]}"><figcaption style="font-size:${Math.min(16, 225 / (.6 * v.label.length)).toFixed(1)}pt"><small>${v.era === 'today' ? 'Existing' : 'Proposed'}</small>${esc(v.label)}</figcaption>${this.drawing(v, span, color[k])}</figure>`).join('<b class="vs" aria-hidden="true">vs</b>')}</div>` +
            `<table class="pair-rows" style="--c0:${color[0]};--c1:${color[1]}">${rows}</table><footer><span>${esc(this.link())}</span><span>Population: US Census Bureau, census tracts within 10 miles of a station</span></footer>`);
        this.ratio = was;
        this.toPaper(`${sides[0].label} and ${sides[1].label} · All Aboard Ohio`);
    }

    toPaper(name) { // The sheet to the print window, named for the saved PDF
        this.unprint?.();
        const title = document.title, back = this.unprint = () => { // Put back once the page is used again: phones signal afterprint before they print
            this.unprint = null;
            document.body.classList.remove('printing');
            document.title = title;
            ['pointerdown', 'keydown'].forEach(t => removeEventListener(t, back, true));
        };

        document.title = name;
        document.body.classList.add('printing');
        setTimeout(() => ['pointerdown', 'keydown'].forEach(t => addEventListener(t, back, true)), 500);
        window.print();
    }

    name(v) { return v.label + (this.planned(v) ? ' (planned)' : ''); } // Told apart from today's version

    dropdown(box, text) { // The route search's matches under it, running and planned apart
        const ul = Combo.list(box), side = +box.closest('.compare-side').dataset.side, list = this.versions(), t = text.trim().toLowerCase();
        const hits = list.filter(o => !t || o.label.toLowerCase().includes(t)), group = (era, title) => { const g = hits.filter(o => o.era === era); return g.length ? `<li class="cmp-group" role="presentation">${title}</li>` + g.map(o => `<li role="option" id="cmp-opt-${side}-${list.indexOf(o)}" data-key="${esc(o.key)}" aria-selected="false"${o.key === this.picks[side] ? ' class="now"' : ''}>${esc(o.label)}</li>`).join('') : ''; };
        this.picker.fill(box, group('today', 'Running today') + group('buildout', 'Planned') || '<li class="cmp-group" role="presentation">No routes match</li>');
        const first = t ? $('[role="option"]', ul) : $('.now', ul);
        if (first) this.picker.mark(box, first);
    }

    pick(side, key) { // A route chosen from a search
        this.picks[side] = key;
        const box = $(`.compare-side[data-side="${side}"] input`, this.el);
        this.picker.shut(box);
        box.blur();
        this.render();
    }

    layers() { // Population and routes shown or hidden, routes raised onto the relief while it shows
        this.el.classList.toggle('no-people', !this.show.people);
        this.el.classList.toggle('no-route', !this.show.route);
        $$('.compare-map', this.el).forEach(m => $('.cmp-route', m)?.setAttribute('transform', this.show.people && m.peak ? `translate(${m.peak} ${m.peak})` : ''));
        if (this.show.people && $$('.compare-map', this.el).some(m => !m.painted)) this.relief();
    }

    relief() { // Each side's population, drawn under its map
        const ask = this.ask, px = dpr();
        $$('.compare-map', this.el).forEach((m, k) => {
            const v = m.v, c = $('canvas', m), area = m.area, W = m.clientWidth;
            if (!v || !W || m.painted || !relief.covers(area)) return;
            m.painted = true;
            Object.assign(c, { width: Math.round(W * px), height: Math.round(W / this.ratio * px) });
            relief.paint([c], area, `compare:${v.key}:${area.map(n => n.toFixed(1))}`, v.members.flatMap(r => r.runs)).then(peak => {
                if (this.ask !== ask || peak === null) return;
                m.peak = peak;
                m.classList.add('relief-on');
                this.layers();
            });
        });
    }

    extent(v, span) { // A route's box with its city names in it, as drawn at this scale
        const u = span / 100, [x0, x1, y0, y1] = bounds(v.members.flatMap(r => r.runs).flat()), b = [x0, x1, y0, y1];
        this.stats(v).stops.filter(n => sizeOf(view.cities[n]) === 'L').forEach(n => { const p = net.cityXY(n); if (p) b.splice(0, 4, Math.min(b[0], p[0] - 1.5 * u), Math.max(b[1], p[0] + (1.8 + place(n).length * 2.15) * u), Math.min(b[2], p[1] - 2.5 * u), Math.max(b[3], p[1] + 2.2 * u)); }); // About 2.15u a letter at 3.4u bold
        return b;
    }

    span(sides, pad) { // One scale fitting every side, names and all
        const fit = span => Math.max(...sides.map(v => { const [x0, x1, y0, y1] = this.extent(v, span); return Math.max(x1 - x0, (y1 - y0) * this.ratio); })) * pad;
        return fit(fit(fit(1))); // Names grow with the scale: settled in a few steps
    }

    drawing(v, span, color = v.r.color, under = false) { // A route at a shared scale; under: state lines in a picture of their own, for beneath the population
        const runs = v.members.flatMap(r => r.runs), [x0, x1, y0, y1] = this.extent(v, span), w = span, h = span / this.ratio, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, u = span / 100;
        const box = [cx - w / 2, cy - h / 2, w, h], s = this.stats(v), pts = runs.flat(), dot = n => { const p = net.cityXY(n), big = sizeOf(view.cities[n]) === 'L'; return p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(big ? 1.3 : .8) * u}"/>` : ''; };
        const taken = [], hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3], over = r => pts.filter(p => p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]).length;
        const inside = r => r[0] >= box[0] && r[2] <= box[0] + w && r[1] >= box[1] && r[3] <= box[1] + h, big = s.stops.filter(n => sizeOf(view.cities[n]) === 'L' && net.cityXY(n));
        const names = [...big.filter(n => n === s.stops[0] || n === s.stops.at(-1)), ...big.filter(n => n !== s.stops[0] && n !== s.stops.at(-1))].map(n => { // The ends first
            const p = net.cityXY(n), tw = place(n).length * 2.15 * u, mx = Math.min(Math.max(p[0], box[0] + tw / 2 + u), box[0] + w - tw / 2 - u), sides = [ // Right, left, above, below (slid inside the edges): the one clear of the line, other names and the edges
                [p[0] + 1.8 * u, p[1] + 1.2 * u, 'start', [p[0] + 1.8 * u, p[1] - 2.2 * u, p[0] + 1.8 * u + tw, p[1] + 1.6 * u]],
                [p[0] - 1.8 * u, p[1] + 1.2 * u, 'end', [p[0] - 1.8 * u - tw, p[1] - 2.2 * u, p[0] - 1.8 * u, p[1] + 1.6 * u]],
                [mx, p[1] - 2.4 * u, 'middle', [mx - tw / 2, p[1] - 5.6 * u, mx + tw / 2, p[1] - 1.8 * u]],
                [mx, p[1] + 4.6 * u, 'middle', [mx - tw / 2, p[1] + 1.4 * u, mx + tw / 2, p[1] + 5.2 * u]]
            ].map((c, k) => ({ c, cost: (taken.some(t => hits(t, c[3])) ? 1e4 : 0) + (inside(c[3]) ? 0 : 1e3) + Math.min(over(c[3]), 90) * 10 + k })); // Ties: right, as usual
            const best = sides.reduce((a, b) => b.cost < a.cost ? b : a);
            if (best.cost >= 1e4) return ''; // Nowhere free: left out
            taken.push(best.c[3]);
            return `<text x="${best.c[0].toFixed(1)}" y="${best.c[1].toFixed(1)}" text-anchor="${best.c[2]}" font-size="${(3.4 * u).toFixed(2)}">${esc(place(n))}</text>`;
        }).join('');

        const mi = 1.609 / KM, scale = Math.pow(10, Math.floor(Math.log10(span * .25 / mi))), bar = [1, 2, 5].map(k => k * scale).filter(m => m * mi <= span * .3).at(-1) || scale; // A round number of miles
        const [bx, by] = [[4 * u, h - 5 * u], [w - 4 * u - bar * mi, h - 5 * u], [4 * u, 8 * u], [w - 4 * u - bar * mi, 8 * u]].map(([x, y]) => [box[0] + x, box[1] + y]).map(at => { // The corner the scale bar crowds least
            const r = [at[0] - 2 * u, at[1] - 6 * u, at[0] + bar * mi + 2 * u, at[1] + 2 * u];
            return { at, n: over(r) + 50 * taken.filter(t => hits(t, r)).length };
        }).reduce((a, b) => b.n < a.n ? b : a).at;
        const open = `<svg viewBox="${box.map(n => n.toFixed(1)).join(' ')}"`, states = `<g class="cmp-states">${view.allStates.map(st => `<path d="${ringsPath(st.rings)}" stroke-width="${(.25 * u).toFixed(2)}"/>`).join('')}</g>`;
        return (under ? `${open} class="cmp-under" aria-hidden="true">${states}</svg>` : '') + `${open} role="img" aria-label="Map of ${esc(v.label)}">${under ? '' : states}<g class="cmp-route">` +
            `<g class="cmp-line" style="--c:${color}" stroke-width="${(1.4 * u).toFixed(2)}">${runs.map(run => `<path class="cmp-case" d="${pathOf(run)}" stroke-width="${(2.4 * u).toFixed(2)}"/><path d="${pathOf(run)}"/>`).join('')}</g>` +
            `<g class="cmp-dots" stroke-width="${(.45 * u).toFixed(2)}">${s.stops.map(dot).join('')}</g><g class="cmp-names" stroke-width="${(.9 * u).toFixed(2)}">${names}</g></g>` +
            `<g class="cmp-bar" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)})"><path d="M0 0h${(bar * mi).toFixed(1)}" stroke-width="${(.7 * u).toFixed(2)}"/><text y="${(-1.6 * u).toFixed(1)}" font-size="${(2.8 * u).toFixed(2)}">${bar} mi</text></g></svg>`;
    }

    async print(i) { // A one-page sheet about a route, then the browser's print window
        const was = this.ratio;
        this.ratio = 1.6; // Paper: the wide shape
        const r = view.routes[i], era = net.present(r) ? 'today' : 'buildout', members = view.routes.filter(o => o.label === r.label && (era === 'today' ? net.present(o) : net.buildout(o)));
        const v = this.versions().find(o => o.label === r.label && o.era === era && o.members.join() === members.join()) || { key: `${r.label}|${era}|print`, label: r.label, era, members, r }; // Just as the card shows it
        const s = this.stats(v), [p, d] = await Promise.all([this.people(v), times.load()]), parts = this.segments(v);
        const trains = v.era === 'today' && d?.routes?.[v.label] ? Math.round(d.routes[v.label] / 2) : null, gap = s.stops.length > 1 ? Math.round(s.miles / (s.stops.length - 1)) : null;
        const facts = [['Length', `${s.miles.toLocaleString('en-US')} mi`], ['Stations', s.stops.length], gap && ['Between stations', `${gap} mi avg.`], p?.n && ['People within 10 mi', Math.round(p.n).toLocaleString('en-US')],
            trains && ['Weekly trains', `${trains} each way`], ['States', s.states.map(id => `<span>${flag(id)}${esc(STATE_NAMES[id] || id)}</span>`).join(' ')]].filter(Boolean);
        this.paper(`<header><div><p>${esc(r.type)} route</p><h1>${esc(v.label)}</h1></div></header>` +
            `<figure${s.stops.length > 40 ? ' class="shorter"' : s.stops.length > 24 ? ' class="short"' : ''}>${this.drawing(v, this.span([v], 1.08), '#c75b59')}</figure><dl>${facts.map(([k, n]) => `<div><dt>${k}</dt><dd${k === 'States' ? ' class="states"' : ''}>${k === 'States' ? n : esc(String(n))}</dd></div>`).join('')}</dl>` +
            `<h2>Stations</h2>${this.lines(v, parts)}<footer><span>${esc(card.shareURL(r))}</span><span>Population: US Census Bureau, census tracts within 10 miles of a station</span></footer>`);
        this.ratio = was;
        this.toPaper(`${v.label} · All Aboard Ohio`);
    }

    segments(v) { // The route as stretches between its ends and junctions, every branch alike
        const lists = v.members.map(r => [...new Set(r.stops.map(mainOf))].filter(n => view.cities[n])).filter(l => l.length), next = new Map();
        const apart = (a, b) => lists.some(m => { const i = m.indexOf(a), j = m.indexOf(b); return i >= 0 && j >= 0 && Math.abs(i - j) > 1; }); // Another branch stops between them: not really next to each other
        const link = (a, b) => { if (!bucket(next, a).includes(b)) bucket(next, a).push(b); };
        lists.forEach(l => l.forEach((n, k) => { if (k && !apart(l[k - 1], n)) { link(l[k - 1], n); link(n, l[k - 1]); } else bucket(next, n); }));
        const used = new Set(), mark = (a, b) => { used.add(`${a}>${b}`); used.add(`${b}>${a}`); }, out = [], ends = [...next.keys()].filter(n => next.get(n).length === 1);
        const walk = (from, to) => { // Along one stretch till the next end or junction
            const seg = [from, to];
            mark(from, to);
            for (let prev = from, at = to; next.get(at).length === 2 && at !== from;) { const nx = next.get(at).find(m => m !== prev); mark(at, nx); [prev, at] = [at, nx]; seg.push(at); }
            return seg;
        };

        const visit = start => { // Out from one end, a junction at a time: stretches meeting at a station listed together
            for (const queue = [start]; queue.length;) { const n = queue.shift(); for (const m of next.get(n)) if (!used.has(`${n}>${m}`)) { const seg = walk(n, m); out.push(seg); queue.push(seg.at(-1)); } }
        };

        visit(ends.includes(lists[0][0]) ? lists[0][0] : ends[0] ?? lists[0][0]);
        [...next.keys()].forEach(visit); // Anything not reached from there: a loop, or a route in pieces
        return { segs: out, ends: new Set(ends), junctions: new Set([...next.keys()].filter(n => next.get(n).length > 2)) };
    }

    lines(v, parts = this.segments(v)) { // Every stretch's stations, each noting where it meets the others
        const { segs, ends, junctions } = parts, and = l => l.length < 3 ? l.join(' and ') : `${l.slice(0, -1).join(', ')}, and ${l.at(-1)}`, longest = Math.max(...segs.map(g => g.length)), per = longest <= 12 ? 5 : longest <= 24 ? 6 : 8;
        if (segs.length < 2) return this.snake(segs[0] || [], per, n => ends.has(n) ? 'end' : '');
        return segs.map((g, k) => {
            const meets = [...new Set([g[0], g.at(-1)])].filter(n => junctions.has(n)).map(n => `At ${esc(place(n))}, also to ${and(segs.filter((h, j) => j !== k && (h[0] === n || h.at(-1) === n)).map(h => esc(place(h[0] === n ? h.at(-1) : h[0]))))}`); // Named by where the others go
            return `<p class="seg-head"><span>${esc(place(g[0]))} – ${esc(place(g.at(-1)))}</span>${meets.length ? `<em>${meets.join(' · ')}</em>` : ''}</p>` + this.snake(g, per, n => ends.has(n) ? 'end' : junctions.has(n) ? 'junction' : '');
        }).join('');
    }

    snake(stops, per, role) { // The stations as one line winding back and forth across the page, state lines marked where it crosses them; role: 'end' or 'junction' for its two ends
        const W = 1000, col = W / per, rowH = per > 6 ? 80 : 92, big = n => sizeOf(view.cities[n]) === 'L', kind = k => !k || k === stops.length - 1 ? role(stops[k]) : '', ends = k => !!kind(k);
        const ruler = this.ruler ??= document.createElement('canvas').getContext('2d'), PT = .527, LINE = 10.2 / PT; // Points per unit across the page, and a name's line height in units
        const tall = k => { // How tall a name wraps to, as the page will set it
            ruler.font = `${big(stops[k]) || ends(k) ? 700 : 400} 8.5pt Montserrat`;
            const room = (col - 10) * PT - 4.25, words = place(stops[k]).match(/[^\s-]+-?/g) || []; // Breaks at spaces, and after hyphens as the page does
            let rows = 1, line = '';
            for (const w of words) { const next = line ? `${line}${line.endsWith('-') ? '' : ' '}${w}` : w; if (line && ruler.measureText(next).width * .75 > room) { rows++; line = w; } else line = next; }
            return rows * LINE;
        };

        const rows = Math.ceil(stops.length / per), deep = Array.from({ length: rows }, (_, r) => Math.max(...stops.slice(r * per, r * per + per).map((n, c) => tall(r * per + c)))); // Each row's longest name
        const ys = [26];
        for (let r = 1; r < rows; r++) ys.push(ys[r - 1] + Math.max(rowH, 20 + deep[r - 1] + 26)); // Rows of long names push the next one down
        const H = ys[rows - 1] + 20 + deep[rows - 1] + 10, at = k => { const r = Math.floor(k / per), c = k % per; return [(r % 2 ? per - 1 - c : c) * col + col / 2, ys[r]]; }; // Odd rows run back right to left
        let d = '';
        stops.forEach((n, k) => {
            const [x, y] = at(k), R = (y - (k ? at(k - 1)[1] : y)) / 2;
            if (!k) d = `M${x},${y}`;
            else if (k % per) d += `L${x},${y}`;
            else d += `A${R},${R} 0 0 ${Math.floor(k / per) % 2} ${x},${y}`; // Round the end of the row, down to the next
        });

        const pct = (x, y) => `left:${(x / W * 100).toFixed(2)}%;top:${(y / H * 100).toFixed(2)}%`;
        const dots = stops.map((n, k) => { const [x, y] = at(k), r = ends(k) ? 11 : big(n) ? 9 : 6.5; return `<circle cx="${x}" cy="${y}" r="${r}"${kind(k) ? ` class="${kind(k)}"` : ''}/>`; }).join('');
        const names = stops.map((n, k) => { const [x, y] = at(k); return `<span class="stop${big(n) || ends(k) ? ' big' : ''}" style="${pct(x, y + 20)};max-width:${(col / W * 100 - 1).toFixed(2)}%">${esc(place(n))}${view.cities[n]?.airport ? PLANE : ''}</span>`; }).join('');
        const lines = stops.slice(1).map((n, k) => { // Where the line crosses into another state
            const a = net.stateIdOf(stops[k]), b = net.stateIdOf(n);
            if (!a || !b || a === b) return '';
            const [x1, y1] = at(k), [x2, y2] = at(k + 1), turn = y1 !== y2, R = (y2 - y1) / 2, low = Math.min(y1 + 2 * R - 10, y1 + 18 + (turn ? tall(k) : 0) + 14); // On a bend: below the name beside it
            const x = turn ? x1 + (x1 > W / 2 ? 1 : -1) * Math.sqrt(Math.max(0, R * R - (low - y1 - R) ** 2)) : (x1 + x2) / 2, y = turn ? low : y1;
            const [l, r] = !turn && x2 < x1 ? [b, a] : [a, b]; // Each state on its own side of the line
            return `<span class="cross" style="${pct(x, y)}">${l}<i></i>${r}</span>`; // On the line itself
        }).join('');

        return `<div class="snake" style="aspect-ratio:${W}/${H.toFixed(0)}"><svg viewBox="0 0 ${W} ${H.toFixed(0)}" aria-hidden="true"><path d="${d}"/>${dots}</svg>${names}${lines}</div>`;
    }

    render() { // Both sides and the table between them
        const list = this.versions(), sides = this.picks.map(k => list.find(o => o.key === k) || list[0]), stats = sides.map(v => this.stats(v)), ask = this.ask = {};
        this.ratio = matchMedia('(max-width: 600px)').matches ? 1.15 : 1.6;
        const span = this.span(sides, 1.1); // Both drawn to one scale
        this.syncURL();
        this.checkPage();
        $$('.compare-side', this.el).forEach((el, k) => {
            const v = sides[k], m = $('.compare-map', el);
            this.picks[k] = v.key;
            $('input', el).value = this.name(v);
            const [under, top] = this.drawing(v, span, Compare.THEME[k], true).split(/(?=<svg viewBox)/).filter(Boolean);
            $('.cmp-kind', el).textContent = v.era === 'today' ? 'Existing' : 'Proposed';
            m.innerHTML = `<div class="cmp-frame">${under}<canvas role="img" aria-label="Population density along ${esc(v.label)}"></canvas>${top}</div>` +
                `<p class="cmp-status"><span class="cmp-flags">${this.stats(v).states.map(id => flag(id, STATE_NAMES[id] || id)).join('')}</span>${esc(v.r.type)} · <b class="is-${statusKind(v.r.status)}">${esc(v.era === 'today' ? 'Running today' : statusText(v.r.status, v.r))}</b></p>`;
            const [x, y, w, h] = $('svg:not(.cmp-under)', m).getAttribute('viewBox').split(' ').map(Number);
            Object.assign(m, { v, area: [x, y, x + w, y + h], painted: false, peak: 0 });
            m.classList.remove('relief-on');
        });

        this.layers();

        const num = (label, vals, fmt = n => n.toLocaleString('en-US')) => { // A row with bars
            const top = Math.max(...vals.filter(n => n != null), 1);
            return `<div class="cmp-row"><span class="cmp-label">${label}</span><span class="cmp-label" aria-hidden="true">${label}</span>` + vals.map((n, k) => `<span class="cmp-val" data-side="${k}">${n == null ? '<i>—</i>' : fmt(n)}<i class="cmp-bar-fill" style="--w:${n == null ? 0 : n / top}"></i></span>`).join('') + '</div>';
        };

        const words = (label, vals) => `<div class="cmp-row words"><span class="cmp-label">${label}</span><span class="cmp-label" aria-hidden="true">${label}</span>` + vals.map((t, k) => `<span class="cmp-val" data-side="${k}">${t || '<i>—</i>'}</span>`).join('') + '</div>';
        const rows = $('.compare-rows', this.el), gap = s => s.stops.length > 1 ? Math.round(s.miles / (s.stops.length - 1)) : null;
        rows.innerHTML = '<div class="cmp-trains"></div><div class="cmp-riders"></div>' + num('Length', stats.map(s => s.miles), n => `${n.toLocaleString('en-US')} mi`) + num('Stations', stats.map(s => s.stops.length)) + num('Distance between stations', stats.map(gap), n => `${n} mi`) +
            '<div class="cmp-people"></div>' + words('Major cities', stats.map(s => esc(s.big.join(', '))));
        $('.compare-note', this.el).textContent = 'Maps drawn to the same scale. Population data from US Census tracts within 10 miles of a station (each person counted once).';
        fadeEdges(this.el);
        Promise.all(sides.map(v => this.people(v))).then(p => {
            if (this.ask !== ask) return;
            const vals = p.map(x => x?.n ?? null), missing = [...new Set(p.flatMap(x => x?.missing || []))];
            $('.cmp-people', rows).outerHTML = vals.some(n => n != null) ? num('People within 10 miles of a station', vals, n => n >= 1e6 ? `${(n / 1e6).toFixed(2)} million` : Math.round(n).toLocaleString('en-US')) : '';
            if (missing.length) $('.compare-note', this.el).textContent += ` No population data yet for ${missing.map(id => STATE_NAMES[id] || id).join(', ')}.`;
            fadeEdges(this.el);
        });

        times.load().then(d => {
            if (this.ask !== ask) return;
            const vals = sides.map(v => v.era === 'today' && d?.routes?.[v.label] ? Math.round(d.routes[v.label] / 2) : null);
            $('.cmp-trains', rows).outerHTML = vals.some(n => n != null) ? num('Weekly trains each way', vals) : '';
            fadeEdges(this.el);
        });

        ridership.forCompare(sides).then(r => { // Only figures for each route alone
            if (this.ask !== ask) return;
            $('.cmp-riders', rows).outerHTML = r.vals.some(n => n != null) ? num(`Riders a year (${r.year})`, r.vals) : '';
            if (r.note) $('.compare-note', this.el).textContent += r.note;
            fadeEdges(this.el);
        });
    }
}