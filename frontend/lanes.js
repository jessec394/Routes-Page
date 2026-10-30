// Side-by-side lanes (worked out on a background thread: lanesThread, below)
class Lanes {
    static SPAN = 16; // Smoothing window (points each side)
    static WEIGHTS = Array.from({ length: 2 * Lanes.SPAN + 1 }, (_, i) => Math.exp(-((i - Lanes.SPAN) ** 2) / 72)); // Gaussian smoothing weights
    static EVEN = Array.from({ length: 2 * Lanes.SPAN + 1 }, (_, i) => Math.exp(-((i - Lanes.SPAN) ** 2) / 32)); // Narrower: smooths a bundle's track

    static GAP = 6.5; // Lane spacing (px at full size)
    static BUNDLE = 26; // Widest a bundle gets (px): busier corridors pack their lanes closer instead of spreading wider
    static ALONG = 2; // A commuter line this near an Amtrak line (map units, about km) shares its track: drawn hugging the bundle
    static N = 12; // Numbers per laid-out point: spot, smoothed bundle middle, offset, half-width, end, nearest big station's distance, share, and that station (x, y)
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
                spans(arr, (k, e) => { // A line ending (or starting) alongside: its lane is kept a little past its end, so the line carrying on doesn't drift into it before the last stop (it closes up after)
                    const last = o => !o.held && (o.k === 0 || o.k === runs.get(o.key).pts.length - 1) && !majors.some(m => dist(runs.get(o.key).pts[o.k], m) < 10); // (Not a lane already held: that would carry it on and on; nor a line ending at a big station: lines meet in its dot, and a held lane there would leave a gap in the lines going on)
                    const gap = j => { const q = runs.get(arr[j].key).pts[arr[j].k]; return [q[0] - run.pts[j][0], q[1] - run.pts[j][1]]; }; // (Where it sat beside this line: held there, carried along)
                    if (last(arr[e])) { const g = gap(e); for (let q = e + 1; q < Math.min(arr.length, e + 13) && !arr[q]; q++) arr[q] = { ...arr[e], held: g }; }
                    if (last(arr[k])) { const g = gap(k); for (let q = k - 1; q >= Math.max(0, k - 12) && !arr[q]; q--) arr[q] = { ...arr[k], held: g }; }
                });
                spans(arr, (k, e) => { // Lines that only meet as they reach a big station (within 8 km of it) aren't bundled: each comes into the dot its own way, no lanes swapping places just before it
                    for (let q = k; q <= e; q++) if (!majors.some(m => dist(run.pts[q], m) < 8)) return;
                    arr.fill(null, k, e + 1);
                });
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
                let cx = 0, cy = 0, cn = 0; // The bundle's middle: where its lines' own tracks average out (the same for each of them; a lane only held past a line's end has no track here)
                at.forEach(a => { const q = runs.get(a.key).pts[a.k]; cx += q[0]; cy += q[1]; cn++; }); // (A held lane counts where its line ended: the bundle's middle doesn't slide off before the stop)
                return [-refDir[1] * off, refDir[0] * off, pos / 2, cx / cn, cy / cn];
            });

            const n = shifts.length;
            if (!shifts.some(sh => sh[2]) && (lanesOf.get(run.r) || 0) < 2) return; // Not shared with anything: drawn as it is
            const spread = new Float32Array(n * Lanes.N); // Per point: see Lanes.N
            run.pts.forEach((p, k) => {
                let ox = 0, oy = 0, half = 0, c = 0, sx = 0, sy = 0, sw = 0, shared = 0;
                for (let m = Math.max(0, k - SPAN); m <= Math.min(n - 1, k + SPAN); m++) {
                    const w = WEIGHTS[m - k + SPAN], v = Lanes.EVEN[m - k + SPAN];
                    ox += shifts[m][0] * w; oy += shifts[m][1] * w; half += shifts[m][2] * w; c += w;
                    sx += shifts[m][3] * v; sy += shifts[m][4] * v; sw += v; shared += (shifts[m][2] > 0) * w;
                }

                const end = Math.min(1, k / 8, (n - 1 - k) / 8), big = Lanes.nearest(p, majors); // Near its ends; nearest major station
                spread.set([p[0], p[1], sx / sw, sy / sw, ox / c, oy / c, half / c, end, big.d, shared / c, big.x, big.y], k * Lanes.N);
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

                if (best) mine.set(result.get(best.key).subarray(best.k * Lanes.N, (best.k + 1) * Lanes.N), k * Lanes.N);
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
                    const b = result.get(o.key), at = o.k * Lanes.N;
                    cands[k].push(b && !b.local ? [b[at + 9] > .5 ? b[at + 2] : b[at], b[at + 9] > .5 ? b[at + 3] : b[at + 1], b[at + 4], b[at + 5], b[at + 6]] : [o.q[0], o.q[1], 0, 0, 0]); // Where its bundle runs (real), its lane's offset and the bundle's half-width (lane units)
                });

                const f = Math.min(1, Math.max(0, (ALONG * 1.5 - closest) / ALONG));
                hug[k] = f * f * (3 - 2 * f);
            });

            const side = new Int8Array(m), count = cands.map(c => c.length), at = k => lean[k] / count[k]; // Which side it hugs: per stretch alongside Amtrak, the side its track mostly runs on (the very same track: its own left)...
            for (let k = 0; k < m;) {
                if (!count[k]) { k++; continue; }
                let e = k, t = 0;
                for (let q = k + 1; q < m && q - e <= 8; q++) if (count[q]) e = q;
                for (let q = k; q <= e; q++) if (count[q]) t += at(q) * hug[q];
                let held = t > .5 ? -1 : 1;
                for (let q = k; q <= e; q++) { // ...switching only where its track clearly crosses to the other side (over a km off, for 8 km or more)
                    if (count[q] && Math.abs(at(q)) > 1 && (at(q) > 0 ? -1 : 1) !== held) { let r = q; while (r <= e && (!count[r] || (Math.abs(at(r)) > 1 && (at(r) > 0 ? -1 : 1) !== held))) r++; if (r - q >= 16) held = -held; }
                    side[q] = held;
                }

                k = e + 1;
            }

            for (let k = 0; k < m;) { // Any run shorter than 6 km takes its neighbours' side
                let e = k;
                while (e + 1 < m && side[e + 1] === side[k]) e++;
                if (side[k] && e - k + 1 < 12) { const before = k > 0 ? side[k - 1] : 0, after = e + 1 < m ? side[e + 1] : 0, to = before || after; if (to) side.fill(to, k, e + 1); }
                k = e + 1;
            }

            for (let k = 1; k < m; k++) if (!count[k] && side[k - 1]) { // Short gaps (4 km) keep beside the same lines
                let e = k;
                while (e < m && !count[e]) e++;
                if (e < m && e - k <= 8) for (let q = k; q < e; q++) { side[q] = side[k - 1]; cands[q] = cands[k - 1]; }
                k = e;
            }

            const real = new Float32Array(m), lane = new Float32Array(m), half = new Float32Array(m); // Shift to the bundle's outer lane: the real part (map units) and the lanes' part (lane units, so it scales with the zoom as Amtrak's lanes do)
            pts.forEach((p, k) => {
                if (!side[k] || !cands[k].length) return;
                const nx = -dirs[k][1] * side[k], ny = dirs[k][0] * side[k];
                let r = -Infinity, l = -Infinity, h = 0;
                for (const [x, y, ox, oy, w] of cands[k]) { r = Math.max(r, (x - p[0]) * nx + (y - p[1]) * ny); l = Math.max(l, ox * nx + oy * ny); h = Math.max(h, w); }
                real[k] = r * side[k]; lane[k] = (l + .85) * side[k]; half[k] = h;
            });

            const ease = (v, w) => v.map((_, k) => { let t = 0, c = 0; for (let q = Math.max(0, k - w); q <= Math.min(m - 1, k + w); q++) { const g = Math.exp(-(((q - k) / w) ** 2) * 3); t += v[q] * g; c += g; } return t / c; }); // (Over the same stretch of track at any zoom)
            const hugged = ease(hug, 10), A = ease(ease(real.map((v, k) => v * hug[k]), 10), 10), B = ease(ease(lane.map((v, k) => v * hug[k]), 10), 10), H = ease(half, 10); // (Smoothed twice: the bundle's edge wobbles as lines join and leave it, the commuter line beside it doesn't) // (Eased over about 5 km: joining, leaving or swapping bundles glides, never steps)
            const stops = majors.map(q => [q, pts.reduce((a, p) => Math.min(a, dist(p, q)), Infinity)]).filter(([, by]) => by < 3).map(([q, by]) => { const g = Math.min(1, (3 - by) / 1.5); return [q, g * g * (3 - 2 * g)]; }); // Big stations it calls at (passes within a few km of): it runs into their dot, like Amtrak's lines
            const out = new Float32Array(m * Lanes.N);
            pts.forEach((p, k) => {
                const by = stops.reduce((t, [q]) => Math.min(t, dist(p, q)), Infinity), h0 = Math.min(1, Math.max(0, (by - 1) / 3)), fade = h0 * h0 * (3 - 2 * h0); // Into a big station it calls at, it lets go of the bundle (over the last 4 km): straight into the dot, never wrapped round it
                const nx = -dirs[k][1], ny = dirs[k][0], a = A[k] * (hugged[k] > 0 ? 1 : 0) * fade;
                B[k] *= fade;
                let x = p[0] + nx * a, y = p[1] + ny * a;
                for (const [q, g] of stops) { const h = Math.min(1, dist(p, q) / 2), pull = (1 - h * h * (3 - 2 * h)) * g; x += (q[0] - x) * pull; y += (q[1] - y) * pull; } // (Within 2 km)
                const big = Lanes.nearest([x, y], majors);
                out.set([x, y, x, y, nx * B[k], ny * B[k], H[k], 1, big.d, 0, big.x, big.y], k * Lanes.N); // A lane spread like Amtrak's (Lanes.at draws it at any zoom, mid-zoom too)
            });

            result.set(`${r.i}:${n}`, out);
        }));

        return result;
    }

    static K(s, home) { // Line width and spacing factor: lines slim down as the map zooms out toward the whole country
        const t = Math.min(1, Math.max(0, Math.log(s / home / .2) / Math.log(5)));
        return .55 + .45 * t * t * (3 - 2 * t);
    }

    static at(b, k, s, radius, home) { // Point k of a laid-out line at scale s (map units)
        const i = k * Lanes.N, K = Lanes.K(s, home), unit = Lanes.GAP * K, half = b[i + 6] * unit, pack = half * 2 > Lanes.BUNDLE * K ? Lanes.BUNDLE * K / (half * 2) : 1; // Lane spacing (px); busy bundles pack in
        const fit = half * pack > radius * .55 ? radius * .55 / (half * pack) : 1, end = b[i + 7], near = b[i + 8] * s; // Bundle fits the station dot
        const f0 = Math.min(1, Math.max(0, (near - radius * .8) / (radius * 3.2))), f = f0 * f0 * (3 - 2 * f0); // Zero at a major station, 1 away from it
        const calm = b[i + 9]; // Bundles follow a smoothed track all the way, ends too (a line ending in a bundle keeps its lane to its last stop, its dot over both: map.snapPins), and into big stations (each bundle narrows evenly into the dot: no lines crossing on the way)
        const taper = fit + (1 - fit) * f, o = unit * pack * taper / s;
        let mx = b[i + 2] - b[i], my = b[i + 3] - b[i + 1]; // Toward the smoothed track
        const tip = 1 - Math.min(1, b[i + 7] * 2); // Near a line's end the smoothed track falls short of it: only its sideways part counts there (the line stays in its bundle's lane, right to its last stop)
        if (tip > 0) { const N = Lanes.N, a = Math.max(0, k - 3) * N, c = Math.min(b.length / N - 1, k + 1) * N, dx = b[c + 2] - b[a + 2], dy = b[c + 3] - b[a + 3], l = Math.hypot(dx, dy) || 1, along = (mx * dx + my * dy) / l; mx -= dx / l * along * tip; my -= dy / l * along * tip; }
        const x = b[i] + mx * calm + b[i + 4] * o, y = b[i + 1] + my * calm + b[i + 5] * o;
        const g = Math.min(1, Math.max(0, (3 - b[i + 8]) / 1.5)), h0 = Math.min(1, Math.max(0, (near - radius * .3) / (radius * 3.7))), pull = g * (1 - h0 * h0 * (3 - 2 * h0)); // Lines reaching a big station (within a few km) run into its dot's centre, from wherever they come (no swapping places beside it)
        return pull ? [x + (b[i + 10] - x) * pull, y + (b[i + 11] - y) * pull] : [x, y];
    }

    static nearest(p, majors) { // Nearest big station to a point: its distance (capped) and spot
        let d = 1e6, x = 0, y = 0;
        for (const q of majors) { const e = dist(p, q); if (e < d) { d = e; x = q[0]; y = q[1]; } }
        return { d, x, y };
    }
}

