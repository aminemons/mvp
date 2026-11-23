import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { SoftwareRenderer } from "./software-renderer.js";
import { loadProjection } from "./texture-projection.js";

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const viewer = $("viewer");
const map = $("map");
const ctx = map.getContext("2d");
const coarse = matchMedia("(pointer: coarse)");
const up = new THREE.Vector3(0, 1, 0);
const vector = (values) => new THREE.Vector3(...values);
const { clamp, degToRad, radToDeg } = THREE.MathUtils;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const display = new THREE.Scene();
display.background = new THREE.Color("#2c2c30");
const camera = new THREE.PerspectiveCamera(55, 1, 0.015, 180);
camera.rotation.order = "YXZ";

let renderer;
let orbit;
let catalog;
let current;
let request = 0;
let frame = 0;
let lastClock = 0;
let walking = true;
let pointer = null;
let noticeTimer;
const held = new Set();
const touchKeys = new Set();
const direction = new THREE.Vector3();
const right = new THREE.Vector3();
const candidate = new THREE.Vector3();
const movement = new THREE.Vector3();
const closest = new THREE.Vector3();
const ray = new THREE.Raycaster();
const hit = [];
const walkPosition = new THREE.Vector3();
const walkRotation = new THREE.Euler(0, 0, 0, "YXZ");
const keyCommands = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function setStatus(message, failed = false) {
  viewer.setAttribute("aria-busy", String(Boolean(message && !failed)));
  viewer.classList.toggle("scan-unavailable", Boolean(message));
  $("progress").hidden = !message;
  $("progress-text").textContent = message;
  $("retry").hidden = !failed;
  $("progress").querySelector(".spinner").hidden = failed;
  $("controls").hidden = Boolean(message);
  $("route-panel").hidden = Boolean(message);
  $("touch-controls").hidden = Boolean(message) || !walking;
}

function notify(message) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  noticeTimer = setTimeout(() => { $("notice").textContent = ""; }, 2800);
}

function initRenderer() {
  const context = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (context) {
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    renderer = new SoftwareRenderer(canvas);
  }
  orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.11;
  orbit.addEventListener("change", () => {
    draw();
    if (!walking) schedule();
  });
  new ResizeObserver(resize).observe(viewer);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    setStatus("Graphics paused. Reload to resume the tour.", true);
  });
  resize();
}

function resize() {
  const { width, height } = viewer.getBoundingClientRect();
  if (!width || !height) return;
  camera.aspect = width / height;
  updateLens();
  renderer.setSize(width, height, false);
  draw();
}

function updateLens() {
  const vertical = 2 * Math.atan(Math.tan(degToRad(59) / 2) / camera.aspect);
  camera.fov = walking ? Math.min(64, radToDeg(vertical)) : 48;
  camera.updateProjectionMatrix();
}

function headingOf(pose) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.q).normalize());
  return { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(clamp(forward.y, -1, 1)) };
}

function angleFrom(yaw, base) {
  return Math.atan2(Math.sin(yaw - base), Math.cos(yaw - base));
}

function supportedAngles(poses, start) {
  const base = headingOf(poses[start]).yaw;
  const headings = poses.map(headingOf);
  const yaw = headings.map((pose) => angleFrom(pose.yaw, base));
  const pitch = headings.map((pose) => pose.pitch);
  const margin = degToRad(13);
  return { base, left: Math.min(...yaw) - margin, right: Math.max(...yaw) + margin,
    lower: Math.max(-1.1, Math.min(...pitch) - margin), upper: Math.min(1.1, Math.max(...pitch) + margin) };
}

function makeRoute(poses) {
  const positions = poses.map(({ p }) => vector(p));
  const segments = positions.slice(1).map((end, i) => new THREE.Line3(positions[i], end));
  const box = new THREE.Box3().setFromPoints(positions);
  return { positions, segments, box };
}

function placeCamera() {
  camera.position.copy(walkPosition);
  camera.rotation.copy(walkRotation);
  drawMap();
  draw();
}

function walk(forward, sideways, step) {
  direction.set(0, 0, -1).applyAxisAngle(up, walkRotation.y);
  right.crossVectors(direction, up);
  movement.copy(direction).multiplyScalar(forward).addScaledVector(right, sideways);
  if (!movement.lengthSq()) return;
  movement.normalize();
  const clearance = current.radius * 0.009;
  hit.length = 0;
  ray.set(walkPosition, movement);
  ray.near = 0.001;
  ray.far = step + clearance;
  ray.intersectObjects(current.meshes, false, hit);
  const travel = hit.length ? Math.max(0, hit[0].distance - clearance) : step;
  if (!travel) return;
  candidate.copy(walkPosition).addScaledVector(movement, travel);
  // The camera can leave the capture line within the observed area. Orbit mode can inspect the entire mesh.
  const withinCoverage = current.route.segments.some((segment) => {
    segment.closestPointToPoint(candidate, true, closest);
    return closest.distanceToSquared(candidate) <= current.walkRadius ** 2;
  });
  if (!withinCoverage) return;
  walkPosition.copy(candidate);
  placeCamera();
}

