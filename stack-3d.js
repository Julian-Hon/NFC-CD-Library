import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

const stage = document.querySelector('.stack-stage');
const canvas = document.querySelector('#stack-canvas');
const buttons = document.querySelector('#cd-stack');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const WIDTH = 6.1;
const DEPTH = 5.2;
const HEIGHT = .4;
const SPACING = .5;
const offsets = [-.18, .13, -.09, .22, -.14, .08, -.2, .16];
const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, .1, 100);
camera.position.set(1.6, 3, 12);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

scene.add(new THREE.HemisphereLight(0xfff6e6, 0x786251, 2.2));
const sunlight = new THREE.DirectionalLight(0xffe7c8, 3.3);
sunlight.position.set(-4, 9, 7);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(1024, 1024);
sunlight.shadow.camera.left = -12;
sunlight.shadow.camera.right = 12;
sunlight.shadow.camera.top = 12;
sunlight.shadow.camera.bottom = -12;
sunlight.shadow.bias = -.0005;
scene.add(sunlight);
const fill = new THREE.DirectionalLight(0xe5edff, 1.2);
fill.position.set(7, 4, -4);
scene.add(fill);

const table = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.ShadowMaterial({ color: '#513925', opacity: .28 })
);
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

const railMaterial = new THREE.MeshPhysicalMaterial({
  color: '#fbf4e9', metalness: .13, roughness: .13, clearcoat: 1,
  transparent: true, opacity: .82, depthWrite: false
});
const darkRailMaterial = new THREE.MeshStandardMaterial({ color: '#655e58', metalness: .2, roughness: .32 });
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const entries = [];
let selected = 0;
let animate = true;
let visible = false;
let frame = 0;
let lastWidth = 0;
let lastHeight = 0;
let albumSignature = '';

