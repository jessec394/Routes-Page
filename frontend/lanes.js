// Side-by-side lanes (worked out on a background thread: lanesThread, below)
class Lanes {
    static SPAN = 16; // Smoothing window (points each side)
    static WEIGHTS = Array.from({ length: 2 * Lanes.SPAN + 1 }, (_, i) => Math.exp(-((i - Lanes.SPAN) ** 2) / 72)); // Gaussian smoothing weights
    static EVEN = Array.from({ length: 2 * Lanes.SPAN + 1 }, (_, i) => Math.exp(-((i - Lanes.SPAN) ** 2) / 32)); // Narrower: smooths a bundle's track

    static GAP = 6.5; // Lane spacing (px at full size)
    static BUNDLE = 26; // Widest a bundle gets (px): busier corridors pack their lanes closer instead of spreading wider
    static ALONG = 2; // A commuter line this near an Amtrak line (map units, about km) shares its track: drawn hugging the bundle
    static EDGE = 1e6; // Commuter lines' lane: kept out of the lane layout, then drawn just clear of Amtrak's lines (Lanes.beside)

    static layout(routes, majors) { // Shared track split into side-by-side lanes: whole map, in lane units (Lanes.at makes them pixels)
        const { SPAN, WEIGHTS } = Lanes;
        const locals = routes.filter(r => r.lane === Lanes.EDGE); // Commuter lines never move Amtrak's lanes: fitted alongside them afterwards (end of this)
        routes = routes.filter(r => r.lane !== Lanes.EDGE);
        const gap = 1, reach = 4, width = new Map(routes.map(r => [r.lane, r.w]));
        const runs = new Map(), grid = new Map(), near = new Map(), relation = new Map(), result = new Map(), lanesOf = new Map(); // (lanesOf: runs per lane)
        const cellOf = (x, y) => (Math.floor(x / reach) + 32768) * 65536 + Math.floor(y / reach) + 32768; // Grid cell ID

        // Resample runs; grid their points
        routes.forEach(r => r.runs.forEach((run, n) => {
            const pts = resample(run, 2), key = `${r.i}:${n}`;
            const dirs = pts.map((p, k) => {
                const a = pts[Math.max(0, k - 3)], b = pts[Math.min(pts.length - 1, k + 3)], l = dist(a, b) || 1;
                return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
            });

            runs.set(key, { r: r.lane, pts, dirs });
            lanesOf.set(r.lane, (lanesOf.get(r.lane) || 0) + 1);
            pts.forEach((p, k) => {
                const c = cellOf(p[0], p[1]);
                grid.has(c) ? grid.get(c).push({ key, r: r.lane, k }) : grid.set(c, [{ key, r: r.lane, k }]);
            });
        }));

        // Parallel neighbours per point (gaps bridged, short overlaps dropped)
        runs.forEach((run, key) => {
            const per = new Map();
            run.pts.forEach((p, k) => {
                const best = new Map();
                for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid.get(cellOf(p[0] + i * reach, p[1] + j * reach)) || []).forEach(o => {
                    if (o.r === run.r) return;
                    const other = runs.get(o.key), d = dist(other.pts[o.k], p);
                    if (Math.abs(dot(other.dirs[o.k], run.dirs[k])) >= .75 && d < reach && !(best.get(o.r)?.d <= d)) best.set(o.r, { ...o, d });
                });

                best.forEach((o, id) => { (per.get(id) || per.set(id, Array(run.pts.length).fill(null)).get(id))[k] = o; });
            });

            per.forEach(arr => {
                let last = -1;
                arr.forEach((o, k) => {
                    if (!o) return;
                    if (last >= 0 && k - last > 1 && k - last <= 10) arr.fill(arr[last], last + 1, k);
                    last = k;
                });

                spans(arr, (k, e) => e - k + 1 < 8 && arr.fill(null, k, e + 1));
            });

            near.set(key, per);
        });

