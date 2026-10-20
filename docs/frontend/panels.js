// Header controls
class Controls {
    sync() { // Header buttons match the view
        $$('button', ui.modes).forEach(b => b.setAttribute('aria-pressed', net.hasType(b.dataset.type)));
        this.showEra(view.era);
        const empty = view.routes.length > 0 && !view.routes.some(net.shown);
        ui.hint.classList.toggle('empty', empty);
        ui.hint.textContent = empty ? 'No routes match this view' : '';
    }

    showEra(era) { // Era switch shows `era` (highlight slides to it)
        $$('button', ui.era).forEach(b => b.setAttribute('aria-checked', b.dataset.era === era));
        const on = $('[aria-checked="true"]', ui.era);
        if (on) { ui.era.style.setProperty('--tx', `${on.offsetLeft}px`); ui.era.style.setProperty('--tw', `${on.offsetWidth}px`); }
    }

    syncZoom() { // Zoom button matches the view
        ui.zoomOut.setAttribute('aria-pressed', !!view.wide);
        ui.zoomOut.querySelector('span').textContent = view.wide ? 'Local View' : 'Full Network';
        ui.map.classList.toggle('wide', !!view.wide);
    }

    setView(change) { // Change types/era and refresh
        if (!view.cam || Object.entries(change).every(([k, v]) => view[k] === v)) return;
        const zoom = view.zoom;
        const era = view.era;
        Object.assign(view, change);
        if (view.era !== era) timeJump.set(view.era, true);
        store.set('routes-types', view.types);
        this.sync();
        if (view.selected !== null && !net.shownAt(view.selected)) view.selected = null;
        if (view.zoom != null && !net.members(view.zoom).some(net.shownAt)) view.zoom = null;
        view.hover = null;
        map.focusRoutesAndStations();
        zoom !== view.zoom || view.zoom != null || view.wide ? camera.move() : map.layout();
    }

    toggleType(type, on) { return TYPES.filter(t => t === type ? on : net.hasType(t)).join(' '); } // Types string with one type on/off

    bind() {
        ui.modes.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.setView({ types: this.toggleType(b.dataset.type, b.getAttribute('aria-pressed') !== 'true') }); });
        ui.era.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { view.eraChosen = true; this.setView({ era: b.dataset.era }); } });
        ui.zoomOut.addEventListener('click', () => { // Full Network / Local View
            view.wide = !view.wide;
            this.syncZoom();
            view.selected = view.city = view.hover = view.zoom = null;
            map.focusRoutesAndStations();
            camera.move();
        });
    }
}

// Routes sidebar
class Sidebar {
    build() { // Sidebar route list
        const groups = [...view.groups.values()].map(ids => view.routes[ids[0]]).sort((a, b) => a.label.localeCompare(b.label));
        const item = r => { // One sidebar entry
            const kind = statusKind(r.status);
            return `<li><button data-i="${r.i}" style="--c:${r.color}" class="${r.typeKey}"><span class="swatch"></span><span class="name">${esc(r.label)}` +
                `<small>${esc(r.type)}${['temporary', 'suspended'].includes(kind) ? ` · <b class="is-${kind}">${kind}</b>` : ''}</small></span></button></li>`;
        };

        const list = items => `<ul>${items.map(item).join('')}</ul>`; // Entries as a list
        const existing = groups.filter(r => statusKind(r.status) !== 'proposed'), left = groups.filter(r => !existing.includes(r));
        const proposed = CATEGORIES.map(([title, test]) => {
            const items = left.filter(test);
            items.forEach(r => left.splice(left.indexOf(r), 1));
            return items.length ? `<h5>${title}</h5>${list(items)}` : '';
        }).join('');

        ui.legendBody.innerHTML = (existing.length ? `<h4>Existing</h4>${list(existing)}` : '') + (proposed ? `<h4>Proposed</h4>${proposed}` : '');
        this.buttons = $$('button', ui.legendBody);
    }