const layouts = new Map(); // Lane layouts worked out, by routes shown and big stations (one per era and types: zooms reuse them)
const sampled = new Map(); // Each zoom's lines (sampled every 5px when first in view), by geometry key: density grids for any view (gridJob)
const drawn = new Map(); // Each zoom's laid-out lines, by geometry key (backdropJob)

function geometryJob({ routes, laid, s, ctx, key: gkey }) { // One zoom's lines and path data (runs on the background thread; a drag at the same zoom needs none)
    const key = laid.join() + '|' + ctx.majors.map(q => q.join()).join(';');
    let laidMs = 0; // (Time laying the lanes out, when this view needed it: for the ?perf report)
    if (!layouts.has(key)) { const t = performance.now(); layouts.set(key, Lanes.layout(laid.map(i => routes[i]), ctx.majors)); laidMs = performance.now() - t; if (layouts.size > 6) layouts.delete(layouts.keys().next().value); }
    const laidOut = layouts.get(key);
    const spreads = routes.map(r => r.runs.map((_, n) => laidOut.get(`${r.i}:${n}`) || null));
    const parts = routes.map((r, i) => r.runs.map((run, n) => { const b = spreads[i][n]; return b ? Array.from({ length: b.length / Lanes.N }, (_, k) => Lanes.at(b, k, s, ctx.radius, ctx.home)) : run; }));

    const kept = parts.map(pr => pr.map(pts => { const at = new Map(pts.map((p, k) => [p, k])); return simplify(pts, .3 / s).map(p => at.get(p)); })); // Sub-pixel detail dropped: fewer points to draw
    const d = parts.map((pr, i) => pr.map((pts, n) => pathOf(kept[i][n].map(k => pts[k]))));
    const spread = spreads.map((sr, i) => sr.map((b, n) => b ? Float32Array.from(kept[i][n].flatMap(k => [...b.subarray(k * Lanes.N, (k + 1) * Lanes.N)])) : null)); // For respacing mid-zoom (map.respace)
    sampled.set(gkey, { s, runs: laid.flatMap(i => parts[i]).map(pts => ({ pts, box: boxOf(pts), dots: null })) }); // (Each line sampled every 5px only once a view needs it)
    drawn.set(gkey, parts);
    if (sampled.size > 10) sampled.delete(sampled.keys().next().value);
    if (drawn.size > 10) drawn.delete(drawn.keys().next().value);
    const flat = parts.map(pr => pr.map(pts => Float32Array.from(pts.flat()))); // Flat numbers: handed over without copying (lanesThread)
    return { parts: flat, d, spread, radius: ctx.radius, home: ctx.home, laidMs };
}