        // Which side each neighbour belongs on, from where the lines go after they part
        const cross = (d, p, q) => d[0] * (q[1] - p[1]) - d[1] * (q[0] - p[0]); // Which side of line d q lies on
        near.forEach((per, key) => {
            const run = runs.get(key);
            per.forEach((arr, id) => {
                if (id < run.r) return;
                const rel = Array(arr.length).fill(0);
                spans(arr, (k, e) => {
                    let score = 0;
                    [[k, -1], [e, 1]].forEach(([at, out]) => {
                        const o = arr[at], other = runs.get(o.key), same = dot(other.dirs[o.k], run.dirs[at]) > 0 ? 1 : -1, sign = same * out;
                        [10, 25, 50, 100].forEach(m => {
                            const q = other.pts[o.k + sign * m], mine = run.pts[at + out * m];
                            if (q) score += cross(run.dirs[at], run.pts[at], q) / Math.sqrt(m); // Where the other goes from here...
                            if (mine) score -= same * cross(other.dirs[o.k], other.pts[o.k], mine) / Math.sqrt(m); // ...and where this one goes (seen from it): a line ending here still gets a side
                        });
                    });

                    rel.fill(Math.sign(score), k, e + 1); // Zero = no evidence
                });

                relation.set(`${key}|${id}`, rel);
            });
        });

        runs.forEach((run, key) => { // Lane offsets (Copeland ranking), smoothed and squeezed into major stations
            const per = near.get(key);
            const shifts = run.pts.map((p, k) => {
                const at = new Map([[run.r, { key, k }]]);
                per.forEach((arr, id) => arr[k] && at.set(id, arr[k]));
                if (at.size < 2) return [0, 0, 0, p[0], p[1]];
                const ids = [...at.keys()].sort((a, b) => a - b), ref = at.get(ids[0]), refDir = runs.get(ref.key).dirs[ref.k];
                const rel = (x, y) => { // Sign (+1/-1): which side x sits of y here
                    const a = at.get(x);
                    return ((relation.get(`${a.key}|${y}`) || [])[a.k] || 0) * Math.sign(dot(runs.get(a.key).dirs[a.k], refDir) || 1);
                };

                const side = (x, y) => x < y ? rel(x, y) : -rel(y, x); // Positive: x before y
                const wins = new Map(ids.map(x => [x, ids.reduce((t, y) => t + (y === x ? 0 : side(x, y) > 0 ? 1 : side(x, y) === 0 ? .5 : 0), 0)]));
                const order = [...ids].sort((x, y) => wins.get(y) - wins.get(x) || x - y);
                let pos = 0;
                const lanes = order.map((id, n) => pos += n ? (width.get(order[n - 1]) + width.get(id)) / 2 * gap : 0);
                const off = lanes[order.indexOf(run.r)] - pos / 2;
                let cx = 0, cy = 0; // The bundle's middle: where its lines' own tracks average out (the same for each of them)
                at.forEach(a => { const q = runs.get(a.key).pts[a.k]; cx += q[0]; cy += q[1]; });
                return [-refDir[1] * off, refDir[0] * off, pos / 2, cx / at.size, cy / at.size];
            });

            const n = shifts.length;
            if (!shifts.some(sh => sh[2]) && (lanesOf.get(run.r) || 0) < 2) return; // Not shared with anything: drawn as it is
            const spread = new Float32Array(n * 10); // Per point: spot, smoothed bundle middle, offset, half-width, end taper, nearest big station, share (at)
            run.pts.forEach((p, k) => {
                let ox = 0, oy = 0, half = 0, c = 0, sx = 0, sy = 0, sw = 0, shared = 0;
                for (let m = Math.max(0, k - SPAN); m <= Math.min(n - 1, k + SPAN); m++) {
                    const w = WEIGHTS[m - k + SPAN], v = Lanes.EVEN[m - k + SPAN];
                    ox += shifts[m][0] * w; oy += shifts[m][1] * w; half += shifts[m][2] * w; c += w;
                    sx += shifts[m][3] * v; sy += shifts[m][4] * v; sw += v; shared += (shifts[m][2] > 0) * w;
                }

                const end = Math.min(1, k / 8, (n - 1 - k) / 8), near = majors.reduce((m, q) => Math.min(m, dist(p, q)), Infinity); // Near its ends; nearest major station
                spread.set([p[0], p[1], sx / sw, sy / sw, ox / c, oy / c, half / c, end, Math.min(near, 1e6), shared / c], k * 10);
            });

            result.set(key, spread);
        });