function draw() {
  if (!renderer || !current) return;
  current.projection?.update(camera, walking);
  renderer.render(display, camera);
}

function drawMap() {
  const { positions, box } = current.route;
  const minX = box.min.x - current.walkRadius, minZ = box.min.z - current.walkRadius;
  const spanX = box.max.x - minX + current.walkRadius, spanZ = box.max.z - minZ + current.walkRadius;
  const scale = Math.min((map.width - 18) / spanX, (map.height - 20) / spanZ);
  function project(p) {
    return [(map.width - spanX * scale) / 2 + (p.x - minX) * scale,
      (map.height - spanZ * scale) / 2 + (p.z - minZ) * scale];
  }
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.beginPath();
  positions.forEach((p, index) => {
    const [x, y] = project(p);
    if (index) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = "#b9b5a4";
  ctx.stroke();
  const [x, y] = project(camera.position);
  camera.getWorldDirection(direction);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 10 * direction.x, y + 10 * direction.z);
  ctx.strokeStyle = "#ebdca8";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ebdca8";
  ctx.fill();
}

function stop() {
  held.clear();
  touchKeys.clear();
  pointer = null;
}

function setMode(walk) {
  if (!current) return;
  stop();
  walking = walk;
  updateLens();
  orbit.enabled = !walk;
  $("walk").setAttribute("aria-pressed", String(walk));
  $("orbit").setAttribute("aria-pressed", String(!walk));
  $("route-panel").hidden = !walk;
  $("touch-controls").hidden = !walk;
  $("help").textContent = walk
    ? coarse.matches ? "Drag to look · Hold arrows to move" : "Drag to look · WASD or arrows to move · Wheel to step"
    : coarse.matches ? "Drag to orbit · Pinch to zoom" : "Drag to orbit · Scroll to zoom · Right-drag to pan";
  if (walk) {
    placeCamera();
  } else {
    const [x, y, z] = current.center;
    orbit.target.set(x, y, z);
    orbit.minDistance = current.radius * 0.08;
    orbit.maxDistance = current.radius * 6;
    camera.position.copy(orbit.target).addScaledVector(new THREE.Vector3(1, 0.92, 1.08), current.radius);
    orbit.update();
  }
  draw();
  schedule();
}

function reset() {
  if (!current) return;
  const pose = current.poses[current.start];
  walkPosition.copy(vector(pose.p));
  const { pitch, yaw } = headingOf(pose);
  walkRotation.set(pitch, yaw, 0);
  setMode(walking);
}

function update(clock) {
  frame = 0;
  const dt = Math.min(Math.max((clock - lastClock) / 1000, 0), 0.05);
  if (!current) return;
  if (!walking) {
    if (orbit.update()) schedule();
    return;
  }
  const pressed = (key, arrow) => held.has(key) || held.has(arrow) || touchKeys.has(arrow);
  const forward = Number(pressed("KeyW", "ArrowUp")) - Number(pressed("KeyS", "ArrowDown"));
  const sideways = Number(pressed("KeyD", "ArrowRight")) - Number(pressed("KeyA", "ArrowLeft"));
  if (dt > 0 && (forward || sideways)) walk(forward, sideways, dt * current.speed * 0.52);
  if (held.size || touchKeys.size) schedule();
}

function schedule() {
  if (!frame) {
    lastClock = performance.now();
    frame = requestAnimationFrame(update);
  }
}

function dispose(root) {
  if (!root) return;
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    for (const material of [object.material].flat()) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function getId() {
  const id = location.hash.slice(1).replace(/^tour-0([12])$/, "tour-$1");
  return catalog.find((item) => item.id === id)?.id || catalog[0].id;
}

function portableMetadata(bytes) {
  if (bytes.byteLength < 28 || bytes.byteLength > 128 * 1024 ** 2) {
    throw new Error("Select a Vyral GLB up to 128 MB.");
  }
  const header = new DataView(bytes);
  const size = header.getUint32(12, true);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2
      || header.getUint32(8, true) !== bytes.byteLength || size > bytes.byteLength - 28
      || header.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error("This is not a valid GLB file.");
  }
  const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, size)));
  const data = doc?.extras?.vyralTour;
  const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
  const quaternion = (value) => vector(value, 4) && Math.abs(Math.hypot(...value) - 1) < 0.02;
  if (data?.version !== 1 || typeof data.name !== "string" || !quaternion(data.alignment)
      || !vector(data.center, 3) || !Number.isFinite(data.radius) || data.radius <= 0
      || !Number.isFinite(data.speed) || data.speed <= 0 || !Array.isArray(data.poses)
      || data.poses.length < 2 || data.poses.length > 180 || !Number.isInteger(data.start)
      || data.start < 0 || data.start >= data.poses.length
      || data.poses.some((pose) => !vector(pose?.p, 3) || !quaternion(pose?.q))) {
    throw new Error("This GLB is missing the Vyral camera route. Use a file exported by Studio.");
  }
  const buffers = doc.buffers;
  const hasInternalBuffers = Array.isArray(buffers) && buffers.length >= 1 && buffers.length <= 2
    && buffers.every((buffer, index) => buffer && !("uri" in buffer)
      && (index === 0 || buffer.extensions?.EXT_meshopt_compression?.fallback === true));
  if (!hasInternalBuffers || !Array.isArray(doc.images) || !doc.images.length
      || doc.images.some((entry) => !entry || "uri" in entry || !Number.isInteger(entry.bufferView))) {
    throw new Error("The tour must contain its mesh and textures in a single file.");
  }
  return data;
}