    highlight(active) { // Dim hidden routes; mark the hovered/selected one
        (this.buttons || []).forEach(b => {
            const i = +b.dataset.i;
            b.classList.toggle('off', !net.members(i).some(net.shownAt));
            b.classList.toggle('on', !!active && net.members(i).some(m => active.includes(m)) && (view.hover !== null || view.selected !== null));
        });
    }

    sync() { // Sidebar open state
        ui.legend.classList.toggle('open', view.legend);
        ui.legendToggle.setAttribute('aria-expanded', view.legend);
        brandMap.place();
    }

    bind() {
        ui.legendToggle.addEventListener('click', () => {
            if (pageW() > NARROW) return; // Fixed open on desktop
            view.legend = !view.legend;
            this.sync();
            if (view.cam) camera.move();
        });

        ui.legendBody.addEventListener('pointerover', e => { const b = e.target.closest('button'); map.hoverRoute(b && !b.classList.contains('off') ? +b.dataset.i : null); });
        ui.legendBody.addEventListener('pointerleave', () => map.hoverRoute(null));
        ui.legendBody.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            const r = view.routes[+b.dataset.i], need = {};
            if (!net.hasType(r.typeKey)) need.types = controls.toggleType(r.typeKey, true);
            if (!net.members(r.i).some(net.shownAt)) need.era = view.era === 'today' ? 'buildout' : 'today';
            controls.setView(need);
            map.selectRoute(net.members(r.i).includes(view.selected) ? null : net.members(r.i).find(net.shownAt));
        });
    }
}

