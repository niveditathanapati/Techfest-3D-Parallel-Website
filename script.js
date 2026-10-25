
(() => {
  "use strict";

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  const state = {
    targetY: window.scrollY,
    currentY: window.scrollY,
    pointerX: 0,
    pointerY: 0,
    smoothX: 0,
    smoothY: 0,
    progress: 0,
    wheelControlled: false,
    portalOpen: false,
    ambient: false,
    lastFrame: 0
  };

  const loader = $("#loader");
  const loaderBar = $("#loaderBar");
  const railFill = $("#railFill");
  const sceneCurrent = $("#sceneCurrent");
  const scrollHint = $("#scrollHint");
  const cursorGlow = $("#cursorGlow");
  const toast = $("#toast");

  let wheelTimer;
  let toastTimer;
  let rafId = 0;
  let world = null;

  /* -------------------------------------------------------
     LOADER
  ------------------------------------------------------- */

  let loading = 0;

  const loadingTimer = setInterval(() => {
    loading = Math.min(92, loading + 9 + Math.random() * 12);
    if (loaderBar) loaderBar.style.width = `${loading}%`;
  }, 120);

  function finishLoader() {
    clearInterval(loadingTimer);
    if (loaderBar) loaderBar.style.width = "100%";

    setTimeout(() => loader?.classList.add("is-hidden"), 220);
  }

  if (document.readyState === "complete") {
    finishLoader();
  } else {
    window.addEventListener("load", finishLoader, { once: true });
    setTimeout(finishLoader, 3000);
  }

  /* -------------------------------------------------------
     HEAVY SCROLL CONTROLLER
     
     Native mouse-wheel movement is scaled down. A large
     wheel gesture therefore advances the page gradually.
     The browser's normal scrollbar and touch scrolling
     remain available.
  ------------------------------------------------------- */

  const WHEEL_SCALE = 0.34;
  const MAX_WHEEL_STEP = 100;
  const SCROLL_EASE = 0.085;

  function maxScroll() {
    return Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    );
  }

  function beginControlledScroll() {
    state.wheelControlled = true;
    clearTimeout(wheelTimer);

    wheelTimer = setTimeout(() => {
      if (Math.abs(state.targetY - window.scrollY) < 2) {
        state.wheelControlled = false;
        state.targetY = window.scrollY;
      }
    }, 450);
  }

  window.addEventListener("wheel", event => {
    // Do not intercept browser zoom or modified wheel gestures.
    if (event.ctrlKey || event.metaKey || reducedMotion.matches) return;
    if ($("body").classList.contains("modal-open")) return;

    // Ignore horizontal-only gestures.
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

    event.preventDefault();

    let delta = event.deltaY;

    if (event.deltaMode === 1) delta *= 16;
    if (event.deltaMode === 2) delta *= window.innerHeight;

    delta = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, delta));

    beginControlledScroll();

    state.targetY = Math.max(
      0,
      Math.min(maxScroll(), state.targetY + delta * WHEEL_SCALE)
    );

    clearTimeout(wheelTimer);

    wheelTimer = setTimeout(() => {
      if (Math.abs(state.targetY - window.scrollY) < 3) {
        state.wheelControlled = false;
        state.targetY = window.scrollY;
      }
    }, 550);
  }, { passive: false });

  // Keep wheel gestures from causing an unexpected jump when
  // the user navigates with links, keyboard, or the scrollbar.
  window.addEventListener("scroll", () => {
    if (!state.wheelControlled) {
      state.targetY = window.scrollY;
      state.currentY = window.scrollY;
    }
  }, { passive: true });

  // Route in-page links through the same smooth scroll controller.
  $$('a[href^="#"]').forEach(link => {
    link.addEventListener("click", event => {
      const href = link.getAttribute("href");
      const target = href && $(href);

      if (!target) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

      event.preventDefault();

      closeMenu();

      const destination =
        target.getBoundingClientRect().top + window.scrollY;

      state.targetY = Math.max(0, Math.min(maxScroll(), destination));

      if (reducedMotion.matches) {
        state.currentY = state.targetY;
        state.wheelControlled = false;
        window.scrollTo(0, state.targetY);
      } else {
        beginControlledScroll();
      }

      history.replaceState(null, "", href);
    });
  });

  /* -------------------------------------------------------
     TOAST
  ------------------------------------------------------- */

  function showToast(message) {
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("is-visible");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  /* -------------------------------------------------------
     SECTION TRACKING
  ------------------------------------------------------- */

  const scenes = $$(".scene");
  const navLinks = $$(".main-nav a");

  const sceneObserver = new IntersectionObserver(entries => {
    const active = entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

    if (!active) return;

    const id = active.target.dataset.scene || "01";

    if (sceneCurrent) sceneCurrent.textContent = id;

    navLinks.forEach(link => {
      const selected = link.getAttribute("href") === `#${active.target.id}`;

      link.classList.toggle("active", selected);

      if (selected) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }, {
    threshold: [0.15, 0.35, 0.55],
    rootMargin: "-10% 0px -10% 0px"
  });

  scenes.forEach(scene => sceneObserver.observe(scene));

  /* -------------------------------------------------------
     REVEAL ANIMATIONS
  ------------------------------------------------------- */

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -35px 0px"
  });

  $$(".reveal").forEach((element, index) => {
    if (!reducedMotion.matches) {
      element.style.transitionDelay = `${(index % 4) * 70}ms`;
    } else {
      element.classList.add("is-visible");
    }

    revealObserver.observe(element);
  });

  /* -------------------------------------------------------
     HEAVY MULTI-LAYER PARALLAX
     
     depth = -0.7 : moves against the normal parallax direction
     depth =  0.0 : stationary relative to the scene
     depth =  0.5 : moderate foreground movement
     depth =  1.0 : strong foreground movement
     depth =  1.4 : extreme foreground movement
  ------------------------------------------------------- */

  const depthElements = $$(".depth[data-depth]");
  const sceneMetrics = new Map();

  function cacheSceneMetrics() {
    sceneMetrics.clear();

    scenes.forEach(scene => {
      sceneMetrics.set(scene, {
        top: scene.offsetTop,
        height: scene.offsetHeight
      });
    });
  }

  cacheSceneMetrics();

  window.addEventListener("resize", cacheSceneMetrics, { passive: true });

  function updateDepth() {
    const vh = window.innerHeight;

    depthElements.forEach(element => {
      const scene = element.closest(".scene");
      if (!scene) return;

      const metrics = sceneMetrics.get(scene);
      if (!metrics) return;

      const depth = Number(element.dataset.depth) || 0;

      // Normalized scene progress: 0 at entry, 1 at exit.
      const progress = Math.max(
        0,
        Math.min(
          1,
          (state.currentY + vh - metrics.top) / (vh + metrics.height)
        )
      );

      // Centered travel creates a noticeable sweep through each scene.
      const centered = progress - 0.5;

      // Different depth multipliers produce genuinely different
      // trajectories, including reversed movement.
      const travel = vh * 0.9;
      const scrollY = -centered * travel * depth;

      // Pointer movement introduces independent X/Y displacement.
      const pointerFactor = element.classList.contains("planet")
        ? 32
        : 20;

      const pointerX = state.smoothX * depth * pointerFactor;
      const pointerY = state.smoothY * depth * pointerFactor * 0.65;

      // Perspective rotation makes nearby objects feel dimensional.
      const rotateX = -state.smoothY * depth * 4.5;
      const rotateY = state.smoothX * depth * 6;

      // Individual CSS transform properties preserve the element's
      // existing CSS transform, including rotation and scale.
      element.style.translate =
        `${pointerX.toFixed(2)}px ${(scrollY + pointerY).toFixed(2)}px`;

      if (!reducedMotion.matches && Math.abs(depth) > 0.35) {
        element.style.rotate =
          `${rotateX.toFixed(2)}deg ${rotateY.toFixed(2)}deg ${(-centered * depth * 5).toFixed(2)}deg`;
      }
    });
  }

  /* -------------------------------------------------------
     POINTER MOVEMENT & CURSOR LIGHT
  ------------------------------------------------------- */

  if (!coarsePointer.matches) {
    window.addEventListener("pointermove", event => {
      state.pointerX = (event.clientX / window.innerWidth - 0.5) * 2;
      state.pointerY = (event.clientY / window.innerHeight - 0.5) * 2;

      if (cursorGlow) {
        cursorGlow.style.left = `${event.clientX}px`;
        cursorGlow.style.top = `${event.clientY}px`;
      }
    }, { passive: true });

    $$(".magnetic").forEach(element => {
      element.addEventListener("pointermove", event => {
        const rect = element.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;

        element.style.translate =
          `${(x * 0.1).toFixed(1)}px ${(y * 0.1).toFixed(1)}px`;
      });

      element.addEventListener("pointerleave", () => {
        element.style.translate = "";
      });
    });
  }

  /* -------------------------------------------------------
     MOBILE NAV
  ------------------------------------------------------- */

  const menuToggle = $("#menuToggle");
  const mainNav = $("#mainNav");

  function closeMenu() {
    menuToggle?.setAttribute("aria-expanded", "false");
    mainNav?.classList.remove("is-open");
  }

  menuToggle?.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") !== "true";

    menuToggle.setAttribute("aria-expanded", String(open));
    mainNav?.classList.toggle("is-open", open);
  });

  navLinks.forEach(link => link.addEventListener("click", closeMenu));

  /* -------------------------------------------------------
     SANCTUARY RELIC
  ------------------------------------------------------- */

  const relic = $("#relic");
  const relicButton = $("#revealSanctuary");

  relicButton?.addEventListener("click", () => {
    const active = relic?.classList.toggle("is-revealed");

    relicButton.innerHTML = active
      ? "Hide the relic <span>✧</span>"
      : "Reveal the relic <span>✧</span>";

    showToast(active
      ? "The First Memory has awakened."
      : "The relic returns to its slumber.");
  });

  /* -------------------------------------------------------
     CONSTELLATION EXPLORER
  ------------------------------------------------------- */

  const starDescriptions = {
    "The Voyager": {
      number: "001",
      description:
        "A solitary light that follows no mapped route. Its legend belongs to those who dare to leave the familiar behind."
    },
    "The Dreamer": {
      number: "002",
      description:
        "A constellation said to appear when imagination becomes stronger than the limits of the known world."
    },
    "The Eternal": {
      number: "003",
      description:
        "An ancient celestial pattern. It represents the quiet truth that every ending contains the seed of another beginning."
    }
  };

  const starDetail = $("#starDetail");
  const starModal = $("#starModal");
  const modalTitle = $("#modalTitle");
  const modalDescription = $("#modalDescription");
  const closeModalButton = $("#closeModal");

  let lastFocusedElement = null;

  function openModal(name) {
    const data = starDescriptions[name];
    if (!data || !starModal) return;

    lastFocusedElement = document.activeElement;

    modalTitle.textContent = name;
    modalDescription.textContent = data.description;

    starModal.hidden = false;
    document.body.classList.add("modal-open");
    closeModalButton?.focus();
  }

  function closeModal() {
    if (!starModal || starModal.hidden) return;

    starModal.hidden = true;
    document.body.classList.remove("modal-open");

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  closeModalButton?.addEventListener("click", closeModal);

  starModal?.addEventListener("click", event => {
    if (event.target === starModal) closeModal();
  });

  $$("[data-star]").forEach(button => {
    button.addEventListener("click", () => {
      const name = button.dataset.star;
      const data = starDescriptions[name];

      if (!data) return;

      starDetail.innerHTML = `
        <span>CONSTELLATION / ${data.number}</span>
        <strong></strong>
        <p></p>
      `;

      $("strong", starDetail).textContent = name;
      $("p", starDetail).textContent = data.description;

      $$("[data-star]").forEach(node => {
        node.setAttribute("aria-pressed", String(node === button));
      });

      openModal(name);
    });
  });

  /* -------------------------------------------------------
     GATEWAY SEQUENCE
  ------------------------------------------------------- */

  const openGate = $("#openGate");
  const portalWrap = $("#portalWrap");

  openGate?.addEventListener("click", () => {
    state.portalOpen = !state.portalOpen;
    portalWrap?.classList.toggle("gate-open", state.portalOpen);

    openGate.innerHTML = state.portalOpen
      ? "Gateway activated <span>✧</span>"
      : "Open the gateway <span>↗</span>";

    if (state.portalOpen) {
      showToast("Gateway established. Proceed to the destination.");

      setTimeout(() => {
        const target = $("#destination");
        if (!target) return;

        state.targetY = Math.max(
          0,
          Math.min(maxScroll(), target.offsetTop)
        );

        beginControlledScroll();
      }, reducedMotion.matches ? 0 : 500);
    } else {
      showToast("Gateway sequence reset.");
    }
  });

  /* -------------------------------------------------------
     RESTART JOURNEY
  ------------------------------------------------------- */

  $("#restartJourney")?.addEventListener("click", () => {
    state.targetY = 0;
    state.currentY = window.scrollY;

    beginControlledScroll();
    showToast("Expedition restarting...");
  });

  /* -------------------------------------------------------
     AMBIENT VISUAL MODE
  ------------------------------------------------------- */

  const soundToggle = $("#soundToggle");
  const soundLabel = $("#soundLabel");

  soundToggle?.addEventListener("click", () => {
    state.ambient = !state.ambient;

    soundToggle.setAttribute("aria-pressed", String(state.ambient));
    document.body.classList.toggle("ambient-active", state.ambient);

    if (soundLabel) {
      soundLabel.textContent = state.ambient
        ? "AMBIENCE ON"
        : "AMBIENT MODE";
    }

    if (world) {
      world.ambientMultiplier = state.ambient ? 1.8 : 1;
    }

    showToast(state.ambient
      ? "Atmospheric visual intensity increased."
      : "Atmospheric visual intensity restored.");
  });

  /* -------------------------------------------------------
     THREE.JS 3D UNIVERSE
     Procedural stars, floating geometry and moving camera.
  ------------------------------------------------------- */

  function initThree() {
    const canvas = $("#worldCanvas");

    if (!canvas || !window.THREE) {
      if (canvas) canvas.style.display = "none";
      return;
    }

    const THREE = window.THREE;

    try {
      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0b1428, 0.012);

      const camera = new THREE.PerspectiveCamera(
        58,
        window.innerWidth / window.innerHeight,
        0.1,
        300
      );

      camera.position.set(0, 0, 24);

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: window.devicePixelRatio < 2,
        powerPreference: "low-power"
      });

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x000000, 0);

      const universe = new THREE.Group();
      scene.add(universe);

      // Star field
      const count = window.innerWidth < 700 ? 850 : 1600;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const j = i * 3;

        positions[j] = (Math.random() - 0.5) * 110;
        positions[j + 1] = (Math.random() - 0.5) * 85;
        positions[j + 2] = (Math.random() - 0.5) * 80;

        const gold = Math.random() > 0.76;

        colors[j] = gold ? 0.95 : 0.7;
        colors[j + 1] = gold ? 0.78 : 0.82;
        colors[j + 2] = gold ? 0.52 : 1;
      }

      const starGeometry = new THREE.BufferGeometry();

      starGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );

      starGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3)
      );

      const stars = new THREE.Points(
        starGeometry,
        new THREE.PointsMaterial({
          size: 0.12,
          vertexColors: true,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
      );

      universe.add(stars);

      // Wireframe celestial objects
      const objects = new THREE.Group();
      universe.add(objects);

      const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xd5b781,
        metalness: 0.75,
        roughness: 0.3,
        transparent: true,
        opacity: 0.65,
        wireframe: true
      });

      const iceMaterial = new THREE.MeshStandardMaterial({
        color: 0x8db9e6,
        metalness: 0.6,
        roughness: 0.3,
        transparent: true,
        opacity: 0.45,
        wireframe: true
      });

      const geometries = [
        new THREE.IcosahedronGeometry(2.5, 1),
        new THREE.TorusGeometry(3.2, 0.025, 8, 100),
        new THREE.OctahedronGeometry(2, 1),
        new THREE.TorusKnotGeometry(1.5, 0.035, 100, 8, 2, 3),
        new THREE.IcosahedronGeometry(1.5, 0),
        new THREE.TorusGeometry(1.8, 0.03, 8, 90)
      ];

      const meshes = [];

      geometries.forEach((geometry, i) => {
        const mesh = new THREE.Mesh(
          geometry,
          i % 2 === 0 ? goldMaterial : iceMaterial
        );

        mesh.position.set(
          (Math.random() - 0.5) * 36,
          (Math.random() - 0.5) * 26,
          -6 - Math.random() * 28
        );

        mesh.rotation.set(
          Math.random() * 3,
          Math.random() * 3,
          Math.random() * 3
        );

        mesh.scale.setScalar(0.7 + Math.random() * 0.7);

        mesh.userData = {
          baseX: mesh.position.x,
          baseY: mesh.position.y,
          speedX: (Math.random() - 0.5) * 0.45,
          speedY: (Math.random() - 0.5) * 0.55,
          phase: Math.random() * Math.PI * 2
        };

        objects.add(mesh);
        meshes.push(mesh);
      });

      scene.add(new THREE.AmbientLight(0x9ebde9, 1.3));

      const goldLight = new THREE.PointLight(0xdac49a, 2.5, 100);
      goldLight.position.set(6, 8, 12);
      scene.add(goldLight);

      const blueLight = new THREE.PointLight(0x709edb, 2, 90);
      blueLight.position.set(-12, -5, 8);
      scene.add(blueLight);

      world = {
        scene,
        camera,
        renderer,
        stars,
        objects,
        meshes,
        start: performance.now(),
        ambientMultiplier: 1
      };

      function resize() {
        if (!world) return;

        camera.aspect = window.innerWidth / window.innerHeight;
        camera.fov = window.innerWidth < 700 ? 65 : 58;
        camera.updateProjectionMatrix();

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight);
      }

      window.addEventListener("resize", resize, { passive: true });

    } catch (error) {
      console.warn("AETHER 3D fallback:", error.message);
      canvas.style.display = "none";
      world = null;
    }
  }

  initThree();

  /* -------------------------------------------------------
     MAIN ANIMATION LOOP
  ------------------------------------------------------- */

  function animate(now) {
    rafId = requestAnimationFrame(animate);

    const dt = state.lastFrame
      ? Math.min(0.04, (now - state.lastFrame) / 1000)
      : 0;

    state.lastFrame = now;

    // Cinematic easing: the document catches up to the target
    // rather than following every wheel tick immediately.
    if (state.wheelControlled && !reducedMotion.matches) {
      const difference = state.targetY - window.scrollY;

      if (Math.abs(difference) > 0.6) {
        window.scrollTo(0, window.scrollY + difference * SCROLL_EASE);
      } else {
        window.scrollTo(0, state.targetY);
      }
    }

    state.currentY = window.scrollY;

    state.smoothX += (state.pointerX - state.smoothX) * 0.065;
    state.smoothY += (state.pointerY - state.smoothY) * 0.065;

    const maxY = maxScroll();

    state.progress = maxY > 0
      ? Math.max(0, Math.min(1, state.currentY / maxY))
      : 0;

    if (railFill) {
      railFill.style.height = `${state.progress * 100}%`;
    }

    updateDepth();

    if (scrollHint) {
      scrollHint.style.opacity = state.progress > 0.04 ? "0" : "1";
      scrollHint.style.pointerEvents = state.progress > 0.04 ? "none" : "auto";
    }

    if (world) {
      const time = (now - world.start) * 0.001;
      const multiplier = world.ambientMultiplier;

      world.stars.rotation.y += dt * 0.012 * multiplier;
      world.stars.rotation.x = Math.sin(time * 0.1) * 0.04;

      world.objects.rotation.y =
        state.smoothX * 0.22 + Math.sin(time * 0.12) * 0.04;

      world.objects.rotation.x =
        state.smoothY * 0.14 + Math.cos(time * 0.13) * 0.03;

      world.meshes.forEach(mesh => {
        const data = mesh.userData;

        if (!reducedMotion.matches) {
          mesh.rotation.x += data.speedX * dt * multiplier;
          mesh.rotation.y += data.speedY * dt * multiplier;

          mesh.position.y =
            data.baseY + Math.sin(time * 0.45 + data.phase) * 0.8;

          mesh.position.x =
            data.baseX + Math.sin(time * 0.25 + data.phase) * 0.45;
        }
      });

      // The camera shifts substantially with the cursor, creating
      // a different perspective from the CSS landscape layers.
      world.camera.position.x = state.smoothX * 2.3;
      world.camera.position.y = -state.smoothY * 1.6;
      world.camera.position.z = 24 - state.progress * 3;

      world.camera.lookAt(0, 0, 0);
      world.renderer.render(world.scene, world.camera);
    }
  }

  if (reducedMotion.matches) {
    state.currentY = window.scrollY;
    state.targetY = window.scrollY;

    window.addEventListener("scroll", () => {
      state.currentY = window.scrollY;
      state.targetY = window.scrollY;

      if (world) {
        world.renderer.render(world.scene, world.camera);
      }
    }, { passive: true });
  } else {
    rafId = requestAnimationFrame(animate);
  }

  /* -------------------------------------------------------
     KEYBOARD & LIFECYCLE
  ------------------------------------------------------- */

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMenu();
      closeModal();
    }
  });

  window.addEventListener("pageshow", () => {
    cacheSceneMetrics();

    state.currentY = window.scrollY;
    state.targetY = window.scrollY;
  });

  window.addEventListener("pagehide", () => {
    if (rafId) cancelAnimationFrame(rafId);
  });

})();