function fillPropertyOptions() {
  $("property").replaceChildren(...catalog.map(({ id, name }) => new Option(name, id)));
}

async function readTour(entry) {
  if (entry.bundle || entry.file) {
    const bytes = entry.file ? await entry.file.arrayBuffer() : await fetch(entry.bundle).then((response) => {
      if (!response.ok) throw new Error("The local job is unavailable. Open it from the local Studio.");
      const length = Number(response.headers.get("Content-Length"));
      if (length > 128 * 1024 ** 2) throw new Error("The tour is larger than the viewer limit.");
      return response.arrayBuffer();
    });
    const metadata = portableMetadata(bytes);
    return [metadata, await loader.parseAsync(bytes, "")];
  }
  return Promise.all([
    fetch(entry.track).then((response) => {
      if (!response.ok) throw new Error("Camera route unavailable");
      return response.json();
    }),
    loader.loadAsync(entry.mesh),
  ]);
}

async function load(id) {
  const ticket = ++request;
  stop();
  $("property").value = id;
  $("share").hidden = id === "imported" || id === "local-job";
  setStatus("Loading 3D scan…");
  const entry = catalog.find((item) => item.id === id);
  $("name").textContent = entry.name;
  $("coverage").textContent = entry.coverage;
  try {
    const [metadata, gltf] = await readTour(entry);
    if ((entry.file || entry.bundle) && ticket === request) {
      entry.name = metadata.name;
      $("name").textContent = metadata.name;
      $("coverage").textContent = "Studio reconstruction · review before sharing";
      fillPropertyOptions();
      $("property").value = entry.id;
    }
    let projection;
    if (entry.views && ticket === request) {
      try {
        projection = await loadProjection(entry.views, metadata.alignment, metadata.radius);
      } catch (error) {
        console.warn("Additional scan textures unavailable", error);
      }
    }
    if (ticket !== request) {
      projection?.dispose();
      dispose(gltf.scene);
      return;
    }
    if (metadata.poses.length < 2) throw new Error("Incomplete camera route");
    if (current) {
      current.projection?.dispose();
      display.remove(current.model);
      dispose(current.model);
    }
    const meshes = [];
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      meshes.push(object);
      const source = object.material;
      object.material = new THREE.MeshBasicMaterial({
        map: source.map, color: source.color, vertexColors: source.vertexColors,
        side: THREE.DoubleSide, toneMapped: false,
      });
      projection?.applyMaterial(object.material);
      source.dispose();
    });
    gltf.scene.quaternion.set(...metadata.alignment);
    display.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    renderer.setMeshes?.(meshes);
    renderer.setProjection?.(projection);
    current = { ...metadata, projection, model: gltf.scene, meshes, route: makeRoute(metadata.poses),
      walkRadius: metadata.radius * 0.105, angles: supportedAngles(metadata.poses, metadata.start) };
    walking = true;
    reset();
    setStatus("");
  } catch (error) {
    if (ticket === request) {
      console.error("Scan load failed", error);
      setStatus(entry.bundle || entry.file ? error.message : "This scan could not load.", true);
    }
  }
}