        const order = new Map([...runs.keys()].map((key, n) => [key, n])); // Branches of one route share a lane: along an earlier one, take its points (one line)
        order.forEach((at, key) => {
            const run = runs.get(key), mine = result.get(key);
            if (!mine || (lanesOf.get(run.r) || 0) < 2) return;
            run.pts.forEach((p, k) => {
                let best = null;
                for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid.get(cellOf(p[0] + i * reach, p[1] + j * reach)) || []).forEach(o => {
                    if (o.r !== run.r || order.get(o.key) >= at || !result.has(o.key)) return;
                    const other = runs.get(o.key), d = dist(other.pts[o.k], p);
                    if (d < reach && Math.abs(dot(other.dirs[o.k], run.dirs[k])) >= .75 && !(best?.d <= d)) best = { ...o, d };
                });

                if (best) mine.set(result.get(best.key).subarray(best.k * 10, best.k * 10 + 10), k * 10);
            });
        });

        const { ALONG } = Lanes; // Commuter lines: where each one runs with Amtrak, which lines it rides beside and on which side, worked out once in real distances (so its shape is the same at every zoom)
        locals.forEach(r => r.runs.forEach((run, n) => {
            const pts = resample(run, .5).map(p => [p[0], p[1]]), m = pts.length;
            const dirs = pts.map((p, k) => { const a = pts[Math.max(0, k - 3)], b = pts[Math.min(m - 1, k + 3)], l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
            const hug = new Float32Array(m), lean = new Float32Array(m), cands = pts.map(() => []); // Hug: 1 on the same track, easing to 0 a few km off; lean: which side Amtrak's lines are on
            pts.forEach((p, k) => {
                const d = dirs[k], best = new Map();
                for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) (grid.get(cellOf(p[0] + i * reach, p[1] + j * reach)) || []).forEach(o => {
                    const other = runs.get(o.key), q = other.pts[o.k], g = dist(q, p);
                    if (g < ALONG * 1.5 && Math.abs(dot(other.dirs[o.k], d)) >= .75 && !(best.get(o.key)?.g <= g)) best.set(o.key, { ...o, g, q });
                });

                let closest = Infinity;
                best.forEach(o => {
                    closest = Math.min(closest, o.g);
                    lean[k] += (-d[1] * (o.q[0] - p[0]) + d[0] * (o.q[1] - p[1]));
                    const [i, nn] = o.key.split(':').map(Number);
                    cands[k].push([i, nn, o.k, o.q[0], o.q[1]]); // (Where it's drawn depends on the zoom: looked up then)
                });

                const f = Math.min(1, Math.max(0, (ALONG * 1.5 - closest) / ALONG));
                hug[k] = f * f * (3 - 2 * f);
            });

            const side = new Int8Array(m);
            for (let k = 0; k < m;) { // One side per stretch alongside Amtrak (the side it really runs on; a line on the very same track keeps to its own left)
                if (!cands[k].length) { k++; continue; }
                let e = k, t = 0;
                for (let q = k + 1; q < m && q - e <= 8; q++) if (cands[q].length) e = q;
                for (let q = k; q <= e; q++) t += lean[q] * hug[q];
                side.fill(t > .5 ? -1 : 1, k, e + 1);
                for (let q = k + 1; q <= e; q++) if (!cands[q].length) cands[q] = cands[q - 1]; // (Short gaps keep beside the same lines)
                k = e + 1;
            }

            const eased = hug.map((_, k) => { let t = 0, c = 0; for (let q = Math.max(0, k - 6); q <= Math.min(m - 1, k + 6); q++) { const w = Math.exp(-(((q - k) / 6) ** 2) * 3); t += hug[q] * w; c += w; } return t / c; }); // Joins and leaves the bundle over a few km
            result.set(`${r.i}:${n}`, { local: true, pts, dirs, hug: eased, side, cands });
        }));

        return result;
    }

    static fit(lay, parts, s, ctx) { // A commuter line at one zoom: its own track, or (where it shares Amtrak's) just outside the lines it runs beside, as drawn now
        const { pts, dirs, hug, side, cands } = lay, m = pts.length, unit = Lanes.GAP * Lanes.K(s, ctx.home), clear = unit * .85 / s, radius = Math.min(ctx.radius / s, .75); // (Station zone capped at a few km: zoomed out, a dot-sized zone would bend every line for 100+ km around a city)
        const want = new Float32Array(m);
        pts.forEach((p, k) => {
            if (!hug[k] || !side[k]) return;
            const nx = -dirs[k][1] * side[k], ny = dirs[k][0] * side[k];
            let edge = -Infinity;
            for (const [i, n, j, x, y] of cands[k]) { const q = parts[i]?.[n]?.[j] && lay.shared(i, n) ? parts[i][n][j] : [x, y]; edge = Math.max(edge, (q[0] - p[0]) * nx + (q[1] - p[1]) * ny); }
            if (edge > -Infinity) want[k] = (edge + clear) * hug[k] * side[k]; // (Along its left normal: + left, - right)
        });

        const offs = want.map((_, k) => { let t = 0, c = 0; for (let q = Math.max(0, k - 4); q <= Math.min(m - 1, k + 4); q++) { const w = Math.exp(-(((q - k) / 4) ** 2) * 3); t += want[q] * w; c += w; } return t / c; }); // (Smoothed over the same stretch of track at any zoom)
        const stops = ctx.majors.filter(q => pts.some(p => Math.abs(p[0] - q[0]) < 3 && Math.abs(p[1] - q[1]) < 3)).map(q => { // Big stations it calls at (passes within a few km of): it runs through their dot, like Amtrak's lines
            const by = pts.reduce((a, p) => Math.min(a, dist(p, q)), Infinity), g = Math.min(1, Math.max(0, (3 - by) / 1.5));
            return [q, g * g * (3 - 2 * g)];
        }).filter(([, g]) => g > 0);
        return pts.map((p, k) => {
            const near = ctx.majors.reduce((a, q) => Math.min(a, dist(p, q)), Infinity), f0 = Math.min(1, Math.max(0, (near - radius * .8) / (radius * 3.2))), o = offs[k] * f0 * f0 * (3 - 2 * f0);
            let x = p[0] - dirs[k][1] * o, y = p[1] + dirs[k][0] * o;
            for (const [q, g] of stops) { const h = Math.min(1, Math.max(0, (dist(p, q) - radius * .3) / (radius * 3.7))), pull = (1 - h * h * (3 - 2 * h)) * g; x += (q[0] - x) * pull; y += (q[1] - y) * pull; }
            return [x, y];
        });
    }

    static K(s, home) { // Line width and spacing factor: lines slim down as the map zooms out toward the whole country
        const t = Math.min(1, Math.max(0, Math.log(s / home / .2) / Math.log(5)));
        return .55 + .45 * t * t * (3 - 2 * t);
    }

    static at(b, k, s, radius, home) { // Point k of a laid-out line at scale s (map units)
        const i = k * 10, K = Lanes.K(s, home), unit = Lanes.GAP * K, half = b[i + 6] * unit, pack = half * 2 > Lanes.BUNDLE * K ? Lanes.BUNDLE * K / (half * 2) : 1; // Lane spacing (px); busy bundles pack in
        const fit = half * pack > radius * .55 ? radius * .55 / (half * pack) : 1, end = b[i + 7], near = b[i + 8] * s; // Bundle fits the station dot
        const f0 = Math.min(1, Math.max(0, (near - radius * .8) / (radius * 3.2))), f = f0 * f0 * (3 - 2 * f0); // Zero at a major station, 1 away from it
        const calm = b[i + 9] * Math.min(1, near / (radius * 2)) * Math.min(1, end * 2); // Bundles follow a smoothed track, not at big stations or the ends (dots go onto their lines: map.snapPins)
        const taper = fit + (1 - fit) * f, o = unit * pack * taper / s; // (A line ending in a bundle keeps its lane to its last stop: no tail curling in to the middle)
        return [b[i] + (b[i + 2] - b[i]) * calm + b[i + 4] * o, b[i + 1] + (b[i + 3] - b[i + 1]) * calm + b[i + 5] * o];
    }
}

