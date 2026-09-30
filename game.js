(() => {
  'use strict';

  const THREE = window.THREE;
  const world = document.getElementById('world');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('start');
  const messageEl = document.getElementById('message');
  const damageEl = document.getElementById('damage');
  const hauntEl = document.getElementById('haunt');
  const bannerEl = document.getElementById('cine-banner');
  const statusEl = document.getElementById('status');
  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const sparksEl = document.getElementById('sparks');
  const rewindsEl = document.getElementById('rewinds');
  const shieldsEl = document.getElementById('shields');
  const shieldBadge = document.getElementById('shield-badge');
  const heartEl = document.getElementById('heart');
  const nerveNeedle = document.getElementById('nerve-needle');
  const nerveLabel = document.getElementById('nerve-label');
  const shieldCount = document.getElementById('shield-count');
  const speedBar = document.getElementById('speed-bar');
  const muteBtn = document.getElementById('mute');
  const fullscreenBtn = document.getElementById('fullscreen');

  // ---------- world layout ----------
  // A round 1960s atrium: terrazzo floor, sunken conversation pit with a hanging fireplace,
  // tulip columns, teak-slat and glass walls, and an oculus with a Calder-style mobile.
  const ROOM = 34;          // playable radius
  const WALL_R = 38;        // curved teak / glass wall
  const CEIL_H = 15;
  const OCULUS_R = 11;
  const HOVER = 1.35;
  const SPARKS_PER_LEVEL = 10;
  const PLAYER_RADIUS = 1.15;
  const ECHO_RADIUS = 1.35;
  const ECHO_ARM_TIME = 1.2;  // seconds an echo takes to materialize before it can hurt you

  // Echoes replay your route at the exact timing you flew it (one sample per SAMPLE_DT),
  // and hunt you along it. Your nerve while flying a route shapes the echo it becomes.
  const SAMPLE_DT = 0.11;
  const IDLE_STEP = 0.08;         // samples closer than this to the last kept one count as standing still
  const MAX_IDLE_SAMPLES = 3;     // an echo keeps at most ~0.3 s of any standstill; longer hovering is cut
  const ECHO_MAX_SPEED = 13;      // hunters outrun normal flight (10.5) but never a boost (16)
  const HUNT_RADIUS = 10;         // + up to 8 more for panicked echoes
  const NEAR_MISS_GAP = 1.6;      // passing this close to an armed echo counts as a near miss
  const CALM_NERVE = 0.25;        // below this a route earns the cool-head bonus
  const CALM_BONUS = 150;
  const BOOST_GRACE = 1.5;        // seconds of boost per route that cost no nerve
  const BOOST_NERVE = 0.12;       // route nerve added per second of boost beyond the grace
  const CRYSTAL_FIRST = 14;
  const CRYSTAL_GAP = [18, 26];
  const REWIND_EVERY = 5;
  const REWIND_SAFE_TIME = 1.4;

  // Eames-era palette.
  const PAL = {
    cream: 0xf3e8d2,
    ivory: 0xf8f2e6,
    teak: 0x8a4a22,
    teakDark: 0x5a2c12,
    teal: 0x2b8584,
    tealLight: 0x5fb3ad,
    orange: 0xe0662b,
    mustard: 0xe3a92b,
    red: 0xc8342b,
    charcoal: 0x1d1a18,
    fern: 0x3d6a32,
  };
  // Echoes glow in cold spectral colors so they read against the warm room.
  const GHOST_COLORS = [0x8ff7ff, 0xb9a4ff, 0x9dffd0, 0xff9ee6, 0xa6d4ff];

  // Third-person orbit camera. yaw 0 looks toward -Z; pitch is the camera's height angle above the craft.
  const LOOK = {
    mouse: 0.0024,      // radians per pixel (pointer lock / drag)
    touch: 0.0055,      // radians per pixel (right-thumb drag on phones)
    wheel: 0.0032,      // radians per wheel unit (two-finger trackpad swipe)
    keyYaw: 2.4,        // radians per second (arrow keys)
    keyPitch: 1.3,
    minPitch: 0.06,
    maxPitch: 1.15,
    minDistance: 7,
    maxDistance: 20,
  };
  const look = { yaw: 0, pitch: 0.37, distance: 12.5 };
  const keys = Object.create(null);
  let clickBoost = false;         // holding the trackpad / mouse button down boosts, like Shift
  let touchBoost = false;         // phones: holding the on-screen BOOST button
  const touchStick = { x: 0, y: 0 };  // phones: left-thumb joystick, -1..1 (y is down)
  // Phones and tablets get touch controls; anything with a hovering pointer keeps the PC controls.
  const isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const boostHeld = () => !!(keys.ShiftLeft || keys.ShiftRight || clickBoost || touchBoost);
  const clock = new THREE.Clock();
  const obstacleData = [];
  const echoes = [];
  const particles = [];
  const snapshots = [];
  const mobileArms = [];

  let state = 'title';
  let score = 0;
  let level = 1;
  let sparks = 0;
  let totalSparks = 0;
  let rewinds = 1;
  let shields = 0;
  let route = [];
  let routeJitter = [];           // per-sample nervousness, used to colour the live trail
  let nerve = { jitter: 0, samples: 0, nearMiss: 0, hesitation: 0, boost: 0, strainWarned: false };
  let lastDir = null;
  let liveNerve = 0;              // fast-decaying, drives the heartbeat
  let heartTimer = 0;
  let lastShriek = -9;
  let sampleTimer = 0;
  let snapshotTimer = 0;
  let gameTime = 0;
  let nextCrystal = CRYSTAL_FIRST;
  let invulnerable = 0;
  let messageTimer = 0;
  let shake = 0;
  let timeScale = 1;              // < 1 during slow motion, eases back to 1
  let cine = null;                // { kind, t, ... } takes over the camera during a cinematic
  const shockwaves = [];
  let muted = false;
  let audioCtx = null;
  let hum = null;

  // ---------- renderer & scene ----------

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  world.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x15373d, 0.005);

  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 8, 32);

  // Warm late-afternoon light through the glass, plus a fire glow and cove lights.
  scene.add(new THREE.HemisphereLight(0xa9d8e1, 0x28302c, 0.8));
  const sun = new THREE.DirectionalLight(0xffdda7, 1.65);
  sun.position.set(-22, 40, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const windowFill = new THREE.DirectionalLight(0x7acddd, 1.05);
  windowFill.position.set(10, 14, -40);
  scene.add(windowFill);
  const fireLight = new THREE.PointLight(0xff6a24, 40, 26, 2);
  fireLight.position.set(0, 2.6, 0);
  scene.add(fireLight);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cove = new THREE.PointLight(0xffc98a, 16, 32, 2);
    cove.position.set(Math.cos(a) * 22, CEIL_H - 3, Math.sin(a) * 22);
    scene.add(cove);
  }

  const arena = new THREE.Group();
  scene.add(arena);

  // ---------- procedural textures (no image files needed) ----------

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canvasTexture(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  }

  function blob(g, x, y, radius, points, rand) {
    g.beginPath();
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = radius * (0.7 + rand() * 0.5);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }

  const terrazzoTex = canvasTexture(512, 512, (g, w, h) => {
    const rand = rng(7);
    g.fillStyle = '#ece2cf';
    g.fillRect(0, 0, w, h);
    const chips = ['#c6bda9', '#a7a397', '#d6c8ae', '#8aaba3', '#bd9e80', '#a8a597', '#e9d9b9'];
    for (let i = 0; i < 2100; i++) {
      g.globalAlpha = 0.25 + rand() * 0.35;
      g.fillStyle = chips[Math.floor(rand() * chips.length)];
      blob(g, rand() * w, rand() * h, 0.5 + rand() * 2.2, 5, rand);
    }
    g.globalAlpha = 1;
  }, [9, 9]);

  const flagstoneTex = canvasTexture(512, 512, (g, w, h) => {
    const rand = rng(11);
    g.fillStyle = '#cdbfa6';
    g.fillRect(0, 0, w, h);
    const stones = ['#6f6a62', '#7d776d', '#5f5b55', '#8a8378', '#726b60', '#66625a'];
    const n = 7;
    const cell = w / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = stones[Math.floor(rand() * stones.length)];
        const cx = (x + 0.5 + (rand() - 0.5) * 0.25) * cell;
        const cy = (y + 0.5 + (rand() - 0.5) * 0.25) * cell;
        blob(g, cx, cy, cell * 0.46, 8, rand);
        g.fillStyle = 'rgba(0, 0, 0, 0.08)';
        for (let k = 0; k < 40; k++) g.fillRect(cx + (rand() - 0.5) * cell * 0.6, cy + (rand() - 0.5) * cell * 0.6, 2, 2);
      }
    }
  }, [5, 5]);

  const teakTex = canvasTexture(512, 512, (g, w, h) => {
    const rand = rng(3);
    const slats = 22;
    const sw = w / slats;
    const tones = ['#8a4a22', '#7e421d', '#94532a', '#83461f', '#8f4c24'];
    for (let i = 0; i < slats; i++) {
      g.fillStyle = tones[Math.floor(rand() * tones.length)];
      g.fillRect(i * sw, 0, sw, h);
      g.strokeStyle = 'rgba(40, 16, 4, 0.18)';
      for (let k = 0; k < 5; k++) {
        const x = i * sw + rand() * sw;
        g.lineWidth = 0.6 + rand();
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.02 + k) * 1.5, y);
        g.stroke();
      }
      g.fillStyle = '#3d1d0c';
      g.fillRect(i * sw + sw - 2, 0, 2, h);
    }
  }, [1, 2]);

  const carpetTex = canvasTexture(256, 256, (g, w, h) => {
    const rand = rng(5);
    g.fillStyle = '#2f8a88';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,30,30,0.08)';
      g.fillRect(rand() * w, rand() * h, 1.5, 1.5);
    }
  }, [4, 4]);

  const skyTex = canvasTexture(16, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#06181f');
    grad.addColorStop(0.32, '#183d4b');
    grad.addColorStop(0.47, '#648b91');
    grad.addColorStop(0.53, '#c0a382');
    grad.addColorStop(0.62, '#3b575b');
    grad.addColorStop(1, '#101e22');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

  // A 1960s city of tomorrow outside the windows: towers, a space-needle, domes, flying cars.
  const skylineTex = canvasTexture(2048, 512, (g, w, h) => {
    const rand = rng(21);
    const ground = h * 0.86;
    const tower = (x, tw, th, color, windows) => {
      g.fillStyle = color;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, ground - th, tw, th, [tw * 0.35, tw * 0.35, 0, 0]);
      else g.rect(x, ground - th, tw, th);
      g.fill();
      if (!windows) return;
      g.fillStyle = 'rgba(255, 214, 150, 0.75)';
      for (let y = ground - th + 14; y < ground - 6; y += 11) {
        for (let wx = x + 5; wx < x + tw - 6; wx += 8) if (rand() > 0.45) g.fillRect(wx, y, 3, 4);
      }
    };
    // hazy far layer
    for (let x = 0; x < w; x += 30 + rand() * 50) tower(x, 26 + rand() * 40, 80 + rand() * 170, 'rgba(120, 150, 150, 0.45)', false);
    // mid layer with lit windows
    for (let x = 10; x < w; x += 70 + rand() * 90) tower(x, 34 + rand() * 46, 110 + rand() * 210, 'rgba(62, 82, 86, 0.92)', true);
    // Googie landmarks
    for (const cx of [260, 1180, 1760]) {
      g.fillStyle = 'rgba(50, 62, 66, 0.96)';
      g.fillRect(cx - 5, ground - 330, 10, 330);
      g.beginPath();
      g.ellipse(cx, ground - 330, 70, 16, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255, 190, 120, 0.9)';
      g.fillRect(cx - 55, ground - 332, 110, 3);
      g.fillStyle = 'rgba(50, 62, 66, 0.96)';
      g.beginPath();
      g.moveTo(cx - 18, ground - 346);
      g.lineTo(cx, ground - 400);
      g.lineTo(cx + 18, ground - 346);
      g.fill();
    }
    for (const cx of [620, 1480]) {
      g.fillStyle = 'rgba(58, 74, 78, 0.95)';
      g.beginPath();
      g.ellipse(cx, ground, 120, 90, 0, Math.PI, 0);
      g.fill();
      g.strokeStyle = 'rgba(255, 200, 140, 0.5)';
      g.lineWidth = 2;
      for (let r = 40; r < 120; r += 26) {
        g.beginPath();
        g.ellipse(cx, ground, r, r * 0.75, 0, Math.PI, 0);
        g.stroke();
      }
    }
    // boomerang arches
    g.strokeStyle = 'rgba(58, 74, 78, 0.95)';
    g.lineWidth = 10;
    for (const cx of [900, 1960]) {
      g.beginPath();
      g.moveTo(cx - 90, ground);
      g.quadraticCurveTo(cx, ground - 260, cx + 90, ground);
      g.stroke();
    }
    g.fillStyle = 'rgba(40, 48, 52, 0.95)';
    g.fillRect(0, ground, w, h - ground);
    // flying cars with light trails
    for (let i = 0; i < 16; i++) {
      const x = rand() * w;
      const y = ground - 180 - rand() * 180;
      g.strokeStyle = 'rgba(255, 170, 110, 0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x - 60, y + 3);
      g.lineTo(x, y + 3);
      g.stroke();
      g.fillStyle = 'rgba(245, 240, 230, 0.9)';
      g.beginPath();
      g.ellipse(x + 6, y + 3, 9, 3.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  });

  function mat(color, emissive = 0x000000, intensity = 0, roughness = 0.45, metalness = 0.12) {
    return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness, metalness });
  }

  function lathe(points, segments = 48) {
    return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  }

  function shadowed(mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---------- the atrium ----------

  function buildArena() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);
    const skyline = new THREE.Mesh(
      new THREE.CylinderGeometry(100, 100, 64, 64, 1, true),
      new THREE.MeshBasicMaterial({ map: skylineTex, side: THREE.BackSide, transparent: true, fog: false, depthWrite: false })
    );
    skylineTex.wrapS = THREE.RepeatWrapping;
    skylineTex.repeat.set(2, 1);
    skyline.position.y = 22;
    scene.add(skyline);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R + 0.5, 128), new THREE.MeshPhysicalMaterial({ map: terrazzoTex, color: 0xb5c2b7, roughness: 0.38, metalness: 0.12, clearcoat: 0.35, clearcoatRoughness: 0.35, bumpMap: terrazzoTex, bumpScale: 0.012 }));
    floor.rotation.x = -Math.PI / 2;
    floor.name = 'observatory-floor';
    floor.receiveShadow = true;
    arena.add(floor);

    const flag = new THREE.Mesh(new THREE.RingGeometry(ROOM - 6, WALL_R + 0.4, 128), new THREE.MeshStandardMaterial({ map: flagstoneTex, roughness: 0.85 }));
    flag.rotation.x = -Math.PI / 2;
    flag.position.y = 0.012;
    flag.receiveShadow = true;
    arena.add(flag);
    const brass = new THREE.Mesh(new THREE.RingGeometry(ROOM - 6.25, ROOM - 6, 128), mat(0xc9a15a, 0x000000, 0, 0.3, 0.8));
    brass.rotation.x = -Math.PI / 2;
    brass.position.y = 0.016;
    arena.add(brass);

    buildHearth();
    buildInlay();
    buildPods();
    buildColumns();
    buildPlanters();
    buildWalls();
    buildCeiling();
    buildMobile(10, -9, 4);
    buildMobile(-13, 7, 9);
  }

  function flatRing(inner, outer, material, y) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    ring.receiveShadow = true;
    arena.add(ring);
  }

  function sectorShape(r0, r1, a0, a1) {
    const s = new THREE.Shape();
    s.absarc(0, 0, r1, a0, a1, false);
    s.absarc(0, 0, r0, a1, a0, true);
    return s;
  }

  const enamel = mat(0xf7f1e6, 0, 0, 0.22, 0.05);

  // The centre is open floor with one landmark: the hanging cone fireplace on a slim stem,
  // visible from anywhere in the room.
  function buildHearth() {
    const chimney = shadowed(new THREE.Mesh(lathe([[0, 3.05], [1.25, 3.1], [0.95, 3.35], [0.55, 3.8], [0.34, 4.4], [0.28, 5.2], [0.28, CEIL_H + 3]]), enamel));
    arena.add(chimney);
    const hearth = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 1.0, 48), mat(0xa9521f, 0, 0, 0.5, 0.1)));
    hearth.position.y = 2.55;
    arena.add(hearth);
    const fire = new THREE.Mesh(
      new THREE.CylinderGeometry(1.37, 1.37, 0.46, 48, 1, true, Math.PI * 0.15, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color: 0xff7a2e, side: THREE.DoubleSide })
    );
    fire.position.y = 2.5;
    arena.add(fire);
    const bowl = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1.36, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), enamel));
    bowl.position.y = 2.06;
    bowl.scale.y = 0.45;
    arena.add(bowl);
    const stem = shadowed(new THREE.Mesh(lathe([[1.1, 0], [0.9, 0.08], [0.35, 0.35], [0.18, 0.9], [0.18, 1.8]]), enamel));
    arena.add(stem);
    obstacleData.push({ x: 0, z: 0, r: 1.3 + PLAYER_RADIUS * 0.55, radius: 1.3, height: 3.5, body: hearth });
  }

  // A brass starburst set into the terrazzo, pointing at the four pods, so you can find your way.
  function buildInlay() {
    const brassMat = mat(0xc9a15a, 0, 0, 0.3, 0.8);
    flatRing(3.6, 3.85, brassMat, 0.017);
    flatRing(13.6, 13.8, brassMat, 0.017);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.PI / 4;
      const long = i % 4 === 0;  // the long rays point at the pods
      const len = long ? 13.5 : 7;
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(long ? 0.22 : 0.12, len), brassMat);
      ray.rotation.x = -Math.PI / 2;
      ray.rotation.z = -a + Math.PI / 2;
      const mid = 3.85 + len / 2;
      ray.position.set(Math.cos(a) * mid, 0.018, Math.sin(a) * mid);
      arena.add(ray);
    }
  }

  // Four small conversation pods on the diagonals: teal carpet, a curved velvet sofa opening
  // toward the centre, and a globe pendant lamp overhead. Duck in for cover — but it's a dead end.
  function buildPods() {
    const velvet = mat(PAL.teal, 0x000000, 0, 0.95, 0);
    const extrude = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 32 });
    const pillowColors = [PAL.orange, PAL.red, PAL.mustard];
    const R = 3.3;
    const span = (125 * Math.PI) / 180;  // half-width of the sofa arc around the outward direction
    for (let p = 0; p < 4; p++) {
      const theta = Math.PI / 4 + (p * Math.PI) / 2;  // outward direction of this pod
      const cx = Math.cos(theta) * 19;
      const cz = Math.sin(theta) * 19;

      const carpet = new THREE.Mesh(new THREE.CircleGeometry(4.3, 64), new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 1 }));
      carpet.rotation.x = -Math.PI / 2;
      carpet.position.set(cx, 0.018, cz);
      carpet.receiveShadow = true;
      arena.add(carpet);
      const rim = new THREE.Mesh(new THREE.RingGeometry(4.3, 4.8, 64), mat(PAL.tealLight, 0, 0, 0.95));
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(cx, 0.02, cz);
      arena.add(rim);

      // Shape angle a lands at world (cos a, -sin a) after the -90° rotation, so negate the world angles.
      const a0 = -(theta + span);
      const a1 = -(theta - span);
      const seat = shadowed(new THREE.Mesh(extrude(sectorShape(R - 1.0, R + 0.1, a0, a1), 0.45), velvet));
      seat.rotation.x = -Math.PI / 2;
      seat.position.set(cx, 0, cz);
      arena.add(seat);
      const back = shadowed(new THREE.Mesh(extrude(sectorShape(R - 0.05, R + 0.4, a0, a1), 1.1), velvet));
      back.rotation.x = -Math.PI / 2;
      back.position.set(cx, 0, cz);
      arena.add(back);
      for (let phi = theta - span; phi <= theta + span + 1e-6; phi += 0.85 / R) {
        obstacleData.push({ x: cx + Math.cos(phi) * (R - 0.3), z: cz + Math.sin(phi) * (R - 0.3), r: 0.75 + PLAYER_RADIUS * 0.55 });
      }
      for (let i = 0; i < 3; i++) {
        const phi = theta - span * 0.6 + i * span * 0.6;
        const pillow = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.26), mat(pillowColors[(p + i) % 3], 0, 0, 0.9)));
        pillow.position.set(cx + Math.cos(phi) * (R - 0.35), 0.75, cz + Math.sin(phi) * (R - 0.35));
        pillow.rotation.y = -phi + Math.PI / 2;
        pillow.rotation.z = 0.12;
        arena.add(pillow);
      }

      // Globe pendant lamp hanging over the pod (no floor footprint).
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, CEIL_H - 6.2, 6), mat(PAL.charcoal, 0, 0, 0.4, 0.6));
      rod.position.set(cx, 6.2 + (CEIL_H - 6.2) / 2, cz);
      arena.add(rod);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), mat(0xfff4dc, 0xffd9a0, 1.6, 0.4));
      globe.position.set(cx, 5.8, cz);
      arena.add(globe);
    }
  }

  // White tulip columns holding up the ceiling ring, flared at the base and the top.
  function buildColumns() {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * 27;
      const z = Math.sin(a) * 27;
      const body = shadowed(new THREE.Mesh(
        lathe([[1.5, 0], [1.2, 0.1], [0.6, 0.5], [0.36, 1.4], [0.3, 3], [0.3, CEIL_H - 3], [0.45, CEIL_H - 1.4], [1.1, CEIL_H - 0.4], [1.6, CEIL_H]]),
        mat(0xf7f1e6, 0, 0, 0.22, 0.05)
      ));
      body.position.set(x, 0, z);
      arena.add(body);
      obstacleData.push({ x, z, r: 1.0 + PLAYER_RADIUS * 0.55, radius: 1.0, height: CEIL_H, body });
    }
  }

  // Teak planters full of ferns, like the Baxter apartment.
  function buildPlanters() {
    const rand = rng(17);
    // Diagonals, between the centre and each pod's mouth: cover to duck behind on the way in.
    for (const [x, z] of [[7.1, 7.1], [-7.1, 7.1], [7.1, -7.1], [-7.1, -7.1]]) {
      const body = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.95, 0.95, 28), mat(PAL.teak, 0, 0, 0.55)));
      body.position.set(x, 0.475, z);
      arena.add(body);
      const soil = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), mat(0x2b1d14, 0, 0, 1));
      soil.rotation.x = -Math.PI / 2;
      soil.position.set(x, 0.96, z);
      arena.add(soil);
      const frondMat = mat(PAL.fern, 0, 0, 0.8);
      for (let i = 0; i < 16; i++) {
        const frond = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.7 + rand() * 0.8, 4), frondMat));
        const a = rand() * Math.PI * 2;
        frond.position.set(x + Math.cos(a) * 0.35, 1.6, z + Math.sin(a) * 0.35);
        frond.rotation.set(Math.sin(a) * (0.5 + rand() * 0.6), 0, -Math.cos(a) * (0.5 + rand() * 0.6));
        frond.scale.z = 0.35;
        arena.add(frond);
      }
      obstacleData.push({ x, z, r: 1.2 + PLAYER_RADIUS * 0.55, radius: 1.2, height: 2.4, body });
    }
  }

  // Curved wall: teak slats around the back, a sweep of floor-to-ceiling glass ahead.
  function buildWalls() {
    const segs = 36;
    const step = (Math.PI * 2) / segs;
    const teakMat = new THREE.MeshStandardMaterial({ map: teakTex, roughness: 0.55, side: THREE.BackSide });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe3e4, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const aluminum = mat(0xd8d4cc, 0, 0, 0.3, 0.85);
    for (let i = 0; i < segs; i++) {
      const theta = i * step;
      const mid = theta + step / 2;
      // CylinderGeometry puts angle theta at (sin θ, cos θ); windows face -Z, ahead of the start position.
      const isWindow = Math.cos(mid) < 0.5;
      if (!isWindow) {
        const panel = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, CEIL_H, 4, 1, true, theta, step), teakMat);
        panel.position.y = CEIL_H / 2;
        panel.receiveShadow = true;
        arena.add(panel);
        continue;
      }
      const sill = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, 1.2, 4, 1, true, theta, step), teakMat);
      sill.position.y = 0.6;
      arena.add(sill);
      const header = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, 2.4, 4, 1, true, theta, step), teakMat);
      header.position.y = CEIL_H - 1.2;
      arena.add(header);
      const glassH = CEIL_H - 3.6;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, glassH, 4, 1, true, theta, step), glassMat);
      glass.position.y = 1.2 + glassH / 2;
      arena.add(glass);
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.16, glassH, 0.16), aluminum);
      mullion.position.set(Math.sin(theta) * WALL_R, 1.2 + glassH / 2, Math.cos(theta) * WALL_R);
      arena.add(mullion);
      const transom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, step * WALL_R), aluminum);
      transom.position.set(Math.sin(mid) * WALL_R, 1.2 + glassH * 0.62, Math.cos(mid) * WALL_R);
      transom.rotation.y = mid + Math.PI / 2;
      arena.add(transom);
    }
  }

  // Cream ceiling ring with a teak-drum oculus and a warm cove light.
  function buildCeiling() {
    const ceiling = new THREE.Mesh(new THREE.RingGeometry(OCULUS_R, WALL_R + 0.5, 96), mat(PAL.cream, 0, 0, 0.9, 0));
    ceiling.material.side = THREE.DoubleSide;
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CEIL_H;
    arena.add(ceiling);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(OCULUS_R, OCULUS_R, 3.2, 64, 1, true), new THREE.MeshStandardMaterial({ map: teakTex, roughness: 0.55, side: THREE.DoubleSide }));
    drum.position.y = CEIL_H + 1.6;
    arena.add(drum);
    const cove = new THREE.Mesh(new THREE.TorusGeometry(OCULUS_R - 0.12, 0.13, 8, 96), mat(0xffe2b0, 0xffc27a, 2.2));
    cove.rotation.x = Math.PI / 2;
    cove.position.y = CEIL_H - 0.08;
    arena.add(cove);
  }

  // A Calder-style mobile: asymmetric wire arms that slowly turn, each ending in a painted paddle.
  function buildMobile(x, z, seed) {
    const rand = rng(seed);
    const colors = [PAL.red, PAL.charcoal, 0xf6efe2, PAL.orange, PAL.mustard, PAL.red];
    const wireMat = mat(PAL.charcoal, 0, 0, 0.4, 0.6);
    const root = new THREE.Group();
    root.position.set(x, CEIL_H, z);
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.8, 4), wireMat);
    hanger.position.y = -0.9;
    root.add(hanger);

    const paddle = (px, py) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.22 + rand() * 0.28, 20), new THREE.MeshStandardMaterial({ color: colors[Math.floor(rand() * colors.length)], roughness: 0.5, side: THREE.DoubleSide }));
      m.position.set(px, py, 0);
      m.scale.set(1, 0.72, 1);
      m.rotation.y = rand() * Math.PI;
      m.castShadow = true;
      return m;
    };

    const arm = (depth, length) => {
      const pivot = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, length, 4), wireMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.x = length * 0.25;
      pivot.add(bar);
      pivot.add(paddle(-length * 0.25, -0.12));
      const rightX = length * 0.75;
      if (depth > 0) {
        const drop = 0.8 + rand() * 0.4;
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, drop, 4), wireMat);
        wire.position.set(rightX, -drop / 2, 0);
        pivot.add(wire);
        const child = arm(depth - 1, length * 0.72);
        child.position.set(rightX, -drop, 0);
        pivot.add(child);
      } else {
        pivot.add(paddle(rightX, -0.12));
      }
      mobileArms.push({ obj: pivot, speed: (rand() - 0.5) * 0.5 });
      return pivot;
    };

    const top = arm(3, 4.4);
    top.position.y = -1.8;
    root.add(top);
    arena.add(root);
  }

  buildArena();

  // ---------- player craft: a tin-toy rocket pod ----------

  function buildPlayer() {
    const g = new THREE.Group();
    g.add(shadowed(new THREE.Mesh(lathe([[0, -0.42], [0.55, -0.36], [0.95, -0.18], [1.12, 0], [0.95, 0.14], [0.6, 0.26], [0, 0.3]]), mat(PAL.ivory, 0, 0, 0.25, 0.2))));
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.075, 10, 64), mat(PAL.orange, PAL.orange, 0.25, 0.35));
    band.rotation.x = Math.PI / 2;
    g.add(band);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x9fe0e0, transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.1 })
    );
    canopy.position.y = 0.22;
    g.add(canopy);
    const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat(PAL.mustard, PAL.mustard, 0.8));
    pilot.position.y = 0.38;
    g.add(pilot);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), mat(0xd8d4cc, 0, 0, 0.3, 0.8));
    antenna.position.set(0, 0.95, 0.15);
    g.add(antenna);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), mat(PAL.red, PAL.red, 2));
    beacon.position.set(0, 1.24, 0.15);
    beacon.name = 'beacon';
    g.add(beacon);
    const finMat = mat(PAL.teal, 0, 0, 0.4);
    for (const side of [-1, 1]) {
      const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.6), finMat));
      fin.position.set(side * 0.5, 0.15, 0.82);
      fin.rotation.z = side * 0.4;
      g.add(fin);
    }
    const tail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.55), finMat));
    tail.position.set(0, 0.35, 0.9);
    g.add(tail);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.35, 20), mat(0xd8d4cc, 0, 0, 0.25, 0.9));
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = 1.05;
    g.add(nozzle);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 16), new THREE.MeshBasicMaterial({ color: 0xffa54a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 1.6;
    flame.name = 'flame';
    g.add(flame);
    g.add(new THREE.PointLight(0xffc27a, 6, 10, 2));
    g.position.set(0, HOVER, 20);
    return g;
  }

  // Shield bubble: a glowing teal force field around the craft, with one orbiting
  // electron ring per shield held, so you can always tell at a glance.
  function buildShield() {
    const group = new THREE.Group();
    const bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x3fe0da) }, uStrength: { value: 1 } },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vPos;
        void main() {
          vPos = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vPos;
        void main() {
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.5);
          float bands = smoothstep(0.85, 1.0, sin(vPos.y * 9.0 - uTime * 4.0) * 0.5 + 0.5);
          float ribs = smoothstep(0.92, 1.0, abs(sin(atan(vPos.z, vPos.x) * 8.0)));
          float a = (0.07 + fres * 0.85 + bands * 0.2 + ribs * 0.15 * fres) * uStrength;
          vec3 col = mix(uColor, vec3(1.0), fres * 0.6);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1.75, 40, 28), bubbleMat);
    bubble.scale.y = 0.8;
    bubble.renderOrder = 3;
    group.add(bubble);
    const rings = [0, 1].map((i) => {
      const tilt = new THREE.Group();
      tilt.rotation.set(Math.PI / 2 + (i ? -0.5 : 0.5), i ? 0.8 : -0.8, 0);
      tilt.add(new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.035, 6, 80), new THREE.MeshBasicMaterial({ color: 0x3fe0da })));
      const spinner = new THREE.Group();
      const electron = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff1c0 }));
      electron.position.x = 2.05;
      spinner.add(electron);
      tilt.add(spinner);
      group.add(tilt);
      return { tilt, spinner };
    });
    const light = new THREE.PointLight(0x3fe0da, 0, 9, 2);
    group.add(light);
    group.visible = false;
    return { group, bubble, rings, light, pop: 0 };
  }

  const player = buildPlayer();
  scene.add(player);
  const shieldFx = buildShield();
  player.add(shieldFx.group);
  const velocity = new THREE.Vector3();
  const facing = new THREE.Vector3(0, 0, -1);

  // ---------- collectibles ----------

  // The spark: a Sputnik starburst lamp.
  function makeSpark() {
    const g = new THREE.Group();
    const burstGroup = new THREE.Group();
    burstGroup.name = 'burst';
    burstGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), mat(0xffc062, 0xff8a2a, 2.4, 0.3, 0.4)));
    const rodMat = mat(0xd9b86a, 0x8a5a10, 0.4, 0.25, 0.9);
    const tipMat = mat(0xfff4dc, 0xffd9a0, 2.2);
    const up = new THREE.Vector3(0, 1, 0);
    const n = 14;
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere: evenly spread spokes.
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5), rodMat);
      rod.quaternion.setFromUnitVectors(up, dir);
      rod.position.copy(dir).multiplyScalar(0.7);
      burstGroup.add(rod);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), tipMat);
      tip.position.copy(dir).multiplyScalar(1.25);
      burstGroup.add(tip);
    }
    g.add(burstGroup);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.035, 6, 64), new THREE.MeshBasicMaterial({ color: 0xffa04a, transparent: true, opacity: 0.6 }));
    halo.name = 'halo';
    halo.rotation.x = Math.PI / 2;
    g.add(halo);
    g.add(new THREE.PointLight(0xffa04a, 14, 16, 2));
    placeCollectible(g, 1.6);
    return g;
  }

  // The shield: an atomic-age atom with three orbiting electrons.
  function makeCrystal() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), mat(0x3fd1cc, 0x2fb8b4, 1.8, 0.3)));
    const orbitMat = mat(0xf3e8d2, 0xf3e8d2, 0.6);
    const electronMat = mat(PAL.mustard, PAL.mustard, 2.2);
    [0, Math.PI / 3, -Math.PI / 3].forEach((tilt, i) => {
      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.set(Math.PI / 2 + 0.25, tilt, 0);
      tiltGroup.add(new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.03, 6, 72), orbitMat));
      const spinner = new THREE.Group();
      spinner.name = `orbit-${i}`;
      const electron = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), electronMat);
      electron.position.x = 1.15;
      spinner.add(electron);
      tiltGroup.add(spinner);
      g.add(tiltGroup);
    });
    g.add(new THREE.PointLight(0x3fd1cc, 10, 13, 2));
    placeCollectible(g, 1.5);
    return g;
  }

  function placeCollectible(object, y) {
    for (let tries = 0; tries < 120; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.sqrt(Math.random()) * (ROOM - 6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const clear = obstacleData.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + 2.2);
      const farFromPlayer = !player || Math.hypot(x - player.position.x, z - player.position.z) > 10;
      if (clear && farFromPlayer) {
        object.position.set(x, y, z);
        return;
      }
    }
    object.position.set(0, y, -20);
  }

  let spark = makeSpark();
  scene.add(spark);
  let crystal = null;
  let currentTrail = null;

  // ---------- echoes: spooky, augmented spectres ----------

  // Hooded wraith silhouette: narrow hood, sloping shoulders, a wide hem with extra rings so it can tatter and ripple.
  const GHOST_H = 3.2;
  const ghostGeometry = lathe([
    [1.2, 0], [1.16, 0.07], [1.1, 0.16], [1.02, 0.28], [0.93, 0.45], [0.82, 0.75], [0.72, 1.1],
    [0.66, 1.5], [0.63, 1.85], [0.6, 2.1], [0.55, 2.35], [0.46, 2.62], [0.32, 2.86], [0.14, 3.08], [0, GHOST_H],
  ], 48);

  const GHOST_VERT = `
    uniform float uTime;
    uniform float uWobble;
    varying float vH;
    varying float vAng;
    varying vec3 vN;
    varying vec3 vView;
    void main() {
      vec3 p = position;
      float h = p.y;
      float ang = atan(p.z, p.x);
      float hem = 1.0 - smoothstep(0.0, 0.9, h);
      float wave = sin(ang * 7.0 + uTime * 4.0) * 0.5 + sin(ang * 3.0 - uTime * 2.3) * 0.5;
      // Ragged, tattered hem: some strips hang lower than others and flutter.
      float tatter = max(0.0, sin(ang * 11.0 + uTime * 2.6)) * max(0.0, sin(ang * 5.0 - uTime * 1.3));
      p.xz *= 1.0 + hem * 0.22 * wave * uWobble;
      p.y += hem * (wave * 0.12 - 0.05 - tatter * 0.35) * uWobble;
      p.x += sin(uTime * 1.7 + h * 2.0) * 0.05 * uWobble;
      vH = h / ${GHOST_H.toFixed(2)};
      vAng = ang;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vView = -mv.xyz;
      vN = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const GHOST_FRAG = `
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uReveal;
    uniform float uGlitch;
    varying float vH;
    varying float vAng;
    varying vec3 vN;
    varying vec3 vView;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      if (vH > uReveal) discard;
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      float fres = pow(1.0 - abs(dot(n, normalize(vView))), 2.0);
      float scan = smoothstep(0.35, 0.5, fract(vH * 26.0 - uTime * 1.6)) * 0.22;
      float flick = 0.8 + 0.2 * hash(floor(uTime * 20.0));
      float glitchRow = step(0.94 - uGlitch * 0.3, hash(floor(vH * 40.0) + floor(uTime * 14.0) * 7.0));
      float hemFade = smoothstep(0.0, 0.3, vH);
      float edge = smoothstep(uReveal - 0.05, uReveal, vH) * step(uReveal, 0.999);
      float folds = 0.5 + 0.5 * sin(vAng * 9.0 + vH * 3.0);
      vec3 deep = mix(vec3(0.005, 0.02, 0.03), vec3(0.03, 0.09, 0.11), folds);
      vec3 col = mix(deep, uColor, clamp(fres * 1.1 + scan * 0.5, 0.0, 1.0));
      col += vec3(0.85, 1.0, 1.0) * pow(fres, 4.0) * 0.9;
      col = mix(col, vec3(1.0, 0.25, 0.5), glitchRow * 0.65);
      col += uColor * edge * 2.0;
      float a = (0.5 + fres * 0.5 + scan * 0.3 + glitchRow * 0.3) * flick * hemFade * uOpacity + edge;
      gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    }
  `;

  function ghostMaterial(color, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
        uReveal: { value: 0 },
        uGlitch: { value: 0 },
        uWobble: { value: 1 },
      },
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // Floating "augmented reality" tag above each echo.
  function tagTexture(label, status, color) {
    const hex = `#${new THREE.Color(color).getHexString()}`;
    return canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = 'rgba(2, 10, 12, 0.55)';
      g.fillRect(14, 14, w - 28, h - 28);
      g.strokeStyle = hex;
      g.lineWidth = 4;
      const b = 20;
      for (const [x, y, sx, sy] of [[6, 6, 1, 1], [w - 6, 6, -1, 1], [6, h - 6, 1, -1], [w - 6, h - 6, -1, -1]]) {
        g.beginPath();
        g.moveTo(x, y + sy * b);
        g.lineTo(x, y);
        g.lineTo(x + sx * b, y);
        g.stroke();
      }
      g.textBaseline = 'middle';
      g.fillStyle = hex;
      // Shrink the title line until it fits inside the brackets.
      let size = 38;
      do {
        g.font = `${size}px Michroma, Jost, sans-serif`;
        size -= 2;
      } while (g.measureText(label).width > w - 68 && size > 16);
      g.fillText(label, 34, 46);
      g.font = '600 26px Jost, sans-serif';
      g.fillStyle = status === 'HUNTING' || status === 'LURKING' ? '#ff5a4a' : hex;
      g.fillText(`▸ ${status}`, 36, 92);
    });
  }

  const smokeTex = canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });

  const WISP_COUNT = 30;
  function makeWisps(color) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(WISP_COUNT * 3);
    const life = new Float32Array(WISP_COUNT);
    for (let i = 0; i < WISP_COUNT; i++) life[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(0.55) }, uMap: { value: smokeTex } },
      vertexShader: `
        attribute float aLife;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (0.4 + (1.0 - aLife) * 1.1) * 260.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform sampler2D uMap;
        varying float vLife;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vLife * 0.55;
          gl_FragColor = vec4(mix(vec3(0.02, 0.06, 0.07), uColor, vLife), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    return { points, positions, life, geo };
  }

  function updateWisps(w, origin, dt, strength) {
    for (let i = 0; i < WISP_COUNT; i++) {
      w.life[i] -= dt * (0.7 + (i % 5) * 0.08);
      const k = i * 3;
      if (w.life[i] <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 0.8;
        w.positions[k] = origin.x + Math.cos(a) * r;
        w.positions[k + 1] = origin.y - 1.1 + Math.random() * 0.4;
        w.positions[k + 2] = origin.z + Math.sin(a) * r;
        w.life[i] = strength * (0.6 + Math.random() * 0.4);
      } else {
        w.positions[k] += Math.sin(i * 1.7 + gameTime * 2) * dt * 0.3;
        w.positions[k + 1] += dt * (0.5 + (i % 3) * 0.15);
        w.positions[k + 2] += Math.cos(i * 1.3 + gameTime * 2) * dt * 0.3;
      }
    }
    w.geo.attributes.position.needsUpdate = true;
    w.geo.attributes.aLife.needsUpdate = true;
  }

  function makeGhost(color, number, temperament) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(ghostGeometry, ghostMaterial(color, 0.5));
    body.position.y = -1.2;
    body.renderOrder = 1;
    g.add(body);

    // Black, slanted eye sockets with burning eyes and a gaping mouth, drawn over the translucent body.
    // The eyes glow in the echo's color while it forms and turn red once it's hostile.
    const face = new THREE.Group();
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95, depthWrite: false });
    const pupilMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const eyeGlowMat = new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const faceZ = -0.56;
    const eyeGlows = [];
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), socketMat);
      socket.scale.set(1, 1.6, 0.4);
      socket.rotation.z = side * -0.4;
      socket.position.set(side * 0.2, 1.12, faceZ);
      face.add(socket);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), pupilMat);
      pupil.scale.set(0.55, 1.2, 0.3);
      pupil.rotation.z = side * -0.4;
      pupil.position.set(side * 0.2, 1.09, faceZ - 0.07);
      pupil.renderOrder = 6;
      face.add(pupil);
      const glow = new THREE.Sprite(eyeGlowMat);
      eyeGlows.push(glow);
      glow.scale.set(0.8, 0.8, 1);
      glow.position.set(side * 0.2, 1.09, faceZ - 0.12);
      glow.renderOrder = 7;
      face.add(glow);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), socketMat);
    mouth.scale.set(0.75, 1.8, 0.35);
    mouth.position.set(0, 0.72, faceZ - 0.1);
    face.add(mouth);
    face.traverse((o) => { if (!o.renderOrder) o.renderOrder = 5; });
    face.visible = false;
    g.add(face);

    // Segmented halo ring and a scanning disc — the "augmented" layer.
    const additive = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const halo = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const seg = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.022, 4, 10, Math.PI / 7), additive(color, 0.8));
      seg.rotation.z = (i / 10) * Math.PI * 2;
      halo.add(seg);
    }
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.45;
    g.add(halo);
    const scanner = new THREE.Mesh(new THREE.RingGeometry(0.15, 1.25, 40), additive(color, 0.22));
    scanner.rotation.x = -Math.PI / 2;
    g.add(scanner);

    const label = `ECHO-${String(number).padStart(2, '0')} · ${temperament}`;
    const tags = {
      forming: tagTexture(label, 'MATERIALIZING', color),
      patrol: tagTexture(label, 'PATROLLING', color),
      hunt: tagTexture(label, 'HUNTING', color),
      lurk: tagTexture(label, 'LURKING', color),
    };
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tags.forming, transparent: true, depthWrite: false, opacity: 0.9 }));
    tag.scale.set(3.4, 0.85, 1);
    tag.position.y = 2.65;
    g.add(tag);

    // Dark smoky shadow pooled on the floor beneath it.
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32), new THREE.MeshBasicMaterial({ map: smokeTex, color: 0x05181b, transparent: true, opacity: 0.75, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    // Ectoplasm wisps that peel off the hem and rise.
    const wisps = makeWisps(color);
    scene.add(wisps.points);

    // Two chromatic afterimages that lag behind it.
    const afterimages = [0xff5fb0, 0x5fe8ff].map((c) => {
      const m = new THREE.Mesh(ghostGeometry, ghostMaterial(c, 0.28));
      scene.add(m);
      return m;
    });

    return { group: g, body, face, halo, scanner, tag, tags, pupilMat, eyeGlowMat, eyeGlows, afterimages, shadow, wisps };
  }

  function temperamentOf(n) {
    if (n < CALM_NERVE) return 'CALM';
    if (n < 0.5) return 'UNEASY';
    if (n < 0.75) return 'FRANTIC';
    return 'PANICKED';
  }

  // Exaggerate the wobble in a route: keep its overall line, but multiply every swerve by k.
  function amplifyTremor(path, k) {
    const lim = ROOM - 1.5;
    return path.map((p, i) => {
      let sx = 0;
      let sz = 0;
      let c = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(path.length - 1, i + 2); j++) {
        sx += path[j].x;
        sz += path[j].z;
        c++;
      }
      sx /= c;
      sz /= c;
      let x = sx + (p.x - sx) * k;
      let z = sz + (p.z - sz) * k;
      const r = Math.hypot(x, z);
      if (r > lim) {
        x *= lim / r;
        z *= lim / r;
      }
      return new THREE.Vector3(x, p.y, z);
    });
  }

  // Cut long standstills out of a route so the echo doesn't park in one spot: a brief
  // hesitation survives, but hovering beyond MAX_IDLE_SAMPLES is dropped.
  function trimIdle(path) {
    if (!path.length) return path;
    const out = [path[0]];
    let idle = 0;
    for (let i = 1; i < path.length; i++) {
      const last = out[out.length - 1];
      if (Math.hypot(path[i].x - last.x, path[i].z - last.z) < IDLE_STEP) {
        if (++idle > MAX_IDLE_SAMPLES) continue;
      } else {
        idle = 0;
      }
      out.push(path[i]);
    }
    return out;
  }

  function createEcho(path, n = 0) {
    path = trimIdle(path);
    if (path.length < 8) return;
    // Panicked echoes burn from their spectral colour toward angry red.
    const base = new THREE.Color(GHOST_COLORS[echoes.length % GHOST_COLORS.length]);
    const color = base.lerp(new THREE.Color(0xff4a3a), THREE.MathUtils.clamp((n - 0.4) / 0.6, 0, 1)).getHex();
    const temperament = temperamentOf(n);
    const ghost = makeGhost(color, echoes.length + 1, `${temperament} ${Math.round(n * 100)}%`);
    const echo = {
      ...ghost,
      path: amplifyTremor(path, 1 + 1.8 * n),
      nerve: n,
      timeScale: (1 + (level - 1) * 0.06) * (1 + 0.6 * n),
      cursor: 0,
      dir: 1,
      mode: 'forming',
      target: 0,
      targetDist: Infinity,
      retarget: 0,
      flare: 0,
      lastNearMiss: -9,
      born: gameTime,
      dead: false,
      hue: color,
      trail: [],
      armed: false,
    };
    echo.group.position.copy(echo.path[0]);
    scene.add(echo.group);
    echoes.push(echo);
    echo.ribbon = addRouteRibbon(echo.path, color);
    if (n >= 0.5) tone(1400, 0.6, 'sawtooth', 0.05, 160);   // a shriek for a frantic one
    else tone(660, 0.35, 'sine', 0.04, 990);                // a soft chime for a calm one
  }

  function removeEcho(e) {
    scene.remove(e.group);
    if (e.ribbon) scene.remove(e.ribbon);
    scene.remove(e.shadow);
    scene.remove(e.wisps.points);
    e.afterimages.forEach((m) => scene.remove(m));
  }

  // Each echo's route is painted on the floor as a soft glowing ribbon with slow dashes flowing
  // along it, so you can read where it can reach. It brightens and reddens while that echo hunts.
  function addRouteRibbon(path, color) {
    const width = 0.55;
    const positions = [];
    const dist = [];
    const side = [];
    const index = [];
    let along = 0;
    let tx = 0;
    let tz = -1;
    for (let i = 0; i < path.length; i++) {
      const prev = path[Math.max(0, i - 1)];
      const next = path[Math.min(path.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dz);
      if (len > 1e-3) { tx = dx / len; tz = dz / len; }  // keep the last direction while hovering
      if (i > 0) along += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      const nx = -tz * width * 0.5;
      const nz = tx * width * 0.5;
      positions.push(path[i].x + nx, 0.05, path[i].z + nz, path[i].x - nx, 0.05, path[i].z - nz);
      dist.push(along, along);
      side.push(1, -1);
      if (i > 0) {
        const a = (i - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    geo.setIndex(index);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        // Deepened so the ribbon reads against the pale terrazzo.
        uColor: { value: new THREE.Color(color).offsetHSL(0, 0.2, -0.28) },
        uHunt: { value: new THREE.Color(0xd4141c) },
        uHunting: { value: 0 },
        uStrength: { value: 0.5 },
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float aDist;
        attribute float aSide;
        varying float vDist;
        varying float vSide;
        void main() {
          vDist = aDist;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uHunt;
        uniform float uHunting;
        uniform float uStrength;
        uniform float uTime;
        varying float vDist;
        varying float vSide;
        void main() {
          float edge = 1.0 - abs(vSide);
          float core = smoothstep(0.0, 0.6, edge);
          float dash = smoothstep(0.35, 0.5, fract(vDist * 0.45 - uTime * 0.6)) * 0.55;
          vec3 col = mix(uColor, uHunt, uHunting);
          float a = (0.38 * core + dash * core) * uStrength;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const ribbon = new THREE.Mesh(geo, material);
    ribbon.userData.routeLine = true;
    ribbon.renderOrder = 0;
    scene.add(ribbon);
    return ribbon;
  }

  function updateCurrentTrail() {
    if (currentTrail) {
      scene.remove(currentTrail);
      currentTrail.geometry.dispose();
      currentTrail.material.dispose();
    }
    if (route.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(route.map((p) => new THREE.Vector3(p.x, 0.1, p.z)));
    const calm = new THREE.Color(PAL.orange);
    const panic = new THREE.Color(0xd4141c);
    const colors = [];
    const c = new THREE.Color();
    route.forEach((_, i) => {
      c.copy(calm).lerp(panic, THREE.MathUtils.clamp((routeJitter[i] || 0) * 2.5, 0, 1));
      colors.push(c.r, c.g, c.b);
    });
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    currentTrail = new THREE.Line(geo, new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: 0.85, dashSize: 0.35, gapSize: 0.28 }));
    currentTrail.computeLineDistances();
    scene.add(currentTrail);
  }

  function startRoute() {
    route = [player.position.clone()];
    routeJitter = [0];
    nerve = { jitter: 0, samples: 0, nearMiss: 0, hesitation: 0, boost: 0, strainWarned: false };
    lastDir = null;
    updateCurrentTrail();
  }

  // 0 = rock steady, 1 = full panic: swerving, reversing, freezing near echoes, near misses,
  // and leaning on the boost for longer than BOOST_GRACE.
  function routeNerve() {
    if (!nerve.samples) return 0;
    const jitter = nerve.jitter / nerve.samples;
    const freeze = nerve.hesitation / nerve.samples;
    const strain = Math.max(0, nerve.boost - BOOST_GRACE) * BOOST_NERVE;
    return THREE.MathUtils.clamp(jitter * 2.2 + freeze * 0.8 + nerve.nearMiss * 0.18 + strain, 0, 1);
  }

  function clearRoutes() {
    echoes.splice(0).forEach(removeEcho);
    [...scene.children].filter((c) => c.userData.routeLine).forEach((line) => {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    });
    route = [];
    updateCurrentTrail();
  }

  // ---------- game flow ----------

  function resetGame() {
    score = 0;
    level = 1;
    sparks = 0;
    totalSparks = 0;
    rewinds = 1;
    shields = 0;
    gameTime = 0;
    nextCrystal = CRYSTAL_FIRST;
    invulnerable = 1.5;
    liveNerve = 0;
    velocity.set(0, 0, 0);
    facing.set(0, 0, -1);
    look.yaw = 0;
    look.pitch = 0.37;
    player.position.set(0, HOVER, 20);
    player.rotation.set(0, 0, 0);
    endCinematic();
    overlay.classList.remove('lost');
    clearRoutes();
    snapshots.length = 0;
    if (crystal) { scene.remove(crystal); crystal = null; }
    placeCollectible(spark, 1.6);
    startRoute();
    updateHud();
    statusEl.textContent = 'EXPEDITION UNDERWAY · ECHOES 00';
  }

  function startGame() {
    unlockAudio();
    resetGame();
    state = 'play';
    overlay.classList.add('hidden');
    startBtn.blur();  // so Space (rewind) can't "click" the hidden start button
    lockCursor();
    showMessage(isTouch ? 'LEFT THUMB FLY · RIGHT THUMB LOOK · DOUBLE-TAP & HOLD RIGHT TO BOOST' : 'WASD MOVE · ARROWS OR TRACKPAD LOOK · ESC FREES CURSOR', 3200);
  }

  function collectSpark() {
    burst(spark.position, 0xffa04a, 22);
    score += 100 + level * 25;
    sparks++;
    totalSparks++;
    const n = routeNerve();
    createEcho(route, n);
    startRoute();
    // Calm flying is rewarded now; panicked flying is punished later by the echo it creates.
    let note;
    if (n < CALM_NERVE) {
      score += CALM_BONUS;
      note = `COOL HEAD · +${CALM_BONUS} · A CALM ECHO`;
    } else if (n >= 0.75) {
      note = 'PANICKED ECHO RELEASED · YOUR FEAR WILL FOLLOW YOU';
    } else if (n >= 0.5) {
      note = 'FRANTIC ECHO RELEASED · IT MOVES LIKE YOU DID';
    }
    if (totalSparks % REWIND_EVERY === 0 && rewinds < 3) {
      rewinds++;
      note = note ? `${note} · +1 REWIND` : 'TEMPORAL CHARGE RESTORED';
    }
    if (note) showMessage(note, 2000);
    tone(620 + sparks * 45, 0.12, 'triangle', 0.08, 980 + sparks * 50);
    if (sparks >= SPARKS_PER_LEVEL) levelUp();
    else placeCollectible(spark, 1.6);
    updateHud();
  }

  // Sector clear: time stops, the camera sweeps a full circle around the craft while every
  // echo dissolves one after another, then the next sector begins.
  const CLEAR_TIME = 2.8;
  function levelUp() {
    const bonus = level * 500;
    score += bonus;
    state = 'clear';
    velocity.set(0, 0, 0);
    cine = { kind: 'clear', t: 0, yaw: look.yaw };
    screenFx('clear', CLEAR_TIME * 1000);
    banner('clear', `SECTOR ${String(level).padStart(2, '0')} CLEAR`, `+${bonus} · THE PAST FALLS SILENT`, CLEAR_TIME * 1000);
    shockwave(player.position, 0xe9bd7d, 32, 1.8);
    burst(player.position, 0xffc861, 40);
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.55, 'triangle', 0.07, f * 1.01), i * 130));
    const gap = Math.min(0.22, 1.5 / Math.max(1, echoes.length));
    echoes.forEach((e, i) => setTimeout(() => {
      if (state !== 'clear' || e.dead) return;
      e.dead = true;
      burst(e.group.position, e.hue, 26);
      shockwave(e.group.position, e.hue, 7, 0.7);
      removeEcho(e);
      tone(1250 - i * 45, 0.22, 'sine', 0.045, 420);
    }, (0.45 + i * gap) * 1000));
    setTimeout(finishLevelUp, CLEAR_TIME * 1000);
  }

  function finishLevelUp() {
    if (state !== 'clear') return;
    endCinematic();
    level++;
    sparks = 0;
    invulnerable = 2;
    state = 'play';
    showMessage(`SECTOR ${String(level).padStart(2, '0')} · THE PAST GROWS RESTLESS`, 2100);
    clearRoutes();
    startRoute();
    placeCollectible(spark, 1.6);
    tone(440, 0.55, 'triangle', 0.08, 1320);
    updateHud();
  }

  function collectCrystal() {
    shields = Math.min(2, shields + 1);
    burst(crystal.position, 0x3fd1cc, 28);
    scene.remove(crystal);
    crystal = null;
    nextCrystal = gameTime + THREE.MathUtils.randFloat(CRYSTAL_GAP[0], CRYSTAL_GAP[1]);
    shieldFx.pop = 0.2;  // pop the bubble open from small
    showMessage(shields >= 2 ? 'SHIELD ×2 · YOU CAN DESTROY TWO ECHOES' : 'SHIELD ON · THE NEXT ECHO YOU TOUCH IS DESTROYED', 2200);
    tone(800, 0.3, 'sine', 0.07, 1480);
    updateHud();
  }

  function hitEcho(echo) {
    if (invulnerable > 0 || echo.dead) return;
    if (shields > 0) {
      shields--;
      echo.dead = true;
      removeEcho(echo);
      burst(echo.group.position, echo.hue, 34);
      burst(player.position, 0x3fe0da, 26);  // the bubble shatters
      score += 250;
      shake = 0.7;
      shieldFlash();
      // Slow motion, a punch-in zoom and two shockwaves: yours and the ghost's.
      timeScale = 0.18;
      camera.fov = 44;
      shockwave(player.position, 0x3fe0da, 15, 1.0);
      shockwave(echo.group.position, echo.hue, 9, 0.75);
      screenFx('shield', 750);
      banner('shield', 'ECHO DESTROYED', shields > 0 ? `+250 · ${shields} SHIELD LEFT` : '+250 · SHIELD SPENT', 1500);
      tone(1300, 0.25, 'square', 0.05, 180);
      tone(95, 0.7, 'sine', 0.14, 30);
      updateHud();
      return;
    }
    velocity.set(0, 0, 0);
    state = 'caught';
    shake = 1.1;
    damageFlash();
    // Time freezes: the camera circles in on the craft and the ghost that got it.
    cine = { kind: 'caught', t: 0, yaw: look.yaw, killer: echo.group.position.clone() };
    screenFx('caught');
    burst(player.position, 0xff6a3a, 30);
    shockwave(player.position, 0xff4a3a, 10, 0.8);
    banner('caught', 'CAUGHT', rewinds > 0 ? `BY YOUR PAST · ${isTouch ? 'TAP ⟲' : 'PRESS SPACE'} TO REWIND (${rewinds})` : 'BY YOUR PAST · NO REWINDS LEFT', rewinds > 0 ? 4000 : 1400);
    tone(360, 0.65, 'sawtooth', 0.07, 55);
    tone(70, 1.2, 'sine', 0.13, 28);
    setTimeout(() => { if (state === 'caught') tone(880, 1.6, 'sine', 0.035); }, 500);  // flatline
    if (rewinds > 0) {
      setTimeout(() => { if (state === 'caught') gameOver(); }, 4000);
    } else {
      setTimeout(() => { if (state === 'caught') gameOver(); }, 900);
    }
  }

  function rewind() {
    if (rewinds <= 0 || (state !== 'play' && state !== 'caught')) return;
    const snap = snapshots[Math.max(0, snapshots.length - 18)];
    if (!snap) return;
    rewinds--;
    player.position.copy(snap.position);
    facing.copy(snap.facing);
    route = snap.route.map((p) => p.clone());
    routeJitter = snap.routeJitter.slice();
    nerve = { ...snap.nerve };
    lastDir = null;
    echoes.forEach((e, i) => { if (snap.cursors[i] !== undefined) e.cursor = snap.cursors[i]; });
    updateCurrentTrail();
    velocity.set(0, 0, 0);
    invulnerable = REWIND_SAFE_TIME;
    state = 'play';
    endCinematic();
    player.rotation.set(0, player.rotation.y, 0);  // undo the crash spin
    screenFx('rewind', 600);
    shockwave(player.position, 0x3fd1cc, 9, 0.6);
    burst(player.position, 0x3fd1cc, 32);
    showMessage('TIMELINE RESTORED', 1800);
    tone(1150, 0.5, 'square', 0.035, 180);
    updateHud();
  }

  function gameOver() {
    state = 'over';
    if (document.pointerLockElement) document.exitPointerLock();  // free the cursor for the restart button
    statusEl.textContent = 'EXPEDITION LOST';
    overlay.querySelector('.transmission').textContent = 'MISSION CONTROL · SIGNAL LOST';
    overlay.querySelector('.kicker').textContent = `FINAL SCORE ${String(score).padStart(5, '0')} · SECTOR ${String(level).padStart(2, '0')}`;
    overlay.querySelector('h1').innerHTML = 'LOST IN THE<br><span>AFTERGLOW.</span>';
    overlay.querySelector('.lede').textContent = 'Your past caught up with you. Step back into the atrium and fly a cleaner timeline.';
    startBtn.querySelector('span').textContent = 'TRY AGAIN';
    overlay.classList.add('lost');
    overlay.classList.remove('hidden');
  }

  // ---------- simulation ----------

  function isBlocked(x, z) {
    if (Math.hypot(x, z) > ROOM - 1.2) return true;
    return obstacleData.some((o) => Math.hypot(x - o.x, z - o.z) < o.r);
  }

  function updatePlayer(dt) {
    // WASD (or the touch joystick) moves relative to where the camera is looking; the craft
    // turns to face its movement. The joystick is analog: a half push flies at half speed.
    const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchStick.x;
    const ahead = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touchStick.y;
    const throttle = Math.min(1, Math.hypot(strafe, ahead));
    const forward = new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
    const right = new THREE.Vector3(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
    const input = forward.multiplyScalar(ahead).addScaledVector(right, strafe);
    const boosting = boostHeld() && input.lengthSq() > 0;
    const maxSpeed = (boosting ? 16 : 10.5) + (level - 1) * 0.35;
    if (input.lengthSq() > 0) {
      input.normalize();
      velocity.lerp(input.multiplyScalar(maxSpeed * throttle), 1 - Math.exp(-dt * 8));
      facing.lerp(input.normalize(), 1 - Math.exp(-dt * 7)).normalize();
    } else {
      velocity.multiplyScalar(Math.exp(-dt * 7));
    }

    const oldX = player.position.x;
    const oldZ = player.position.z;
    const nx = oldX + velocity.x * dt;
    const nz = oldZ + velocity.z * dt;
    if (!isBlocked(nx, oldZ)) player.position.x = nx; else velocity.x *= -0.18;
    if (!isBlocked(player.position.x, nz)) player.position.z = nz; else velocity.z *= -0.18;

    const speed = velocity.length();
    player.position.y = HOVER + Math.sin(gameTime * 5.5) * 0.12 + Math.min(speed * 0.018, 0.24);
    player.rotation.y = Math.atan2(-facing.x, -facing.z);
    // Bank into turns: sideways speed relative to the craft's own facing.
    const lateral = velocity.x * -facing.z + velocity.z * facing.x;
    player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -lateral * 0.018, 1 - Math.exp(-dt * 6));
    animateCraft(speed, boosting);
    speedBar.style.width = `${Math.min(100, speed / (16 + level * 0.35) * 100)}%`;

    // Record every sample, hovering included, so echoes replay your hesitations and dashes exactly.
    sampleTimer += dt;
    if (sampleTimer >= SAMPLE_DT) {
      sampleTimer -= SAMPLE_DT;
      const j = measureJitter(speed, boosting);
      route.push(player.position.clone());
      routeJitter.push(j);
      if (route.length % 3 === 0) updateCurrentTrail();
    }
    liveNerve = Math.max(0, liveNerve - dt * 0.35);
  }

  // How nervous was this last slice of flight? Sharp turns and reversals count, and so does
  // freezing in place while an armed echo is close by. Boosting past the grace strains it too.
  function measureJitter(speed, boosting) {
    let j = 0;
    if (speed > 1) {
      const dir = new THREE.Vector2(velocity.x, velocity.z).normalize();
      if (lastDir) {
        const turn = Math.acos(THREE.MathUtils.clamp(dir.dot(lastDir), -1, 1));
        j = (turn / Math.PI) * Math.min(1, speed / 4);
        if (turn > 2.2) j += 0.5;  // a reversal is pure panic
      }
      lastDir = dir;
    } else if (echoes.some((e) => e.armed && !e.dead && e.group.position.distanceTo(player.position) < 10)) {
      nerve.hesitation++;
      j = 0.35;
    }
    nerve.jitter += Math.min(j, 1);
    nerve.samples++;
    liveNerve = Math.min(1, liveNerve + j * 0.5);
    if (boosting) {
      nerve.boost += SAMPLE_DT;
      if (nerve.boost > BOOST_GRACE) {
        liveNerve = Math.min(1, liveNerve + 0.06);  // heart climbs the longer you hold it
        if (!nerve.strainWarned) {
          nerve.strainWarned = true;
          showMessage('BOOST STRAIN · YOUR NERVE IS RISING', 1800);
        }
        return j + 0.25;  // tint the live trail red where you over-boosted
      }
    }
    return j;
  }

  // Your heart races as your nerve goes: a synth thump from ~60 to ~150 bpm, with a red pulse.
  function updateHeartbeat(dt) {
    const h = Math.max(liveNerve, routeNerve() * 0.7);
    if (h < 0.12) { heartTimer = 0; return; }
    heartTimer += dt;
    if (heartTimer < 60 / (60 + 90 * h)) return;
    heartTimer = 0;
    tone(62, 0.14, 'sine', 0.05 + 0.1 * h, 38);
    setTimeout(() => tone(56, 0.12, 'sine', 0.03 + 0.07 * h, 36), 150);
    heartEl.style.opacity = (0.12 + 0.5 * h).toFixed(2);
    setTimeout(() => { heartEl.style.opacity = '0'; }, 110);
  }

  // Analog nerve dial: needle sweeps from CALM to PANIC with this route's nerve.
  function updateNerveHud() {
    const n = routeNerve();
    nerveNeedle.style.transform = `rotate(${-90 + n * 180}deg)`;
    const t = temperamentOf(n);
    if (nerveLabel.textContent !== t) {
      nerveLabel.textContent = t;
      nerveLabel.dataset.level = t.toLowerCase();
    }
  }

  function updateShieldFx(dt) {
    const fx = shieldFx;
    fx.pop = THREE.MathUtils.lerp(fx.pop, shields > 0 ? 1 : 0, 1 - Math.exp(-dt * 10));
    fx.group.visible = fx.pop > 0.02;
    if (!fx.group.visible) return;
    const pulse = 1 + Math.sin(gameTime * 5) * 0.035;
    fx.group.scale.setScalar(fx.pop * pulse);
    fx.bubble.material.uniforms.uTime.value = gameTime;
    fx.bubble.material.uniforms.uStrength.value = shields >= 2 ? 1.25 : 0.95;
    fx.rings.forEach((r, i) => {
      r.tilt.visible = i < shields;
      r.spinner.rotation.z += dt * (3 + i);
    });
    fx.light.intensity = 8 * fx.pop;
  }

  function animateCraft(speed, boosting) {
    const flame = player.getObjectByName('flame');
    flame.scale.y = 0.35 + speed * 0.07 + Math.random() * 0.2 + (boosting ? 0.5 : 0);
    flame.material.opacity = 0.35 + Math.min(0.55, speed * 0.05);
    player.getObjectByName('beacon').material.emissiveIntensity = Math.sin(gameTime * 6) > 0 ? 3 : 0.2;
  }

  // Advance an echo's cursor by `points` along its route, never faster than ECHO_MAX_SPEED in the world.
  function stepAlong(e, points, dt) {
    const i = THREE.MathUtils.clamp(Math.floor(e.cursor), 0, e.path.length - 2);
    const seg = Math.max(0.05, e.path[i].distanceTo(e.path[i + 1]));
    const maxPoints = (ECHO_MAX_SPEED * dt) / seg;
    return Math.sign(points) * Math.min(Math.abs(points), maxPoints);
  }

  // Path-bound hunting: an echo never leaves the route you flew, but once it notices you it
  // races along that route toward the point nearest you, then lurks there waiting.
  function moveEcho(e, index, armed, dt) {
    const last = e.path.length - 1;
    const rate = (1 / SAMPLE_DT) * e.timeScale * dt;  // your recorded timing, sped up by level and nerve

    e.retarget -= dt;
    if (e.retarget <= 0) {
      e.retarget = THREE.MathUtils.lerp(0.6, 0.15, e.nerve);  // frantic echoes react faster
      let best = Infinity;
      for (let k = 0; k <= last; k++) {
        const p = e.path[k];
        const d = (p.x - player.position.x) ** 2 + (p.z - player.position.z) ** 2;
        if (d < best) { best = d; e.target = k; }
      }
      e.targetDist = Math.sqrt(best);
    }

    const huntRadius = HUNT_RADIUS + 8 * e.nerve;
    let mode = 'patrol';
    if (armed && state === 'play' && e.targetDist < huntRadius) {
      const delta = e.target - e.cursor;
      if (Math.abs(delta) < 0.8) {
        mode = 'lurk';
        e.cursor = THREE.MathUtils.clamp(e.target + Math.sin(gameTime * 7 + index) * 0.5 * (0.4 + e.nerve), 0, last);
      } else {
        mode = 'hunt';
        const closeness = THREE.MathUtils.clamp(1 - e.group.position.distanceTo(player.position) / huntRadius, 0, 1);
        let step = Math.sign(delta) * rate * (1 + (0.3 + 0.7 * e.nerve) * closeness) * 1.3;
        step = stepAlong(e, step, dt);
        if (Math.abs(step) > Math.abs(delta)) step = delta;
        e.cursor += step;
        e.dir = Math.sign(delta);
      }
    } else {
      // Faithful replay: back and forth along your route at the speed you flew it.
      e.cursor += stepAlong(e, e.dir * rate, dt);
      if (e.cursor >= last) { e.cursor = last; e.dir = -1; }
      if (e.cursor <= 0) { e.cursor = 0; e.dir = 1; }
    }
    if (!armed) mode = 'forming';

    if (mode !== e.mode) {
      if (mode === 'hunt' && e.mode !== 'lurk') {
        e.flare = 1;
        if (gameTime - lastShriek > 0.8) {
          lastShriek = gameTime;
          tone(900 + e.nerve * 500, 0.4, 'sawtooth', 0.035, 260);
        }
      }
      e.mode = mode;
      e.tag.material.map = e.tags[mode];
      e.tag.material.needsUpdate = true;
    }
  }

  function updateEchoes(dt) {
    let nearest = Infinity;
    echoes.forEach((e, index) => {
      if (e.dead || e.path.length < 2) return;
      const age = gameTime - e.born;
      const armed = age > ECHO_ARM_TIME;
      moveEcho(e, index, armed, dt);
      const i = THREE.MathUtils.clamp(Math.floor(e.cursor), 0, e.path.length - 2);
      const next = i + 1;
      const alpha = e.cursor - i;
      const g = e.group;
      g.position.lerpVectors(e.path[i], e.path[next], alpha);
      g.position.y = 1.25 + Math.sin(gameTime * 2.4 + index) * 0.18;
      // Frantic echoes twitch unpredictably — and the twitch is real, it can catch you.
      if (armed && e.nerve > 0.5) {
        const twitch = (e.nerve - 0.5) * 0.7;
        g.position.x += (Math.random() - 0.5) * twitch;
        g.position.z += (Math.random() - 0.5) * twitch;
      }
      const dist = g.position.distanceTo(player.position);

      // Drift facing forward along its route — but once armed and close, it turns to stare
      // straight into the camera, at you.
      let dx = (e.path[next].x - e.path[i].x) * e.dir;
      let dz = (e.path[next].z - e.path[i].z) * e.dir;
      if (armed && dist < 12) {
        dx = camera.position.x - g.position.x;
        dz = camera.position.z - g.position.z;
      }
      if (dx * dx + dz * dz > 1e-5) {
        const target = Math.atan2(-dx, -dz);
        const diff = Math.atan2(Math.sin(target - g.rotation.y), Math.cos(target - g.rotation.y));
        g.rotation.y += diff * (1 - Math.exp(-dt * 6));
      }
      if (armed) nearest = Math.min(nearest, dist);
      const glitch = armed ? Math.max(e.nerve * 0.6, THREE.MathUtils.clamp((9 - dist) / 6, 0, 1)) : 0.4;

      // Materialize from the floor up, then stay solid and hostile.
      const u = e.body.material.uniforms;
      u.uTime.value = gameTime + index * 3.1;
      u.uReveal.value = Math.min(1.01, age / (ECHO_ARM_TIME * 0.8));
      u.uOpacity.value = armed ? 1 : 0.55;
      u.uGlitch.value = glitch;
      e.face.visible = u.uReveal.value > 0.9;
      e.shadow.position.set(g.position.x, 0.035, g.position.z);
      e.shadow.material.opacity = 0.35 + Math.min(1, age) * 0.4;
      updateWisps(e.wisps, g.position, dt, armed ? 1 : 0.5);
      if (armed !== e.armed) {
        e.armed = armed;
        e.pupilMat.color.set(armed ? 0xff3b2f : e.hue);
        e.eyeGlowMat.color.set(armed ? 0xff2a1a : e.hue);
      }
      // Eyes flare when it starts hunting you.
      e.flare = Math.max(0, e.flare - dt * 1.5);
      const ru = e.ribbon.material.uniforms;
      const hunting = e.mode === 'hunt' || e.mode === 'lurk' ? 1 : 0;
      ru.uTime.value = gameTime;
      ru.uHunting.value = THREE.MathUtils.lerp(ru.uHunting.value, hunting, 1 - Math.exp(-dt * 5));
      ru.uStrength.value = THREE.MathUtils.lerp(ru.uStrength.value, armed ? 1 + hunting * 0.7 : 0.5, 1 - Math.exp(-dt * 5));
      const eyeSize = 0.8 + e.flare * 1.1 + (e.mode === 'hunt' ? 0.25 : 0);
      e.eyeGlows.forEach((s) => s.scale.set(eyeSize, eyeSize, 1));
      e.halo.rotation.z += dt * (armed ? 1.6 : 0.6);
      e.scanner.position.y = -1.15 + ((gameTime * 0.8 + index * 0.37) % 1) * 3.2;
      e.tag.material.opacity = 0.55 + Math.random() * 0.1 + glitch * 0.35;

      // Chromatic afterimages trail a few frames behind.
      e.trail.push(g.position.clone());
      if (e.trail.length > 12) e.trail.shift();
      e.afterimages.forEach((m, k) => {
        const p = e.trail[Math.max(0, e.trail.length - 5 - k * 5)];
        m.position.set(p.x, p.y - 1.2, p.z);
        m.rotation.y = g.rotation.y;
        const mu = m.material.uniforms;
        mu.uTime.value = gameTime + index * 3.1 - 0.1 * (k + 1);
        mu.uReveal.value = u.uReveal.value;
        mu.uOpacity.value = (armed ? 0.3 : 0.12) + glitch * 0.25;
        mu.uGlitch.value = glitch;
      });

      if (armed && dist < ECHO_RADIUS + PLAYER_RADIUS) {
        hitEcho(e);
      } else if (armed && dist < ECHO_RADIUS + PLAYER_RADIUS + NEAR_MISS_GAP && gameTime - e.lastNearMiss > 1) {
        // A near miss rattles you: it counts toward this route's nerve.
        e.lastNearMiss = gameTime;
        nerve.nearMiss++;
        liveNerve = Math.min(1, liveNerve + 0.35);
        tone(520, 0.25, 'sine', 0.04, 140);
      }
    });
    haunt(nearest);
    statusEl.textContent = `EXPEDITION UNDERWAY · ECHOES ${String(echoes.filter((e) => !e.dead).length).padStart(2, '0')}`;
  }

  // Cold haze, screen jitter and a low hum when an armed echo is near.
  function haunt(distance) {
    const intensity = state === 'play' ? THREE.MathUtils.clamp((10 - distance) / 7, 0, 1) : 0;
    hauntEl.style.opacity = (intensity * 0.9).toFixed(3);
    hauntEl.classList.toggle('glitch', intensity > 0.6);
    if (hum && audioCtx) hum.gain.setTargetAtTime(muted ? 0 : intensity * 0.07, audioCtx.currentTime, 0.12);
  }

  function updateCollectibles(dt) {
    spark.getObjectByName('burst').rotation.y += dt * 0.9;
    spark.getObjectByName('burst').rotation.x += dt * 0.35;
    spark.getObjectByName('halo').rotation.z += dt * 0.6;
    spark.position.y = 1.6 + Math.sin(gameTime * 3.2) * 0.22;
    if (spark.position.distanceTo(player.position) < 2.0) collectSpark();
    if (!crystal && gameTime >= nextCrystal) {
      crystal = makeCrystal();
      scene.add(crystal);
      showMessage('ATOMIC SHIELD DETECTED', 1500);
    }
    if (crystal) {
      for (let i = 0; i < 3; i++) crystal.getObjectByName(`orbit-${i}`).rotation.z += dt * (2.2 + i * 0.7);
      crystal.rotation.y -= dt * 0.6;
      crystal.position.y = 1.5 + Math.sin(gameTime * 4) * 0.2;
      if (crystal.position.distanceTo(player.position) < 2) collectCrystal();
    }
  }

  function saveSnapshot(dt) {
    snapshotTimer += dt;
    if (snapshotTimer < 0.11) return;
    snapshotTimer = 0;
    snapshots.push({
      position: player.position.clone(),
      facing: facing.clone(),
      route: route.map((p) => p.clone()),
      routeJitter: routeJitter.slice(),
      nerve: { ...nerve },
      cursors: echoes.map((e) => e.cursor),
    });
    if (snapshots.length > 40) snapshots.shift();
  }

  // ---------- camera ----------

  function turnView(dx, dy, sensitivity) {
    look.yaw -= dx * sensitivity;
    look.pitch = THREE.MathUtils.clamp(look.pitch + dy * sensitivity, LOOK.minPitch, LOOK.maxPitch);
  }

  function updateLook(dt) {
    if (state === 'title' || state === 'over') {
      // A restrained drift keeps the observatory windows in the title composition.
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) look.yaw = Math.sin(performance.now() * 0.000065) * 0.3;
      return;
    }
    const yawInput = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
    const pitchInput = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    look.yaw += yawInput * LOOK.keyYaw * dt;
    look.pitch = THREE.MathUtils.clamp(look.pitch + pitchInput * LOOK.keyPitch * dt, LOOK.minPitch, LOOK.maxPitch);
  }

  // Fade any column, planter or hearth standing between the camera and the craft.
  function fadeOccluders(dt) {
    const ax = camera.position.x;
    const az = camera.position.z;
    const abx = player.position.x - ax;
    const abz = player.position.z - az;
    const lenSq = abx * abx + abz * abz || 1;
    for (const o of obstacleData) {
      if (!o.body) continue;
      const t = THREE.MathUtils.clamp(((o.x - ax) * abx + (o.z - az) * abz) / lenSq, 0, 1);
      const blocking = Math.hypot(ax + abx * t - o.x, az + abz * t - o.z) < o.radius + 0.8;
      const m = o.body.material;
      m.opacity = THREE.MathUtils.lerp(m.opacity, blocking ? 0.16 : 1, 1 - Math.exp(-dt * 10));
      const solid = m.opacity > 0.98;
      if (m.transparent === solid) {
        m.transparent = !solid;
        m.depthWrite = solid;
        m.needsUpdate = true;
      }
    }
  }

  function updateCamera(dt) {
    if (cine) { cinematicCamera(dt); return; }
    const flat = Math.cos(look.pitch) * look.distance;
    let cx = player.position.x + Math.sin(look.yaw) * flat;
    let cz = player.position.z + Math.cos(look.yaw) * flat;
    // Keep the camera inside the room and under the ceiling.
    const r = Math.hypot(cx, cz);
    if (r > WALL_R - 1.2) {
      cx *= (WALL_R - 1.2) / r;
      cz *= (WALL_R - 1.2) / r;
    }
    camera.position.set(cx, Math.min(player.position.y + Math.sin(look.pitch) * look.distance, CEIL_H - 0.8), cz);
    // Aim a little ahead of the craft so it sits in the lower third and you can see where you're going.
    const target = player.position.clone().add(new THREE.Vector3(-Math.sin(look.yaw) * 4, 1.3, -Math.cos(look.yaw) * 4));
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 2.2);
    }
    camera.lookAt(target);
    fadeOccluders(dt);
    const boosting = boostHeld();
    camera.fov = THREE.MathUtils.lerp(camera.fov, boosting && state === 'play' ? 66 : 58, 1 - Math.exp(-dt * 4));
    camera.updateProjectionMatrix();
  }

  // Scripted camera moves. Caught: a slow orbit that closes in on the craft and its killer.
  // Clear: a full rising circle around the craft that lands back where the player was looking.
  function cinematicCamera(dt) {
    cine.t += dt;
    let focus;
    let angle;
    let dist;
    let height;
    let fov;
    if (cine.kind === 'caught') {
      const ease = 1 - Math.exp(-cine.t * 1.4);
      focus = player.position.clone().lerp(cine.killer, 0.4);
      focus.y = 1.4;
      angle = cine.yaw + 0.5 * ease + cine.t * 0.12;
      dist = THREE.MathUtils.lerp(look.distance, 6, ease);
      height = THREE.MathUtils.lerp(Math.sin(look.pitch) * look.distance, 1.6, ease);
      fov = 48;
    } else {
      const p = Math.min(1, cine.t / CLEAR_TIME);
      const sweep = p * p * (3 - 2 * p);
      const lift = Math.sin(Math.PI * p);
      focus = player.position.clone();
      focus.y += 1;
      angle = cine.yaw + sweep * Math.PI * 2;
      dist = look.distance + lift * 7;
      height = Math.sin(look.pitch) * look.distance + lift * 6;
      fov = 58 + lift * 10;
    }
    const flat = Math.sqrt(Math.max(1, dist * dist - height * height));
    let cx = focus.x + Math.sin(angle) * flat;
    let cz = focus.z + Math.cos(angle) * flat;
    const r = Math.hypot(cx, cz);
    if (r > WALL_R - 1.2) {
      cx *= (WALL_R - 1.2) / r;
      cz *= (WALL_R - 1.2) / r;
    }
    camera.position.set(cx, Math.min(focus.y + height, CEIL_H - 0.8), cz);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 2.2);
    }
    camera.lookAt(focus);
    fadeOccluders(dt);
    camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
  }

  function endCinematic() {
    cine = null;
    timeScale = 1;
    document.body.classList.remove('fx-caught', 'fx-clear', 'cinema');
    bannerEl.className = 'cine-banner';
  }

  // ---------- effects, hud, audio ----------

  function burst(at, color, count) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.08 + Math.random() * 0.16), material.clone());
      mesh.position.copy(at);
      const vel = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 6);
      vel.y = Math.abs(vel.y) + 1;
      scene.add(mesh);
      particles.push({ mesh, vel, life: 0.65 + Math.random() * 0.5 });
    }
  }

  // A flat ring racing across the floor plus a wireframe shell: the shockwave of a big moment.
  function shockwave(at, color, radius, duration) {
    const mat = () => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 72), mat());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, 0.1, at.z);
    const shellMat = mat();
    shellMat.wireframe = true;
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), shellMat);
    shell.position.copy(at);
    scene.add(ring, shell);
    shockwaves.push({ ring, shell, radius, duration, t: 0 });
  }

  function updateShockwaves(dt) {
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const w = shockwaves[i];
      w.t += dt / w.duration;
      const e = 1 - Math.pow(1 - Math.min(w.t, 1), 3);
      w.ring.scale.setScalar(0.3 + w.radius * e);
      w.ring.material.opacity = Math.max(0, 1 - w.t);
      w.shell.scale.setScalar(0.3 + w.radius * 0.45 * e);
      w.shell.rotation.y += dt * 1.5;
      w.shell.material.opacity = 0.55 * Math.max(0, 1 - w.t) ** 2;
      if (w.t >= 1) {
        [w.ring, w.shell].forEach((m) => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
        shockwaves.splice(i, 1);
      }
    }
  }

  // Big stamped title over the screen: shield (teal slam), caught (red glitch), clear (gold spread).
  function banner(kind, title, sub, duration) {
    bannerEl.className = 'cine-banner';
    bannerEl.innerHTML = `<small>${kind === 'clear' ? 'MISSION CONTROL' : kind === 'caught' ? 'SIGNAL LOST' : 'IMPACT'}</small><strong></strong><em></em>`;
    bannerEl.querySelector('strong').textContent = title;
    bannerEl.querySelector('em').textContent = sub;
    void bannerEl.offsetWidth;  // restart the CSS animation
    bannerEl.style.setProperty('--dur', `${duration}ms`);
    bannerEl.classList.add(kind, 'show');
    const token = (bannerEl.token = (bannerEl.token || 0) + 1);
    setTimeout(() => { if (bannerEl.token === token) bannerEl.className = 'cine-banner'; }, duration);
  }

  // Colour-grade the whole view (canvas filter) and, for caught / clear, bring in letterbox bars.
  function screenFx(kind, duration) {
    const cls = `fx-${kind}`;
    document.body.classList.remove(cls);
    void document.body.offsetWidth;
    document.body.classList.add(cls);
    if (kind === 'caught' || kind === 'clear') document.body.classList.add('cinema');
    if (duration) {
      setTimeout(() => {
        document.body.classList.remove(cls);
        if (kind === 'clear') document.body.classList.remove('cinema');
      }, duration);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.vel.y -= dt * 6;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }
  }

  function updateAmbience(dt, time) {
    for (const arm of mobileArms) arm.obj.rotation.y += dt * arm.speed;
    fireLight.intensity = 36 + Math.sin(time * 11) * 4 + Math.random() * 6;
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(5, '0');
    levelEl.textContent = String(level).padStart(2, '0');
    sparksEl.textContent = `${String(sparks).padStart(2, '0')}/${String(SPARKS_PER_LEVEL).padStart(2, '0')}`;
    drawCells(rewindsEl, 3, rewinds);
    drawCells(shieldsEl, 2, shields);
    shieldBadge.classList.toggle('hidden', shields === 0);
    shieldCount.textContent = `×${shields}`;
    document.body.classList.toggle('shielded', shields > 0);
    document.body.classList.toggle('no-rewinds', rewinds === 0);
  }

  function drawCells(el, max, amount) {
    el.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < amount ? 'active' : ''}"></i>`).join('');
  }

  function showMessage(text, duration = 1400) {
    messageEl.textContent = text;
    messageEl.classList.remove('hidden');
    messageTimer = duration / 1000;
  }

  function shieldFlash() {
    damageEl.classList.add('shield-hit');
    setTimeout(() => damageEl.classList.remove('shield-hit'), 320);
  }

  function damageFlash() {
    damageEl.classList.add('hit');
    setTimeout(() => damageEl.classList.remove('hit'), 320);
  }

  function unlockAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    if (audioCtx && !hum) {
      // Two detuned low sines beat against each other: an uneasy haunted-house drone.
      const gain = audioCtx.createGain();
      gain.gain.value = 0;
      gain.connect(audioCtx.destination);
      for (const [freq, type] of [[55, 'sine'], [58.3, 'sine'], [220, 'triangle']]) {
        const osc = audioCtx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        const g = audioCtx.createGain();
        g.gain.value = type === 'triangle' ? 0.15 : 1;
        osc.connect(g).connect(gain);
        osc.start();
      }
      hum = { gain: gain.gain };
    }
  }

  function tone(from, duration, type, volume, to = from) {
    if (muted) return;
    unlockAudio();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration + 0.02);
  }

  // ---------- main loop ----------

  const presentation = new window.VectorfallPresentation(renderer, scene, camera, arena, player, rng(1964));

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const idleTime = performance.now() * 0.001;

    if (state === 'play') {
      const sim = dt * timeScale;  // slow motion after a shield break
      timeScale = Math.min(1, timeScale + dt * 1.4);
      gameTime += sim;
      invulnerable = Math.max(0, invulnerable - sim);
      updatePlayer(sim);
      updateEchoes(sim);
      updateCollectibles(sim);
      saveSnapshot(sim);
      updateShieldFx(sim);
      updateHeartbeat(dt);
      updateNerveHud();
    } else if (state === 'caught' || (state === 'over' && cine)) {
      // The craft spins out and sinks, shedding sparks.
      player.rotation.z += dt * 2.4;
      player.rotation.y += dt * 0.9;
      player.position.y = THREE.MathUtils.lerp(player.position.y, 0.45, 1 - Math.exp(-dt * 1.6));
      if (Math.random() < dt * 14) burst(player.position, Math.random() < 0.5 ? 0xff6a3a : 0xffc861, 2);
      animateCraft(0, false);
    } else if (state === 'clear') {
      player.position.y = HOVER + Math.sin(idleTime * 2.2) * 0.12;
      animateCraft(0, false);
      updateShieldFx(dt);
      haunt(Infinity);
    } else if (state === 'title' || state === 'over') {
      player.position.y = HOVER + Math.sin(idleTime * 2.2) * 0.12;
      player.rotation.y += dt * 0.18;
      spark.getObjectByName('burst').rotation.y += dt * 0.5;
      animateCraft(0, false);
      haunt(Infinity);
    }

    updateAmbience(dt, idleTime);
    updateLook(dt);
    updateCamera(dt);
    updateParticles(dt);
    updateShockwaves(dt);
    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) messageEl.classList.add('hidden');
    }
    presentation.update(dt, idleTime, state, spark, echoes, velocity, look.yaw, liveNerve);
    presentation.render();
  }

  // ---------- input ----------

  addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys[event.code] = true;
    if (event.code === 'Space' && !event.repeat) rewind();
    if (event.code === 'KeyM' && !event.repeat) toggleMute();
  });
  addEventListener('keyup', (event) => { keys[event.code] = false; });

  // Trackpad / mouse look:
  //  - click the atrium to lock the cursor, then just move your finger (Esc frees it)
  //  - or click-and-drag without locking
  //  - pressing and holding the trackpad (or left mouse button) boosts, same as Shift
  //  - two-finger swipe also turns the camera; pinch zooms in and out
  const canvas = renderer.domElement;
  const isLocked = () => document.pointerLockElement === canvas;
  let dragging = false;

  function lockCursor() {
    if (isTouch || isLocked() || !canvas.requestPointerLock) return;
    try {
      const request = canvas.requestPointerLock();
      if (request && request.catch) request.catch(() => {});
    } catch { /* pointer lock unavailable; drag and arrow keys still work */ }
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (state !== 'play' && state !== 'caught') return;
    if (event.pointerType === 'touch') return;  // touches are handled by the touch controls
    dragging = true;
    if (event.button === 0) clickBoost = true;
    lockCursor();
    event.preventDefault();
  });
  const releasePointer = () => { dragging = false; clickBoost = false; };
  addEventListener('pointerup', releasePointer);
  addEventListener('pointercancel', releasePointer);
  addEventListener('pointermove', (event) => {
    if (state !== 'play' && state !== 'caught') return;
    if (isLocked() || dragging) turnView(event.movementX, event.movementY, LOOK.mouse);
  });
  addEventListener('wheel', (event) => {
    if (state !== 'play' && state !== 'caught') return;
    event.preventDefault();
    if (event.ctrlKey) {
      // Trackpad pinch arrives as a ctrl+wheel event.
      look.distance = THREE.MathUtils.clamp(look.distance + event.deltaY * 0.05, LOOK.minDistance, LOOK.maxDistance);
    } else {
      turnView(event.deltaX, event.deltaY, LOOK.wheel);
    }
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('look-locked', isLocked());
  });

  addEventListener('blur', () => {
    Object.keys(keys).forEach((key) => { keys[key] = false; });
    clickBoost = false;
    touchBoost = false;
    touchStick.x = touchStick.y = 0;
  });

  // Phone / tablet controls. PC controls above are untouched; none of this runs on a computer.
  //  - left side of the screen: a floating joystick appears under your thumb (analog flying)
  //  - right side: drag to look, pinch with two fingers to zoom
  //  - double-tap the right side and keep the finger down to boost (you can still look with it)
  //  - a ⟲ REWIND button appears only while you're caught
  // Running as a Home Screen app (already full screen), or can this browser go full screen itself (Android)?
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
  const canFullscreen = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);

  // Phones: go full screen and lock to landscape on BEGIN where the browser allows it (Android Chrome).
  // iPhone Safari can't do this for web pages; there the Home Screen app is full screen instead.
  function phoneFullscreen() {
    if (!isTouch || standalone || !canFullscreen || document.fullscreenElement) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => {});
  }

  function setupTouch() {
    document.body.classList.add('touch');
    document.body.classList.toggle('standalone', standalone);
    document.body.classList.toggle('can-fullscreen', canFullscreen);
    if (presentation.high) presentation.qualityBtn.click();  // phones start in LITE for a smooth frame rate
    const layer = document.getElementById('touch-layer');
    const stick = document.getElementById('stick');
    const knob = stick.querySelector('i');
    const boostRing = document.getElementById('boost-ring');
    const rewindBtn = document.getElementById('touch-rewind');
    const STICK_R = 52;
    const DEAD = 0.14;
    const looks = new Map();
    let stickId = null;
    let sx = 0;
    let sy = 0;
    let pinch = 0;
    let boostId = null;
    let lastTap = null;                // a quick tap on the right side; a second press soon after boosts
    const TAP_MS = 260;
    const DOUBLE_MS = 380;

    const stopBoost = () => {
      boostId = null;
      touchBoost = false;
      boostRing.classList.remove('on');
    };
    const moveRing = (x, y) => {
      boostRing.style.left = `${x}px`;
      boostRing.style.top = `${y}px`;
    };

    const restStick = () => {
      stickId = null;
      touchStick.x = touchStick.y = 0;
      stick.classList.remove('on');
      stick.style.left = stick.style.top = '';
      knob.style.transform = '';
    };

    layer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state !== 'play' && state !== 'caught') return;
      layer.setPointerCapture(e.pointerId);
      if (stickId === null && e.clientX < innerWidth * 0.45) {
        stickId = e.pointerId;
        sx = e.clientX;
        sy = e.clientY;
        stick.style.left = `${sx}px`;
        stick.style.top = `${sy}px`;
        stick.classList.add('on');
      } else {
        const now = performance.now();
        if (boostId === null && lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 90) {
          boostId = e.pointerId;
          touchBoost = true;
          moveRing(e.clientX, e.clientY);
          boostRing.classList.add('on');
        }
        lastTap = null;
        looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: now });
        pinch = 0;
      }
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - sx;
        let dy = e.clientY - sy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) {
          dx *= STICK_R / len;
          dy *= STICK_R / len;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const m = Math.min(1, len / STICK_R);
        const k = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD) / Math.max(m, 1e-6);
        touchStick.x = (dx / STICK_R) * k;
        touchStick.y = (dy / STICK_R) * k;
        return;
      }
      const prev = looks.get(e.pointerId);
      if (!prev) return;
      if (e.pointerId === boostId) moveRing(e.clientX, e.clientY);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (looks.size >= 2) {
        const [a, b] = [...looks.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) look.distance = THREE.MathUtils.clamp(look.distance + (pinch - d) * 0.05, LOOK.minDistance, LOOK.maxDistance);
        pinch = d;
      } else if (state === 'play' || state === 'caught') {
        turnView(dx, dy, LOOK.touch);
      }
    });
    const release = (e) => {
      if (e.pointerId === stickId) restStick();
      if (e.pointerId === boostId) stopBoost();
      const p = looks.get(e.pointerId);
      if (p && e.type === 'pointerup' && performance.now() - p.t < TAP_MS && Math.hypot(p.x - p.sx, p.y - p.sy) < 14) {
        lastTap = { t: performance.now(), x: p.x, y: p.y };
      }
      looks.delete(e.pointerId);
      pinch = 0;
    };
    layer.addEventListener('pointerup', release);
    layer.addEventListener('pointercancel', release);

    rewindBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rewind();
    });
    addEventListener('blur', () => { restStick(); stopBoost(); });
  }
  if (isTouch) setupTouch();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, presentation.high ? 1.75 : 1));
    renderer.setSize(innerWidth, innerHeight);
    presentation.resize();
  });

  startBtn.addEventListener('click', () => {
    phoneFullscreen();
    startGame();
  });
  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { showMessage('FULLSCREEN UNAVAILABLE', 1200); }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.childNodes[0].nodeValue = document.fullscreenElement ? 'EXIT ' : 'FULLSCREEN ';
  });
  function toggleMute() {
    muted = !muted;
    muteBtn.querySelector('b').textContent = muted ? 'OFF' : 'ON';
    if (hum && audioCtx) hum.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  }
  muteBtn.addEventListener('click', toggleMute);

  updateHud();
  // Useful for kiosk launches and automated visual checks.
  if (new URLSearchParams(location.search).has('autostart')) setTimeout(startGame, 120);
  animate();
})();
