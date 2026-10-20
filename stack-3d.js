import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';

const stage = document.querySelector('.stack-stage');
const canvas = document.querySelector('#stack-canvas');
const buttons = document.querySelector('#cd-stack');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// Standard jewel case proportions: 142 × 124 × 10.4 mm.
const WIDTH = 5.68;
const DEPTH = 4.96;
const HEIGHT = .416;
const COVER_SIZE = 4.72;
const COVER_X = .3;
const SPACING = HEIGHT + .012;
const offsets = [-.18, .13, -.09, .22, -.14, .08, -.2, .16];
const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.PerspectiveCamera(15, 1, .1, 100);
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

// A transparent receiver anchors the individual 3D cases to the photographed desk.
const table = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.ShadowMaterial({ color: '#241b14', opacity: .28 }));
table.rotation.x = -Math.PI / 2;
table.position.y = -.018;
table.receiveShadow = true;
scene.add(table);
const contactTexture = canvasTexture((context, width, height) => {
  const gradient = context.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width / 2);
  gradient.addColorStop(0, 'rgba(22,17,12,.40)');
  gradient.addColorStop(.6, 'rgba(22,17,12,.17)');
  gradient.addColorStop(1, 'rgba(22,17,12,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
});
const contact = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 6.3), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false }));
contact.rotation.x = -Math.PI / 2;
contact.position.set(0, -.009, .1);
scene.add(contact);
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
  color: '#ffffff', metalness: 0, roughness: .06, transmission: 0, transparent: true, opacity: .11, depthWrite: false,
  thickness: .045, ior: 1.49, clearcoat: 1, clearcoatRoughness: .04,
  envMapIntensity: .65
});
const edgeMaterial = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 0, roughness: .08, transparent: true, opacity: .18, depthWrite: false, clearcoat: 1, envMapIntensity: .65 });
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const entries = [];
let selected = 0;
let hovered = -1;
const mobile = matchMedia('(max-width: 760px)');
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

function commonCoverColor(image) {
  try {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 48;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 48, 48);
    const pixels = context.getImageData(0, 0, 48, 48).data;
    const colors = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 200) continue;
      const key = `${pixels[i] >> 5},${pixels[i + 1] >> 5},${pixels[i + 2] >> 5}`;
      const bin = colors.get(key) || { count: 0, channels: [0, 0, 0] };
      bin.count++;
      for (let channel = 0; channel < 3; channel++) bin.channels[channel] += pixels[i + channel];
      colors.set(key, bin);
    }
    const common = [...colors.values()].sort((a, b) => b.count - a.count)[0];
    if (common) return common.channels.map(sum => Math.round(sum / common.count));
  } catch { /* Keep the placeholder color if the cover host blocks pixel reads. */ }
  return null;
}

