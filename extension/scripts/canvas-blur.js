// Blur a bounded raster before it reaches the page compositor. In particular,
// Safari's no-canvas-filter fallback must not blur a huge scaled DOM layer.
export class CanvasBlur {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', {
      alpha: true, premultipliedAlpha: true, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    this.available = !!this.gl;
    this.ready = false;
    this.failed = false;
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.ready = false;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.ready = false;
      this.failed = false;
    });
    if (this.available) {
      try { this.init(); }
      catch (error) { this.available = false; this.failed = true; console.warn('Ambient Light blur:', error); }
    }
  }

  init() {
    const gl = this.gl;
    const shader = (type, source) => {
      const item = gl.createShader(type);
      gl.shaderSource(item, source);
      gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(item);
        gl.deleteShader(item);
        throw new Error(message || 'Cannot compile blur shader');
      }
      return item;
    };
    const vertex = shader(gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() { uv = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }
    `);
    const fragment = shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D image;
      uniform vec2 stepSize;
      uniform vec2 padding;
      uniform vec2 sourceSize;
      uniform float sigma;
      varying vec2 uv;
      vec4 sampleImage(vec2 point) {
        vec2 source = (point - padding) / (1.0 - 2.0 * padding);
        vec2 coverage = clamp(min(source, 1.0 - source) * sourceSize + 0.5, 0.0, 1.0);
        return texture2D(image, source) * coverage.x * coverage.y;
      }
      void main() {
        vec4 color = vec4(0.0);
        float total = 0.0;
        for (int i = -12; i <= 12; i++) {
          float x = float(i);
          float distance = x / max(sigma, 0.001);
          float weight = exp(-0.5 * distance * distance);
          color += sampleImage(uv + stepSize * x) * weight;
          total += weight;
        }
        gl_FragColor = color / total;
      }
    `);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Cannot link blur shader');
    gl.useProgram(this.program);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.step = gl.getUniformLocation(this.program, 'stepSize');
    this.padding = gl.getUniformLocation(this.program, 'padding');
    this.sourceSize = gl.getUniformLocation(this.program, 'sourceSize');
    this.sigma = gl.getUniformLocation(this.program, 'sigma');
    gl.uniform1i(gl.getUniformLocation(this.program, 'image'), 0);
    const texture = () => {
      const item = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, item);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return item;
    };
    this.input = texture();
    this.intermediate = texture();
    this.framebuffer = gl.createFramebuffer();
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.width = this.height = 0;
    this.ready = true;
  }

  render(source, width, height, border, sigma) {
    const gl = this.gl;
    if (!this.available || this.failed || gl.isContextLost() || width <= border * 2 || height <= border * 2) return null;
    try {
      if (!this.ready) this.init();
      // Work is bounded independently of window size, device pixel ratio and
      // the user's glow reach. Keep the original aspect ratio and blur radius.
      // At most four raster pixels per sigma keeps a 25-tap kernel smooth,
      // even when the requested blur is very wide. Sample every raster pixel.
      const scale = Math.min(1, 512 / Math.max(width, height), 4 / Math.max(4, sigma));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      if (w !== this.width || h !== this.height) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.width = w;
        this.height = h;
        gl.bindTexture(gl.TEXTURE_2D, this.intermediate);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.intermediate, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Blur target unavailable');
      }
      gl.viewport(0, 0, w, h);
      gl.bindTexture(gl.TEXTURE_2D, this.input);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform2f(this.padding, border / width, border / height);
      gl.uniform2f(this.sourceSize, source.videoWidth || source.width, source.videoHeight || source.height);
      gl.uniform1f(this.sigma, Math.max(0, sigma) * w / width);
      gl.uniform2f(this.step, 1 / w, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindTexture(gl.TEXTURE_2D, this.intermediate);
      gl.uniform2f(this.padding, 0, 0);
      gl.uniform2f(this.sourceSize, w, h);
      gl.uniform1f(this.sigma, Math.max(0, sigma) * h / height);
      gl.uniform2f(this.step, 0, 1 / h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // The caller copies immediately, before the non-preserved buffer expires.
      return this.canvas;
    } catch (error) {
      this.failed = true;
      console.warn('Ambient Light blur paused:', error);
      return null; // Preserve the previously committed glow until restoration.
    }
  }

  clear() {
    if (!this.ready || this.gl.isContextLost()) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, this.intermediate);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.canvas.width = this.canvas.height = 1;
    this.width = this.height = 0;
  }
}
