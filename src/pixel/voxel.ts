import { EYE, type SpriteFace } from "./sprite-face";

/** The rotations, squash and lift a voxel mascot is drawn at (degrees, scales about the feet, lift in body heights). */
export type VoxelPose = { y: number; sx: number; sy: number; rx: number; ry: number; rz: number };
type Rgb = readonly [number, number, number];
type Mesh = { buffer: WebGLBuffer; count: number; G: number };

const VERTEX = `
attribute vec3 p; attribute vec3 n; attribute float e;
uniform mat4 mvp; uniform mat4 rot; uniform vec3 ink; uniform vec3 eyeInk;
varying vec3 c;
void main() {
  vec3 N = normalize((rot * vec4(n, 0.0)).xyz);
  float l = max(dot(N, normalize(vec3(-0.45, 0.7, 0.85))), 0.0);
  float rim = max(dot(N, vec3(0.0, 0.0, 1.0)), 0.0);
  c = e > 0.5 ? eyeInk : ink * (0.6 + 0.3 * l + 0.12 * rim);
  gl_Position = mvp * vec4(p, 1.0);
}`;
const FRAGMENT = `precision mediump float; varying vec3 c; void main() { gl_FragColor = vec4(c, 1.0); }`;

/** Half the depth of each body column: thicker the further it sits from the outline, so the sprite reads as a rounded
 * toy built from whole cubes. */
function halfDepths(s: SpriteFace): Float32Array {
  const { W, H, paint } = s, dist = new Float32Array(W * H);
  for (let i = 0; i < paint.length; i++) dist[i] = paint[i] ? 99 : 0;
  for (let pass = 0; pass < 6; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!paint[i]) continue;
    let near = 99;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const xx = x + dx, yy = y + dy;
      near = Math.min(near, xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : dist[yy * W + xx]!);
    }
    dist[i] = Math.min(dist[i]!, near + 1);
  }
  const half = new Float32Array(W * H);
  for (let i = 0; i < half.length; i++) half[i] = dist[i] ? [0, 1, 1.5, 2, 2.5][Math.min(4, dist[i]!)]! : 0;
  return half;
}

function buildMesh(gl: WebGLRenderingContext, s: SpriteFace): Mesh {
  const { W, H, G, px, pt, paint } = s, half = halfDepths(s), out: number[] = [];
  const cx = px + G / 2, cy = pt + G / 2;
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], e: number) => {
    for (const v of [a, b, c, a, c, d]) out.push(v[0]! - cx, cy - v[1]!, v[2]!, n[0]!, n[1]!, n[2]!, e);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, h = half[i]!;
    if (!h) continue;
    const eye = paint[i] === EYE ? 1 : 0;
    quad([x, y, h], [x + 1, y, h], [x + 1, y + 1, h], [x, y + 1, h], [0, 0, 1], eye);
    quad([x + 1, y, -h], [x, y, -h], [x, y + 1, -h], [x + 1, y + 1, -h], [0, 0, -1], 0);
    const side = (nx: number, ny: number) => {
      const xx = x + nx, yy = y + ny;
      const other = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : half[yy * W + xx]!;
      if (other >= h) return;
      const n = [nx, -ny, 0];
      for (const [z0, z1] of other ? [[other, h], [-h, -other]] : [[-h, h]]) {
        if (nx === 1) quad([x + 1, y, z1!], [x + 1, y, z0!], [x + 1, y + 1, z0!], [x + 1, y + 1, z1!], n, 0);
        if (nx === -1) quad([x, y, z0!], [x, y, z1!], [x, y + 1, z1!], [x, y + 1, z0!], n, 0);
        if (ny === -1) quad([x, y, z0!], [x + 1, y, z0!], [x + 1, y, z1!], [x, y, z1!], n, 0);
        if (ny === 1) quad([x, y + 1, z1!], [x + 1, y + 1, z1!], [x + 1, y + 1, z0!], [x, y + 1, z0!], n, 0);
      }
    };
    side(1, 0); side(-1, 0); side(0, 1); side(0, -1);
  }
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
  return { buffer, count: out.length / 7, G };
}

