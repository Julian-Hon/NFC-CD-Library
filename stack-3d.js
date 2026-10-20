import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

const stage = document.querySelector('.stack-stage');
const canvas = document.querySelector('#stack-canvas');
const buttons = document.querySelector('#cd-stack');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Standard jewel case proportions: 142 × 124 × 10.4 mm.
const WIDTH = 5.68;
const DEPTH = 4.96;
const HEIGHT = .416;
const SPACING = HEIGHT + .012;
const offsets = [-.18, .13, -.09, .22, -.14, .08, -.2, .16];
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b6a18b');
scene.fog = new THREE.Fog('#b6a18b', 28, 65);
const camera = new THREE.OrthographicCamera(-4, 4, 3, -3, .1, 100);
camera.position.set(1.6, 3, 12);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

scene.add(new THREE.HemisphereLight(0xfff6e6, 0x786251, 1.3));
const sunlight = new THREE.DirectionalLight(0xfff2df, 3.0);
sunlight.position.set(-4, 9, 7);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.normalBias = .025;
sunlight.shadow.camera.left = -12;
sunlight.shadow.camera.right = 12;
sunlight.shadow.camera.top = 12;
sunlight.shadow.camera.bottom = -12;
sunlight.shadow.bias = -.0005;
scene.add(sunlight);
const fill = new THREE.DirectionalLight(0xe5edff, 1.2);
fill.position.set(7, 4, -4);
scene.add(fill);

// A real room and tabletop receive the cases' light, shadows and reflections.
const woodTexture = canvasTexture((context, width, height) => {
  context.fillStyle = '#98704b';
  context.fillRect(0, 0, width, height);
  let seed = 17;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let line = 0; line < 1800; line++) {
    const y = random() * height;
    context.strokeStyle = `rgba(${random() > .5 ? '52,29,15' : '221,180,126'},${.025 + random() * .11})`;
    context.lineWidth = .4 + random() * 1.4;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(width * .3, y + random() * 12, width * .7, y - random() * 12, width, y + random() * 6);
    context.stroke();
  }
});
woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
woodTexture.repeat.set(3, 2);
const table = new THREE.Mesh(
  new THREE.BoxGeometry(24, .48, 12),
  new THREE.MeshStandardMaterial({ map: woodTexture, color: '#b9a58e', roughness: .43, metalness: 0 })
);
table.position.set(0, -.24, -1);
table.receiveShadow = true;
table.castShadow = true;
scene.add(table);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 40), new THREE.MeshStandardMaterial({ color: '#b9a48e', roughness: 1 }));
wall.position.set(0, 13, -11);
wall.receiveShadow = true;
scene.add(wall);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial({ color: '#746253', roughness: .9 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -4;
floor.receiveShadow = true;
scene.add(floor);
for (const x of [-9, 9]) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(.35, 3.6, .35), new THREE.MeshStandardMaterial({ color: '#49372b', roughness: .55 }));
  leg.position.set(x, -2.2, 4.7);
  scene.add(leg);
}
// Softbox reflections make clear plastic readable without tinting it blue.
const reflectionRoom = new THREE.Scene();
reflectionRoom.background = new THREE.Color('#a49789');
for (const [x, y, z, width, height] of [[-5, 7, 3, 5, 7], [6, 5, -2, 2, 6], [0, 10, 0, 6, 4]]) {
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.9, 1.75), side: THREE.DoubleSide }));
  panel.position.set(x, y, z);
  panel.lookAt(0, 0, 0);
  reflectionRoom.add(panel);
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(reflectionRoom, .04).texture;
pmrem.dispose();
reflectionRoom.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
const railMaterial = new THREE.MeshPhysicalMaterial({
  color: '#ffffff', metalness: 0, roughness: .025, transmission: .98,
  thickness: .045, ior: 1.49, clearcoat: 1, clearcoatRoughness: .04,
  envMapIntensity: .35
});
const edgeMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: .08, transparent: true, opacity: .18, depthWrite: false, clearcoat: 1, envMapIntensity: .65 });
const darkRailMaterial = new THREE.MeshStandardMaterial({ color: '#363430', roughness: .32 });
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

