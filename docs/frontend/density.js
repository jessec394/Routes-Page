// Population-density relief of a route's states, drawn in a background worker (driven by Density in map.js)
// Census tracts rise by density (taller = denser) with soft shadows on their sides; the route rides above them
// Messages in: load (fetch a state) and draw (a view of the picture). Shapes are kept between draws.

const NAVY = [13, 35, 68], WHITE = [255, 255, 255]; // Low to high density
const GAMMA = .35; // Density -> height curve (low densities rise faster)
const SHADOW = 'rgb(2 5 10 / .12)'; // Side shading, one layer per height step
const RED = '#b72717', WALL = '#3d0804'; // Route top and its side
const states = {}; // State id -> promise of { border, tracts: [{ density, people, h, band, color, path, box }] } in map units
const floors = {}; // Route key -> its height above the ground (0..1)
const probe = new OffscreenCanvas(1, 1).getContext('2d'); // For point-in-tract tests in map units

const pathOf = rings => { const p = new Path2D(); rings.forEach(r => { p.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]); p.closePath(); }); return p; };

function load({ id, url, rings, proj: { cLon, cLat, k }, vmax }) { // Fetch and shape a state once
    return states[id] ??= fetch(url).then(r => r.json()).then(({ tracts }) => ({
        border: pathOf(rings.map(r => r.flat())),
        tracts: tracts.map(([density, people, ...parts]) => {
            const rings = parts.map(flat => { // Packed ring (1/10000 deg steps) -> map units
                const out = new Float64Array(flat.length);
                for (let i = 0, lon = 0, lat = 0; i < flat.length; i += 2) {
                    lon += flat[i];
                    lat += flat[i + 1];
                    out[i] = (lon / 1e4 - cLon) * k * 100;
                    out[i + 1] = (cLat - lat / 1e4) * 100;
                }

                return out;
            });

            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            rings.forEach(r => { for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } });
            const h = Math.min(1, density / (vmax || 1)) ** GAMMA, c = NAVY.map((v, n) => Math.round(v + (WHITE[n] - v) * h));
            return { density, people, h, band: Math.min(9, Math.floor(h * 10)), color: `rgb(${c})`, path: pathOf(rings), box: [x0, y0, x1, y1] };
        })
    }));
}

function floorOf(key, tracts, routes) { // Average height of the tracts under a route
    if (floors[key] === undefined) {
        const heights = [];
        routes.forEach(run => run.forEach((p, n) => {
            if (n % 3) return;
            const t = tracts.find(t => p[0] >= t.box[0] && p[0] <= t.box[2] && p[1] >= t.box[1] && p[1] <= t.box[3] && probe.isPointInPath(t.path, p[0], p[1], 'evenodd'));
            if (t) heights.push(t.h);
        }));
        floors[key] = heights.length ? heights.reduce((a, b) => a + b) / heights.length : 0;
    }

    return floors[key];
}

async function draw({ key, seq, list, routes, stops, view, width, height, lift, inset, line }) { // One view of the picture
    const loaded = await Promise.all(list.map(load)), tracts = loaded.flatMap(s => s.tracts), [vx0, vy0, vx1, vy1] = view;
    const s = width / (vx1 - vx0), canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true }); // CPU drawing: leaves the GPU to the video
    const at = rise => ctx.setTransform(s, 0, 0, s, (rise * lift - vx0) * s, (rise * lift - vy0) * s); // Map units -> pixels, raised by `rise`
    const seen = tracts.filter(t => t.box[2] + lift >= vx0 && t.box[0] <= vx1 && t.box[3] + lift >= vy0 && t.box[1] <= vy1); // In or rising into the view
    at(0);
    ctx.fillStyle = `rgb(${NAVY})`;
    loaded.forEach(st => ctx.fill(st.border, 'evenodd')); // Ground
    ctx.fillStyle = SHADOW;
    for (let tier = .1; tier < .95; tier += .2) { at(tier); seen.forEach(t => t.h >= tier && ctx.fill(t.path, 'evenodd')); } // Sides of raised tracts
    for (let band = 0; band < 10; band++) { // Tracts in ten height bands, the tallest drawn last
        at(band / 10);
        seen.forEach(t => { if (t.band === band) { ctx.fillStyle = t.color; ctx.fill(t.path, 'evenodd'); } });
    }

    at(0);
    ctx.globalCompositeOperation = 'destination-out'; // Inset from each border
    ctx.lineWidth = Math.max(1.5 / s, 2 * inset);
    ctx.lineJoin = 'round';
    loaded.forEach(st => ctx.stroke(st.border));
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgb(255 255 255 / .22)'; // Faint outline
    ctx.lineWidth = 1 / s;
    loaded.forEach(st => ctx.stroke(st.border));

    // The route rides at the average height of the tracts it crosses, on a short wall; stations sit on top
    const floor = floorOf(key, tracts, routes) * lift, peak = floor + .11 * lift + 1.5 / s;
    const trace = (rise, color, w, alpha = 1) => {
        at(0);
        Object.assign(ctx, { strokeStyle: color, lineWidth: w / s, globalAlpha: alpha, lineJoin: 'round', lineCap: 'round' });
        ctx.translate(rise, rise);
        routes.forEach(run => { ctx.beginPath(); run.forEach((p, n) => n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); });
        ctx.globalAlpha = 1;
    };

    trace(peak * .3, '#000', line * 2.2, .25); // Shadow on the ground
    for (let n = 0; n <= 4; n++) trace(floor + (peak - floor) * n / 4, WALL, line * 1.6); // Wall
    trace(peak, RED, line); // Top
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    stops.forEach(({ x, y, r }) => { // Station dots
        ctx.beginPath();
        ctx.arc((x + peak - vx0) * s, (y + peak - vy0) * s, r, 0, Math.PI * 2);
        Object.assign(ctx, { fillStyle: '#fff', strokeStyle: `rgb(${NAVY})`, lineWidth: Math.max(1, r * .4) });
        ctx.fill();
        ctx.stroke();
    });

    const bitmap = canvas.transferToImageBitmap();
    postMessage({ type: 'drawn', key, seq, view, peak, bitmap }, [bitmap]);
}

onmessage = ({ data }) => {
    const job = { load, draw }[data.type];
    Promise.resolve(job?.(data)).catch(e => postMessage({ type: 'error', key: data.key, seq: data.seq, error: String(e) }));
};
