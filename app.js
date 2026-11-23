import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { SoftwareRenderer } from "./software-renderer.js";

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const viewer = $("viewer");
const map = $("map");
const ctx = map.getContext("2d");
const coarse = matchMedia("(pointer: coarse)");
const up = new THREE.Vector3(0, 1, 0);
const vector = (values) => new THREE.Vector3(...values);
const clamp = THREE.MathUtils.clamp;
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
  camera.fov = clamp(64 - 15 * (camera.aspect - 0.7), 44, 68);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  draw();
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
  if (renderer && current) renderer.render(display, camera);
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
  direction.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(...pose.q).normalize());
  walkRotation.set(Math.asin(clamp(direction.y, -1, 1)), Math.atan2(-direction.x, -direction.z), 0);
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

async function load(id) {
  const ticket = ++request;
  stop();
  $("property").value = id;
  setStatus("Loading 3D scan…");
  const entry = catalog.find((item) => item.id === id);
  $("name").textContent = entry.name;
  $("coverage").textContent = entry.coverage;
  try {
    const [metadata, gltf] = await Promise.all([
      fetch(entry.track).then((response) => {
        if (!response.ok) throw new Error("Camera route unavailable");
        return response.json();
      }),
      loader.loadAsync(entry.mesh),
    ]);
    if (ticket !== request) {
      dispose(gltf.scene);
      return;
    }
    if (metadata.poses.length < 2) throw new Error("Incomplete camera route");
    if (current) {
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
      source.dispose();
    });
    gltf.scene.quaternion.set(...metadata.alignment);
    display.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    renderer.setMeshes?.(meshes);
    current = { ...metadata, model: gltf.scene, meshes, route: makeRoute(metadata.poses),
      walkRadius: metadata.radius * 0.19 };
    walking = true;
    reset();
    setStatus("");
  } catch (error) {
    if (ticket === request) {
      console.error("Scan load failed", error);
      setStatus("This scan could not load.", true);
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
    await navigator.clipboard.writeText(new URL(`#${getId()}`, location.href).href);
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
  walkRotation.y -= (event.clientX - pointer.x) * 0.004;
  walkRotation.x = clamp(walkRotation.x + (event.clientY - pointer.y) * 0.004, -1.4, 1.4);
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

try {
  initRenderer();
  const response = await fetch("./assets/scans/index.json");
  if (!response.ok) throw new Error("Scan manifest unavailable");
  catalog = await response.json();
  $("property").replaceChildren(...catalog.map(({ id, name }) => new Option(name, id)));
  await load(getId());
} catch (error) {
  console.error("Tour initialization failed", error);
  setStatus("The 3D viewer could not start.", true);
}
