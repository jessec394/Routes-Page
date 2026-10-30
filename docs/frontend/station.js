// Station window
class StationModal {
    static R = 170; // Minimap half-height (map units)
    el = $('.station');
    vids = $$('.station-hero video'); // Its two videos
    eraSwitch = $('.station-era', this.el); // Present Day / Full Buildout, for the minimap
    viewSwitch = $('.station-view', this.el); // Video or map (stations with clips)
    files = []; i = 0; cur = 0; swapping = false; opener = null; // Clip player state
    shut = new Set(); // Service sections folded away (kept from station to station)
    name = null; era = 'today'; // Station shown, and the minimap's era (starts as the main map's)
    isOpen() { return !this.el.hidden; }

    clipsFor(name) { // Folder clips/<Station> (<ST>)/ (or the city's "clips" folder)
        return bg.clips.filter(f => f.includes('/') && clipCity(folderOf(f)) === name);
    }

    mine(name) { return view.routes.filter(r => net.inEra(this.era, r) && twinsOf(name).some(n => view.served[n]?.includes(r.i))); } // Routes through a station in the minimap's era

    locator(name) { // Minimap for stations without clips: relief (with the routes on it) or plain lines, states, station
        const mine = this.mine(name), others = view.routes.filter(r => net.inEra(this.era, r) && !mine.includes(r)), density = relief.covers(this.around(name));
        const runs = (r, attrs) => r.runs.map(run => `<path ${attrs} d="${pathOf(run)}"/>`).join(''); // A route as SVG paths
        const [cx, cy] = net.cityXY(name).map(v => v.toFixed(1)), sheet = '<svg preserveAspectRatio="none">', layer = density ? '<canvas class="station-relief far" aria-hidden="true"></canvas><canvas class="station-relief" aria-hidden="true"></canvas>' : ''; // Far: the whole zoom-out range, coarse; then the sharp view
        return layer + sheet + // Relief, then borders and other lines, then the routes on top, then the station
            view.allStates.map(st => `<path class="st${st.id.toUpperCase() === view.focus ? ' oh' : ''}" d="${ringsPath(st.rings)}"/>`).join('') +
            others.map(r => runs(r, 'class="bgline"')).join('') +
            mine.map(r => runs(r, `class="line" style="--c:${r.color}"`)).join('') + // Hidden once the relief (which draws its own) is up
            `</svg>${layer}${sheet}<g class="here-mark${building(name, this.era) ? ' building' : ''}"><g><circle cx="${cx}" cy="${cy}" r="7" class="here"/><circle class="ring" cx="${cx}" cy="${cy}" r="11"/>` +
            `<text x="${+cx + 11}" y="${cy}" text-anchor="start" class="here">${esc(place(name))}</text></g></g></svg>` +
            (density ? credit() : '');
    }

    around(name) { // Starting view: the station centred, filling the minimap
        const box = $('.station-locator', this.el), W = box.clientWidth || 3.2, H = box.clientHeight || 2, [cx, cy] = net.cityXY(name);
        const s = Math.max(W / (StationModal.R * 3.2), H / (StationModal.R * 2)), w = W / s / 2, h = H / s / 2;
        return [cx - w, cy - h, cx + w, cy + h];
    }