const layouts = new Map(); // Lane layouts worked out, by routes shown and big stations (one per era and types: zooms reuse them)
const sampled = new Map(); // Each zoom's lines as points every 5px, by geometry key: density grids for any view (gridJob)
const drawn = new Map(); // Each zoom's laid-out lines, by geometry key (backdropJob)

function geometryJob({ routes, laid, s, ctx, key: gkey }) { // One zoom's lines and path data (runs on the background thread; a drag at the same zoom needs none)
    const key = laid.join() + '|' + ctx.majors.map(q => q.join()).join(';');
    let laidMs = 0; // (Time laying the lanes out, when this view needed it: for the ?perf report)
    if (!layouts.has(key)) { const t = performance.now(); layouts.set(key, Lanes.layout(laid.map(i => routes[i]), ctx.majors)); laidMs = performance.now() - t; if (layouts.size > 6) layouts.delete(layouts.keys().next().value); }
    const laidOut = layouts.get(key);
    const spreads = routes.map(r => r.runs.map((_, n) => { const b = laidOut.get(`${r.i}:${n}`); return b && !b.local ? b : null; }));
    const parts = routes.map((r, i) => r.lane === Lanes.EDGE ? [] : r.runs.map((run, n) => { const b = spreads[i][n]; return b ? Array.from({ length: b.length / 10 }, (_, k) => Lanes.at(b, k, s, ctx.radius, ctx.home)) : run; }));
    const shared = (i, n) => !!spreads[i]?.[n];
    for (const i of laid) if (routes[i].lane === Lanes.EDGE) parts[i] = routes[i].runs.map((_, n) => { // Commuter lines: beside Amtrak's, as drawn at this zoom (no lane spread: a mid-zoom respace leaves them be)
        const lay = laidOut.get(`${i}:${n}`);
        spreads[i][n] = null;
        return lay ? Lanes.fit({ ...lay, shared }, parts, s, ctx) : routes[i].runs[n];
    });

    const kept = parts.map(pr => pr.map(pts => { const at = new Map(pts.map((p, k) => [p, k])); return simplify(pts, .3 / s).map(p => at.get(p)); })); // Sub-pixel detail dropped: fewer points to draw
    const d = parts.map((pr, i) => pr.map((pts, n) => pathOf(kept[i][n].map(k => pts[k]))));
    const spread = spreads.map((sr, i) => sr.map((b, n) => b ? Float32Array.from(kept[i][n].flatMap(k => [...b.subarray(k * 10, k * 10 + 10)])) : null)); // For respacing mid-zoom (map.respace)
    sampled.set(gkey, laid.flatMap(i => parts[i].flatMap(pts => resample(simplify(pts, 1 / s), 5 / s)))); // (Every 5px)
    drawn.set(gkey, parts);
    if (sampled.size > 4) sampled.delete(sampled.keys().next().value);
    if (drawn.size > 4) drawn.delete(drawn.keys().next().value);
    const flat = parts.map(pr => pr.map(pts => Float32Array.from(pts.flat()))); // Flat numbers: handed over without copying (lanesThread)
    return { parts: flat, d, spread, radius: ctx.radius, home: ctx.home, laidMs };
}

