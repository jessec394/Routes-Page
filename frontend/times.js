// Train times today
const NOTE = '<p class="times-note">Amtrak only; excludes local transit and commuter trains</p>'; // What the count covers

class TrainTimes {
    load() { return this.data ??= getJSON('data/schedules.json').catch(() => null); } // None until the schedule is in data/gtfs

    at(name) { return (d => twinsOf(name).map(n => d.stations[n]).find(Boolean))(this.data); } // A station's times

    credit(d, plain) { // Where the times come from
        const s = d.source, span = s.from && s.to ? ` (${s.from} – ${s.to})` : '';
        return plain ? `Times: ${s.name} schedule${span}, via ${s.via}` : `Times: ${esc(s.name)} schedule${esc(span)}, via <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.via)}</a>`;
    }

    night(min, d) { const [a, b] = d.night.map(h => h * 60); return a < b ? min >= a && min < b : min >= a || min < b; } // Overnight
    window(d) { return `between ${clock(d.night[0] * 60)} and ${clock(d.night[1] * 60)}`; } // "between 12 AM and 7 AM"

    tag(era) { return era === 'today' ? '' : '<span class="times-now" title="The trains running now, not the routes planned above">Today</span>'; } // Full Buildout: these are today's trains

    none(era, seasonal) { return `<div class="station-times none-today"><p class="times-sum">${this.tag(era)}${seasonal ? 'No trains this week <small>seasonal stop</small>' : 'No passenger rail service'}</p></div>`; } // A station no train stops at today

    forStation(el, name, era) { // A station window
        if (!el || unbuilt(name)) return;
        this.load().then(d => {
            const s = d && twinsOf(name).map(n => d.stations[n]).find(Boolean);
            if (!s || !el.isConnected) return;
            el.innerHTML = `<p class="times-sum">${this.tag(era)}<b>${Math.round(s.weekly / 2)}</b> train${Math.round(s.weekly / 2) === 1 ? '' : 's'} a week <small>per direction</small></p>` + NOTE +
                '<div class="times-list scroller">' + s.routes.map(r => foldSection(esc(r.name), `<ul>${r.calls.map(c => `<li class="${this.night(c.min, d) ? 'night' : ''}"><span>${c.to.startsWith('From ') ? esc(c.to) : `To ${esc(c.to)}`}</span><em>${esc(c.days)}</em><b>${this.night(c.min, d) ? '<i aria-label="night">☾</i>' : ''}${esc(c.time)}</b></li>`).join('')}</ul>`, { key: `times:${r.name}`, shut: stationModal.shut, sect: 'times-route', tag: 'h5', level: 4 })).join('') +
                `<p class="times-credit">${this.credit(d)}. Local station time.</p></div>`; // The credit at the list's end: the room goes to the times
            el.hidden = false;
            fadeEdges(el);
        });
    }

    forRoute(el, r, era) { // A route card: its trains a week each way
        if (!el || era !== 'today') return;
        this.load().then(d => {
            const n = Math.round((d?.routes?.[r.label] || 0) / 2);
            if (!n || !el.isConnected) return;
            el.innerHTML = `<p class="times-sum"><b>${n}</b> train${n === 1 ? '' : 's'} a week <small>per direction</small></p>`;
            el.hidden = false;
        });
    }
}

const clock = minutes => { const h = Math.floor(minutes / 60) % 24, m = minutes % 60; return `${(h % 12) || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; }; // 360 -> "6 AM"