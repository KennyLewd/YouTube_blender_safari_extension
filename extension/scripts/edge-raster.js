import { CanvasBlur } from './canvas-blur.js';

// Extend the outermost pixels BEFORE blurring. Transparent pixels beyond a
// canvas boundary otherwise darken the rim when composited over the player.
export class EdgeRaster {
  constructor() {
    this.paddingCanvas = document.createElement('canvas');
    this.paddingContext = this.paddingCanvas.getContext('2d', { alpha: false });
    this.blur = null;
  }

  draw(source, destination, sigma, extension = 0) {
    const w = source.width, h = source.height;
    if (!w || !h) return false;
    if (sigma > 0 && !this.blur) this.blur = new CanvasBlur();
    if (!this.paddingContext || ((!this.blur?.available || sigma <= 0) && !extension)) {
      // Keep the original rim visible if a GPU blur context cannot start.
      // Do not restore a large CSS filter as a fallback.
      destination.drawImage(source, 0, 0, w, h);
      return true;
    }
    const pad = Math.ceil(sigma * 3) + 2 + extension;
    const pw = w + pad * 2, ph = h + pad * 2;
    const c = this.paddingCanvas, ctx = this.paddingContext;
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
    ctx.drawImage(source, pad, pad);
    ctx.drawImage(source, 0, 0, 1, h, 0, pad, pad, h);
    ctx.drawImage(source, w - 1, 0, 1, h, pad + w, pad, pad, h);
    ctx.drawImage(source, 0, 0, w, 1, pad, 0, w, pad);
    ctx.drawImage(source, 0, h - 1, w, 1, pad, pad + h, w, pad);
    ctx.drawImage(source, 0, 0, 1, 1, 0, 0, pad, pad);
    ctx.drawImage(source, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
    ctx.drawImage(source, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
    ctx.drawImage(source, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);
    const output = sigma > 0 && this.blur?.available ? this.blur.render(c, pw, ph, 0, sigma) : c;
    if (!output) return false;
    const sx = output.width / pw, sy = output.height / ph;
    destination.drawImage(output, (pad - extension) * sx, (pad - extension) * sy,
      (w + extension * 2) * sx, (h + extension * 2) * sy,
      0, 0, w + extension * 2, h + extension * 2);
    return true;
  }

  clear() {
    this.paddingCanvas.width = this.paddingCanvas.height = 1;
    this.blur?.clear();
  }
}