function canvasTexture(draw, width = 1024, height = 1024) {
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
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

function spineTexture(cd) {
  return canvasTexture((context, width, height) => {
    context.fillStyle = '#f1ede5';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.fillStyle = '#252321';
    const year = String(cd.date || '').slice(0, 4);
    const title = `${cd.artist}  /  ${cd.album}`;
    fitText(context, title, width - 260, 65, 32);
    context.fillText(title, 42, height / 2, width - 260);
    context.textAlign = 'right';
    context.font = '60px Arial, sans-serif';
    context.fillStyle = '#34302b';
    context.fillText(year, width - 38, height / 2);
  }, 2048, 128);
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

function rail(group, size, position, material = edgeMaterial) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  group.add(mesh);
}

function addCover(entry, cd) {
  const paths = [
    cd.id && `https://coverartarchive.org/release/${encodeURIComponent(cd.id)}/front-500`,
    cd.releaseGroupId && `https://coverartarchive.org/release-group/${encodeURIComponent(cd.releaseGroupId)}/front-500`
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
  const baseY = HEIGHT / 2 + (total - 1 - index) * SPACING;
  const baseX = offsets[index % offsets.length];
  const baseZ = (index % 4 - 1.5) * .035;
  group.position.set(baseX, baseY, baseZ);
  group.rotation.y = (index % 5 - 2) * .01;
  scene.add(group);

  // The insert is paper inside a thin shell, not a solid opaque case-sized block.
  const paper = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - .18, .045, DEPTH - .18), new THREE.MeshStandardMaterial({ color: '#d5d0c7', roughness: .85 }));
  paper.position.y = -HEIGHT / 2 + .065;
  paper.castShadow = true;
  paper.receiveShadow = true;
  group.add(paper);
  const coverMaterial = new THREE.MeshStandardMaterial({ map: placeholderCover(cd, index), roughness: .7 });
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(4.72, 4.72), coverMaterial);
  cover.rotation.x = -Math.PI / 2;
  cover.position.set(.3, HEIGHT / 2 - .065, 0);
  cover.castShadow = true;
  cover.receiveShadow = true;
  group.add(cover);
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - .34, HEIGHT - .12), new THREE.MeshStandardMaterial({ map: spineTexture(cd), roughness: .78 }));
  spine.position.set(.07, 0, DEPTH / 2 - .06);
  group.add(spine);

  rail(group, [WIDTH, .025, DEPTH], [0, HEIGHT / 2 - .0125, 0], railMaterial);
  rail(group, [WIDTH, .025, DEPTH], [0, -HEIGHT / 2 + .0125, 0]);
  rail(group, [WIDTH, HEIGHT - .025, .025], [0, 0, DEPTH / 2 - .0125]);
  rail(group, [WIDTH, HEIGHT - .025, .025], [0, 0, -DEPTH / 2 + .0125]);
  rail(group, [.025, HEIGHT, DEPTH], [WIDTH / 2 - .0125, 0, 0]);
  rail(group, [.025, HEIGHT, DEPTH], [-WIDTH / 2 + .0125, 0, 0]);
  rail(group, [.42, .055, DEPTH - .12], [-WIDTH / 2 + .27, -HEIGHT / 2 + .08, 0], darkRailMaterial);
  for (let groove = 0; groove < 15; groove++) {
    rail(group, [.28, .035, .023], [-WIDTH / 2 + .26, HEIGHT / 2 - .065, -DEPTH / 2 + .2 + groove * .32]);
  }
  for (const z of [-DEPTH / 2 + .2, DEPTH / 2 - .2]) rail(group, [.14, .14, .2], [-WIDTH / 2 + .08, 0, z]);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  const entry = { group, paper: hit, coverMaterial, baseX, baseY, baseZ, alive: true, index };
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
        if (material === railMaterial || material === edgeMaterial || material === darkRailMaterial) continue;
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
  const viewHeight = Math.max(7.5, 9.4 / aspect, entries.length * SPACING + 5.0);
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  const targetX = width > 900 ? 1.65 : 0;
  const targetY = Math.max(.5, entries.length * SPACING / 2);
  camera.position.set(targetX + 2.0, targetY + 7.2, 12);
  camera.lookAt(targetX, targetY, 0);
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
    button.style.height = `${height}px`;
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
    const targetY = entry.baseY;
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
    const signature = JSON.stringify(albums.map(cd => [cd.id, cd.album, cd.artist, cd.date, cd.releaseGroupId]));
    if (signature === albumSignature && entries.length === albums.length) {
      requestDraw();
      return;
    }
    albumSignature = signature;
    clearCases();
    for (const [index, cd] of albums.entries()) entries.push(makeCase(cd, index, albums.length));
    // Table stays at y = 0; the bottom case rests on its surface.
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
