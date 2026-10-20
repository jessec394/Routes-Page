// Background video
const unload = v => { v.pause(); v.removeAttribute('src'); v.load(); }; // Stop a video and free its download
const swapClips = (out, into, sec, then) => { // Cross-fade between two videos; `then` once the old one is hidden
    if (into.currentTime > 0) into.currentTime = 0; // No needless seek
    play(into);
    into.classList.add('on');
    out.classList.remove('on');
    later(sec, () => { out.pause(); then(); });
};

class BackgroundVideo {
    static FADE = 1.5; // Cross-fade seconds
    vids = $$('.bg'); // The two background videos
    opened = this.vids[0].getAttribute('src'); // First clip, written into the page by serve.py
    clips = []; // Every playable clip (shared with the station window)
    order = []; // Queued clips, played first and in order
    held = false; // Paused by a window over the map
    off = false; // Switched off: a plain background instead
    started = false; cur = 0; fading = false; queued = null; rescue = false; // Player state
    bad = new Set(); bag = []; first = true; // Clips that failed; shuffle bag
    lastTime = -1; stuck = 0; frames = null; slow = 0; // Watchdog state
    onShowing = () => {}; // Called with each clip as it starts showing

    init() { // Load the clip list (in the page, else fetched) and start
        const v0 = this.vids[0], embedded = v0.dataset.clips && { clips: JSON.parse(v0.dataset.clips), ordered: +v0.dataset.ordered || 0 };
        (embedded ? Promise.resolve(embedded) : this.waitForClips()).then(q => this.start(q)).catch(e => console.warn(`Background clips not loaded: ${e}. Run serve.py.`));
    }