function canvasTexture(draw) {
  const source = document.createElement('canvas');
  source.width = 1024;
  source.height = 1024;
  const context = source.getContext('2d');
  draw(context, source.width, source.height);
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

function fitText(context, value, maximum, initialSize, minimumSize = 28) {
  let size = initialSize;
  do {
    context.font = `700 ${size}px Arial, sans-serif`;
    if (context.measureText(value).width <= maximum) break;
    size -= 2;
  } while (size > minimumSize);
  return size;
}

function spineTexture(cd, index) {
  return canvasTexture((context, width) => {
    context.fillStyle = index % 3 === 0 ? '#e9e0d1' : index % 3 === 1 ? '#eee8dd' : '#ddd5c8';
    context.fillRect(0, 0, width, width);
    context.fillStyle = '#8d7159';
    context.fillRect(0, 0, 20, width);
    context.fillStyle = '#2e2925';
    fitText(context, cd.album, 920, 106, 48);
    context.fillText(cd.album, 46, 142);
    context.font = '54px Arial, sans-serif';
    context.fillStyle = '#6c5b4f';
    context.fillText(cd.artist, 48, 255, 920);
  });
}

function placeholderCover(cd, index) {
  return canvasTexture((context, width, height) => {
    const palettes = [['#a66c5b', '#e3b99e'], ['#797360', '#d6c7a3'], ['#596d72', '#b5c5c2'], ['#8b6d7b', '#dcc2c4']];
    const [base, light] = palettes[index % palettes.length];
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, light);
    gradient.addColorStop(1, base);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#fff9';
    context.lineWidth = 2;
    for (let ring = 1; ring < 7; ring++) {
      context.beginPath();
      context.arc(width * .65, height * .38, ring * 84, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = '#2a2524';
    fitText(context, cd.album, 900, 100, 56);
    context.fillText(cd.album, 62, 830);
    context.font = '54px Arial, sans-serif';
    context.fillText(cd.artist, 65, 915, 900);
  });
}

function rail(group, size, position, material = railMaterial) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  group.add(mesh);
}

function addCover(entry, cd) {
  const paths = [
    cd.id && `https://coverartarchive.org/release/${encodeURIComponent(cd.id)}/front-250`,
    cd.releaseGroupId && `https://coverartarchive.org/release-group/${encodeURIComponent(cd.releaseGroupId)}/front-250`
  ].filter(Boolean);
  const loader = new THREE.TextureLoader();
  function tryPath(index) {
    if (index >= paths.length) return;
    loader.load(paths[index], texture => {
      if (!entry.alive) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      entry.coverMaterial.map.dispose();
      entry.coverMaterial.map = texture;
      entry.coverMaterial.needsUpdate = true;
      requestDraw();
    }, undefined, () => tryPath(index + 1));
  }
  tryPath(0);
}

function makeCase(cd, index, total) {
  const group = new THREE.Group();
  const baseY = (total - 1 - index) * SPACING - (total - 1) * SPACING / 2;
  const baseX = offsets[index % offsets.length];
  const baseZ = (index % 4 - 1.5) * .055;
  group.position.set(baseX, baseY, baseZ);
  group.rotation.y = (index % 5 - 2) * .013;
  scene.add(group);

  const spine = spineTexture(cd, index);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - .08, HEIGHT - .065, DEPTH - .08), [
    new THREE.MeshStandardMaterial({ color: '#999188', roughness: .45 }),
    new THREE.MeshStandardMaterial({ color: '#c5b6a7', roughness: .65 }),
    new THREE.MeshStandardMaterial({ color: '#eee6db', roughness: .8 }),
    new THREE.MeshStandardMaterial({ color: '#95887a', roughness: .8 }),
    new THREE.MeshStandardMaterial({ map: spine, roughness: .56 }),
    new THREE.MeshStandardMaterial({ color: '#c5b9ab', roughness: .7 })
  ]);
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);

  const coverMaterial = new THREE.MeshStandardMaterial({ map: placeholderCover(cd, index), roughness: .64 });
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - .62, DEPTH - .45), coverMaterial);
  cover.rotation.x = -Math.PI / 2;
  cover.position.set(.12, HEIGHT / 2 - .027, -.04);
  cover.receiveShadow = true;
  group.add(cover);

  // Clear jewel-case edges catch highlights while leaving the printed insert visible.
  for (const y of [-HEIGHT / 2, HEIGHT / 2]) {
    rail(group, [WIDTH, .035, .055], [0, y, DEPTH / 2]);
    rail(group, [WIDTH, .03, .045], [0, y, -DEPTH / 2]);
    rail(group, [.052, .03, DEPTH], [-WIDTH / 2, y, 0]);
    rail(group, [.052, .03, DEPTH], [WIDTH / 2, y, 0]);
  }
  rail(group, [.15, HEIGHT, DEPTH], [-WIDTH / 2 + .07, 0, 0], darkRailMaterial);
  rail(group, [.045, HEIGHT, DEPTH], [-WIDTH / 2 + .17, 0, 0]);
  rail(group, [WIDTH - .1, .026, .026], [.05, HEIGHT / 2 + .01, DEPTH / 2 - .04]);

  const entry = { group, paper, coverMaterial, baseX, baseY, baseZ, alive: true, index };
  addCover(entry, cd);
  return entry;
}

