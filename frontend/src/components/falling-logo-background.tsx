'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  baseX: number;
  z: number; // 0.2 (far/small/blurred) to 1.0 (near/large/sharp)
  baseSize: number;
  aspectRatio: number;
  vy: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  vRotX: number;
  vRotY: number;
  vRotZ: number;
  swayPhase: number;
  swaySpeed: number;
  swayAmp: number;
  opacity: number;
}

export function FallingLogoBackground({
  count = 9,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Track mouse for subtle parallax
    let mouseX = width / 2;
    let mouseY = height / 2;
    let targetMouseX = width / 2;
    let targetMouseY = height / 2;

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX;
      targetMouseY = e.clientY;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Handle high-DPI displays
    const resize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.resetTransform?.();
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);

    // Preload logo image
    const img = new Image();
    img.src = '/logo.png';
    let imageLoaded = false;
    let imgAspectRatio = 385 / 339; // default logo aspect ratio

    img.onload = () => {
      imageLoaded = true;
      if (img.naturalWidth && img.naturalHeight) {
        imgAspectRatio = img.naturalWidth / img.naturalHeight;
      }
    };

    // Create particles with realistic depth of field and tumbling parameters
    const createParticle = (slotIndex: number, totalSlots: number): Particle => {
      // Depth z: 0.35 (deep background) to 1.0 (foreground)
      const z = 0.35 + Math.pow(Math.random(), 1.2) * 0.65;

      // Stratified lane assignment to prevent initial overlap
      const laneWidth = (width + 200) / totalSlots;
      const baseX = -100 + (slotIndex + 0.5 + (Math.random() - 0.5) * 0.6) * laneWidth;
      const initialY = -100 + (slotIndex / totalSlots) * (height + 250) + (Math.random() - 0.5) * 80;

      // Base sizes range: 150px to 290px
      const baseSize = 150 + Math.random() * 140;

      // Falling speed proportional to depth (foreground falls faster)
      const vy = (0.4 + z * 1.1) * (0.85 + Math.random() * 0.3);

      return {
        x: baseX,
        y: initialY,
        baseX,
        z,
        baseSize,
        aspectRatio: imgAspectRatio,
        vy,
        rotX: Math.random() * Math.PI * 2,
        rotY: Math.random() * Math.PI * 2,
        rotZ: Math.random() * Math.PI * 2,
        // 3D angular rotation speeds for tumbling
        vRotX: (Math.random() - 0.5) * 0.018 * (0.5 + z * 0.5),
        vRotY: (Math.random() - 0.5) * 0.026 * (0.5 + z * 0.5),
        vRotZ: (Math.random() - 0.5) * 0.012 * (0.5 + z * 0.5),
        swayPhase: Math.random() * Math.PI * 2,
        swaySpeed: 0.005 + Math.random() * 0.008,
        swayAmp: 18 + (1 - z) * 35 + Math.random() * 20,
        // Foreground higher opacity, background softer
        opacity: 0.22 + z * 0.65,
      };
    };

    // Adjust particle count based on screen size (fewer on mobile for zero overlap)
    const adjustedCount = width < 768 ? Math.max(5, Math.floor(count * 0.6)) : count;
    // Distribute initial particles across full height in non-overlapping slots
    const particles: Particle[] = Array.from({ length: adjustedCount }, (_, i) =>
      createParticle(i, adjustedCount)
    );

    // Sort by depth (z ascending) so background particles are drawn first
    particles.sort((a, b) => a.z - b.z);

    let lastTime = performance.now();
    let isTabVisible = !document.hidden;

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible) {
        lastTime = performance.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Animation loop
    const render = (time: number) => {
      animationFrameId = requestAnimationFrame(render);

      if (!isTabVisible || !imageLoaded) return;

      const dt = Math.min((time - lastTime) / 16.667, 2.5); // normalized delta time (~1.0 at 60fps)
      lastTime = time;

      // Smooth mouse parallax interpolation
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;
      const mouseParallaxX = (mouseX - width / 2) / (width / 2);
      const mouseParallaxY = (mouseY - height / 2) / (height / 2);

      ctx.clearRect(0, 0, width, height);

      // 1. Update basic kinematics & sway
      for (const p of particles) {
        p.rotX += p.vRotX * dt;
        p.rotY += p.vRotY * dt;
        p.rotZ += p.vRotZ * dt;
        p.swayPhase += p.swaySpeed * dt;

        // Downward vertical motion
        p.y += p.vy * dt;

        // Horizontal sinusoidal sway
        p.x = p.baseX + Math.sin(p.swayPhase) * p.swayAmp;
      }

      // 2. Anti-overlap soft repulsion physics
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        if (!p1) continue;
        const r1 = (p1.baseSize * p1.z) * 0.48;

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          if (!p2) continue;
          const r2 = (p2.baseSize * p2.z) * 0.48;
          const minDist = r1 + r2 + 25; // 25px safety margin

          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < minDist * minDist && distSq > 1) {
            const dist = Math.sqrt(distSq);
            const overlap = (minDist - dist);
            const nx = dx / dist;
            const ny = dy / dist;

            // Smoothly push apart horizontally and vertically
            const pushX = nx * overlap * 0.06 * dt;
            const pushY = ny * overlap * 0.03 * dt;

            p1.baseX += pushX;
            p2.baseX -= pushX;
            p1.x += pushX;
            p2.x -= pushX;
            p1.y += pushY;
            p2.y -= pushY;
          }
        }
      }

      // 3. Draw particles & recycle
      for (const p of particles) {
        const renderedWidth = p.baseSize * p.z;
        const renderedHeight = renderedWidth / imgAspectRatio;

        // Recycle particle when it goes below screen bottom
        if (p.y > height + renderedHeight + 120) {
          p.y = -renderedHeight - Math.random() * 140;

          // Smart non-overlapping spawn X selection
          let bestX = Math.random() * (width + 160) - 80;
          let maxMinDist = 0;
          for (let attempt = 0; attempt < 8; attempt++) {
            const candidateX = Math.random() * (width + 160) - 80;
            let closestDist = Infinity;
            for (const other of particles) {
              if (other === p || other.y > 300) continue;
              const d = Math.abs(candidateX - other.x);
              if (d < closestDist) closestDist = d;
            }
            if (closestDist > maxMinDist) {
              maxMinDist = closestDist;
              bestX = candidateX;
            }
          }
          p.baseX = bestX;
          p.x = bestX;

          // Refresh tumbling velocities
          p.vRotX = (Math.random() - 0.5) * 0.018 * (0.5 + p.z * 0.5);
          p.vRotY = (Math.random() - 0.5) * 0.026 * (0.5 + p.z * 0.5);
          p.vRotZ = (Math.random() - 0.5) * 0.012 * (0.5 + p.z * 0.5);
        }

        // Apply mouse parallax (foreground moves more than background)
        const currentX = p.x + mouseParallaxX * (p.z * 35);
        const currentY = p.y + mouseParallaxY * (p.z * 20);

        // Draw particle in 3D perspective
        ctx.save();
        ctx.translate(currentX, currentY);

        // Roll (2D in-plane rotation)
        ctx.rotate(p.rotZ);

        // 3D Pitch and Yaw simulated via 2D scale matrix
        // Math.cos produces authentic flipping/tumbling of a 3D object
        const scaleX = Math.cos(p.rotY);
        const scaleY = Math.cos(p.rotX);

        // Prevent zero-scale glitching
        ctx.scale(
          Math.abs(scaleX) < 0.08 ? 0.08 * Math.sign(scaleX || 1) : scaleX,
          Math.abs(scaleY) < 0.08 ? 0.08 * Math.sign(scaleY || 1) : scaleY
        );

        // Depth-based blur simulation for deep background layers
        if (p.z < 0.42 && ctx.filter !== undefined) {
          const blurAmount = (0.42 - p.z) * 6;
          ctx.filter = `blur(${blurAmount.toFixed(1)}px)`;
        } else {
          ctx.filter = 'none';
        }

        // Subtle specular/lighting modulation as the logo rotates
        const lightFactor = 0.75 + 0.25 * Math.abs(Math.cos(p.rotY + 0.5));
        ctx.globalAlpha = Math.min(1, p.opacity * lightFactor);

        // Render logo centered
        ctx.drawImage(
          img,
          -renderedWidth / 2,
          -renderedHeight / 2,
          renderedWidth,
          renderedHeight
        );

        ctx.restore();
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [count]);

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 pointer-events-none -z-10 overflow-hidden select-none ${className}`}
    >
      {/* Ambient background glow accents complementing the brand colors */}
      <div className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full bg-brand/10 blur-[130px] dark:bg-brand/15 pointer-events-none" />
      <div className="absolute top-1/3 -right-20 h-[450px] w-[450px] rounded-full bg-brand-strong/10 blur-[140px] dark:bg-brand-strong/12 pointer-events-none" />
      <div className="absolute -bottom-20 left-1/3 h-[400px] w-[400px] rounded-full bg-brand/5 blur-[120px] dark:bg-brand/10 pointer-events-none" />

      {/* 3D Falling Logos Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full block"
      />
    </div>
  );
}