    place() { // Show the minimap's current view: borders and lines exactly, the relief stretched until its redraw
        const M = this.map, [x0, y0, x1, y1] = M.view, [cx, cy] = net.cityXY(this.name), k = (x1 - x0) / (M.home[2] - M.home[0]);
        $$('svg', M.box).forEach(s => s.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`));
        $('.here-mark > g', M.box)?.setAttribute('transform', `translate(${cx} ${cy}) scale(${k.toFixed(4)}) translate(${-cx} ${-cy})`); // Station marker keeps its size on screen
        [M.far, M.near].forEach(L => L?.drawn && L.canvases.forEach(c => stretch(c, L.drawn, M.view)));
        const near = M.near?.drawn, covered = !!near && near[0] <= x0 && near[1] <= y0 && near[2] >= x1 && near[3] >= y1;
        M.far?.canvases.forEach(c => c.classList.toggle('spare', covered)); // The coarse layer only shows while the sharp one doesn't reach the edges
    }

    repaint(L = this.map.near) { // Redraw the near (sharp) or far (whole zoom range) layer; latest view wins
        const M = this.map, name = this.name;
        if (!L) return;
        if (L.busy) { L.again = true; return; }
        const area = L === M.near ? relief.around(M.view, Relief.MARGIN) : M.reach;
        L.busy = true;
        relief.paint(L.canvases, area, `station:${name}:${this.era}`, this.mine(name).flatMap(r => r.runs), !L.drawn && L === M.near).then(peak => { // The first sharp picture waits for its states; the rest draw what's loaded
            if (this.map !== M) return;
            L.busy = false;
            if (peak !== null) {
                L.drawn = area;
                L.canvases.forEach(c => c.classList.add('on'));
                if (L === M.near) $('.here-mark', M.box)?.setAttribute('transform', `translate(${peak} ${peak})`); // Station sits on the raised route
                this.place();
                if (L === M.near && !M.far.drawn && !M.far.busy) this.repaint(M.far); // Then the coarse layer, so zooming out never shows blank map
            }

            if (L.again) { L.again = false; this.repaint(L); }
        });
    }

    move(...v) { // Drag or zoom the minimap, redrawing as it goes
        const M = this.map;
        M.view = held(M.view, M.world, ...v);
        this.place();
        this.repaint();
    }

    showMap(era) { // Draw the minimap for an era (keeps the view, and the old picture until the new one is ready)
        const box = $('.station-locator', this.el), next = document.createElement('div');
        this.era = era;
        controls.showEra(era, this.eraSwitch);
        next.innerHTML = this.locator(this.name);
        const old = $$('svg', box), mark = old[1]?.querySelector('.here-mark')?.getAttribute('transform'); // Station keeps its place meanwhile
        if (!this.map) { // First time: fit and size the canvases
            box.replaceChildren(...next.childNodes);
            const home = this.around(this.name), all = view.allStates.map(s => s.box), [x0, y0, x1, y1] = home, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = (x1 - x0) * 3, h = (y1 - y0) * 3;
            const layer = (canvases, k) => { canvases.forEach(c => { c.width = Math.round(box.clientWidth * k); c.height = Math.round(box.clientHeight * k); }); return canvases.length ? { canvases } : null; };
            this.map = { box, home, near: layer($$('canvas:not(.far)', box), dpr() * (1 + 2 * Relief.MARGIN)), far: layer($$('canvas.far', box), dpr()), reach: [cx - w, cy - h, cx + w, cy + h], view: home.slice(), world: [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[2])), Math.max(...all.map(b => b[1])), Math.max(...all.map(b => b[3]))] };
        } else {
            $$('svg', next).forEach((s, n) => old[n].replaceWith(s));
            if (mark) $('.here-mark', box).setAttribute('transform', mark);
        }

        this.place();
        this.repaint();
        if (this.map.far?.drawn) this.repaint(this.map.far); // New era: the far layer's routes too
    }

    stateInset(name) { // State outline with the focused station's dot
        const st = view.allStates.find(s => s.id.toUpperCase() === net.stateIdOf(name)), p = net.cityXY(name);
        if (!st || !p) return '';
        const [x0, x1, y0, y1] = st.box, span = Math.max(x1 - x0, y1 - y0), pad = span * .06;
        return `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" aria-hidden="true">` +
            `<path d="${ringsPath(st.rings)}"/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(span * .045).toFixed(1)}"/></svg>`;
    }

    stationInfo(name) { // Name, state, the routes of the view shown, today's times
        const c = view.cities[name], served = [...new Set(twinsOf(name).flatMap(n => view.served[n] || []))], state = net.stateOf(name);
        const routeList = (ids, passing) => `<ul class="station-routes scroller">${net.uniqueGroups(ids).map(r => routeItem(r, `${esc(r.type)} · ${passing ? '<b class="is-passing">Passes through, no stop yet</b>' : `<b class="is-${statusKind(r.status)}">${esc(statusText(r.status, r))}</b>`}`)).join('')}</ul>`; // (passing: today's trains at a station still being built; a long list scrolls in place, so what's under it stays in sight)
        const today = served.filter(i => net.present(view.routes[i])), future = served.filter(i => net.buildout(view.routes[i]));
        return `<h2 id="station-name"><span>${nameHTML(name)}</span>${state ? `<small>${esc(state)}</small>` : ''}</h2>` + (building(name, this.era) ? `<p class="building-note">${BUILDING}</p>` : '') + '<p class="station-reach" hidden></p>' +
            (c.description ? `<p class="about">${esc(c.description)}</p>` : '') +
            (this.era === 'today' // One list: the routes of the view it's in (the minimap's era); today's times under it, in either
                ? foldSection('Present-Day Service', unbuilt(name) ? `<p class="none building-line">${today.length ? `Trains pass through ${esc(place(name))} without stopping. Soon, they will serve a new station being built here.` : `A new station is being built in ${esc(place(name))}. No trains stop here yet.`}</p>${today.length ? routeList(today, true) : ''}` : today.length ? routeList(today) : '<p class="none">No intercity rail service today.</p>', { key: 'routes', open: !this.shut.has('routes') })
                : foldSection('Future Service', future.length ? routeList(future) : '<p class="none">No service planned.</p>', { cls: 'future-head', key: 'routes', open: !this.shut.has('routes') })) +
            (today.length && !unbuilt(name) ? '<div class="station-times" hidden></div>' : times.none(this.era)) +
            (c.link ? `<a class="more" href="${esc(c.link)}" target="_blank" rel="noopener">Learn more →</a>` : '') +
            '<div class="card-actions"><button class="act" data-copy="station"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span>Share link</span></button></div>';
    }

    shareURL(name) { return shareLink('s', name); } // Link straight to a station's window (its preview page: previews.py)

    static find(s) { const want = slug(s); return Object.keys(view.cities).find(n => slug(n) === want) ?? Object.keys(view.cities).find(n => slug(place(n)) === want) ?? null; } // A station from a link's name

    stopClips() { this.vids.forEach(v => { v.classList.remove('on'); unload(v); }); } // Stop and unload both videos

    crossFade(v) { // Cross-fade to the next clip near the end of this one
        const n = this.files.length, into = this.vids[1 - this.cur];
        if (n < 2 || this.swapping || v !== this.vids[this.cur] || v.duration - v.currentTime > 1.2 || into.readyState < 3) return;
        this.swapping = true;
        this.cur = 1 - this.cur;
        this.i = (this.i + 1) % n;
        swapClips(v, into, 1.2, () => { bg.load(v, this.files[(this.i + 1) % n]); this.swapping = false; });
    }

    open(name) { // Open the window for a station
        if (!view.cities[name]) return;
        const files = this.clipsFor(name), [a, b] = this.vids;
        Object.assign(this, { opener: document.activeElement, files, i: 0, cur: 0, swapping: false, name, era: view.era, map: null });
        $('.station-info', this.el).innerHTML = this.stationInfo(name);
        fadeEdges(this.el);
        reach.forStation($('.station-reach', this.el), name);
        times.forStation($('.station-times', this.el), name, this.era);
        this.stale = false;
        $('.station-locator', this.el).replaceChildren();
        $('.station-inset', this.el).innerHTML = this.stateInset(name);
        this.el.classList.toggle('has-clips', files.length > 0);
        this.el.classList.remove('mapped'); // (Clips first)
        this.stopClips();
        if (files.length) {
            a.loop = files.length === 1;
            bg.load(a, files[0]);
            a.addEventListener('canplay', () => { play(a); a.classList.add('on'); }, { once: true });
            if (files.length > 1) bg.load(b, files[1]);
        }

        bg.pause();
        cover(true);
        this.el.hidden = false;
        controls.showEra(this.era, this.eraSwitch); // Now it's on screen: its highlight measures its buttons (shown with the clips too: it sets the routes listed)
        if (files.length) measureSwitch(this.viewSwitch);
        if (!files.length) this.showMap(this.era); // Now that it has a size
        else choose(this.viewSwitch, 'view', 'video');
        $('.station-panel', this.el).scrollTop = 0;
        $('.close', this.el).focus({ preventScroll: true });
        setParam('station', slug(name)); // The address bar follows (it's shareable as is)
    }

    setEra(era) { // Present Day / Full Buildout: the routes listed beside, and the map (drawn now if it shows, else when it's asked for)
        this.era = era;
        controls.showEra(era, this.eraSwitch);
        const info = $('.station-info', this.el), top = info.scrollTop;
        info.innerHTML = this.stationInfo(this.name);
        fadeEdges(info);
        reach.forStation($('.station-reach', info), this.name);
        times.forStation($('.station-times', info), this.name, this.era);
        info.scrollTop = top;
        if (this.map && (this.el.classList.contains('mapped') || !this.files.length)) this.showMap(era);
        else if (this.map) this.stale = true;
    }

    showVideo(on) { // A station with clips: its clips, or the map (drawn the first time it's asked for)
        this.el.classList.toggle('mapped', !on);
        choose(this.viewSwitch, 'view', on ? 'video' : 'map');
        if (on) return play(this.vids[this.cur]);
        this.vids.forEach(v => v.pause());
        if (!this.map || this.stale) { this.stale = false; this.showMap(this.era); }
    }

    closeStationModal() { // Close and resume the background
        this.el.hidden = true;
        setParam('station', null);
        cover(false);
        this.stopClips();
        bg.resume();
        this.opener?.focus?.({ preventScroll: true });
    }

    bind() {
        this.el.addEventListener('scroll', e => e.target.classList?.contains('scroller') && fadeEdges(e.target), true); // (Scrolls don't bubble: caught on the way down)
        const box = $('.station-locator', this.el), home = () => this.map.home[2] - this.map.home[0];
        relief.onLoad = id => { // A state arrived: redraw the layers it shows up in (the far one at most every half second)
            const M = this.map;
            if (!this.isOpen() || !M?.near?.drawn) return;
            if (relief.statesIn(relief.around(M.view, Relief.MARGIN)).includes(id)) this.repaint();
            clearTimeout(M.farTimer);
            M.farTimer = setTimeout(() => this.map === M && this.repaint(M.far), 500);
        };

        panZoom(box, box, { view: () => this.map.view, width: w => Math.min(this.map.world[2] - this.map.world[0], home() * 6, Math.max(home() / 4, w)), move: (...v) => this.move(...v) }); // In to 4x, out to 6x
        this.vids.forEach(v => v.addEventListener('timeupdate', () => this.crossFade(v)));
        this.el.addEventListener('click', e => {
            if (e.target === this.el || e.target.closest('.close')) return this.closeStationModal();
            const shown = e.target.closest('.station-view button')?.dataset.view;
            if (shown) return this.showVideo(shown === 'video');
            const era = e.target.closest('.station-era button')?.dataset.era;
            if (era) return era !== this.era && this.setEra(era);
            const share = e.target.closest('.act[data-copy="station"]');
            if (share) { const label = $('span', share); return card.copyText(this.shareURL(this.name)).then(ok => { label.textContent = ok ? 'Link copied' : 'Copy failed'; later(1.8, () => { label.textContent = 'Share link'; }); }); }
            const head = e.target.closest('.fold-head');
            if (head) { toggleFold(head) ? this.shut.delete(head.dataset.fold) : this.shut.add(head.dataset.fold); fadeEdges(this.el); return later(.35, () => fadeEdges(this.el)); } // (Kept folded for the next station; the lists' fades once it has folded)
            const b = e.target.closest('.station-routes button');
            if (b) { const name = this.name; this.closeStationModal(); sidebar.pick(+b.dataset.i, true); if (view.selected !== null) view.backTo = { station: name, route: view.selected }; } // (Its route type, and era, turned on if they're off; closing its card comes back here)
        });

        document.addEventListener('visibilitychange', () => { // Station clips pause with the tab
            if (!this.isOpen() || !this.files.length || this.el.classList.contains('mapped')) return;
            document.hidden ? this.vids.forEach(v => v.pause()) : play(this.vids[this.cur]);
        });
    }
}

// "Now showing" button
class NowShowing {
    el = $('.now-showing');

    update(f) { // Show the city in the current clip, pulse its dot
        const folder = folderOf(f), city = folder && clipCity(folder), label = $('strong', this.el);
        this.el.dataset.city = city || '';
        label.innerHTML = city ? `${nameHTML(city)}<small>${esc(net.stateIdOf(city))}</small>` : esc(folder.split('/').pop());
        this.el.disabled = !city;
        this.el.hidden = !folder;
        if (!still) label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, easing: 'ease' });
        $('.pin.showing', ui.pins)?.classList.remove('showing');
        if (city) $(`.pin[data-city="${CSS.escape(city)}"]`, ui.pins)?.classList.add('showing');
    }

    bind() {
        bg.onShowing = f => setTimeout(() => this.update(f), this.el.dataset.city === undefined ? 0 : 700); // Mid cross-fade
        this.el.addEventListener('click', () => this.el.dataset.city && stationModal.open(this.el.dataset.city));
    }
}