// Route/city card
class InfoCard {
    shareURL(r) { return `${location.origin}${location.pathname}?route=${slug(r.label)}`; } // Link to a route
    embedCode(r) { return `<iframe src="${location.origin}${location.pathname}?embed&route=${slug(r.label)}" width="100%" height="560" style="border:0;border-radius:12px" title="${esc(r.label)} · All Aboard Ohio" loading="lazy"></iframe>`; } // Embed snippet for a route

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
        if (EMBED) return;
        const r = view.selected !== null ? view.routes[view.selected] : null, want = r ? `?route=${slug(r.label)}` : '';
        if (location.search !== want) history.replaceState(null, '', location.pathname + want + location.hash);
    }

    stopItem(n, r) { // One stop in a route card
        const others = net.uniqueGroups(net.routesAt(n).filter(j => view.routes[j].label !== r.label));
        return `<li class="size-${sizeOf(view.cities[n])}" data-city="${esc(n)}"><i></i><span class="stop-name">${nameHTML(n)}</span>` +
            `<span class="links">${others.map(o => `<b style="--c:${o.color}" title="${esc(o.label)}"></b>`).join('')}</span></li>`;
    }

    routeCard(r) { // Route card HTML
        const list = net.members(r.i).map(i => view.routes[i]).filter(net.shown);
        if (!list.length) list.push(r);
        const trunk = common(list.map(b => b.stops)), shared = list.length > 1 ? list[0].stops.slice(0, trunk) : list[0].stops;
        const split = list.length > 1 && trunk ? shared.at(-1) : null, items = stops => stops.map(n => this.stopItem(n, r)).join('');
        return `<div class="card-head" style="--c:${r.color}"><span class="swatch"></span><div>` +
            `<p class="kicker">${esc(r.type)} route</p><h3>${esc(r.label)}</h3><p class="status is-${statusKind(r.status)}">${esc(r.status)}</p>` +
            `<p class="meta">${plural(new Set(list.flatMap(b => b.stops)).size, 'stop')}${split ? ` · splits at ${esc(place(split))}` : ''}` +
            `${list.every(b => b.traced) ? '' : ' · line approximated'}</p></div></div>${density.markup(r.i)}<ol class="stops" style="--c:${r.color}">` + items(shared) +
            (list.length > 1 ? list.map(b => `<li class="branch-head">${esc(b.name)}</li>` + items(b.stops.slice(trunk))).join('') : '') + '</ol>' +
            `<div class="card-actions">${EMBED ? `<a class="act" href="${esc(this.shareURL(r))}" target="_blank" rel="noopener">Open full map ↗</a>`
                : '<button class="act" data-copy="link">Share link</button><button class="act" data-copy="embed">Embed</button>'}</div>`;
    }

    cityCard(name) { // City card HTML
        const list = net.uniqueGroups(net.routesAt(name));
        return `<div class="card-head"><span class="dot"></span><div><p class="kicker">Station city</p><h3>${esc(place(name))}</h3>` +
            `<p class="meta">${plural(list.length, 'route')}</p></div></div><ul class="route-links">${list.map(r =>
                `<li><button data-i="${r.i}" style="--c:${r.color}"><span class="swatch"></span><span>${esc(r.label)}</span><span class="go">→</span></button></li>`).join('')}</ul>`;
    }

    show() { // Show/refresh the card
        const key = view.selected !== null ? `r${view.routes[view.selected].label}:${view.types}:${view.era}` : view.city ? `c${view.city}:${view.types}:${view.era}` : '';
        if (ui.card.hidden !== !key) { ui.card.hidden = !key; ui.card.parentNode.classList.toggle('carded', !!key); } // Only touch the DOM on a change
        this.syncURL();
        if (!key || ui.card.dataset.key === key) return;
        ui.card.dataset.key = key;
        ui.body.innerHTML = view.selected !== null ? this.routeCard(view.routes[view.selected]) : this.cityCard(view.city);
        if (view.selected !== null) density.fill($('.relief', ui.body), view.selected);
        if (!still) ui.card.animate([{ opacity: 0, translate: '0 .75rem' }, { opacity: 1, translate: '0 0' }], { duration: 400, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }

    bind() {
        ui.card.addEventListener('click', e => {
            if (e.target.closest('.close')) return map.reset();
            const act = e.target.closest('.act[data-copy]'), stop = e.target.closest('.stops li[data-city]'), b = e.target.closest('.route-links button');
            if (act && view.selected !== null) {
                const embed = act.dataset.copy === 'embed', r = view.routes[view.selected];
                this.copyText(embed ? this.embedCode(r) : this.shareURL(r)).then(ok => {
                    act.textContent = ok ? (embed ? 'Embed code copied' : 'Link copied') : 'Copy failed';
                    setTimeout(() => { act.textContent = embed ? 'Embed' : 'Share link'; }, 1800);
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

// Static brand map (splash map docked in the sidebar)
class BrandMap {
    static RATIO = 353 / 392; // Map image aspect
    static GLIDE = 'cubic-bezier(.65, 0, .35, 1)'; // Open/close easing
    el = $('.brand'); // Docked map
    viewer = $('.brand-map-view'); // Full-size viewer
    isOpen() { return !this.viewer.hidden; }

    dockRect() { // Free space under the legend, or null
        const last = ui.legendBody.lastElementChild;
        if (pageW() <= NARROW || !view.legend || !last) return null;
        const free = pageH() - rectOf(last).bottom - 16;
        const w = Math.min(ui.legend.offsetWidth - 48, 260, (free - 32) / BrandMap.RATIO), h = w * BrandMap.RATIO;
        return h >= 120 ? { w, left: (ui.legend.offsetWidth - w) / 2, top: pageH() - 20 - h } : null;
    }

    place() { // Dock the map in the sidebar
        if (!document.body.classList.contains('settled')) return;
        const d = this.dockRect(), b = this.el;
        if (d && !b.classList.contains('docked')) { pageEl().append(b); b.classList.add('docked'); }
        b.classList.toggle('away', !d);
        b.tabIndex = d ? 0 : -1;
        if (d) Object.assign(b.style, { width: `${d.w.toFixed(1)}px`, left: `${d.left.toFixed(1)}px`, top: `${d.top.toFixed(1)}px` });
    }

    flipFrom(el, from) { // FLIP transform from a previous rect
        const to = rectOf(el);
        return `translate(${(from.left - to.left).toFixed(1)}px, ${(from.top - to.top).toFixed(1)}px) scale(${(from.width / to.width).toFixed(4)})`;
    }

    openBrandMap() { // Open the full-size viewer
        const v = this.viewer, img = $('.brand-big', v), from = rectOf(this.el);
        v.hidden = false;
        document.body.classList.add('covered');
        map.syncTrains();
        this.el.style.visibility = 'hidden';
        v.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still ? 0 : 350, easing: 'ease-out' });
        img.animate([{ transform: this.flipFrom(img, from) }, { transform: 'none' }], { duration: still ? 0 : 650, easing: BrandMap.GLIDE });
        $('.close', v).focus();
    }

    closeBrandMap() { // Close it, shrinking back
        const v = this.viewer, img = $('.brand-big', v);
        img.style.visibility = '';
        const back = img.animate([{ transform: 'none' }, { transform: this.flipFrom(img, rectOf(this.el)) }], { duration: still ? 0 : 550, easing: BrandMap.GLIDE, fill: 'forwards' });
        v.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still ? 0 : 450, delay: still ? 0 : 150, easing: 'ease-in', fill: 'forwards' });
        back.finished.then(() => {
            v.hidden = true;
            document.body.classList.remove('covered');
            map.syncTrains();
            this.el.style.visibility = '';
            v.getAnimations({ subtree: true }).forEach(a => a.cancel());
            this.el.focus();
        });
    }

    bind() {
        this.el.addEventListener('click', () => this.el.classList.contains('docked') && this.openBrandMap());
        this.viewer.addEventListener('click', () => this.closeBrandMap());
    }
}

// Station window
class StationModal {
    el = $('.station');
    vids = $$('.station-hero video'); // Its two videos
    files = []; i = 0; cur = 0; swapping = false; opener = null; // Clip player state
    isOpen() { return !this.el.hidden; }

    clipsFor(name) { // Folder clips/<Station>/ (or the city's "clips" folder)
        const want = norm(view.cities[name]?.clips || place(name));
        return bg.clips.filter(f => f.includes('/') && norm(folderOf(f)) === want);
    }

    locatorSVG(name) { // Minimap for stations without clips (only what's in frame)
        const [cx, cy] = net.cityXY(name), R = 170, frame = [cx - R * 1.6, cx + R * 1.6, cy - R, cy + R];
        const inFrame = ([x0, x1, y0, y1]) => x0 < frame[1] && x1 > frame[0] && y0 < frame[3] && y1 > frame[2]; // Bounding box overlaps the minimap
        const routes = view.routes.filter(r => statusKind(r.status) !== 'temporary' && inFrame(r.box));
        const mine = routes.filter(r => view.served[name]?.includes(r.i));
        const runs = (r, attrs) => r.runs.map(run => `<path ${attrs} d="${pathOf(run)}"/>`).join(''); // A route as SVG paths
        return `<svg viewBox="${frame[0]} ${frame[2]} ${R * 3.2} ${R * 2}" preserveAspectRatio="xMidYMid slice">` +
            view.allStates.filter(st => inFrame(st.box)).map(st => `<path class="st${st.id.toUpperCase() === view.focus ? ' oh' : ''}" d="${ringsPath(st.rings)}"/>`).join('') +
            routes.map(r => runs(r, 'class="bgline"')).join('') +
            mine.map(r => runs(r, `class="line${net.present(r) ? '' : ' proposed'}" style="--c:${r.color}"`)).join('') +
            `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" class="here"/><circle class="ring" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11"/>` +
            `<text x="${(cx + 11).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="start" class="here">${esc(place(name))}</text></svg>`;
    }

    stateInset(name) { // State outline with the focused station's dot
        const st = view.allStates.find(s => s.id.toUpperCase() === net.stateIdOf(name)), p = net.cityXY(name);
        if (!st || !p) return '';
        const [x0, x1, y0, y1] = st.box, span = Math.max(x1 - x0, y1 - y0), pad = span * .06;
        return `<svg viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}" aria-hidden="true">` +
            `<path d="${ringsPath(st.rings)}"/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${(span * .045).toFixed(1)}"/></svg>`;
    }

    stationInfo(name) { // Name, state, present vs future service
        const c = view.cities[name], served = view.served[name] || [], state = net.stateOf(name);
        const routeList = ids => `<ul class="station-routes">${net.uniqueGroups(ids).map(r => `<li><button data-i="${r.i}" style="--c:${r.color}"><span class="swatch"></span><span class="name">${esc(r.label)}` +
            `<small>${esc(r.type)} · <b class="is-${statusKind(r.status)}">${esc(r.status)}</b></small></span><span class="go">→</span></button></li>`).join('')}</ul>`; // Route buttons
        const today = served.filter(i => net.present(view.routes[i])), future = served.filter(i => statusKind(view.routes[i].status) !== 'temporary');
        return `<h2 id="station-name"><span>${nameHTML(name)}</span>${state ? `<small>${esc(state)}</small>` : ''}</h2>` +
            (c.description ? `<p class="about">${esc(c.description)}</p>` : '') +
            `<h4>Present-Day Service</h4>${today.length ? routeList(today) : '<p class="none">No passenger rail service today.</p>'}` +
            `<h4 class="future-head">Future service</h4>${routeList(future)}` +
            (c.link ? `<a class="more" href="${esc(c.link)}" target="_blank" rel="noopener">Learn more →</a>` : '');
    }

    loadClip(v, f) { v.src = clipUrl(f); v.load(); } // Load a clip into a video
    stopClips() { this.vids.forEach(v => { v.pause(); v.classList.remove('on'); v.removeAttribute('src'); v.load(); }); } // Stop and unload both videos

    crossFade(v) { // Cross-fade to the next clip near the end of this one
        const n = this.files.length, into = this.vids[1 - this.cur];
        if (n < 2 || this.swapping || v !== this.vids[this.cur] || v.duration - v.currentTime > 1.2 || into.readyState < 3) return;
        this.swapping = true;
        into.currentTime = 0;
        play(into);
        into.classList.add('on');
        v.classList.remove('on');
        this.cur = 1 - this.cur;
        this.i = (this.i + 1) % n;
        setTimeout(() => { v.pause(); this.loadClip(v, this.files[(this.i + 1) % n]); this.swapping = false; }, 1200);
    }

    open(name) { // Open the window for a station
        if (!view.cities[name]) return;
        const files = this.clipsFor(name), [a, b] = this.vids;
        Object.assign(this, { opener: document.activeElement, files, i: 0, cur: 0, swapping: false });
        $('.station-info', this.el).innerHTML = this.stationInfo(name);
        $('.station-locator', this.el).innerHTML = files.length ? '' : this.locatorSVG(name);
        $('.station-inset', this.el).innerHTML = this.stateInset(name);
        this.el.classList.toggle('has-clips', files.length > 0);
        this.stopClips();
        if (files.length) {
            a.loop = files.length === 1;
            this.loadClip(a, files[0]);
            a.addEventListener('canplay', () => { play(a); a.classList.add('on'); }, { once: true });
            if (files.length > 1) this.loadClip(b, files[1]);
        }

        bg.pause();
        document.body.classList.add('covered'); // Map hidden: stop the trains
        map.syncTrains();
        this.el.hidden = false;
        $('.station-panel', this.el).scrollTop = 0;
        $('.close', this.el).focus({ preventScroll: true });
    }

    closeStationModal() { // Close and resume the background
        this.el.hidden = true;
        document.body.classList.remove('covered');
        map.syncTrains();
        this.stopClips();
        bg.resume();
        this.opener?.focus?.({ preventScroll: true });
    }

    bind() {
        this.vids.forEach(v => v.addEventListener('timeupdate', () => this.crossFade(v)));
        this.el.addEventListener('click', e => {
            if (e.target === this.el || e.target.closest('.close')) return this.closeStationModal();
            const b = e.target.closest('.station-routes button');
            if (b) { this.closeStationModal(); map.selectRoute(+b.dataset.i); }
        });

        document.addEventListener('visibilitychange', () => { // Station clips pause with the tab
            if (!this.isOpen() || !this.files.length) return;
            document.hidden ? this.vids.forEach(v => v.pause()) : play(this.vids[this.cur]);
        });
    }
}

// "Now showing" button
class NowShowing {
    el = $('.now-showing');

    update(f) { // Show the city in the current clip, pulse its dot
        const folder = folderOf(f), city = Object.keys(view.cities).find(n => norm(view.cities[n].clips || place(n)) === norm(folder)), label = $('strong', this.el);
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