$("walk").onclick = () => setMode(true);
$("orbit").onclick = () => setMode(false);
$("reset").onclick = reset;
$("property").onchange = (event) => { location.hash = event.target.value; };
window.addEventListener("hashchange", () => { if (catalog) load(getId()); });
$("retry").onclick = () => renderer && !renderer.getContext?.()?.isContextLost() && catalog ? load(getId()) : location.reload();
$("fullscreen").hidden = !document.fullscreenEnabled;
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector(".app").requestFullscreen();
  } catch {
    notify("Fullscreen is unavailable.");
  }
};
$("share").onclick = async () => {
  try {
    await navigator.clipboard.writeText(new URL(`./viewer.html#${getId()}`, location.href).href);
    notify("Tour link copied");
  } catch {
    notify("Copy the address to share this tour.");
  }
};
window.addEventListener("keydown", (event) => {
  if (!current || !walking || !keyCommands.has(event.code) || event.target.closest("select, input, textarea") || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  held.add(event.code);
  schedule();
});
window.addEventListener("keyup", (event) => held.delete(event.code));
window.addEventListener("blur", stop);
canvas.addEventListener("pointerdown", (event) => {
  if (!current || !walking || event.button !== 0 || pointer) return;
  canvas.setPointerCapture(event.pointerId);
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer || event.pointerId !== pointer.id) return;
  const { base, left, right, lower, upper } = current.angles;
  const turned = angleFrom(walkRotation.y, base) - (event.clientX - pointer.x) * 0.0025;
  const tilted = walkRotation.x + (event.clientY - pointer.y) * 0.0025;
  walkRotation.y = base + clamp(turned, left, right);
  walkRotation.x = clamp(tilted, lower, upper);
  if (!pointer.limited && (turned < left || turned > right || tilted < lower || tilted > upper)) {
    pointer.limited = true;
    notify("Edge of the captured views");
  }
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  placeCamera();
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  canvas.addEventListener(eventName, (event) => { if (pointer?.id === event.pointerId) pointer = null; });
}
canvas.addEventListener("wheel", (event) => {
  if (!current || !walking) return;
  event.preventDefault();
  const wheelPixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  if (wheelPixels) walk(Math.sign(wheelPixels), 0, current.speed * Math.min(Math.abs(wheelPixels), 100) * 0.001);
}, { passive: false });
for (const [id, command] of [["forward", "ArrowUp"], ["back", "ArrowDown"], ["right", "ArrowRight"], ["left", "ArrowLeft"]]) {
  const button = $(id);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchKeys.add(command);
    schedule();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, () => touchKeys.delete(command));
  }
}

const dialog = $("import-dialog");
const tourFile = $("tour-file");
$("open-file").onclick = () => {
  $("import-error").textContent = "";
  tourFile.value = "";
  dialog.showModal();
};
dialog.addEventListener("close", () => {
  if (catalog && !current && location.hash === "#import") {
    history.replaceState(null, "", "./viewer.html");
    load(getId());
  }
});
tourFile.onchange = async () => {
  const file = tourFile.files[0];
  if (!file) return;
  tourFile.disabled = true;
  $("import-error").textContent = "Checking the tour file…";
  try {
    if (file.size > 128 * 1024 ** 2) throw new Error("Choose an exported Vyral GLB up to 128 MB.");
    const bytes = await file.arrayBuffer();
    const metadata = portableMetadata(bytes);
    catalog = catalog.filter((entry) => entry.id !== "imported");
    catalog.unshift({ id: "imported", name: metadata.name, file });
    fillPropertyOptions();
    history.replaceState(null, "", "./viewer.html#imported");
    dialog.close();
    await load("imported");
  } catch (error) {
    $("import-error").textContent = error.message;
  } finally {
    tourFile.disabled = false;
    tourFile.value = "";
  }
};

try {
  initRenderer();
  const response = await fetch("./assets/scans/index.json");
  if (!response.ok) throw new Error("Scan manifest unavailable");
  catalog = await response.json();
  const job = new URLSearchParams(location.search).get("job");
  if (job && /^[0-9a-f]{32}$/.test(job)) {
    catalog.unshift({ id: "local-job", name: "Studio scan", bundle: `./api/jobs/${job}/result.glb` });
  }
  fillPropertyOptions();
  if (location.hash === "#import") {
    setStatus("Choose a tour file to begin.");
    viewer.setAttribute("aria-busy", "false");
    $("progress").querySelector(".spinner").hidden = true;
    $("import-dialog").showModal();
  } else {
    await load(getId());
  }
} catch (error) {
  console.error("Tour initialization failed", error);
  setStatus("The 3D viewer could not start.", true);
}