function spineTexture(cd, color = null) {
  const hash = [...`${cd.artist}${cd.album}`].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) >>> 0, 7);
  const [red, green, blue] = color || [[166, 108, 91], [121, 115, 96], [89, 109, 114], [139, 109, 123]][hash % 4];
  const luminance = [red, green, blue]
    .map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, channel) => sum + value * [.2126, .7152, .0722][channel], 0);
  return canvasTexture((context, width, height) => {
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.fillStyle = luminance > .179 ? '#1b1b1a' : '#faf7f1';
    const artistWidth = Math.min(700, Math.max(330, cd.artist.length * 35));
    fitText(context, cd.artist, artistWidth - 65, 64, 32);
    context.fillText(cd.artist, 48, height / 2, artistWidth - 65);
    const titleWidth = width - artistWidth - 260;
    fitText(context, cd.album, titleWidth, 62, 28);
    const family = hash % 3 === 0 ? 'Georgia, serif' : 'Arial, sans-serif';
    context.font = context.font.replace('Arial, sans-serif', family).replace('700', '400');
    context.fillText(cd.album, artistWidth + 25, height / 2, titleWidth);
    context.textAlign = 'right';
    context.font = '34px Arial, sans-serif';
    context.fillText(typeof cd.label === 'string' && cd.label ? cd.label : String(cd.date || '').slice(0, 4), width - 34, height / 2, 200);
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
      const color = commonCoverColor(texture.image);
      if (color) {
        entry.spineMaterial.map.dispose();
        entry.spineMaterial.map = spineTexture(cd, color);
        entry.spineMaterial.needsUpdate = true;
      }
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
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(COVER_SIZE, COVER_SIZE), coverMaterial);
  cover.rotation.x = -Math.PI / 2;
  cover.position.set(COVER_X, HEIGHT / 2 - .065, 0);
  cover.castShadow = true;
  cover.receiveShadow = true;
  group.add(cover);
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(COVER_SIZE, HEIGHT - .12), new THREE.MeshStandardMaterial({ map: spineTexture(cd), roughness: .78 }));
  spine.position.set(COVER_X, 0, DEPTH / 2 - .06);
  group.add(spine);

  rail(group, [WIDTH, .025, DEPTH], [0, HEIGHT / 2 - .0125, 0], railMaterial);
  rail(group, [WIDTH, .025, DEPTH], [0, -HEIGHT / 2 + .0125, 0]);
  rail(group, [WIDTH, HEIGHT - .025, .025], [0, 0, DEPTH / 2 - .0125]);
  rail(group, [WIDTH, HEIGHT - .025, .025], [0, 0, -DEPTH / 2 + .0125]);
  rail(group, [.025, HEIGHT, DEPTH], [WIDTH / 2 - .0125, 0, 0]);
  rail(group, [.025, HEIGHT, DEPTH], [-WIDTH / 2 + .0125, 0, 0]);
  for (let groove = 0; groove < 15; groove++) {
    rail(group, [.28, .035, .023], [-WIDTH / 2 + .26, HEIGHT / 2 - .065, -DEPTH / 2 + .2 + groove * .32]);
  }
  for (const z of [-DEPTH / 2 + .2, DEPTH / 2 - .2]) rail(group, [.14, .14, .2], [-WIDTH / 2 + .08, 0, z]);
  for (const y of [-HEIGHT / 2 + .012, HEIGHT / 2 - .012]) {
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(WIDTH - .01, .018, DEPTH - .01)), new THREE.LineBasicMaterial({ color: '#c9cfcd', transparent: true, opacity: .38 }));
    rim.position.y = y;
    group.add(rim);
    const seam = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(WIDTH - .035, .012, DEPTH - .035)), new THREE.LineBasicMaterial({ color: '#b7b5ad', transparent: true, opacity: .3 }));
    seam.position.y = y - .018;
    group.add(seam);
    rail(group, [WIDTH - .035, .018, .025], [0, y + .025, DEPTH / 2 - .035]);
  }
  for (const x of [-WIDTH / 2 + .1, WIDTH / 2 - .1]) {
    for (const z of [-DEPTH / 2 + .13, DEPTH / 2 - .13]) rail(group, [.045, HEIGHT - .04, .09], [x, 0, z]);
  }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, HEIGHT, DEPTH), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  const entry = { group, paper: hit, coverMaterial, spineMaterial: spine.material, baseX, baseY, baseZ, alive: true, index };
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
        if (material === railMaterial || material === edgeMaterial) continue;
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
  const viewHeight = Math.max(7.6 / aspect, entries.length * SPACING + 1.65);
  // Perspective makes the near spine edge longer than the far edge, as on a
  // real jewel case. A long focal length keeps the view almost front-facing.
  const cameraDistance = 24;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(viewHeight / (2 * cameraDistance)));
  camera.aspect = aspect;
  const targetY = viewHeight * .34 - .28;
  camera.position.set(-1.75, targetY + 2.4, cameraDistance);
  camera.lookAt(.12, targetY, 0);
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
      [COVER_X - COVER_SIZE / 2, -HEIGHT / 2 + .025, DEPTH / 2 + .03],
      [COVER_X + COVER_SIZE / 2, -HEIGHT / 2 + .025, DEPTH / 2 + .03],
      [COVER_X - COVER_SIZE / 2, HEIGHT / 2 - .025, DEPTH / 2 + .03],
      [COVER_X + COVER_SIZE / 2, HEIGHT / 2 - .025, DEPTH / 2 + .03]
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

function draw(now) {
  if (!visible || !entries.length || document.hidden || mobile.matches) return;
  resize();
  let moving = false;
  for (const entry of entries) {
    // The selected case becomes the exposed top case, so the visible cover
    // always belongs to the title on its spine. Cases above it close the gap.
    const stackIndex = entry.index === selected ? 0 : entry.index < selected ? entry.index + 1 : entry.index;
    const targetY = HEIGHT / 2 + (entries.length - 1 - stackIndex) * SPACING + (entry.index === selected ? .055 : 0);
    const targetX = entry.baseX + (entry.index === selected ? .44 : entry.index === hovered ? .24 : 0);
    if (entry.targetX !== targetX || entry.targetY !== targetY) {
      entry.startX = entry.group.position.x;
      entry.startY = entry.group.position.y;
      entry.targetX = targetX;
      entry.targetY = targetY;
      entry.motionStart = now;
    }
    const progress = animate && !reducedMotion.matches ? Math.min(1, (now - entry.motionStart) / 520) : 1;
    const eased = progress * progress * (3 - 2 * progress);
    entry.group.position.x = entry.startX + (targetX - entry.startX) * eased;
    entry.group.position.y = entry.startY + (targetY - entry.startY) * eased;
    if (progress < 1) moving = true;
  }
  positionLabels();
  renderer.render(scene, camera);
  if (moving) requestDraw();
}

function requestDraw() {
  if (!frame && visible && !document.hidden && !mobile.matches) {
    frame = requestAnimationFrame(now => { frame = 0; draw(now); });
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
  hover(index) { hovered = index; requestDraw(); },
  setAlbums(albums) {
    const signature = JSON.stringify(albums.map(cd => [cd.id, cd.album, cd.artist, cd.date, cd.label, cd.releaseGroupId]));
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
  api.hover(index ?? -1);
});
canvas.addEventListener('pointerleave', () => api.hover(-1));
canvas.addEventListener('click', event => {
  const index = caseAt(event);
  if (index === undefined) return;
  api.onSelect?.(index);
});
canvas.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    api.onSelect?.((selected + (event.key === 'ArrowUp' ? -1 : 1) + entries.length) % entries.length);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    api.onSelect?.(selected);
  }
});
new ResizeObserver(requestDraw).observe(stage);
document.addEventListener('visibilitychange', requestDraw);
reducedMotion.addEventListener('change', requestDraw);
mobile.addEventListener('change', requestDraw);
stage.classList.add('is-3d');
window.CDStack3D = api;
window.dispatchEvent(new Event('cd-stack-3d-ready'));
