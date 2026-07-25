"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DObject,
  CSS2DRenderer,
} from "three/addons/renderers/CSS2DRenderer.js";
import { DOMAIN_CENTERS, DOMAIN_COLORS } from "@/lib/concepts";
import type { ConceptEdge, ConceptNode } from "@/lib/types";

interface SkillUniverseProps {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
  selectedId: string;
  onSelect: (id: string) => void;
}

function seededRandomFactory(seed = 417) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,0.98)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.38, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function SkillUniverse({
  nodes,
  edges,
  selectedId,
  onSelect,
}: SkillUniverseProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = Math.max(mount.clientWidth, 320);
    const height = Math.max(mount.clientHeight, 420);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 200);
    camera.position.set(2.5, 4.8, 22);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "universe-canvas";
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three-dimensional map of learned and connected concepts",
    );
    renderer.domElement.setAttribute("role", "img");
    mount.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(width, height);
    labelRenderer.domElement.className = "universe-label-layer";
    mount.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = true;
    controls.minDistance = 6;
    controls.maxDistance = 38;
    controls.autoRotate =
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotateSpeed = 0.18;

    const selectedNode = nodes.find((node) => node.id === selectedId);
    if (selectedNode) {
      const selectedPosition = new THREE.Vector3(...selectedNode.position);
      controls.target.copy(selectedPosition);
      camera.position.copy(
        selectedPosition.clone().add(new THREE.Vector3(5.5, 4.2, 16)),
      );
    }

    const random = seededRandomFactory();
    const backgroundGeometry = new THREE.BufferGeometry();
    const backgroundPositions: number[] = [];
    const backgroundColors: number[] = [];

    for (let index = 0; index < 760; index += 1) {
      const radius = 18 + random() * 45;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      backgroundPositions.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );
      const brightness = 0.42 + random() * 0.42;
      backgroundColors.push(
        brightness * 0.78,
        brightness * 0.84,
        brightness,
      );
    }

    backgroundGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(backgroundPositions, 3),
    );
    backgroundGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(backgroundColors, 3),
    );
    const backgroundStars = new THREE.Points(
      backgroundGeometry,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    scene.add(backgroundStars);

    const activeDomains = Array.from(new Set(nodes.map((node) => node.domain)));
    activeDomains.forEach((domain, domainIndex) => {
      const center = DOMAIN_CENTERS[domain] ?? DOMAIN_CENTERS.General;
      const nebulaPositions: number[] = [];
      const domainRandom = seededRandomFactory(700 + domainIndex * 911);

      for (let index = 0; index < 95; index += 1) {
        const radius = Math.pow(domainRandom(), 0.65) * 4.4;
        const angle = domainRandom() * Math.PI * 2;
        nebulaPositions.push(
          center[0] + Math.cos(angle) * radius,
          center[1] + (domainRandom() - 0.5) * 2.6,
          center[2] + Math.sin(angle) * radius * 0.62,
        );
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(nebulaPositions, 3),
      );
      const material = new THREE.PointsMaterial({
        color: new THREE.Color(
          DOMAIN_COLORS[domain] ?? DOMAIN_COLORS.General,
        ),
        size: 0.075,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      scene.add(new THREE.Points(geometry, material));
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x74809b,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const activeEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xe7edf9,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });

    edges.forEach((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...from.position),
        new THREE.Vector3(...to.position),
      ]);
      const isActive = edge.from === selectedId || edge.to === selectedId;
      scene.add(
        new THREE.Line(
          geometry,
          isActive ? activeEdgeMaterial : edgeMaterial,
        ),
      );
    });

    const glowTexture = makeGlowTexture();
    const clickableMeshes: THREE.Mesh[] = [];
    const animated: Array<{
      group: THREE.Group;
      glow: THREE.Sprite | null;
      phase: number;
      status: ConceptNode["status"];
      baseScale: number;
      baseGlowOpacity: number;
    }> = [];

    nodes.forEach((node, index) => {
      const color = new THREE.Color(
        DOMAIN_COLORS[node.domain] ?? DOMAIN_COLORS.General,
      );
      const group = new THREE.Group();
      group.position.set(...node.position);
      group.userData.id = node.id;

      const isSelected = node.id === selectedId;
      const baseRadius =
        node.status === "mastered"
          ? 0.22
          : node.status === "learning"
            ? 0.29
            : node.status === "suggested"
              ? 0.19
              : 0.115;

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(baseRadius, 20, 20),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: node.status === "locked" ? 0.36 : 0.98,
        }),
      );
      sphere.userData.id = node.id;
      group.add(sphere);
      clickableMeshes.push(sphere);

      let glow: THREE.Sprite | null = null;
      const baseGlowOpacity =
        node.status === "learning"
          ? 0.72
          : node.status === "mastered"
            ? 0.46
            : node.status === "suggested"
              ? 0.32
              : 0.1;
      if (glowTexture) {
        glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTexture,
            color,
            transparent: true,
            opacity: baseGlowOpacity,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const glowScale =
          node.status === "learning"
            ? 2.6
            : node.status === "mastered"
              ? 1.75
              : 1.25;
        glow.scale.set(glowScale, glowScale, 1);
        group.add(glow);
      }

      if (node.status === "mastered" || node.status === "learning") {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(
            baseRadius * (isSelected ? 2.15 : 1.7),
            0.018,
            8,
            48,
          ),
          new THREE.MeshBasicMaterial({
            color: isSelected ? 0xffffff : color,
            transparent: true,
            opacity: isSelected ? 0.92 : 0.48,
          }),
        );
        ring.rotation.x = Math.PI * 0.44;
        ring.rotation.y = Math.PI * 0.18;
        group.add(ring);
      }

      const label = document.createElement("div");
      label.className = `star-label star-label--${node.status}${
        isSelected ? " star-label--selected" : ""
      }`;
      const title = document.createElement("span");
      title.textContent = node.label;
      label.appendChild(title);
      if (node.status === "learning" || isSelected) {
        const detail = document.createElement("small");
        detail.textContent =
          node.status === "learning" ? `${node.mastery}% learning` : node.domain;
        label.appendChild(detail);
      }
      const labelObject = new CSS2DObject(label);
      labelObject.position.set(0, baseRadius + 0.32, 0);
      group.add(labelObject);

      animated.push({
        group,
        glow,
        phase: index * 0.73,
        status: node.status,
        baseScale: isSelected ? 1.18 : 1,
        baseGlowOpacity,
      });
      scene.add(group);
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    let hovered: THREE.Mesh | null = null;

    const updatePointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    };

    const onPointerMove = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const next = raycaster.intersectObjects(clickableMeshes, false)[0]
        ?.object as THREE.Mesh | undefined;
      if (hovered && hovered !== next) hovered.scale.setScalar(1);
      hovered = next ?? null;
      if (hovered) hovered.scale.setScalar(1.45);
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
      controls.autoRotate = false;
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerUp = (event: PointerEvent) => {
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
      if (!pointerStart) return;
      const distance = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      pointerStart = null;
      if (distance > 6) return;
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableMeshes, false)[0];
      const id = hit?.object.userData.id;
      if (typeof id === "string") onSelect(id);
    };

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    let frame = 0;
    const clock = new THREE.Clock();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const render = () => {
      frame = window.requestAnimationFrame(render);
      const elapsed = clock.getElapsedTime();
      controls.update();
      backgroundStars.rotation.y += reduceMotion ? 0 : 0.000025;

      if (!reduceMotion) {
        animated.forEach((item) => {
          const pulse =
            item.status === "learning"
              ? 1 + Math.sin(elapsed * 1.7 + item.phase) * 0.055
              : 1;
          item.group.scale.setScalar(item.baseScale * pulse);
          if (item.glow) {
            (item.glow.material as THREE.SpriteMaterial).opacity =
              item.baseGlowOpacity *
              (1 + Math.sin(elapsed + item.phase) * 0.055);
          }
        });
      }

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    render();

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(mount.clientWidth, 320);
      const nextHeight = Math.max(mount.clientHeight, 420);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
      labelRenderer.setSize(nextWidth, nextHeight);
    });
    resizeObserver.observe(mount);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material?.dispose();
          }
        }
      });
      glowTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    };
  }, [edges, nodes, onSelect, selectedId]);

  return <div className="universe-mount" ref={mountRef} />;
}

export default SkillUniverse;
