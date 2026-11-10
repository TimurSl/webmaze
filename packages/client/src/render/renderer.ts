// Low-res pipeline: the scene renders at ~480x270 into an offscreen target (nearest filtering),
// then one fullscreen pass upscales it and applies the style-break effects (grey drain, compression artifacts).
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime, uGrey, uArt, uVig, uLight, uDither, uFlash, uFade;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 ordered dither matrix
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) { if (float(k) == i) return m[k] / 16.0; }
  return 0.0;
}
void main() {
  vec2 uv = vUv;
  if (uArt > 0.0) {
    vec2 blk = floor(uv * uRes / 8.0);
    float n = h21(blk + floor(uTime * 7.0));
    if (n < uArt * 0.4) uv.x += (n - 0.2) * 0.06 * uArt;
    float cell = 1.0 + floor(uArt * 3.0);
    uv = (floor(uv * uRes / cell) * cell + 0.5 * cell) / uRes;
  }
  vec3 c = texture2D(tDiffuse, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), uGrey);
  float levels = mix(48.0, 6.0, uArt);
  float dth = (bayer4(vUv * uRes) - 0.5) * (uDither / levels);
  c = floor((c + dth) * levels + 0.5) / levels;
  float d = distance(vUv, vec2(0.5));
  c *= 1.0 - uVig * smoothstep(0.38, 0.9, d);
  float spot = smoothstep(0.85, 0.1, d * 1.25);
  c *= mix(0.9, 1.0 + 0.12 * spot, uLight);
  c = mix(c, vec3(1.0, 0.1, 0.1), uFlash * 0.5);
  c *= uFade;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class PixelRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 140);
  private rt: THREE.WebGLRenderTarget;
  private post = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  w = 480;
  h = 270;
  fx = { grey: 0, art: 0, vig: 0.55, light: 0, dither: 1, flash: 0, fade: 1 };

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera.rotation.order = 'YXZ';
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false,
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(this.w, this.h) }, uTime: { value: 0 },
        uGrey: { value: 0 }, uArt: { value: 0 }, uVig: { value: 0.55 }, uLight: { value: 0 }, uDither: { value: 1 },
        uFlash: { value: 0 }, uFade: { value: 1 },
      },
    });
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
    const aspect = Math.min(2.4, Math.max(1.2, W / H));
    this.h = 270;
    this.w = Math.round(this.h * aspect);
    this.rt.setSize(this.w, this.h);
    this.mat.uniforms.uRes.value.set(this.w, this.h);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  render(time: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uGrey.value = this.fx.grey; u.uArt.value = this.fx.art; u.uVig.value = this.fx.vig;
    u.uLight.value = this.fx.light; u.uDither.value = this.fx.dither; u.uFlash.value = this.fx.flash; u.uFade.value = this.fx.fade;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.post, this.postCam);
  }
}
