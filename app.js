import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

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
let distance = 0;
let lateral = 0;
let yaw = 0;
let pitch = 0;
let walking = true;
let playing = false;
let pointer = null;
let touchDirection = 0;
let noticeTimer;
const held = new Set();
const direction = new THREE.Vector3();
const keyCommands = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

function setStatus(message, failed = false) {
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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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

function makeRoute(data) {
  const positions = data.map(({ p }) => vector(p));
  const orientations = data.map(({ q }) => new THREE.Quaternion(...q).normalize());
  const lengths = [0];
  for (let i = 1; i < positions.length; i++) {
    const step = positions[i].distanceTo(positions[i - 1]);
    const turn = orientations[i].angleTo(orientations[i - 1]);
    lengths.push(lengths.at(-1) + Math.max(step, turn * 0.28, 0.0001));
  }
  return { positions, orientations, lengths, total: lengths.at(-1) };
}

function pathPose(at) {
  const { positions, orientations, lengths } = current.route;
  let i = 0;
  while (i < lengths.length - 2 && lengths[i + 1] < at) i++;
  const t = clamp((at - lengths[i]) / (lengths[i + 1] - lengths[i]), 0, 1);
  const position = positions[i].clone().lerp(positions[i + 1], t);
  const orientation = orientations[i].clone().slerp(orientations[i + 1], t);
  const seconds = THREE.MathUtils.lerp(current.poses[i].t, current.poses[i + 1].t, t);
  return { position, orientation, seconds };
}

function placeCamera() {
  const { position, orientation, seconds } = pathPose(distance);
  direction.set(0, 0, -1).applyQuaternion(orientation);
  const side = new THREE.Vector3().crossVectors(direction, up).normalize();
  camera.position.copy(position).addScaledVector(side, lateral);
  // Keep the horizon level when the visitor looks around.
  const heading = Math.atan2(-direction.x, -direction.z);
  const elevation = Math.asin(clamp(direction.y, -1, 1));
  camera.rotation.set(clamp(elevation + pitch, -1.45, 1.45), heading + yaw, 0, "YXZ");
  $("route-time").textContent = `${seconds.toFixed(1)} s`;
  drawMap();
  draw();
}

function draw() {
  if (renderer && current) renderer.render(display, camera);
}

function drawMap() {
  const { positions } = current.route;
  const xs = positions.map((p) => p.x);
  const zs = positions.map((p) => p.z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const spanX = Math.max(...xs) - minX, spanZ = Math.max(...zs) - minZ;
  const scale = Math.min((map.width - 20) / Math.max(spanX, 0.01), (map.height - 20) / Math.max(spanZ, 0.01));
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

function setPlaying(value) {
  playing = value;
  $("play").setAttribute("aria-pressed", String(playing));
  $("play-label").textContent = playing ? "Pause" : "Play tour";
  $("play-icon").textContent = playing ? "Ⅱ" : "▶";
}

function stop() {
  setPlaying(false);
  held.clear();
  touchDirection = 0;
}

function setMode(walk) {
  if (!current) return;
  walking = walk;
  orbit.enabled = !walk;
  $("walk").setAttribute("aria-pressed", String(walk));
  $("orbit").setAttribute("aria-pressed", String(!walk));
  $("route-panel").hidden = !walk;
  $("touch-controls").hidden = !walk;
  $("help").textContent = walk
    ? coarse.matches ? "Drag to look · Hold arrows to move" : "Drag to look · W/S to move along the scan · A/D to sidestep"
    : coarse.matches ? "Drag to orbit · Pinch to zoom" : "Drag to orbit · Scroll to zoom · Right-drag to pan";
  if (walk) {
    placeCamera();
  } else {
    stop();
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
  stop();
  distance = current.route.lengths[current.start];
  lateral = yaw = pitch = 0;
  setMode(walking);
}

function update(clock) {
  frame = 0;
  const dt = Math.min((clock - lastClock) / 1000, 0.05);
  lastClock = clock;
  if (!current) return;
  if (!walking) {
    const changed = orbit.update();
    if (changed) schedule();
    return;
  }
  const keyboard = Number(held.has("KeyW") || held.has("ArrowUp"))
    - Number(held.has("KeyS") || held.has("ArrowDown"));
  const sidestep = Number(held.has("KeyD") || held.has("ArrowRight"))
    - Number(held.has("KeyA") || held.has("ArrowLeft"));
  const movement = playing ? 1 : keyboard || touchDirection;
  if (movement || sidestep) {
    distance = clamp(distance + movement * dt * current.speed, 0, current.route.total);
    lateral = clamp(lateral + dt * sidestep * current.speed * 0.6, -current.width, current.width);
    placeCamera();
  }
  if (playing && distance >= current.route.total) setPlaying(false);
  if (playing || held.size || touchDirection) schedule();
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
  const id = location.hash.slice(1);
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
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      const source = object.material;
      object.material = new THREE.MeshBasicMaterial({
        map: source.map, color: source.color, vertexColors: source.vertexColors,
        side: THREE.DoubleSide, toneMapped: false,
      });
      source.dispose();
    });
    gltf.scene.quaternion.set(...metadata.alignment);
    display.add(gltf.scene);
    current = { ...metadata, model: gltf.scene, route: makeRoute(metadata.poses) };
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
$("play").onclick = () => {
  if (!current) return;
  if (playing) {
    setPlaying(false);
    return;
  }
  if (distance >= current.route.total - 0.01 || !walking || Math.abs(distance - current.route.lengths[current.start]) < 0.001) distance = 0;
  lateral = yaw = pitch = 0;
  setMode(true);
  setPlaying(true);
  schedule();
};
$("property").onchange = (event) => { location.hash = event.target.value; };
window.addEventListener("hashchange", () => { if (catalog) load(getId()); });
$("retry").onclick = () => renderer && !renderer.getContext().isContextLost() && catalog ? load(getId()) : location.reload();
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
  setPlaying(false);
  held.add(event.code);
  schedule();
});
window.addEventListener("keyup", (event) => held.delete(event.code));
window.addEventListener("blur", stop);
canvas.addEventListener("pointerdown", (event) => {
  if (!current || !walking || event.button !== 0 || pointer) return;
  setPlaying(false);
  canvas.setPointerCapture(event.pointerId);
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointer || event.pointerId !== pointer.id) return;
  yaw -= (event.clientX - pointer.x) * 0.004;
  pitch = clamp(pitch + (event.clientY - pointer.y) * 0.004, -1.4, 1.4);
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
  setPlaying(false);
  const wheelPixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  distance = clamp(distance + wheelPixels * current.speed * 0.003, 0, current.route.total);
  placeCamera();
}, { passive: false });
for (const [id, sign] of [["forward", 1], ["back", -1]]) {
  const button = $(id);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    setPlaying(false);
    touchDirection = sign;
    schedule();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, () => { if (touchDirection === sign) touchDirection = 0; });
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
  setStatus("The 3D viewer could not start. Check WebGL and try again.", true);
}