function gridJob(job, routes) { // Line density on screen (10px cells) for one view, for placing station names
    if (!sampled.has(job.key)) geometryJob({ ...job, routes });
    const { x0, y0, vw, vh } = job.view, s = job.s, grid = new Map();
    for (const p of sampled.get(job.key)) {
        if (p[0] <= x0 || p[1] <= y0 || p[0] >= x0 + vw || p[1] >= y0 + vh) continue;
        const k = Math.floor((p[0] - x0) * s / 10) * 4096 + Math.floor((p[1] - y0) * s / 10);
        grid.set(k, (grid.get(k) || 0) + 1);
    }

    return { grid: [...grid] };
}

function backdropJob(job, routes) { // Softer picture of the lines a screen past each edge: a drag shows it at the edges yet
    if (typeof OffscreenCanvas === 'undefined') return { bitmap: null };
    if (!drawn.has(job.key)) geometryJob({ ...job, routes });
    const parts = drawn.get(job.key), { x0, y0, vw, vh } = job.area, q = job.scale, W = Math.round(vw * q), H = Math.round(vh * q);
    const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d', { willReadFrequently: true }); // (Drawn by this thread, not the graphics card)
    g.lineCap = g.lineJoin = 'round';
    const paths = new Map(), path = (i, n) => { // Each run once, in the picture's pixels
        const k = i + ':' + n;
        if (!paths.has(k)) {
            const pts = parts[i][n], p = new Path2D();
            let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
            simplify(pts, 1 / q).forEach((pt, m) => { const x = (pt[0] - x0) * q, y = (pt[1] - y0) * q; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); m ? p.lineTo(x, y) : p.moveTo(x, y); });
            paths.set(k, bx1 < -20 || by1 < -20 || bx0 > W + 20 || by0 > H + 20 ? null : p); // Off the picture: skipped
        }

        return paths.get(k);
    };

    for (const layer of ['casing', 'line']) for (const r of job.lines) { // Casings under every line, as on the map
        g.globalAlpha = r.alpha * (layer === 'casing' ? .9 : 1);
        g.strokeStyle = layer === 'casing' ? job.deep : r.color;
        g.lineWidth = job.px * r.w * (layer === 'casing' ? (r.on ? 10 : 7.5) : (r.on ? 6.5 : 5));
        parts[r.i].forEach((_, n) => { const p = path(r.i, n); if (p) g.stroke(p); });
    }

    return { bitmap: canvas.transferToImageBitmap() };
}

