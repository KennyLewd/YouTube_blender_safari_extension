// Drive canvas work directly from presented video frames. Layout wakeups use
// one animation frame without cancelling an outstanding video-frame callback.
export class VideoFrameLoop {
  constructor(render) {
    this.render = render;
    this.video = null;
    this.videoRequest = null;
    this.animationRequest = null;
    this.generation = 0;
    this.active = false;
    this.limit = 0;
    this.lastDraw = -Infinity;
    this.lastFallbackFrame = undefined;
    this.forceRequested = false;
  }

  setVideo(video) {
    if (video === this.video) return;
    this.stop();
    this.video = video;
    this.lastDraw = -Infinity;
    this.lastFallbackFrame = undefined;
  }

  setLimit(fps = 0) {
    this.limit = Math.max(0, fps);
    this.lastDraw = -Infinity;
  }

  stop() {
    this.active = false;
    this.generation++;
    if (this.videoRequest !== null) this.video?.cancelVideoFrameCallback?.(this.videoRequest);
    if (this.animationRequest !== null) cancelAnimationFrame(this.animationRequest);
    this.videoRequest = this.animationRequest = null;
  }

  requestUpdate() {
    this.forceRequested = true;
    if (this.video?.paused || this.video?.ended || this.video?.seeking) this.stop();
    if (document.hidden) {
      this.stop();
      this.draw(performance.now(), null, true);
      return;
    }
    if (this.animationRequest !== null) return;
    const generation = this.generation;
    this.animationRequest = requestAnimationFrame(now => {
      this.animationRequest = null;
      if (generation !== this.generation) return;
      this.forceRequested = false;
      this.draw(now, null, true);
      this.schedule();
    });
  }

  draw(now, metadata, force) {
    if (!force && this.limit && now - this.lastDraw < 1000 / this.limit - 1) return;
    if (!force && !metadata) {
      const count = this.video?.getVideoPlaybackQuality?.().totalVideoFrames;
      const key = typeof count === 'number' && count > 0 ? count : this.video?.currentTime;
      if (key === this.lastFallbackFrame) return;
      this.lastFallbackFrame = key;
    }
    this.lastDraw = now;
    this.active = this.render({ now, metadata, force,
      mediaTime: metadata?.mediaTime ?? this.video?.currentTime }) !== false;
    if (!this.active) this.stop();
  }

  schedule() {
    const video = this.video;
    if (!this.active || !video || video.paused || video.ended || video.seeking || document.hidden) return;
    if (this.videoRequest !== null) return;
    const generation = this.generation;
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.videoRequest = video.requestVideoFrameCallback((now, metadata) => {
        if (generation !== this.generation || video !== this.video) return;
        this.videoRequest = null;
        // Drawing here avoids an additional requestAnimationFrame of latency.
        this.draw(now, metadata, false);
        this.schedule();
      });
    } else if (this.animationRequest === null) {
      this.animationRequest = requestAnimationFrame(now => {
        if (generation !== this.generation || video !== this.video) return;
        this.animationRequest = null;
        const force = this.forceRequested;
        this.forceRequested = false;
        this.draw(now, null, force);
        this.schedule();
      });
    }
  }
}