const boxOf = pts => pts.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);

function partsIn(job, routes, { x0, y0, vw, vh }) { // A zoom's lines laid out afresh, only those crossing an area (others null): for a view whose lines are no longer kept here
    const { laid, ctx, s } = job, key = laid.join() + '|' + ctx.majors.map(q => q.join()).join(';'), pad = 40 / s, parts = [];
    if (!layouts.has(key)) layouts.set(key, Lanes.layout(laid.map(i => routes[i]), ctx.majors));
    const laidOut = layouts.get(key);
    for (const i of laid) parts[i] = routes[i].runs.map((run, n) => {
        const b = boxOf(run);
        if (!(b[2] > x0 - pad && b[0] < x0 + vw + pad && b[3] > y0 - pad && b[1] < y0 + vh + pad)) return null;
        const sp = laidOut.get(`${i}:${n}`);
        return sp ? Array.from({ length: sp.length / Lanes.N }, (_, k) => Lanes.at(sp, k, s, ctx.radius, ctx.home)) : run;
    });

    return parts;
}

function gridJob(job, routes) { // Line density on screen (10px cells) for one view, for placing station names
    const { x0, y0, vw, vh } = job.view, s = job.s, grid = new Map(), pad = 40 / s, inView = b => b[2] > x0 - pad && b[0] < x0 + vw + pad && b[3] > y0 - pad && b[1] < y0 + vh + pad;
    let lines = sampled.get(job.key), redone = 0;
    if (!lines) { // This zoom's lines are no longer kept here: lay out just the ones in view (not the whole map again)
        const t = performance.now();
        lines = { s, runs: partsIn(job, routes, job.view).flat().filter(Boolean).map(pts => ({ pts, box: boxOf(pts), dots: null })) };
        redone = performance.now() - t;
    }

    for (const run of lines.runs) if (inView(run.box)) for (const p of run.dots ??= resample(simplify(run.pts, 1 / lines.s), 5 / lines.s)) {
        if (p[0] <= x0 || p[1] <= y0 || p[0] >= x0 + vw || p[1] >= y0 + vh) continue;
        const k = Math.floor((p[0] - x0) * s / 10) * 4096 + Math.floor((p[1] - y0) * s / 10);
        grid.set(k, (grid.get(k) || 0) + 1);
    }

    return { grid: [...grid], redoneMs: redone };
}