function clearCases() {
  for (const entry of entries) {
    entry.alive = false;
    scene.remove(entry.group);
    entry.group.traverse(object => {
      object.geometry?.dispose();
      if (!object.material) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (material === railMaterial || material === darkRailMaterial) continue;
        material.map?.dispose();
        material.dispose();
      }
    });
  }
  entries.length = 0;
}

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  if (width !== lastWidth || height !== lastHeight) {
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
  }
  const aspect = width / height;
  const viewHeight = Math.max(6.45, 8.1 / aspect, entries.length * SPACING + 2.7);
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  const targetX = width > 900 ? 1.65 : 0;
  camera.position.x = targetX + 1.6;
  camera.lookAt(targetX, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function project(x, y, z) {
  const point = new THREE.Vector3(x, y, z).project(camera);
  return { x: (point.x + 1) * lastWidth / 2, y: (1 - point.y) * lastHeight / 2 };
}

function positionLabels() {
  for (const entry of entries) {
    const button = buttons.querySelector(`[data-index="${entry.index}"]`);
    if (!button) continue;
    entry.group.updateMatrixWorld(true);
    const corners = [
      [-WIDTH / 2 + .21, -HEIGHT / 2 + .025, DEPTH / 2 + .03],
      [WIDTH / 2 - .08, -HEIGHT / 2 + .025, DEPTH / 2 + .03],
      [-WIDTH / 2 + .21, HEIGHT / 2 - .025, DEPTH / 2 + .03],
      [WIDTH / 2 - .08, HEIGHT / 2 - .025, DEPTH / 2 + .03]
    ].map(coords => {
      const point = entry.group.localToWorld(new THREE.Vector3(...coords));
      return project(point.x, point.y, point.z);
    });
    const left = Math.min(...corners.map(point => point.x));
    const right = Math.max(...corners.map(point => point.x));
    const top = Math.min(...corners.map(point => point.y));
    const bottom = Math.max(...corners.map(point => point.y));
    const width = right - left;
    const height = bottom - top;
    const polygon = [corners[2], corners[3], corners[1], corners[0]]
      .map(point => `${(point.x - left) / width * 100}% ${(point.y - top) / height * 100}%`)
      .join(', ');
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.style.width = `${width}px`;
    button.style.height = `${Math.max(20, height)}px`;
    button.style.clipPath = `polygon(${polygon})`;
    button.style.zIndex = String(100 + entries.length - entry.index + (entry.index === selected ? 100 : 0));
  }
}

function draw() {
  if (!visible || !entries.length || document.hidden) return;
  resize();
  let moving = false;
  for (const entry of entries) {
    const active = entry.index === selected;
    const targetX = entry.baseX + (active ? .65 : 0);
    const targetY = entry.baseY + (active ? .055 : 0);
    const targetZ = entry.baseZ + (active ? .25 : 0);
    const factor = animate && !reducedMotion.matches ? .085 : 1;
    entry.group.position.x += (targetX - entry.group.position.x) * factor;
    entry.group.position.y += (targetY - entry.group.position.y) * factor;
    entry.group.position.z += (targetZ - entry.group.position.z) * factor;
    if (Math.abs(targetX - entry.group.position.x) > .002 || Math.abs(targetZ - entry.group.position.z) > .002) moving = true;
  }
  positionLabels();
  renderer.render(scene, camera);
  if (moving) requestDraw();
}

function requestDraw() {
  if (!frame && visible && !document.hidden) {
    frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
}

function caseAt(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height * 2 - 1));
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(entries.map(entry => entry.paper), false)[0];
  return hit ? entries.find(entry => entry.paper === hit.object)?.index : undefined;
}

const api = {
  onSelect: null,
  onOpen: null,
  setAlbums(albums) {
    const signature = JSON.stringify(albums.map(cd => [cd.id, cd.album, cd.artist, cd.releaseGroupId]));
    if (signature === albumSignature && entries.length === albums.length) {
      requestDraw();
      return;
    }
    albumSignature = signature;
    clearCases();
    for (const [index, cd] of albums.entries()) entries.push(makeCase(cd, index, albums.length));
    table.position.y = -(albums.length - 1) * SPACING / 2 - HEIGHT / 2 - .075;
    selected = Math.min(selected, Math.max(albums.length - 1, 0));
    requestDraw();
  },
  select(index) {
    if (index < 0 || index >= entries.length) return;
    selected = index;
    requestDraw();
  },
  setMotion(value) { animate = value; requestDraw(); },
  setVisible(value) {
    visible = value;
    if (value) requestDraw();
  }
};

canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const index = caseAt(event);
  canvas.style.cursor = index === undefined ? 'default' : 'pointer';
  if (index !== undefined && index !== selected) api.onSelect?.(index);
});
canvas.addEventListener('click', event => {
  const index = caseAt(event);
  if (index === undefined) return;
  if (matchMedia('(hover: none)').matches && index !== selected) api.onSelect?.(index);
  else api.onOpen?.(index);
});
canvas.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    api.onSelect?.((selected + (event.key === 'ArrowUp' ? -1 : 1) + entries.length) % entries.length);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    api.onOpen?.(selected);
  }
});
new ResizeObserver(requestDraw).observe(stage);
document.addEventListener('visibilitychange', requestDraw);
reducedMotion.addEventListener('change', requestDraw);
stage.classList.add('is-3d');
window.CDStack3D = api;
window.dispatchEvent(new Event('cd-stack-3d-ready'));
