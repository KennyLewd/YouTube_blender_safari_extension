import { VideoFrameLoop } from './video-frame-loop.js';
import { EdgeRaster } from './edge-raster.js';

(function () {
  'use strict';

  // Keep the picture opaque under the blend. Extend colors beyond its box
  // so the picture, bar fills and outer glow share one continuous border.
  const DEFAULT_WIDTH = 20;
  const normalize = value => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(60, Math.max(0, value)) : DEFAULT_WIDTH;

  // Infer only flat, near-black, symmetric bars; dark scenes without a
  // clearly brighter center retain the original frame bounds.
  function detectBars(data, w, h) {
    const black = (x, y) => {
      const i = (y * w + x) * 4;
      return Math.max(data[i], data[i + 1], data[i + 2]) <= 10;
    };
    let bright = 0;
    for (let y = Math.floor(h * .25); y < h * .75; y++) {
      for (let x = Math.floor(w * .25); x < w * .75; x++) {
        const i = (y * w + x) * 4;
        if (Math.max(data[i], data[i + 1], data[i + 2]) > 40) bright++;
      }
    }
    if (bright < w * h * .025) return null;
    const count = (vertical, reverse) => {
      const length = vertical ? w : h;
      const across = vertical ? h : w;
      let n = 0;
      for (; n < Math.floor(length * .44); n++) {
        const at = reverse ? length - 1 - n : n;
        let matches = 0, samples = 0;
        for (let a = Math.floor(across * .15); a < across * .85; a++) {
          samples++;
          if (black(vertical ? at : a, vertical ? a : at)) matches++;
        }
        if (matches < samples * .99) break;
      }
      return n;
    };
    const left = count(true, false), right = count(true, true);
    const top = count(false, false), bottom = count(false, true);
    // Unequal dark margins are usually scene content rather than bars.
    const x = left >= 1 && right >= 1 && Math.abs(left - right) <= 2 ? Math.min(left, right) / w : 0;
    const y = top >= 1 && bottom >= 1 && Math.abs(top - bottom) <= 2 ? Math.min(top, bottom) / h : 0;
    return { x, y };
  }

  function pictureBounds(w, h, vw, vh, style, bars) {
    let rw = vw, rh = vh;
    const fit = style.objectFit;
    if (fit === 'fill') { rw = w; rh = h; }
    else if (fit !== 'none') {
      let scale = fit === 'cover' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
      if (fit === 'scale-down') scale = Math.min(1, scale);
      rw *= scale; rh *= scale;
    }
    const positions = (style.objectPosition || '50% 50%').split(/\s+/);
    const offset = (value, space) => {
      const keywords = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };
      value = keywords[value] || value;
      const number = parseFloat(value);
      if (!Number.isFinite(number)) return space / 2;
      return value.endsWith('%') ? space * number / 100 : number;
    };
    const x = offset(positions[0], w - rw), y = offset(positions[1] || '50%', h - rh);
    return {
      image: { x, y, w: rw, h: rh },
      left: Math.max(0, x + rw * bars.x), right: Math.min(w, x + rw * (1 - bars.x)),
      top: Math.max(0, y + rh * bars.y), bottom: Math.min(h, y + rh * (1 - bars.y)),
    };
  }

  (async () => {
    const stored = await chrome.storage.local.get(['setting-enabled', 'safari-edge-blend', 'setting-framerateLimit', 'safari-edge-reach']);
    // How far (CSS px) the picture's colors spread beyond the regular player
    // before fading into the glow. 0 turns the outer blend off.
    const normalizeReach = value => typeof value === 'number' && Number.isFinite(value)
      ? Math.min(320, Math.max(0, Math.round(value))) : 160;
    let underReach = normalizeReach(stored['safari-edge-reach']);
    // Edge blending follows the glow's frame-rate limit (0 or unset = every video frame).
    const fpsLimit = value => typeof value === 'number' && Number.isFinite(value) ? Math.min(60, Math.max(0, value)) : 0;
    let enabled = stored['setting-enabled'] !== false;
    let width = normalize(stored['safari-edge-blend']);
    let video = null;
    let host = null;
    let failedVideo = null;
    let lastTime = -1;
    let lastSource = '';
    let bars = { x: 0, y: 0 };
    let lastScan = -Infinity;
    // Bars rarely change within a video. Scan every 0.5 s at first, then
    // double the wait each time the result repeats, up to 4 s. Seeks, new
    // sources and size changes restart at 0.5 s.
    const SCAN_MIN = 500, SCAN_MAX = 4000;
    let scanInterval = SCAN_MIN;
    const restartScan = () => { scanInterval = SCAN_MIN; lastScan = -Infinity; };
    const rescanEvents = ['seeked', 'loadeddata', 'resize', 'emptied'];
    let readable = true;
    let lastGeometry = '';
    let layout = null;
    let layoutDirty = true;
    let lastLayout = -Infinity;
    let syncCanvas = null;
    let scanTimer = null;
    let sourceGeneration = 0;
    const frameLoop = new VideoFrameLoop(tick);
    frameLoop.setLimit(fpsLimit(stored['setting-framerateLimit']));
    const overlay = document.createElement('div');
    overlay.className = 'safari-edge-blend';
    overlay.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    const rim = document.createElement('div');
    rim.className = 'safari-edge-blend__rim';
    rim.appendChild(canvas);
    overlay.appendChild(rim);
    // Seamless blend for the regular (non-theater) player: a softened copy of
    // the picture, extended outward and faded, drawn behind the page content
    // just above the glow. Living behind the content lets it reach far
    // without covering the title, buttons or sidebar.
    const under = document.createElement('div');
    under.className = 'safari-edge-under';
    under.setAttribute('aria-hidden', 'true');
    const underCanvas = document.createElement('canvas');
    under.appendChild(underCanvas);
    const underCtx = underCanvas.getContext('2d', { alpha: false });
    const underSrc = document.createElement('canvas');
    const underSrcCtx = underSrc.getContext('2d', { alpha: false });
    const underRaster = new EdgeRaster();
    let underHost = null, underFixed = false, underDrawn = false;
    const sample = document.createElement('canvas');
    sample.width = sample.height = 96;
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
    const frameCanvas = document.createElement('canvas');
    const ctx = frameCanvas.getContext('2d', { alpha: false });
    const displayCtx = canvas.getContext('2d', { alpha: false });
    if (!ctx || !displayCtx) return;
    const raster = new EdgeRaster();
    // Mixed fill for wide bars: a stretched edge near the picture that fades
    // into a zoomed, heavily softened copy of the whole frame further out.
    const midCanvas = document.createElement('canvas');
    const midCtx = midCanvas.getContext('2d', { alpha: false });
    const tinyCanvas = document.createElement('canvas');
    const tinyCtx = tinyCanvas.getContext('2d', { alpha: false });
    const edgeCanvas = document.createElement('canvas');
    const edgeCtx = edgeCanvas.getContext('2d');

    function paintAmbient(l, r, t, b, cw, ch) {
      const pw = r - l, ph = b - t, long = Math.max(pw, ph);
      const size = (n, side) => Math.max(1, Math.round(n * side / long));
      const mw = size(96, pw), mh = size(96, ph), tw = size(24, pw), th = size(24, ph);
      if (midCanvas.width !== mw || midCanvas.height !== mh) { midCanvas.width = mw; midCanvas.height = mh; }
      if (tinyCanvas.width !== tw || tinyCanvas.height !== th) { tinyCanvas.width = tw; tinyCanvas.height = th; }
      // Two downscale steps avoid the shimmer of sampling a large frame
      // straight down to a few pixels.
      midCtx.imageSmoothingEnabled = tinyCtx.imageSmoothingEnabled = true;
      midCtx.imageSmoothingQuality = tinyCtx.imageSmoothingQuality = 'high';
      midCtx.drawImage(frameCanvas, l, t, pw, ph, 0, 0, mw, mh);
      tinyCtx.drawImage(midCanvas, 0, 0, tw, th);
      const zoom = Math.max(cw / pw, ch / ph) * 1.08;
      const dw = pw * zoom, dh = ph * zoom;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.rect(l, t, pw, ph);
      ctx.clip('evenodd'); // Paint only the bars, never over the picture.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // No extra dimming: darkening the backdrop turned bright videos gray.
      ctx.drawImage(tinyCanvas, (l + r - dw) / 2, (t + b - dh) / 2, dw, dh);
      ctx.restore();
    }

    // Stretch an edge strip across a bar. With a fade length, the stretch is
    // opaque at the picture edge and dissolves into the ambient fill beneath.
    function fillBar(src, dst, from, to, fade) {
      if (dst[2] <= 0 || dst[3] <= 0) return;
      if (!fade) { ctx.drawImage(frameCanvas, ...src, ...dst); return; }
      edgeCtx.globalCompositeOperation = 'source-over';
      edgeCtx.clearRect(...dst);
      edgeCtx.drawImage(frameCanvas, ...src, ...dst);
      const gradient = edgeCtx.createLinearGradient(from[0], from[1], to[0], to[1]);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(.45, 'rgba(0,0,0,.55)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      edgeCtx.globalCompositeOperation = 'destination-in';
      edgeCtx.fillStyle = gradient;
      edgeCtx.fillRect(...dst);
      edgeCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(edgeCanvas, ...dst, ...dst);
    }
    let player = null;

    function clear() {
      player?.removeAttribute('data-safari-edge-player');
      player = null;
      if (scanTimer !== null) clearTimeout(scanTimer);
      scanTimer = null;
      const hadBlend = video?.hasAttribute('data-safari-edge-video');
      video?.removeAttribute('data-safari-edge-video');
      video?.removeAttribute('data-safari-edge-picture');
      video?.removeAttribute('data-safari-edge-bars');
      if (host) {
        host.removeAttribute('data-safari-edge-host');
        host.removeAttribute('data-safari-edge-cropped');
        for (const key of ['fade', 'left', 'right', 'top', 'bottom'])
          host.style.removeProperty(`--safari-edge-${key}`);
      }
      overlay.remove();
      under.remove(); underFixed = false; underDrawn = false;
      document.documentElement.removeAttribute('data-safari-edge-active');
      if (hadBlend) raster.clear();
      if (hadBlend) document.dispatchEvent(new Event('safari-edge-blend-change'));
    }

    function selectVideo() {
      if (location.pathname !== '/watch' && !location.pathname.startsWith('/shorts/') &&
          !location.pathname.startsWith('/embed/')) return null;
      // Measure each video once; measuring inside the sort forces layout
      // repeatedly.
      return [...document.querySelectorAll('video')]
        .filter(v => v.isConnected)
        .map(v => ({ v, rect: v.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 20)
        .sort((a, b) => (Number(!b.v.paused) - Number(!a.v.paused)) * 1e8 +
          b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.v || null;
    }

    const events = ['play', 'playing', 'pause', 'seeking', 'seeked', 'loadeddata', 'resize', 'emptied', 'ended', 'ratechange',
      'webkitbeginfullscreen', 'webkitendfullscreen', 'enterpictureinpicture', 'leavepictureinpicture'];
    const resizeObserver = new ResizeObserver(wake);
    function attach(next) {
      if (next === video && next?.parentElement === host) return;
      clear();
      if (video) for (const event of events) video.removeEventListener(event, wake);
      if (video) for (const event of rescanEvents) video.removeEventListener(event, restartScan);
      resizeObserver.disconnect();
      frameLoop.setVideo(next);
      video = next;
      layout = null; layoutDirty = true; syncCanvas = null; sourceGeneration++;
      host = video?.parentElement || null;
      failedVideo = null;
      lastTime = -1;
      lastSource = '';
      bars = { x: 0, y: 0 }; lastScan = -Infinity; scanInterval = SCAN_MIN; readable = true; lastGeometry = '';
      sample.width = 96;
      if (video) {
        for (const event of events) video.addEventListener(event, wake);
        for (const event of rescanEvents) video.addEventListener(event, restartScan);
        resizeObserver.observe(video);
      }
    }

    function tick({ now = performance.now(), mediaTime = video?.currentTime, force = false } = {}) {
      const rendererActive = document.documentElement.hasAttribute('data-ambientlight-enabled');
      const updateLayout = layoutDirty || !layout || now - lastLayout >= 250;
      const rect = updateLayout ? video?.getBoundingClientRect() : layout.rect;
      if (!enabled || !width || !rendererActive || document.hidden || !video || !host ||
          video.webkitDisplayingFullscreen || document.pictureInPictureElement === video ||
          rect.width < 20 || rect.height < 20 || rect.bottom <= 0 || rect.top >= innerHeight ||
          video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.ended) {
        clear();
        return false;
      }
      // A new source on the same <video> must be sampled even if its time is 0.
      const source = video.currentSrc || video.src;
      if (source !== lastSource) {
        lastSource = source;
        lastTime = -1;
        failedVideo = null;
        bars = { x: 0, y: 0 }; lastScan = -Infinity; scanInterval = SCAN_MIN; readable = true; lastGeometry = '';
        sample.width = 96;
        sourceGeneration++; layoutDirty = true;
      }
      if (failedVideo === video) { clear(); return false; }
      const style = updateLayout ? getComputedStyle(video) : layout.style;
      if (sampleCtx && readable && scanTimer === null && now - lastScan >= scanInterval) {
        const target = video, generation = sourceGeneration;
        // Bar analysis is geometry work: keep its GPU readback out of the
        // frame-presentation callback, then repaint only if bounds change.
        scanTimer = setTimeout(() => {
          scanTimer = null;
          if (generation !== sourceGeneration || target !== video || document.hidden || !enabled || !width) return;
          lastScan = performance.now();
          try {
            // Preserve native resolution on the axis being measured. A 96x96
            // thumbnail loses the narrow black rows often encoded in music videos.
            const horizontalHeight = Math.min(2160, target.videoHeight);
            sample.width = 64; sample.height = horizontalHeight;
            sampleCtx.imageSmoothingEnabled = false;
            sampleCtx.drawImage(target, 0, 0, sample.width, sample.height);
            const horizontal = detectBars(sampleCtx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
            const verticalWidth = Math.min(3840, target.videoWidth);
            sample.width = verticalWidth; sample.height = 64;
            sampleCtx.imageSmoothingEnabled = false;
            sampleCtx.drawImage(target, 0, 0, sample.width, sample.height);
            const vertical = detectBars(sampleCtx.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
            // Compression often leaves one dark transition row after a black
            // bar. Exclude that row from edge sampling as well as the bar.
            const detected = horizontal && vertical ? {
              x: vertical.x ? vertical.x + 1 / verticalWidth : 0,
              y: horizontal.y ? horizontal.y + 1 / horizontalHeight : 0,
            } : null;
            if (detected && (detected.x !== bars.x || detected.y !== bars.y)) {
              bars = detected; layoutDirty = true; frameLoop.requestUpdate();
              scanInterval = SCAN_MIN;
            } else if (detected) {
              scanInterval = Math.min(SCAN_MAX, scanInterval * 2);
            }
            // A dark or unreadable frame (detected === null) keeps the
            // current pace so bars are found soon after a dark intro.
          } catch { readable = false; }
        }, 0);
      }
      const picture = pictureBounds(video.offsetWidth, video.offsetHeight,
        video.videoWidth, video.videoHeight, style, bars);
      if (picture.right <= picture.left || picture.bottom <= picture.top) { clear(); return false; }
      const band = Math.min(width, (picture.right - picture.left) * .06,
        (picture.bottom - picture.top) * .06);
      const cropped = !!host.style.getPropertyValue('--video-transform') &&
        getComputedStyle(host).overflow === 'hidden';
      const reach = cropped || document.fullscreenElement ? 0 : Math.min(48, Math.max(16, band * 1.5));
      const barReach = Math.max(picture.left, video.offsetWidth - picture.right,
        picture.top, video.offsetHeight - picture.bottom);
      const blurRadius = Math.max(1, band * .35, Math.min(40, barReach * .12));
      // Render only as finely as the blur can show. Detail finer than the
      // blur is erased anyway, so keep at least 2.5 canvas pixels per blur
      // radius and never go below half the previous 640 px budget. Heavy blur
      // (wide bars) draws about a quarter of the pixels; light blur saves less.
      const baseScale = Math.min(1, 640 / Math.max(video.offsetWidth + reach * 2, video.offsetHeight + reach * 2));
      const scale = Math.max(baseScale * .5, Math.min(baseScale, 2.5 / blurRadius));
      const cw = Math.max(1, Math.round(video.offsetWidth * scale));
      const ch = Math.max(1, Math.round(video.offsetHeight * scale));
      const padding = Math.ceil(reach * scale);
      if (canvas.width !== cw + padding * 2 || canvas.height !== ch + padding * 2) {
        canvas.width = cw + padding * 2; canvas.height = ch + padding * 2;
        frameCanvas.width = cw; frameCanvas.height = ch; lastTime = -1;
        edgeCanvas.width = cw; edgeCanvas.height = ch;
      }
      const reachX = padding * video.offsetWidth / cw;
      const reachY = padding * video.offsetHeight / ch;
      const geometry = JSON.stringify([picture, blurRadius, reach]);
      if (updateLayout) {
        syncCanvas = host.querySelector('.ambientlight__video-overlay:not(.ambientlight__video-overlay--hide)');
        if (syncCanvas && (!syncCanvas.width || !syncCanvas.height)) syncCanvas = null;
      }
      try {
        if (force || lastTime !== mediaTime || geometry !== lastGeometry || syncCanvas) {
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
          const image = picture.image;
          const sourceWidth = syncCanvas?.width || video.videoWidth;
          const sourceHeight = syncCanvas?.height || video.videoHeight;
          // Sample only the active picture. Scaling a full letterboxed frame
          // first mixes its black rows into the edge pixels before bar filling.
          ctx.drawImage(syncCanvas || video,
            (picture.left - image.x) / image.w * sourceWidth,
            (picture.top - image.y) / image.h * sourceHeight,
            (picture.right - picture.left) / image.w * sourceWidth,
            (picture.bottom - picture.top) / image.h * sourceHeight,
            picture.left * scale, picture.top * scale,
            (picture.right - picture.left) * scale, (picture.bottom - picture.top) * scale);
          // Extend the nearest picture pixels across either kind of bar:
          // margins from object-fit and black strips encoded in the video.
          const l = Math.min(cw - 1, Math.max(0, Math.ceil(picture.left * scale)));
          const r = Math.max(l + 1, Math.min(cw, Math.floor(picture.right * scale)));
          const t = Math.min(ch - 1, Math.max(0, Math.ceil(picture.top * scale)));
          const b = Math.max(t + 1, Math.min(ch, Math.floor(picture.bottom * scale)));
          const stripX = Math.max(1, Math.min(8, Math.floor((r - l) * .03)));
          const stripY = Math.max(1, Math.min(8, Math.floor((b - t) * .03)));
          // Thin bars keep the plain stretch. Wide bars (vertical videos,
          // 4:3 in fullscreen) get the ambient fill under a fading stretch,
          // which avoids long horizontal streaks.
          // A bar counts as wide only when it is at least 15% of the picture
          // (e.g. a vertical video in a 16:9 player). Narrow bars, such as the
          // slim side margins of a wide window, keep the plain stretch.
          const mixMin = Math.max(12, Math.round(Math.min(cw, ch) * .05));
          const wide = (bar, side) => bar > Math.max(mixMin, side * .15);
          const mixed = !!(midCtx && tinyCtx && edgeCtx) &&
            (wide(l, r - l) || wide(cw - r, r - l) || wide(t, b - t) || wide(ch - b, b - t));
          if (mixed) paintAmbient(l, r, t, b, cw, ch);
          const fadeFor = (bar, side) => mixed && wide(bar, side) ? Math.max(mixMin, bar * .3) : 0;
          if (l > 0) { const f = fadeFor(l, r - l); fillBar([l, t, stripX, b - t], [0, t, l, b - t], [l, 0], [l - f, 0], f); }
          if (r < cw) { const f = fadeFor(cw - r, r - l); fillBar([r - stripX, t, stripX, b - t], [r, t, cw - r, b - t], [r, 0], [r + f, 0], f); }
          if (t > 0) { const f = fadeFor(t, b - t); fillBar([0, t, cw, stripY], [0, 0, cw, t], [0, t], [0, t - f], f); }
          if (b < ch) { const f = fadeFor(ch - b, b - t); fillBar([0, b - stripY, cw, stripY], [0, b, cw, ch - b], [0, b], [0, b + f], f); }
          // Outer blend: small raster, heavier blur the farther it reaches.
          if (underReach > 0 && underHost && !cropped && !document.fullscreenElement && underCtx && underSrcCtx) {
            const us = Math.min(1, 256 / Math.max(video.offsetWidth, video.offsetHeight));
            const uw = Math.max(1, Math.round(video.offsetWidth * us));
            const uh = Math.max(1, Math.round(video.offsetHeight * us));
            const ext = Math.ceil(underReach * us);
            if (underSrc.width !== uw || underSrc.height !== uh) { underSrc.width = uw; underSrc.height = uh; }
            if (underCanvas.width !== uw + ext * 2 || underCanvas.height !== uh + ext * 2) {
              underCanvas.width = uw + ext * 2; underCanvas.height = uh + ext * 2;
            }
            underSrcCtx.imageSmoothingEnabled = true;
            underSrcCtx.imageSmoothingQuality = 'high';
            underSrcCtx.drawImage(frameCanvas, 0, 0, cw, ch, 0, 0, uw, uh);
            if (underRaster.draw(underSrc, underCtx, Math.max(blurRadius, underReach * .2) * us, ext)) {
              // Attach on the next layout pass, never before the first frame.
              if (!underDrawn) { underDrawn = true; layoutDirty = true; }
            }
          }
          if (!raster.draw(frameCanvas, displayCtx, blurRadius * scale, padding)) {
            // Never mask the original video before the first complete frame.
            if (!overlay.isConnected) return true;
          } else {
            lastTime = mediaTime; lastGeometry = geometry;
          }
        }
      } catch (error) {
        clear();
        if (error.name !== 'InvalidStateError') failedVideo = video;
        return false;
      }
      // Most frames only change canvas pixels. Keep layout reads and DOM
      // writes off that path when the player geometry has not changed.
      if (!updateLayout && !layoutDirty) return !syncCanvas;
      const fade = `0px`; // A hard picture mask only removes bars; it does not dim the video.
      let changed = host.style.getPropertyValue('--safari-edge-fade') !== fade;
      for (const key of ['left', 'right', 'top', 'bottom']) {
        const value = `${picture[key]}px`;
        if (host.style.getPropertyValue(`--safari-edge-${key}`) !== value) {
          host.style.setProperty(`--safari-edge-${key}`, value); changed = true;
        }
      }
      // Map the inner picture through YouTube's crop transform to the host.
      let inner = picture;
      if (cropped) {
        const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
        const origin = style.transformOrigin.split(' ').map(parseFloat);
        const map = (x, y) => new DOMPoint(x - origin[0], y - origin[1]).matrixTransform(matrix);
        const start = map(picture.left, picture.top), end = map(picture.right, picture.bottom);
        inner = { left: start.x + origin[0] + video.offsetLeft,
          right: end.x + origin[0] + video.offsetLeft,
          top: start.y + origin[1] + video.offsetTop,
          bottom: end.y + origin[1] + video.offsetTop };
        inner = { left: Math.max(0, inner.left), right: Math.min(host.clientWidth, inner.right),
          top: Math.max(0, inner.top), bottom: Math.min(host.clientHeight, inner.bottom) };
      }
      for (const key of ['left', 'right', 'top', 'bottom'])
        rim.style.setProperty(`--safari-edge-${key}`, `${inner[key] + (key === 'left' || key === 'right' ? reachX : reachY)}px`);
      Object.assign(overlay.style, {
        left: `${cropped ? 0 : video.offsetLeft - reachX}px`, top: `${cropped ? 0 : video.offsetTop - reachY}px`,
        width: `${cropped ? host.clientWidth : video.offsetWidth + reachX * 2}px`,
        height: `${cropped ? host.clientHeight : video.offsetHeight + reachY * 2}px`,
        transform: cropped ? 'none' : style.transform,
        transformOrigin: cropped ? style.transformOrigin : style.transformOrigin.split(' ').map((v, i) => `${parseFloat(v) + (i === 0 ? reachX : i === 1 ? reachY : 0)}px`).join(' '),
        borderRadius: style.borderRadius,
      });
      overlay.style.setProperty('--safari-edge-width', `${Math.min(12, band * .4)}px`);
      overlay.style.setProperty('--safari-edge-reach-x', `${reachX}px`);
      overlay.style.setProperty('--safari-edge-reach-y', `${reachY}px`);
      Object.assign(canvas.style, {
        position: cropped ? 'absolute' : 'static',
        left: cropped ? `${video.offsetLeft}px` : '', top: cropped ? `${video.offsetTop}px` : '',
        width: cropped ? `${video.offsetWidth}px` : '100%',
        height: cropped ? `${video.offsetHeight}px` : '100%',
        transform: cropped ? style.transform : 'none', transformOrigin: style.transformOrigin,
      });
      overlay.setAttribute('data-safari-edge-cropped', String(cropped));
      // Place the outer blend in the glow's layer, aligned to the video box.
      underHost = document.querySelector('html[data-ambientlight-enabled] .ambientlight__container');
      if (underReach > 0 && underHost && underDrawn && !cropped && !document.fullscreenElement) {
        const hostRect = underHost.getBoundingClientRect();
        Object.assign(under.style, {
          left: `${rect.left - hostRect.left - underReach}px`, top: `${rect.top - hostRect.top - underReach}px`,
          width: `${rect.width + underReach * 2}px`, height: `${rect.height + underReach * 2}px`,
        });
        under.style.setProperty('--safari-under-reach', `${underReach}px`);
        if (under.parentElement !== underHost) underHost.appendChild(under);
        underFixed = getComputedStyle(underHost).position === 'fixed';
      } else {
        under.remove(); underFixed = false;
        if (underReach === 0 || cropped || document.fullscreenElement) underDrawn = false;
      }
      // The rim mask belongs to the wrapper when YouTube crops the video.
      host.toggleAttribute('data-safari-edge-cropped', cropped);
      const nextPlayer = cropped || document.fullscreenElement ? null : video.closest('.html5-video-player');
      if (player !== nextPlayer) player?.removeAttribute('data-safari-edge-player');
      player = nextPlayer;
      player?.setAttribute('data-safari-edge-player', '');
      // The frame canvas already includes object-fit geometry and bar fills.
      canvas.style.objectFit = 'fill';
      if (changed) host.style.setProperty('--safari-edge-fade', fade);
      host.setAttribute('data-safari-edge-host', '');
      video.setAttribute('data-safari-edge-video', '');
      document.documentElement.setAttribute('data-safari-edge-active', '');
      video.dataset.safariEdgePicture = JSON.stringify({left: picture.left, right: picture.right, top: picture.top, bottom: picture.bottom});
      video.dataset.safariEdgeBars = JSON.stringify(bars);
      // Keep the rim above the optional synced-video canvas, below player UI.
      if (overlay.parentElement !== host || host.lastElementChild !== overlay) host.appendChild(overlay);
      if (changed) document.dispatchEvent(new Event('safari-edge-blend-change'));
      layout = { rect, style };
      layoutDirty = false; lastLayout = now;
      // The optional delayed-video canvas drives its own matching edge frame.
      return !syncCanvas;
    }

    function wake(event) {
      if (event?.type === 'loadeddata' || event?.type === 'emptied') {
        readable = true; sample.width = 96; lastScan = -Infinity; scanInterval = SCAN_MIN; lastTime = -1;
      }
      attach(selectVideo());
      layoutDirty = true;
      frameLoop.requestUpdate();
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes['setting-enabled']) enabled = changes['setting-enabled'].newValue !== false;
      if (changes['safari-edge-blend']) width = normalize(changes['safari-edge-blend'].newValue);
      if (changes['setting-framerateLimit']) frameLoop.setLimit(fpsLimit(changes['setting-framerateLimit'].newValue));
      if (changes['safari-edge-reach']) { underReach = normalizeReach(changes['safari-edge-reach'].newValue); layoutDirty = true; lastGeometry = ''; }
      wake();
    });
    // Observe renderer state and YouTube replacing/resizing its player. Ignore
    // our own style and canvas changes to avoid a self-triggering render loop.
    const observer = new MutationObserver(records => {
      if (records.some(record => {
        if (record.type === 'childList') return [...record.addedNodes, ...record.removedNodes]
          .some(node => node !== overlay && node !== canvas && node !== rim && node.nodeType === 1 &&
            (node.matches('video, .ambientlight__video-overlay') ||
              node.querySelector('video, .ambientlight__video-overlay')));
        if (record.target === video && record.attributeName === 'crossorigin') {
          readable = true; sample.width = 96; lastScan = -Infinity; scanInterval = SCAN_MIN;
        }
        return record.target === video || record.target === host ||
          record.target === syncCanvas || record.target.classList?.contains('ambientlight__video-overlay');
      })) wake();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'src', 'crossorigin'] });
    const stateObserver = new MutationObserver(wake);
    stateObserver.observe(document.documentElement, { attributes: true,
      attributeFilter: ['data-ambientlight-enabled'] });
    document.addEventListener('safari-ambient-video-frame', event => {
      if (event.target !== syncCanvas || !video) return;
      tick({ now: performance.now(), mediaTime: video.currentTime, force: true });
    });
    document.addEventListener('visibilitychange', wake);
    document.addEventListener('fullscreenchange', wake);
    document.addEventListener('yt-navigate-finish', wake);
    window.addEventListener('popstate', wake);
    // The overlay sits inside the player, so scrolling already moves it with
    // the video. Scroll and window resize only need a visibility check, at
    // most once per animation frame; the player's own size changes still
    // arrive through the ResizeObserver.
    let repositionFrame = null;
    const reposition = () => {
      if (!video || !enabled || !width || repositionFrame !== null) return;
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = null;
        if (!video) return;
        // A fixed glow layer does not scroll with the page: realign the outer blend.
        if (underFixed && under.isConnected) { layoutDirty = true; frameLoop.requestUpdate(); return; }
        const rect = video.getBoundingClientRect();
        const visible = rect.width >= 20 && rect.height >= 20 && rect.bottom > 0 && rect.top < innerHeight;
        if (visible === overlay.isConnected) return;
        layoutDirty = true;
        frameLoop.requestUpdate();
      });
    };
    window.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });
    wake();
  })().catch(error => console.warn('Ambient Light edge blending could not start:', error));
})();
