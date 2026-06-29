'use client';

import { useEffect, useRef } from 'react';

/**
 * 3D Holographic Sine Mesh Background.
 * Renders a full-screen, perspective-projected wireframe wave grid.
 * The waves ripple organically across the entire screen and distort dynamically
 * in response to mouse movement (hover ripples), creating a stunning 3D digital landscape.
 * Completely transparent.
 */
const BRAND = '255, 153, 0'; // #FF9900 as RGB for connections
const NODE_COLOR = '255, 255, 255'; // White particle points
const CAMERA_DISTANCE = 350;
const TILT_ANGLE = 50 * (Math.PI / 180); // Tilt the grid for 3D floor perspective

export function ConstellationBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000, targetX: -1000, targetY: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let raf = 0;
    let time = 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const handleMouseMove = (e: MouseEvent) => {
      // Track mouse position relative to canvas bounds
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.targetX = e.clientX - rect.left;
      mouseRef.current.targetY = e.clientY - rect.top;
    };

    const handleMouseLeave = () => {
      mouseRef.current.targetX = -1000;
      mouseRef.current.targetY = -1000;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const cosT = Math.cos(TILT_ANGLE);
      const sinT = Math.sin(TILT_ANGLE);

      // Smooth mouse coordinates interpolation
      if (mouseRef.current.targetX !== -1000) {
        if (mouseRef.current.x === -1000) {
          mouseRef.current.x = mouseRef.current.targetX;
          mouseRef.current.y = mouseRef.current.targetY;
        } else {
          mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.1;
          mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.1;
        }
      } else {
        mouseRef.current.x = -1000;
        mouseRef.current.y = -1000;
      }

      // Configure grid rows & columns based on screen width
      const cols = Math.min(32, Math.max(16, Math.floor(width / 50)));
      const rows = Math.min(18, Math.max(10, Math.floor(height / 45)));

      // Helper to compute 3D coordinate and project it to 2D
      const getProjectedPoint = (c: number, r: number) => {
        // Distribute grid coordinates spanning slightly wider than screen bounds
        const xOffset = (c / (cols - 1) - 0.5) * (width * 1.25);
        const yOffset = (r / (rows - 1) - 0.5) * (height * 1.15);

        const absoluteX = centerX + xOffset;
        const absoluteY = centerY + yOffset;

        // Base sine wave calculation driven by time and grid coordinate distance
        const distFromCenter = Math.hypot(xOffset, yOffset);
        let waveHeight = Math.sin(distFromCenter * 0.006 - time * 0.035) * 28;
        waveHeight += Math.cos((xOffset + yOffset) * 0.004 + time * 0.02) * 12;

        // Interactive mouse hover displacement ripple
        if (mouseRef.current.x !== -1000) {
          const distToMouse = Math.hypot(
            absoluteX - mouseRef.current.x,
            absoluteY - mouseRef.current.y,
          );
          if (distToMouse < 260) {
            const force = 1 - distToMouse / 260;
            // push down/up based on mouse proximity
            waveHeight += Math.sin(distToMouse * 0.04 - time * 0.1) * 35 * force;
          }
        }

        // Apply 3D tilt rotation around X-axis
        const rotY = yOffset * cosT - waveHeight * sinT;
        const rotZ = yOffset * sinT + waveHeight * cosT;

        // Apply 3D Perspective projection
        const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + rotZ);
        const px = centerX + xOffset * scale;
        const py = centerY + rotY * scale;

        // Calculate depth opacity (0 to 1) based on Z distance
        const maxZ = height * 0.8;
        const depth = Math.max(0.1, Math.min(1.0, 1.0 - (rotZ + maxZ / 2) / maxZ));

        return { px, py, scale, depth };
      };

      // 1. Pre-calculate grid points matrix
      const grid: Array<Array<{ px: number; py: number; scale: number; depth: number }>> = [];
      for (let c = 0; c < cols; c++) {
        const colArr: Array<{ px: number; py: number; scale: number; depth: number }> = [];
        for (let r = 0; r < rows; r++) {
          colArr.push(getProjectedPoint(c, r));
        }
        grid.push(colArr);
      }

      // 2. Draw wireframe grid lines
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const col = grid[c];
          if (!col) continue;
          const pt = col[r];
          if (!pt) continue;

          // Connect to right neighbor
          if (c < cols - 1) {
            const rightCol = grid[c + 1];
            const nextCol = rightCol?.[r];
            if (nextCol) {
              const avgDepth = (pt.depth + nextCol.depth) / 2;
              ctx.strokeStyle = `rgba(${BRAND}, ${(0.14 * avgDepth).toFixed(3)})`;
              ctx.lineWidth = 0.7 * avgDepth;
              ctx.beginPath();
              ctx.moveTo(pt.px, pt.py);
              ctx.lineTo(nextCol.px, nextCol.py);
              ctx.stroke();
            }
          }

          // Connect to bottom neighbor
          if (r < rows - 1) {
            const nextRow = col[r + 1];
            if (nextRow) {
              const avgDepth = (pt.depth + nextRow.depth) / 2;
              ctx.strokeStyle = `rgba(${BRAND}, ${(0.14 * avgDepth).toFixed(3)})`;
              ctx.lineWidth = 0.7 * avgDepth;
              ctx.beginPath();
              ctx.moveTo(pt.px, pt.py);
              ctx.lineTo(nextRow.px, nextRow.py);
              ctx.stroke();
            }
          }
        }
      }

      // 3. Draw grid nodes on top
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const pt = grid[c]?.[r];
          if (!pt) continue;
          const radius = Math.max(0.6, 1.8 * pt.scale);
          const alpha = 0.2 + 0.6 * pt.depth;

          ctx.fillStyle = `rgba(${NODE_COLOR}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(pt.px, pt.py, radius, 0, Math.PI * 2);
          ctx.fill();

          // Add a subtle glowing ring for nodes close to front
          if (pt.depth > 0.85) {
            ctx.strokeStyle = `rgba(${BRAND}, ${((0.25 * (pt.depth - 0.85)) / 0.15).toFixed(3)})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.arc(pt.px, pt.py, radius * 2.2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    };

    const tick = () => {
      time += 0.65;
      draw();
      raf = requestAnimationFrame(tick);
    };

    resize();
    if (reduceMotion) {
      draw();
    } else {
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
