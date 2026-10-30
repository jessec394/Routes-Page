// Performance report (?perf in the address): the map's heavy steps timed with your own data
(() => {
    if (!new URLSearchParams(location.search).has('perf')) return;
    const steps = new Map(), frames = { n: 0, slow: 0, worst: 0, lost: 0 }, longTasks = { n: 0, ms: 0 }; // Timings per step, stuttering frames, long tasks
    let phase = 'intro'; // What's happening (the scripted test names its stages; the opening animation until the map is drawn)
    const opening = { n: 0, slow: 0, worst: 0, lost: 0 }; // The opening animation's frames (kept when a test resets the rest)
    const introOver = setInterval(() => { if (document.body.classList.contains('drawn')) { clearInterval(introOver); if (phase === 'intro') phase = 'idle'; } }, 100);
    const note = (name, ms) => { const s = steps.get(name) ?? steps.set(name, { n: 0, ms: 0, max: 0 }).get(name); s.n++; s.ms += ms; s.max = Math.max(s.max, ms); };
    const time = (obj, label, names) => names.forEach(n => { // Each call of these methods timed (the work they do on the page, not what they hand to the thread)
        const f = obj[n];
        if (typeof f !== 'function') return;
        obj[n] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { note(`${label}.${n}`, performance.now() - t); } };
    });

    time(intro, 'intro', ['plan', 'unflat', 'flipEra', 'settle', 'finish']);
    time(map, 'map', ['prepare', 'build', 'layout', 'drawRoutes', 'geometry', 'respace', 'arrangeStationLabels', 'absorb', 'pickGrid', 'focusRoutesAndStations', 'liftHovered', 'snapPins', 'backdrop', 'applyZ', 'routeAt', 'pinAt', 'crossfade', 'recolor', 'zoomClasses', 'glideLines', 'measureNames', 'pinSizes']);
    time(camera, 'camera', ['show', 'draw', 'applyFrame', 'placePins', 'flyPins', 'measure']);
    time(net, 'net', ['recolor', 'paint', 'split']);
    time(programs, 'programs', ['drawMap', 'render', 'plan', 'sidebar', 'showStops', 'paint']);
    time(card, 'card', ['show', 'routeCard', 'drawBranches']);
    time(sidebar, 'sidebar', ['build', 'highlight']);
    time(relief, 'relief', ['fill', 'redraw']);

    const run = lanesThread.run.bind(lanesThread); // The background thread: its own working time, and the wait for it
    lanesThread.run = job => { const t = performance.now(), kind = job.kind || 'lines'; return run(job).then(out => { note(`thread.${kind} (working)`, out?.ms ?? 0); if (out?.laidMs) note('thread.lanes laid out', out.laidMs); if (out?.redoneMs) note(`thread.${kind}: lines worked out again`, out.redoneMs); note(`thread.${kind} (wait)`, performance.now() - t); return out; }); };

    let last = performance.now(); // Frame gaps: a slow frame is a visible stutter
    const tick = now => { const gap = now - last; last = now; frames.n++; if (gap > 25) { frames.dropped = (frames.dropped || 0) + 1; note(`dropped frames (over 25 ms): ${phase}`, gap - 16.7); if (phase === 'intro') opening.dropped = (opening.dropped || 0) + 1; } if (phase === 'intro') { opening.n++; if (gap > 50) { opening.slow++; opening.lost += gap - 16.7; opening.worst = Math.max(opening.worst, gap); } } if (gap > 50) { frames.slow++; frames.lost += gap - 16.7; frames.worst = Math.max(frames.worst, gap); note(`frames over 50 ms: ${phase}`, gap); } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver(list => list.getEntries().forEach(e => { longTasks.n++; longTasks.ms += e.duration; })).observe({ type: 'longtask', buffered: true }); } catch { }
    try { // Slow frames split into the page's own code and the browser's work drawing it (Chrome and Edge)
        new PerformanceObserver(list => list.getEntries().forEach(e => {
            const end = e.startTime + e.duration, layout = e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0, script = e.scripts.reduce((t, s) => t + s.duration, 0);
            note(`slow frames, page code: ${phase}`, script);
            note(`slow frames, browser restyle + layout: ${phase}`, layout);
            note(`slow frames, other browser work: ${phase}`, Math.max(0, e.duration - script - layout));
            e.scripts.forEach(s => s.duration > 5 && note(`  code: ${(s.sourceURL || '').split('/').pop().split('?')[0] || 'page'} ${s.sourceFunctionName || s.invoker}`, s.duration));
        })).observe({ type: 'long-animation-frame', buffered: false });
    } catch { }

    const data = () => { // What the map is drawing: the size of the work
        const pts = r => (r.runs || []).reduce((t, run) => t + run.length, 0), all = [...view.routes, ...view.regional];
        const biggest = [...all].sort((a, b) => pts(b) - pts(a)).slice(0, 8).map(r => `${r.label} ${r.name && r.name !== r.label ? `(${r.name}) ` : ''}${pts(r)}`);
        return [`routes ${view.routes.length} (${view.routes.filter(net.shown).length} shown), commuter lines ${view.regional.length} (${view.regional.filter(net.regionalShown).length} shown)`,
            `line points: routes ${view.routes.reduce((t, r) => t + pts(r), 0)}, commuter ${view.regional.reduce((t, r) => t + pts(r), 0)}; most: ${biggest.join(', ')}`,
            `station dots ${view.pinList?.length}, map paths ${$$('path', ui.map).length}, page elements ${document.getElementsByTagName('*').length}`, `screen ${innerWidth}x${innerHeight} at ${devicePixelRatio}x`];
    };

    const report = () => { // Slowest first, by total time
        const rows = [...steps].sort((a, b) => b[1].ms - a[1].ms).map(([k, s]) => `${k.padEnd(42)} ${s.ms.toFixed(0).padStart(7)} ms total  ${String(s.n).padStart(6)} calls  ${(s.ms / s.n).toFixed(1).padStart(7)} avg  ${s.max.toFixed(0).padStart(5)} max`);
        return [...data(), `intro: frames ${opening.n}, ${opening.dropped || 0} dropped (over 25 ms), ${opening.slow} over 50 ms (${opening.lost.toFixed(0)} ms lost, worst ${opening.worst.toFixed(0)} ms)`, `frames ${frames.n}, ${frames.dropped || 0} dropped (over 25 ms), ${frames.slow} over 50 ms (${frames.lost.toFixed(0)} ms lost, worst ${frames.worst.toFixed(0)} ms); long tasks ${longTasks.n} (${longTasks.ms.toFixed(0)} ms)`, '', ...rows].join('\n');
    };

    const reset = () => { [...steps.keys()].forEach(k => !k.endsWith(': intro') && !k.startsWith('intro.') && steps.delete(k)); Object.assign(frames, { n: 0, slow: 0, worst: 0, lost: 0, dropped: 0 }); Object.assign(longTasks, { n: 0, ms: 0 }); };
    const pause = ms => new Promise(r => setTimeout(r, ms));
    const test = async () => { // The same moves every time, so runs compare (before/after a change)
        reset();
        const go = async (name, cam, ms = 1600) => { phase = name; view.zoom = null; view.back = cam; camera.move(); await pause(ms); };
        const at = (city, half) => { const [x, y] = net.cityXY(city); return { cx: x, cy: y, hx: half, hy: half * .6, side: 0 }; };
        await go('zoom out to the country', camera.network());
        await go('zoom to New York', at('New York', 60));
        await go('zoom to Chicago', at('Chicago', 80));
        await go('zoom to Ohio', { ...view.home });
        phase = 'drag (by hand)';
        for (let k = 0; k < 90; k++) { const f = camera.frameFor(view.cam, camera.quick()); camera.drag?.(f.x0 + 9 / f.s, f.y0 + Math.sin(k / 10) * 3 / f.s, f.vw); await pause(16); } // About 800px, across and back a little
        await pause(800);
        const box = ui.map.getBoundingClientRect(), [cx, cy] = net.cityXY('Chicago'), f0 = view.frame, wheel = dy => ui.map.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: box.left + (cx - f0.x0) * f0.s, clientY: box.top + (cy - f0.y0) * f0.s, bubbles: true, cancelable: true }));
        phase = 'wheel zoom in';
        for (let k = 0; k < 24; k++) { wheel(-60); await pause(30); }
        await pause(900);
        phase = 'wheel zoom out';
        for (let k = 0; k < 24; k++) { wheel(60); await pause(30); }
        await pause(900);
        phase = 'hover sweep';
        const r = ui.map.getBoundingClientRect();
        for (let k = 0; k < 60; k++) { ui.map.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * (.2 + .6 * k / 60), clientY: r.top + r.height * (.3 + .4 * Math.sin(k / 6)), pointerType: 'mouse', bubbles: true })); await pause(16); }
        await pause(500);
        for (const era of ['today', 'buildout']) { phase = `era: ${era}`; controls.setView({ era }); await pause(1500); }
        phase = 'pick a route';
        const pick = view.routes.find(x => net.shown(x) && !x.context);
        if (pick) { map.selectRoute(pick.i); await pause(1800); map.reset(); await pause(1500); }
        phase = 'program window';
        programs.open?.('Corridor ID Program'); await pause(1800); programs.close?.(); await pause(800);
        phase = 'idle';
        out.textContent = report();
        return `${frames.slow} slow frames, ${frames.lost.toFixed(0)} ms lost, worst ${frames.worst.toFixed(0)} ms`;
    };

    const culprits = async () => { // The test again with one layer gone each time: whichever saves the most is the biggest cost here
        const tries = [['everything shown', ''], ['without glows', '.glow'], ['without line casings', '.under'], ['without commuter lines', '.regional'], ['without station dots and names', '.pins, .pins-lit'], ['without the background video', 'video']];
        const lines = [];
        for (const [name, hide] of tries) {
            out.textContent = `Testing ${name} (${lines.length + 1} of ${tries.length}, about 25 s each): leave the page alone…\n\n${lines.join('\n')}`;
            const style = hide && hide !== 'video' && document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `${hide} { display: none !important; }` }));
            const video = hide === 'video' && !bg.off;
            if (video) bg.setOff(true);
            await pause(1000);
            lines.push(`${name.padEnd(32)} ${await test()}`);
            if (style) style.remove();
            if (video) bg.setOff(false);
        }

        culprits.result = ['Same test, one layer hidden each time (the most time saved = the biggest cost):', ...lines].join('\n');
        out.textContent = culprits.result + '\n\n' + report();
    };

    const panel = document.createElement('div'); // The report, over the page
    panel.style.cssText = 'position:fixed;z-index:99;left:8px;bottom:8px;max-width:min(52rem,calc(100vw - 16px));max-height:45vh;display:flex;flex-direction:column;gap:6px;padding:8px;font:11px/1.35 ui-monospace,monospace;color:#fff;background:rgb(0 0 0/.82);border-radius:8px';
    panel.innerHTML = '<div style="display:flex;gap:6px"><button data-a="test">Run test</button><button data-a="culprits">Find culprits</button><button data-a="show">Show report</button><button data-a="copy">Copy report</button><button data-a="reset">Reset</button><button data-a="hide">Hide</button></div><pre style="margin:0;overflow:auto;white-space:pre"></pre>';
    $$('button', panel).forEach(b => { b.style.cssText = 'padding:3px 8px;color:#000;background:#fff;border-radius:4px'; });
    const out = $('pre', panel);
    panel.addEventListener('click', e => {
        const a = e.target.dataset?.a;
        if (a === 'test') { out.textContent = 'Running (about 20 s): leave the page alone…'; test(); }
        if (a === 'culprits') culprits();
        if (a === 'show') out.textContent = report();
        if (a === 'copy') { const text = [culprits.result, report()].filter(Boolean).join('\n\n'); navigator.clipboard?.writeText(text).then(() => { out.textContent = text; }); }
        if (a === 'reset') { reset(); out.textContent = 'Reset: use the map, then Show report.'; }
        if (a === 'hide') out.hidden = !out.hidden;
    });
    addEventListener('load', () => document.body.append(panel));
    if (document.readyState === 'complete') document.body.append(panel);
    window.perfReport = report; // (Also from the console)
})();
