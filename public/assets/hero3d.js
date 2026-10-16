// CiteSeen hero: "citation architecture" — a website panel, structured-data layers, and a cobalt
// evidence path that ends at a source card. Three.js r128 (UMD from cdnjs). Static SVG fallback stays
// visible until WebGL draws; reduced motion renders a single still frame; pauses when offscreen.
(function () {
  const host = document.getElementById("hero3d");
  if (!host || !window.THREE) return;
  const THREE = window.THREE;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    return; // keep fallback
  }
  const W = () => host.clientWidth, H = () => host.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.className = "hero3d-canvas";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(27, W() / H(), 0.1, 100);
  camera.position.set(5.2, 2.9, 7.6);
  const target = new THREE.Vector3(0.55, 0.35, 0);
  camera.lookAt(target);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4c8, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdbe4ff, 0.35);
  rim.position.set(-6, 3, -4);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.6;
  ground.receiveShadow = true;
  scene.add(ground);

  const COBALT = 0x315ceb, TEAL = 0x267c70, INK = 0x202a33, PORCELAIN = 0xfbfaf6, LINE = 0xd9d8d1;
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.02 }, o));

  function roundedSlab(w, h, d, r, material) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 10 });
    g.translate(0, 0, -d / 2);
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  const bar = (w, h, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat(color, { roughness: 0.7 }));
    m.position.set(x, y, z);
    return m;
  };

  // 1. Website document
  const site = new THREE.Group();
  site.add(roundedSlab(2.6, 3.3, 0.08, 0.14, mat(PORCELAIN, { roughness: 0.42 })));
  const fz = 0.07;
  site.add(bar(2.24, 0.24, 0xeef0ec, 0, 1.38, fz));
  [0xd95f5f, 0xe2b44b, 0x5aa36b].forEach((c, i) => site.add(bar(0.07, 0.07, c, -1.0 + i * 0.12, 1.38, fz + 0.005)));
  site.add(bar(1.55, 0.16, INK, -0.32, 0.98, fz));
  site.add(bar(1.1, 0.16, INK, -0.55, 0.74, fz));
  for (let i = 0; i < 5; i++) site.add(bar(i === 4 ? 1.3 : 2.0, 0.055, LINE, i === 4 ? -0.35 : 0, 0.4 - i * 0.16, fz));
  site.add(bar(0.95, 0.5, 0xeaf0ff, -0.52, -0.75, fz));
  site.add(bar(0.6, 0.05, COBALT, -0.66, -0.62, fz + 0.006));
  site.add(bar(0.4, 0.05, 0x9db2f5, -0.76, -0.76, fz + 0.006));
  site.add(bar(0.95, 0.5, 0xf0f0ec, 0.55, -0.75, fz));
  site.position.set(-1.9, 0.15, 0);
  site.rotation.y = 0.28;
  scene.add(site);

  // 2. Structured-data layers (frosted acrylic sheets)
  const layers = [];
  const layerColors = [0xeaf0ff, 0xe5f3ef, 0xf2f2ee];
  for (let i = 0; i < 3; i++) {
    const L = roundedSlab(1.9, 2.4, 0.03, 0.12, mat(layerColors[i], { transparent: true, opacity: 0.8, roughness: 0.25 }));
    L.add(bar(0.9 - i * 0.18, 0.05, i === 1 ? TEAL : COBALT, -0.32, 0.85, 0.03));
    for (let k = 0; k < 3; k++) L.add(bar(1.3, 0.04, 0xc9d3ec, 0, 0.5 - k * 0.22 - i * 0.05, 0.03));
    L.position.set(0.55 + i * 0.62, 0.15 + i * 0.05, -0.55 - i * 0.18);
    L.rotation.y = 0.28;
    layers.push(L);
    scene.add(L);
  }

  // 4. Source / citation card
  const card = new THREE.Group();
  card.add(roundedSlab(1.45, 0.95, 0.07, 0.1, mat(0xffffff, { roughness: 0.4 })));
  card.add(bar(0.18, 0.18, COBALT, -0.48, 0.18, 0.06));
  card.add(bar(0.7, 0.07, INK, 0.05, 0.22, 0.06));
  card.add(bar(0.95, 0.045, LINE, 0.0, 0.0, 0.06));
  card.add(bar(0.7, 0.045, LINE, -0.12, -0.13, 0.06));
  card.add(bar(0.36, 0.09, TEAL, -0.36, -0.3, 0.06));
  card.position.set(3.15, 1.25, 0.45);
  card.rotation.y = -0.18;
  scene.add(card);

  // 3. Evidence path through the layers to the source card
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.1, -0.6, 0.25),
    new THREE.Vector3(0.3, -0.35, -0.2),
    new THREE.Vector3(1.4, 0.15, -0.5),
    new THREE.Vector3(2.2, 0.75, -0.2),
    new THREE.Vector3(2.6, 1.15, 0.35),
  ]);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.04, 12, false), mat(COBALT, { roughness: 0.3, metalness: 0.15 }));
  tube.castShadow = true;
  scene.add(tube);
  const nodeMat = mat(COBALT, { roughness: 0.25, metalness: 0.2 });
  [0, 0.5, 1].forEach((t) => {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 20), nodeMat);
    n.position.copy(curve.getPoint(t));
    scene.add(n);
  });
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: 0x8fa9ff }));
  scene.add(pulse);

  let px = 0, py = 0;
  host.addEventListener("pointermove", (e) => {
    const r = host.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
  });
  host.addEventListener("pointerleave", () => { px = 0; py = 0; });

  const steps = Array.from(document.querySelectorAll("[data-rq-step]"));
  let visible = true, raf = 0;
  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    const drift = reduce ? 0 : Math.sin(t * 0.18) * 0.35;
    camera.position.x += (5.2 + drift + px * 0.5 - camera.position.x) * (reduce ? 1 : 0.04);
    camera.position.y += (2.9 - py * 0.3 - camera.position.y) * (reduce ? 1 : 0.04);
    camera.lookAt(target);
    if (!reduce) {
      layers.forEach((L, i) => { L.position.y = 0.15 + i * 0.05 + Math.sin(t * 0.6 + i) * 0.03; });
      card.position.y = 1.25 + Math.sin(t * 0.5) * 0.04;
      const p = (t * 0.12) % 1;
      pulse.position.copy(curve.getPoint(p));
      const phase = p < 0.34 ? 0 : p < 0.67 ? 1 : 2; // Reach → Understand → Quote
      steps.forEach((s, i) => s.classList.toggle("on", i === phase));
    } else {
      pulse.position.copy(curve.getPoint(1));
    }
    renderer.render(scene, camera);
    if (!reduce && visible) raf = requestAnimationFrame(frame);
  }

  host.appendChild(renderer.domElement);
  frame();
  host.classList.add("ready");
  if (!reduce) {
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    }).observe(host);
  }
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      renderer.setSize(W(), H());
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      if (reduce) frame();
    }, 120);
  });
})();