    waitForClips() { return getJSON('data/clips.json').then(q => q.clips.length ? q : wait(20000).then(() => this.waitForClips())); } // Poll clips.json until there are clips
    setQueue(q) { this.clips = q.clips; this.order = q.clips.slice(0, q.ordered); }
    nameOf(v) { return clipName(v.getAttribute('src')); }
    load(v, f) { v.preload = 'auto'; v.src = clipUrl(f); v.load(); } // Start loading a clip
    bufferedTo(v) { return v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0; } // End of the buffered range
    fullyBuffered(v) { return v.duration > 0 && this.bufferedTo(v) >= v.duration - .25; } // Whole clip downloaded
    ready(v) { return v.readyState >= 3 && this.bufferedTo(v) >= Math.min(v.duration || 8, 8); } // Enough buffered to cross-fade
    ahead(v) { // Seconds buffered past the playhead
        for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + .1 && v.buffered.end(i) > v.currentTime) return v.buffered.end(i) - v.currentTime;
        return 0;
    }

    setOff(off) { // Footage off (a plain background) or back on (each visit starts with it on)
        this.off = off;
        document.body.classList.toggle('plain', off);
        if (off) this.vids.forEach(v => v.pause());
        else if (!this.held) this.resume();
    }

    lite(level) { // Reduce map effects when video drops frames
        document.body.dataset.lite = level;
        console.info(`Background video was dropping frames, so map effects were reduced (level ${level}).`);
    }

    next() { // Next clip: queued ones in order, then the rest shuffled
        const files = this.clips, order = this.order;
        if (!this.bag.length) {
            if (files.every(f => this.bad.has(f))) this.bad.clear();
            const pool = files.filter(f => !this.bad.has(f) && !(this.first && f === this.opener)), rest = pool.filter(f => !order.includes(f));
            for (let i = rest.length - 1; i > 0; i--) { const k = Math.random() * (i + 1) | 0; [rest[i], rest[k]] = [rest[k], rest[i]]; }
            this.bag = [...order.filter(f => pool.includes(f)), ...rest];
            this.first = false;
            if (!this.bag.length) this.bag = [...files];
        }

        const k = order.includes(this.bag[0]) ? 0 : this.bag.findIndex(f => f !== this.last && folderOf(f) !== folderOf(this.last));
        return this.last = this.bag.splice(Math.max(0, k), 1)[0];
    }

    start(queue) {
        this.setQueue(queue);
        const v0 = this.vids[0], files = this.clips;
        this.opener = this.last = this.opened ? clipName(this.opened) : this.order[0] || files[Math.random() * files.length | 0];
        this.vids.forEach(v => {
            v.loop = true;
            v.addEventListener('timeupdate', () => v === this.vids[this.cur] && v.duration - v.currentTime <= BackgroundVideo.FADE + .3 && this.transitionClip());
            v.addEventListener('error', () => { // One pending retry per element
                if (!v.getAttribute('src') || v._retry) return;
                this.bad.add(this.nameOf(v));
                if (this.clips.every(f => this.bad.has(f))) return; // None of them play here: stop trying (no endless reloading)
                const visible = v === this.vids[this.cur];
                v._retry = setTimeout(() => { v._retry = null; visible ? this.load(v, this.next()) : this.queued = v; }, visible ? 0 : 3000);
            });
        });

        setInterval(() => this.watchdog(), 1000);
        document.addEventListener('visibilitychange', () => document.hidden ? this.vids.forEach(v => v.pause()) : this.started && !this.held && !this.off && play(this.vids[this.cur]));

        // First clip waits (dark) until the draw-in is done; 20 s cap
        if (!this.opened) this.load(v0, this.opener);
        v0.removeAttribute('autoplay');
        v0.pause();
        v0.addEventListener('playing', () => {
            v0.classList.add('on');
            document.body.classList.add('playing');
            this.onShowing(this.nameOf(v0));
        }, { once: true });

        const begin = () => { if (this.started) return; this.started = true; if (!document.hidden && !this.off) play(v0); }; // Start playback (once)
        introFinished.then(begin);
        setTimeout(begin, 20000);
        this.queued = this.vids[1];
    }

    transitionClip(force) { // Cross-fade to the next video
        const out = this.vids[this.cur], into = this.vids[1 - this.cur];
        if (this.fading || !into.getAttribute('src') || !(this.ready(into) || (force === true && into.readyState >= 3))) return;
        this.fading = true;
        this.rescue = false;
        this.cur = 1 - this.cur;
        this.onShowing(this.nameOf(into));
        swapClips(out, into, BackgroundVideo.FADE, () => { unload(out); this.fading = false; this.queued = out; });
    }

    watchdog() { // Start the queued download, detect dropped frames and stalls
        const v = this.vids[this.cur], into = this.vids[1 - this.cur];
        if (!this.started || this.held || this.off || document.hidden || this.fading || !v.getAttribute('src')) return;
        if (this.queued && !this.queued.getAttribute('src') && (this.fullyBuffered(v) || v.networkState === v.NETWORK_IDLE || v.duration - v.currentTime < 12)) {
            this.load(this.queued, this.next());
            this.queued = null;
        }

        const q = v.getVideoPlaybackQuality?.();
        if (q && this.frames?.v === v && v.readyState >= 3 && v.currentTime !== this.lastTime) {
            const total = q.totalVideoFrames - this.frames.total, dropped = q.droppedVideoFrames - this.frames.dropped;
            this.slow = total >= 10 && dropped / total > .3 ? this.slow + 1 : 0; // Share of frames dropped
        } else this.slow = 0;
        this.frames = q && { v, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
        this.stuck = v.currentTime === this.lastTime ? this.stuck + 1 : 0;
        this.lastTime = v.currentTime;
        if (this.slow >= 3) {
            this.slow = 0;
            const level = +(document.body.dataset.lite || 0);
            if (level < 1) this.lite(1);
        }

        if (v.paused && v.readyState >= 3) play(v);
        if (this.rescue && into.readyState >= 3) return this.transitionClip(true);
        const decodeStall = this.ahead(v) > 1; // Frozen with video buffered: decoder, not network
        if (decodeStall && this.stuck === 2) v.currentTime = v.currentTime; // Seek in place restarts the decoder
        if (this.stuck < (decodeStall ? 5 : 15)) return;
        this.stuck = 0;
        this.bad.add(this.nameOf(v));
        if (into.getAttribute('src') && into.readyState >= 3 && !this.bad.has(this.nameOf(into))) return this.transitionClip(true);
        if (!into.getAttribute('src') || this.bad.has(this.nameOf(into))) { this.load(into, this.next()); this.queued = null; }
        this.rescue = true;
    }

    pause() { this.held = true; this.vids.forEach(v => v.pause()); } // Hold while a window covers the map
    resume() { this.held = false; if (this.started && !this.off && !document.hidden) play(this.vids[this.cur]); }
}