function backdropJob(job, routes) { // Softer picture of the lines a screen past each edge: a drag shows it at the edges yet
    if (typeof OffscreenCanvas === 'undefined') return { bitmap: null };
    const t = performance.now(), parts = drawn.get(job.key) || partsIn(job, routes, job.area), redone = drawn.has(job.key) ? 0 : performance.now() - t; // (This zoom's lines no longer kept here: just the ones in the picture laid out again)
    const { x0, y0, vw, vh } = job.area, q = job.scale, W = Math.round(vw * q), H = Math.round(vh * q);
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
        (parts[r.i] || []).forEach((pts, n) => { const p = pts && path(r.i, n); if (p) g.stroke(p); });
    }

    return { bitmap: canvas.transferToImageBitmap(), redoneMs: redone };
}

const handOver = out => [...(out.parts || []).flat(), ...(out.spread || []).flat(), out.bitmap].filter(Boolean).map(a => a.buffer || a); // Number arrays and pictures move to the page, not copied

const work = (job, routes) => { const t = performance.now(), out = job.kind === 'grid' ? gridJob(job, routes) : job.kind === 'backdrop' ? backdropJob(job, routes) : geometryJob({ ...job, routes }); out.ms = performance.now() - t; return out; }; // One job, of any kind (timed, for ?perf)

const lanesThread = { // Route geometry off the main thread, so zooming and panning never freeze while it's worked out
    seq: 0,
    waiting: new Map(), // Job -> its resolver
    start(routes) { // Hand over the routes once
        this.routes = routes.map(r => ({ i: r.i, lane: r.lane, w: r.w, runs: r.runs, xy: r.xy }));
        const src = [dist, dot, segDist, simplify, resample, spans, pathOf, work, handOver].map(f => `const ${f.name} = ${f};`).join('\n') + `\n${Lanes}\nconst boxOf = ${boxOf};\n${partsIn}\n${geometryJob}\n${gridJob}\n${backdropJob}\n` +
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
