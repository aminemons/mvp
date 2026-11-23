import { Matrix4, Vector3 } from "three";

const background = 0xff302c2c;
const maxPixels = 210_000;

// Canvas2D fallback for browsers without WebGL. Render the same indexed triangles and atlas.
export class SoftwareRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.transform = new Matrix4();
    this.meshes = [];
  }

  setSize(width, height) {
    const ratio = Math.min(1, Math.sqrt(maxPixels / (width * height)));
    this.canvas.width = Math.max(1, Math.floor(width * ratio));
    this.canvas.height = Math.max(1, Math.floor(height * ratio));
    this.image = this.context.createImageData(this.canvas.width, this.canvas.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.depth = new Float32Array(this.pixels.length);
  }

  setMeshes(meshes) {
    const sources = new Map();
    const vertex = new Vector3();
    this.meshes = meshes.map((mesh) => {
      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      const world = new Float32Array(position.count * 3);
      const texcoords = new Float32Array(position.count * 2);
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray(world, i * 3);
        texcoords.set([uv.getX(i), uv.getY(i)], i * 2);
      }
      const source = mesh.material.map.image;
      if (!sources.has(source)) {
        const atlas = document.createElement("canvas");
        atlas.width = source.width;
        atlas.height = source.height;
        const context = atlas.getContext("2d", { willReadFrequently: true });
        context.drawImage(source, 0, 0);
        const colors = new Uint32Array(context.getImageData(0, 0, atlas.width, atlas.height).data.buffer);
        sources.set(source, { colors, width: atlas.width, height: atlas.height });
      }
      const indices = geometry.index?.array ?? Uint32Array.from({ length: position.count }, (_, i) => i);
      return { world, texcoords, indices, atlas: sources.get(source), projected: new Float32Array(world.length) };
    });
  }

  render(_scene, camera) {
    if (!this.image) return;
    this.pixels.fill(background);
    this.depth.fill(0);
    camera.updateMatrixWorld();
    const matrix = this.transform.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    const { width, height } = this.image;
    for (const mesh of this.meshes) {
      const { world, projected } = mesh;
      for (let i = 0; i < world.length; i += 3) {
        const x = world[i], y = world[i + 1], z = world[i + 2];
        const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        if (w <= camera.near) {
          projected[i + 2] = 0;
          continue;
        }
        const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
        const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
        projected[i] = (1 + clipX / w) * width * 0.5;
        projected[i + 1] = (1 - clipY / w) * height * 0.5;
        projected[i + 2] = 1 / w;
      }
      this.rasterize(mesh, width, height);
    }
    this.context.putImageData(this.image, 0, 0);
  }

  rasterize({ indices, projected, texcoords, atlas }, width, height) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      const da = projected[a * 3 + 2], db = projected[b * 3 + 2], dc = projected[c * 3 + 2];
      if (!da || !db || !dc) continue;
      const ax = projected[a * 3], bx = projected[b * 3], cx = projected[c * 3];
      const ay = projected[a * 3 + 1], by = projected[b * 3 + 1], cy = projected[c * 3 + 1];
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      if (minX > maxX || minY > maxY) continue;
      const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(area) < 0.001) continue;
      const ua = texcoords[a * 2] * da, ub = texcoords[b * 2] * db, uc = texcoords[c * 2] * dc;
      const va = texcoords[a * 2 + 1] * da, vb = texcoords[b * 2 + 1] * db, vc = texcoords[c * 2 + 1] * dc;
      const stepA = (by - cy) / area, stepB = (cy - ay) / area;
      for (let y = minY; y <= maxY; y++) {
        let qa = ((by - cy) * (minX + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / area;
        let qb = ((cy - ay) * (minX + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / area;
        for (let x = minX; x <= maxX; x++, qa += stepA, qb += stepB) {
          const qc = 1 - qa - qb;
          if (qa < 0 || qb < 0 || qc < 0) continue;
          const depth = qa * da + qb * db + qc * dc;
          const offset = y * width + x;
          if (depth <= this.depth[offset]) continue;
          const u = (qa * ua + qb * ub + qc * uc) / depth;
          const v = (qa * va + qb * vb + qc * vc) / depth;
          const tx = Math.max(0, Math.min(atlas.width - 1, Math.floor(u * atlas.width)));
          const ty = Math.max(0, Math.min(atlas.height - 1, Math.floor(v * atlas.height)));
          this.pixels[offset] = atlas.colors[ty * atlas.width + tx];
          this.depth[offset] = depth;
        }
      }
    }
  }
}