const handOver = out => [...(out.parts || []).flat(), ...(out.spread || []).flat(), out.bitmap].filter(Boolean).map(a => a.buffer || a); // Number arrays and pictures move to the page, not copied

const work = (job, routes) => { const t = performance.now(), out = job.kind === 'grid' ? gridJob(job, routes) : job.kind === 'backdrop' ? backdropJob(job, routes) : geometryJob({ ...job, routes }); out.ms = performance.now() - t; return out; }; // One job, of any kind (timed, for ?perf)

const lanesThread = { // Route geometry off the main thread, so zooming and panning never freeze while it's worked out
    seq: 0,
    waiting: new Map(), // Job -> its resolver
    start(routes) { // Hand over the routes once
        this.routes = routes.map(r => ({ i: r.i, lane: r.lane, w: r.w, runs: r.runs, xy: r.xy }));
        const src = [dist, dot, segDist, simplify, resample, spans, pathOf, work, handOver].map(f => `const ${f.name} = ${f};`).join('\n') + `\n${Lanes}\n${geometryJob}\n${gridJob}\n${backdropJob}\n` +
            'const layouts = new Map(), sampled = new Map(), drawn = new Map(); let routes; onmessage = ({ data }) => { if (data.routes) routes = data.routes; else { const out = work(data, routes); postMessage({ id: data.id, ...out }, handOver(out)); } };';
        try { this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); } catch { this.worker = null; }
        this.worker?.addEventListener('message', ({ data }) => { this.waiting.get(data.id)?.(data); this.waiting.delete(data.id); });
        this.worker?.addEventListener('error', e => { e.preventDefault(); console.warn('Route layout thread failed; working on the page instead.'); this.worker = null; this.waiting.forEach((done, id) => done(null)); });
        this.worker?.postMessage({ routes: this.routes });
    },

    run(job) { // Promise of the job's result
        if (!this.worker) return Promise.resolve(job.kind === 'backdrop' ? { bitmap: null } : work(job, this.routes)); // (No backdrop without the thread: drawing it here would stall the page)
        const id = ++this.seq;
        return new Promise(done => { this.waiting.set(id, data => done(data || work(job, this.routes))); this.worker.postMessage({ id, ...job }); });
    }
};
