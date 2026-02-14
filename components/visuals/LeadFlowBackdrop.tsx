"use client";

import { useEffect, useRef } from "react";
import Matter from "matter-js";
import { cn } from "@/lib/utils";

type FlowNode = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
};

type PointerState = {
  x: number;
  y: number;
  active: boolean;
};

type FlowPointer = {
  x: number;
  y: number;
  intensity: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const squaredDistance = (aX: number, aY: number, bX: number, bY: number) => {
  const dx = aX - bX;
  const dy = aY - bY;
  return dx * dx + dy * dy;
};

export function LeadFlowBackdrop({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // User preference stored in localStorage (applies even on /login before auth).
    // "auto" respects OS reduce-motion; "off" disables motion; "on" enables motion unless OS reduce-motion is set.
    let motionPref: "auto" | "on" | "off" = "auto";
    try {
      const stored = window.localStorage.getItem("mission_control.motion");
      if (stored === "on" || stored === "off" || stored === "auto") motionPref = stored;
    } catch {
      // ignore (storage disabled)
    }

    const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prefersReducedMotion = systemReducedMotion || motionPref === "off";
    const { Engine, World, Bodies, Body } = Matter;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let animationFrameId = 0;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let lastAmbientSpawn = 0;
    let lastUserPointerAt = 0;
    let lineDistanceSq = 140 * 140;
    let pointerRadiusSq = 165 * 165;
    let pointerBodyInfluenceSq = 160 * 160;
    let bodyLimit = 24;

    const pointer: PointerState = { x: 0, y: 0, active: false };
    const nodes: FlowNode[] = [];
    const shapeCooldown = new Map<string, number>();

    const physicsEngine = Engine.create({
      gravity: { x: 0, y: 0.78, scale: 0.001 },
      enableSleeping: false,
    });

    let boundaries: Matter.Body[] = [];
    const dynamicBodies: Matter.Body[] = [];

    const removeBodies = (bodies: Matter.Body[]) => {
      for (const body of bodies) {
        World.remove(physicsEngine.world, body);
      }
    };

    const addBodies = (bodies: Matter.Body[]) => {
      for (const body of bodies) {
        World.add(physicsEngine.world, body);
      }
    };

    const clearDynamicBodies = () => {
      if (dynamicBodies.length === 0) return;
      removeBodies(dynamicBodies);
      dynamicBodies.length = 0;
    };

    const rebuildBoundaries = () => {
      if (boundaries.length > 0) {
        removeBodies(boundaries);
      }

      const thickness = 140;
      boundaries = [
        Bodies.rectangle(width / 2, height + thickness / 2, width + thickness * 2, thickness, {
          isStatic: true,
          restitution: 0.95,
          friction: 0.45,
        }),
        Bodies.rectangle(-thickness / 2, height / 2, thickness, height * 2, { isStatic: true }),
        Bodies.rectangle(width + thickness / 2, height / 2, thickness, height * 2, { isStatic: true }),
        Bodies.rectangle(width / 2, -thickness / 2, width + thickness * 2, thickness, { isStatic: true }),
      ];

      addBodies(boundaries);
    };

    const initializeNodes = () => {
      nodes.length = 0;
      const nodeCount = prefersReducedMotion ? 12 : width < 640 ? 20 : width < 960 ? 30 : 38;

      for (let i = 0; i < nodeCount; i += 1) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() * 2 - 1) * 0.4,
          vy: (Math.random() * 2 - 1) * 0.4,
          radius: Math.random() * 1.4 + 1.1,
          hue: 185 + Math.random() * 42,
        });
      }
    };

    const spawnPhysicsShape = (x: number, y: number, energy: number) => {
      const size = clamp(Math.sqrt(energy) * 0.24, 12, 34);
      const type = Math.floor(Math.random() * 6);
      const hue = 185 + Math.random() * 48;

      let shape: Matter.Body;
      if (type === 0) {
        shape = Bodies.polygon(x, y, 3, size * 1.08, {
          restitution: 0.82,
          friction: 0.04,
          frictionAir: 0.002,
          density: 0.0011,
        });
      } else if (type === 1) {
        shape = Bodies.rectangle(x, y, size * 1.5, size * 0.92, {
          restitution: 0.84,
          friction: 0.05,
          frictionAir: 0.0022,
          density: 0.001,
          chamfer: { radius: 2 },
        });
      } else if (type === 2) {
        shape = Bodies.polygon(x, y, 4, size * 0.95, {
          restitution: 0.8,
          friction: 0.045,
          frictionAir: 0.0018,
          density: 0.001,
        });
        Body.rotate(shape, Math.PI / 4);
      } else if (type === 3) {
        shape = Bodies.polygon(x, y, 5, size, {
          restitution: 0.78,
          friction: 0.05,
          frictionAir: 0.002,
          density: 0.0012,
        });
      } else if (type === 4) {
        shape = Bodies.rectangle(x, y, size * 0.9, size * 1.5, {
          restitution: 0.86,
          friction: 0.04,
          frictionAir: 0.0021,
          density: 0.001,
          chamfer: { radius: 3 },
        });
      } else {
        shape = Bodies.polygon(x, y, 6, size * 0.9, {
          restitution: 0.79,
          friction: 0.052,
          frictionAir: 0.0017,
          density: 0.00115,
        });
      }

      shape.plugin = {
        ...(shape.plugin ?? {}),
        hue,
        createdAt: performance.now(),
      };

      Body.setVelocity(shape, {
        x: (Math.random() * 2 - 1) * 2.5,
        y: -2.6 - Math.random() * 1.8,
      });
      Body.setAngularVelocity(shape, (Math.random() * 2 - 1) * 0.08);

      World.add(physicsEngine.world, shape);
      dynamicBodies.push(shape);

      while (dynamicBodies.length > bodyLimit) {
        const oldest = dynamicBodies.shift();
        if (oldest) World.remove(physicsEngine.world, oldest);
      }
    };

    const detectClosedShapes = (adjacency: boolean[][], now: number, flowPointer: FlowPointer | null) => {
      if (!flowPointer || prefersReducedMotion) return;
      let spawned = 0;
      const maxPerBurst = width < 640 ? 2 : 3;
      const n = nodes.length;

      for (let i = 0; i < n; i += 1) {
        if (spawned >= maxPerBurst) return;
        for (let j = i + 1; j < n; j += 1) {
          if (!adjacency[i][j]) continue;
          for (let k = j + 1; k < n; k += 1) {
            if (!adjacency[i][k] || !adjacency[j][k]) continue;

            const a = nodes[i];
            const b = nodes[j];
            const c = nodes[k];
            const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
            if (area < 110) continue;

            const centerX = (a.x + b.x + c.x) / 3;
            const centerY = (a.y + b.y + c.y) / 3;
            if (squaredDistance(centerX, centerY, flowPointer.x, flowPointer.y) > pointerRadiusSq) continue;

            const key = `${i}:${j}:${k}`;
            const last = shapeCooldown.get(key) ?? 0;
            if (now - last < 900) continue;

            shapeCooldown.set(key, now);
            spawnPhysicsShape(centerX, centerY, area);
            spawned += 1;
            if (spawned >= maxPerBurst) return;
          }
        }
      }
    };

    const updateNodes = (adjacency: boolean[][], flowPointer: FlowPointer | null) => {
      const pointerInfluenceRadius = width < 640 ? 130 : 210;
      const pointerInfluenceSq = pointerInfluenceRadius * pointerInfluenceRadius;

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!prefersReducedMotion) {
          node.x += node.vx;
          node.y += node.vy;
        }

        if (node.x <= 0 || node.x >= width) {
          node.vx *= -1;
          node.x = clamp(node.x, 0, width);
        }
        if (node.y <= 0 || node.y >= height) {
          node.vy *= -1;
          node.y = clamp(node.y, 0, height);
        }

        if (flowPointer) {
          const dx = flowPointer.x - node.x;
          const dy = flowPointer.y - node.y;
          const distSq = dx * dx + dy * dy;

          if (distSq > 0.0001 && distSq < pointerInfluenceSq) {
            const dist = Math.sqrt(distSq);
            const pull = (1 - dist / pointerInfluenceRadius) * 0.018 * flowPointer.intensity;
            node.vx += (dx / dist) * pull;
            node.vy += (dy / dist) * pull;
          }
        }

        node.vx *= 0.995;
        node.vy *= 0.995;
        node.vx = clamp(node.vx, -0.88, 0.88);
        node.vy = clamp(node.vy, -0.88, 0.88);

        for (let j = i + 1; j < nodes.length; j += 1) {
          const peer = nodes[j];
          if (squaredDistance(node.x, node.y, peer.x, peer.y) <= lineDistanceSq) {
            adjacency[i][j] = true;
            adjacency[j][i] = true;
          }
        }
      }
    };

    const updatePhysics = (deltaMs: number, flowPointer: FlowPointer | null) => {
      Engine.update(physicsEngine, deltaMs);

      if (!flowPointer) return;
      for (let i = 0; i < dynamicBodies.length; i += 1) {
        const body = dynamicBodies[i];
        const dx = flowPointer.x - body.position.x;
        const dy = flowPointer.y - body.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= 0.0001 || distSq > pointerBodyInfluenceSq) continue;
        const dist = Math.sqrt(distSq);
        const forceScale = (1 - dist / Math.sqrt(pointerBodyInfluenceSq)) * 0.00004 * flowPointer.intensity;
        Body.applyForce(body, body.position, {
          x: (dx / dist) * forceScale,
          y: (dy / dist) * forceScale * 0.65,
        });
      }
    };

    const drawBackground = (flowPointer: FlowPointer | null) => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#03050c";
      context.fillRect(0, 0, width, height);

      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(2, 12, 34, 0.84)");
      gradient.addColorStop(0.5, "rgba(5, 20, 48, 0.54)");
      gradient.addColorStop(1, "rgba(4, 10, 30, 0.82)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      if (flowPointer) {
        const glowRadius = width < 640 ? 170 : 260;
        const glow = context.createRadialGradient(flowPointer.x, flowPointer.y, 0, flowPointer.x, flowPointer.y, glowRadius);
        glow.addColorStop(0, `rgba(34, 211, 238, ${0.12 * flowPointer.intensity})`);
        glow.addColorStop(0.44, `rgba(99, 102, 241, ${0.09 * flowPointer.intensity})`);
        glow.addColorStop(1, "rgba(99, 102, 241, 0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);
      }
    };

    const drawNodeLines = (adjacency: boolean[][], flowPointer: FlowPointer | null) => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          if (!adjacency[i][j]) continue;
          const peer = nodes[j];
          const distSq = squaredDistance(node.x, node.y, peer.x, peer.y);
          const alpha = clamp(1 - distSq / lineDistanceSq, 0.12, 0.56);
          const gradient = context.createLinearGradient(node.x, node.y, peer.x, peer.y);
          gradient.addColorStop(0, `hsla(${node.hue}, 86%, 64%, ${alpha})`);
          gradient.addColorStop(1, `hsla(${peer.hue}, 86%, 64%, ${alpha * 0.9})`);
          context.strokeStyle = gradient;
          context.lineWidth = 1.15;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(peer.x, peer.y);
          context.stroke();
        }
      }

      if (flowPointer) {
        for (let i = 0; i < nodes.length; i += 1) {
          const node = nodes[i];
          const distSq = squaredDistance(node.x, node.y, flowPointer.x, flowPointer.y);
          if (distSq > pointerRadiusSq) continue;
          const alpha = clamp((1 - distSq / pointerRadiusSq) * flowPointer.intensity, 0.08, 0.42);
          const beam = context.createLinearGradient(node.x, node.y, flowPointer.x, flowPointer.y);
          beam.addColorStop(0, `hsla(${node.hue}, 90%, 66%, ${alpha})`);
          beam.addColorStop(1, `rgba(129, 140, 248, ${alpha * 0.9})`);
          context.strokeStyle = beam;
          context.lineWidth = 1.2;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(flowPointer.x, flowPointer.y);
          context.stroke();
        }
      }
    };

    const drawNodes = () => {
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        context.fillStyle = `hsla(${node.hue}, 88%, 68%, 0.8)`;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fill();
      }
    };

    const drawPhysicsBodies = (now: number) => {
      for (let i = 0; i < dynamicBodies.length; i += 1) {
        const body = dynamicBodies[i];
        const vertices = body.vertices;
        if (!vertices || vertices.length === 0) continue;

        const bodyHue = typeof body.plugin?.hue === "number" ? body.plugin.hue : 200;
        const bornAt = typeof body.plugin?.createdAt === "number" ? body.plugin.createdAt : now;
        const age = now - bornAt;
        const lifeAlpha = age > 16000 ? clamp(1 - (age - 16000) / 5000, 0, 1) : 1;

        context.beginPath();
        context.moveTo(vertices[0].x, vertices[0].y);
        for (let vertexIndex = 1; vertexIndex < vertices.length; vertexIndex += 1) {
          const point = vertices[vertexIndex];
          context.lineTo(point.x, point.y);
        }
        context.closePath();

        const fill = context.createLinearGradient(body.bounds.min.x, body.bounds.min.y, body.bounds.max.x, body.bounds.max.y);
        fill.addColorStop(0, `hsla(${bodyHue}, 88%, 62%, ${0.36 * lifeAlpha})`);
        fill.addColorStop(1, `hsla(${bodyHue + 28}, 84%, 60%, ${0.5 * lifeAlpha})`);
        context.fillStyle = fill;
        context.strokeStyle = `rgba(255, 255, 255, ${0.34 * lifeAlpha})`;
        context.lineWidth = 1;
        context.fill();
        context.stroke();

        if (lifeAlpha <= 0.02) {
          World.remove(physicsEngine.world, body);
          dynamicBodies.splice(i, 1);
          i -= 1;
        }
      }
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const linkDistance = width < 640 ? 124 : width < 960 ? 142 : 156;
      lineDistanceSq = linkDistance * linkDistance;
      pointerRadiusSq = (width < 640 ? 148 : 220) ** 2;
      pointerBodyInfluenceSq = (width < 640 ? 150 : 210) ** 2;
      bodyLimit = width < 640 ? 16 : width < 960 ? 26 : 34;
      pointer.x = width / 2;
      pointer.y = height / 2;

      initializeNodes();
      clearDynamicBodies();
      rebuildBoundaries();
    };

    const getFlowPointer = (now: number): FlowPointer | null => {
      const userPointerFresh = pointer.active && now - lastUserPointerAt < 2800;
      if (userPointerFresh) {
        return { x: pointer.x, y: pointer.y, intensity: 1 };
      }

      if (prefersReducedMotion) return null;

      const t = now * 0.00024;
      const orbitX = width * 0.5 + Math.cos(t * 0.92) * width * 0.3 + Math.sin(t * 0.37) * width * 0.08;
      const orbitY = height * 0.5 + Math.sin(t * 1.12) * height * 0.24 + Math.cos(t * 0.41) * height * 0.06;
      return {
        x: clamp(orbitX, 40, width - 40),
        y: clamp(orbitY, 40, height - 40),
        intensity: 0.74,
      };
    };

    const renderFrame = () => {
      const now = performance.now();
      const delta = clamp(now - lastFrameTime, 8, 32);
      lastFrameTime = now;
      const flowPointer = getFlowPointer(now);

      const adjacency = Array.from({ length: nodes.length }, () =>
        Array.from({ length: nodes.length }, () => false),
      );

      updateNodes(adjacency, flowPointer);
      if (!prefersReducedMotion) {
        updatePhysics(delta, flowPointer);
      }

      frameCount += 1;
      if (!prefersReducedMotion && frameCount % 6 === 0) {
        detectClosedShapes(adjacency, now, flowPointer);
        shapeCooldown.forEach((value, key) => {
          if (now - value > 12000) shapeCooldown.delete(key);
        });
      }

      if (
        !prefersReducedMotion &&
        flowPointer &&
        now - lastAmbientSpawn > 920 &&
        dynamicBodies.length < bodyLimit - 2
      ) {
        lastAmbientSpawn = now;
        spawnPhysicsShape(
          clamp(flowPointer.x + (Math.random() * 190 - 95), 20, width - 20),
          clamp(flowPointer.y + (Math.random() * 120 - 70), 20, height - 20),
          280 + Math.random() * 520,
        );
      }

      drawBackground(flowPointer);
      drawNodeLines(adjacency, flowPointer);
      drawPhysicsBodies(now);
      drawNodes();

      if (!prefersReducedMotion) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      lastUserPointerAt = performance.now();
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointer.x = touch.clientX;
      pointer.y = touch.clientY;
      pointer.active = true;
      lastUserPointerAt = performance.now();
    };

    const deactivatePointer = () => {
      pointer.active = false;
    };

    resize();
    renderFrame();

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", deactivatePointer);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", deactivatePointer);
      clearDynamicBodies();
      if (boundaries.length > 0) World.remove(physicsEngine.world, boundaries);
      Engine.clear(physicsEngine);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="lead-flow-backdrop"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  );
}