type Mat = Float32Array;
const mul = (a: Mat, b: Mat): Mat => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r]! * b[c * 4 + k]!; o[c * 4 + r] = v; }
  return o;
};
const ident = (): Mat => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const translate = (x: number, y: number, z: number): Mat => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
const scale = (x: number, y: number, z: number): Mat => { const m = ident(); m[0] = x; m[5] = y; m[10] = z; return m; };
const rotate = (axis: 0 | 1 | 2, deg: number): Mat => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), m = ident();
  if (axis === 0) { m[5] = c; m[6] = s; m[9] = -s; m[10] = c; }
  if (axis === 1) { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  if (axis === 2) { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
};
const perspective = (fovY: number, near: number, far: number): Mat => {
  const f = 1 / Math.tan(fovY / 2), m = new Float32Array(16);
  m[0] = f; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
};

/** How much bigger than the body's box the drawn canvas is, so hops and rolls stay inside it. */
export const VOXEL_ROOM = 1.8;

type Renderer = { gl: WebGLRenderingContext; canvas: HTMLCanvasElement; loc: Record<string, WebGLUniformLocation | number>; meshes: Map<string, Mesh> };
let renderer: Renderer | null | undefined;

function rendererOf(): Renderer | null {
  if (renderer !== undefined) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return (renderer = null);
  const shader = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  const loc: Renderer["loc"] = { p: gl.getAttribLocation(program, "p"), n: gl.getAttribLocation(program, "n"), e: gl.getAttribLocation(program, "e") };
  for (const name of ["mvp", "rot", "ink", "eyeInk"]) loc[name] = gl.getUniformLocation(program, name)!;
  return (renderer = { gl, canvas, loc, meshes: new Map() });
}

export const voxelSupported = (): boolean => typeof document !== "undefined" && rendererOf() !== null;

/** Draws one voxel mascot into `target` (a 2d canvas VOXEL_ROOM times its box) through the one shared WebGL context. */
export function drawVoxel(target: CanvasRenderingContext2D, sprite: SpriteFace, pose: VoxelPose, ink: Rgb, eyeInk: Rgb): void {
  const r = rendererOf();
  if (!r) return;
  const { gl, canvas, loc, meshes } = r;
  const w = target.canvas.width, h = target.canvas.height;
  if (w > canvas.width || h > canvas.height) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
  let mesh = meshes.get(sprite.key);
  if (!mesh) {
    if (meshes.size > 48) { for (const m of meshes.values()) gl.deleteBuffer(m.buffer); meshes.clear(); }
    mesh = buildMesh(gl, sprite);
    meshes.set(sprite.key, mesh);
  }
  const G = mesh.G, view = G * VOXEL_ROOM, dist = G * 4.2, fov = 2 * Math.atan(view / 2 / dist);
  const rot = mul(rotate(1, pose.ry), mul(rotate(0, pose.rx), rotate(2, -pose.rz)));
  const feet = -G / 2;
  const model = mul(translate(0, -pose.y * G, 0), mul(translate(0, feet, 0), mul(scale(pose.sx, pose.sy, pose.sx), mul(translate(0, -feet, 0), rot))));
  const mvp = mul(perspective(fov, dist - G * 2, dist + G * 2), mul(translate(0, 0, -dist), model));
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(loc.mvp as WebGLUniformLocation, false, mvp);
  gl.uniformMatrix4fv(loc.rot as WebGLUniformLocation, false, rot);
  gl.uniform3f(loc.ink as WebGLUniformLocation, ink[0], ink[1], ink[2]);
  gl.uniform3f(loc.eyeInk as WebGLUniformLocation, eyeInk[0], eyeInk[1], eyeInk[2]);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
  const stride = 7 * 4;
  for (const [name, size, offset] of [["p", 3, 0], ["n", 3, 12], ["e", 1, 24]] as const) {
    gl.enableVertexAttribArray(loc[name] as number);
    gl.vertexAttribPointer(loc[name] as number, size, gl.FLOAT, false, stride, offset);
  }
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  target.clearRect(0, 0, w, h);
  target.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
}

/** A css colour as 0..1 rgb, read through the page so variables and names resolve. */
export function rgbOf(el: HTMLElement, css: string): Rgb {
  const probe = el.style.color;
  el.style.color = css;
  const m = getComputedStyle(el).color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  el.style.color = probe;
  return [m[0]! / 255, m[1]! / 255, m[2]! / 255];
}
