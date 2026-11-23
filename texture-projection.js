import { Matrix4, NearestFilter, Quaternion, TextureLoader, Vector3, Vector4 } from "three";

function loadDepthPixels(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function loadProjection(source, alignment, radius) {
  const [raw, depth] = await Promise.all([
    fetch(source + ".json").then((response) => {
      if (!response.ok) throw new Error("Camera references unavailable");
      return response.json();
    }),
    new TextureLoader().loadAsync(source + ".png"),
  ]);
  depth.flipY = false;
  depth.generateMipmaps = false;
  depth.minFilter = depth.magFilter = NearestFilter;
  depth.needsUpdate = true;
  const inverse = new Matrix4().makeRotationFromQuaternion(new Quaternion(...alignment));
  const rotation = inverse.clone();
  inverse.invert();
  const views = raw.map((view) => ({
    ...view,
    position: new Vector3(...view.origin).applyMatrix4(rotation),
    facing: new Vector3(...view.forward).transformDirection(rotation),
    transform: new Matrix4().set(...view.matrix.flat(), 0, 0, 0, 1).multiply(inverse),
    tile: new Vector4(...view.rect),
    depthTile: new Vector4(...view.depthRect),
    lens: new Vector4(...view.intrinsics),
  }));
  const depthPixels = loadDepthPixels(depth.image);
  const { width, height } = depth.image;
  const forward = new Vector3();
  let active = [];
  const uniforms = {
    tourCamera: { value: [new Matrix4(), new Matrix4()] },
    tourRect: { value: [new Vector4(), new Vector4()] },
    tourDepthRect: { value: [new Vector4(), new Vector4()] },
    tourLens: { value: [new Vector4(), new Vector4()] },
    tourScale: { value: [1, 1] },
    tourWeight: { value: [0, 0] },
    tourDepth: { value: depth },
  };

  function update(camera, enabled) {
    active = [];
    uniforms.tourWeight.value.fill(0);
    if (!enabled) return;
    camera.getWorldDirection(forward);
    const ranked = views.map((view) => {
      const separation = camera.position.distanceTo(view.position) / Math.max(0.5, radius * 0.12);
      const angle = Math.acos(Math.min(1, Math.max(-1, forward.dot(view.facing))));
      const score = 1 / (0.1 + separation ** 2 + angle ** 2 * 3) ** 2;
      return { view, score };
    }).sort((a, b) => b.score - a.score).slice(0, 2);
    const peak = ranked[0].score;
    active = ranked.map(({ view, score }, i) => {
      uniforms.tourCamera.value[i] = view.transform;
      uniforms.tourRect.value[i] = view.tile;
      uniforms.tourDepthRect.value[i] = view.depthTile;
      uniforms.tourLens.value[i] = view.lens;
      uniforms.tourScale.value[i] = view.depthScale;
      uniforms.tourWeight.value[i] = score / peak;
      return { view, weight: score / peak };
    });
  }

  function applyMaterial(material) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = "varying vec3 tourWorld;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>", "#include <begin_vertex>\ntourWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
      shader.fragmentShader = `
        varying vec3 tourWorld;
        uniform mat4 tourCamera[2];
        uniform vec4 tourRect[2], tourDepthRect[2], tourLens[2];
        uniform float tourScale[2], tourWeight[2];
        uniform sampler2D tourDepth;
      ` + shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        vec3 projectedColor = vec3(0.0);
        float projectedWeight = 0.0;
        for (int i = 0; i < 2; i++) {
          if (tourWeight[i] <= 0.0) continue;
          vec3 p = (tourCamera[i] * vec4(tourWorld, 1.0)).xyz;
          if (p.z <= 0.015) continue;
          vec2 uv = p.xy / p.z * tourLens[i].xy + tourLens[i].zw;
          vec2 edge = min(uv, 1.0 - uv);
          float border = min(edge.x, edge.y);
          if (border <= 0.0) continue;
          float measured = texture2D(tourDepth, tourDepthRect[i].xy + uv * tourDepthRect[i].zw).r * tourScale[i];
          float tolerance = max(tourScale[i] * 0.017, measured * 0.06);
          float agreement = 1.0 - smoothstep(tolerance, 2.0 * tolerance, abs(p.z - measured));
          if (measured <= 0.0) continue;
          float weight = tourWeight[i] * smoothstep(0.0, 0.07, border) * agreement;
          projectedColor += texture2D(map, tourRect[i].xy + uv * tourRect[i].zw).rgb * weight;
          projectedWeight += weight;
        }
        if (projectedWeight > 0.0) {
          diffuseColor.rgb = mix(diffuseColor.rgb, projectedColor / projectedWeight, min(1.0, 2.8 * projectedWeight));
        }
      `);
    };
  }

  function sample(x, y, z, atlas, fallback) {
    let red = 0, green = 0, blue = 0, sum = 0;
    for (const { view, weight } of active) {
      const e = view.transform.elements;
      const distance = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (distance <= 0.015) continue;
      const [fx, fy, cx, cy] = view.intrinsics;
      const u = (e[0] * x + e[4] * y + e[8] * z + e[12]) * fx / distance + cx;
      const v = (e[1] * x + e[5] * y + e[9] * z + e[13]) * fy / distance + cy;
      const border = Math.min(u, v, 1 - u, 1 - v);
      if (border <= 0) continue;
      const [dx, dy, dw, dh] = view.depthRect;
      const tx = Math.floor((dx + u * dw) * width);
      const ty = Math.floor((dy + v * dh) * height);
      const measured = depthPixels[4 * (ty * width + tx)] * view.depthScale / 255;
      if (!measured) continue;
      const tolerance = Math.max(view.depthScale * 0.017, measured * 0.06);
      const t = Math.max(0, Math.min(1, Math.abs(distance - measured) / tolerance - 1));
      const edge = Math.min(1, border / 0.07);
      const contribution = weight * edge * edge * (3 - 2 * edge) * (1 - t * t * (3 - 2 * t));
      if (!contribution) continue;
      const [sx, sy, sw, sh] = view.rect;
      const color = atlas.colors[Math.floor((sy + v * sh) * atlas.height) * atlas.width + Math.floor((sx + u * sw) * atlas.width)];
      red += (color & 255) * contribution;
      green += ((color >>> 8) & 255) * contribution;
      blue += ((color >>> 16) & 255) * contribution;
      sum += contribution;
    }
    if (!sum) return fallback;
    const opacity = Math.min(1, 2.8 * sum);
    const mix = (value, original) => Math.round(value / sum * opacity + original * (1 - opacity));
    return (0xff000000 | (mix(blue, (fallback >>> 16) & 255) << 16)
      | (mix(green, (fallback >>> 8) & 255) << 8) | mix(red, fallback & 255)) >>> 0;
  }

  return { update, applyMaterial, sample, dispose: () => depth.dispose() };
}
