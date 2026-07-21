import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import * as PIXI from 'pixi.js';

// Respect the OS "reduce motion" setting for the Pixi-canvas board effects
// (robber/pirate slide, placement ring, hex press, flying cards). The DOM/
// framer-motion side is already handled via tokens.css + <MotionConfig>.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawStylizedWave(g, wx, wy, scale) {
  g.lineStyle(1.2 * scale, 0x38bdf8, 0.22);
  g.moveTo(wx - 8 * scale, wy);
  g.quadraticCurveTo(wx - 4 * scale, wy - 3 * scale, wx, wy);
  g.quadraticCurveTo(wx + 4 * scale, wy - 3 * scale, wx + 8 * scale, wy);
  g.moveTo(wx - 4 * scale, wy + 3 * scale);
  g.quadraticCurveTo(wx - 2 * scale, wy + 1.2 * scale, wx, wy + 3 * scale);
  g.quadraticCurveTo(wx + 2 * scale, wy + 1.2 * scale, wx + 4 * scale, wy + 3 * scale);
}

function drawStylizedBackgroundShip(g, sx, sy, scale) {
  g.beginFill(0x020617, 0.18);
  g.lineStyle(0);
  g.drawEllipse(sx + 1 * scale, sy + 3 * scale, 9 * scale, 2.5 * scale);
  g.endFill();
  
  g.beginFill(0x78350f, 0.65);
  g.lineStyle(0.8 * scale, 0x451a03, 0.6);
  g.moveTo(sx - 9 * scale, sy);
  g.lineTo(sx + 9 * scale, sy);
  g.lineTo(sx + 12 * scale, sy - 3 * scale);
  g.lineTo(sx - 12 * scale, sy - 3 * scale);
  g.closePath();
  g.endFill();
  
  g.lineStyle(1.2 * scale, 0x451a03, 0.6);
  g.moveTo(sx, sy - 3 * scale);
  g.lineTo(sx, sy - 16 * scale);
  
  g.beginFill(0xf8fafc, 0.75);
  g.lineStyle(0.6 * scale, 0xe2e8f0, 0.7);
  g.moveTo(sx, sy - 16 * scale);
  g.quadraticCurveTo(sx + 9 * scale, sy - 10 * scale, sx + 1 * scale, sy - 4 * scale);
  g.lineTo(sx, sy - 4 * scale);
  g.closePath();
  g.endFill();
}

function drawCompassRose(g, cx, cy, scale) {
  g.lineStyle(0.8 * scale, 0x38bdf8, 0.15);
  g.drawCircle(cx, cy, 26 * scale);
  g.drawCircle(cx, cy, 22 * scale);
  
  g.lineStyle(0.6 * scale, 0x38bdf8, 0.2);
  g.drawCircle(cx, cy, 5 * scale);

  const directions = [
    { dx: 0, dy: -1, length: 36, isMain: true },
    { dx: 1, dy: 0, length: 30, isMain: true },
    { dx: 0, dy: 1, length: 30, isMain: true },
    { dx: -1, dy: 0, length: 30, isMain: true },
    { dx: 0.707, dy: -0.707, length: 20, isMain: false },
    { dx: 0.707, dy: 0.707, length: 20, isMain: false },
    { dx: -0.707, dy: 0.707, length: 20, isMain: false },
    { dx: -0.707, dy: -0.707, length: 20, isMain: false }
  ];
  
  g.lineStyle(0);
  directions.forEach(dir => {
    const px = cx + dir.dx * dir.length * scale;
    const py = cy + dir.dy * dir.length * scale;
    const perpX = -dir.dy;
    const perpY = dir.dx;
    const w = (dir.isMain ? 4 : 2.5) * scale;
    
    g.beginFill(0xf8fafc, 0.35);
    g.drawPolygon([
      cx, cy,
      cx + perpX * w, cy + perpY * w,
      px, py
    ]);
    g.endFill();
    
    g.beginFill(0x0284c7, 0.35);
    g.drawPolygon([
      cx, cy,
      cx - perpX * w, cy - perpY * w,
      px, py
    ]);
    g.endFill();
  });
}

function drawOceanRefinements(g, scale) {
  g.lineStyle(0.6 * scale, 0x38bdf8, 0.05);
  g.drawCircle(0, 0, 320 * scale);
  g.drawCircle(0, 0, 640 * scale);
  g.drawCircle(0, 0, 960 * scale);
  
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    g.moveTo(0, 0);
    g.lineTo(Math.cos(angle) * 1100 * scale, Math.sin(angle) * 1100 * scale);
  }
  
  drawCompassRose(g, 360 * scale, -280 * scale, scale);
  drawCompassRose(g, -360 * scale, 340 * scale, scale);
  
  const wavePoints = [
    { x: -350, y: -180 },
    { x: -450, y: 80 },
    { x: -200, y: 380 },
    { x: 380, y: 220 },
    { x: 220, y: -380 },
    { x: -280, y: -340 },
    { x: 450, y: -100 },
    { x: -550, y: -80 },
    { x: 100, y: -480 },
    { x: -100, y: 480 },
    { x: 480, y: -320 },
    { x: 550, y: 120 }
  ];
  wavePoints.forEach(p => {
    drawStylizedWave(g, p.x * scale, p.y * scale, scale);
  });
  
  drawStylizedBackgroundShip(g, -360 * scale, -80 * scale, scale);
  drawStylizedBackgroundShip(g, 260 * scale, 360 * scale, scale);
}

function drawFlyingCard(g, cx, cy, resource, t, scale) {
  const w = 26 * scale * (1.0 + 0.25 * Math.sin(t * Math.PI));
  const h = 38 * scale * (1.0 + 0.25 * Math.sin(t * Math.PI));
  
  let fill = 0xffffff;
  switch (resource) {
    case 'wood': fill = 0x22c55e; break;
    case 'brick': fill = 0xef4444; break;
    case 'sheep': fill = 0xa3e635; break;
    case 'wheat': fill = 0xeab308; break;
    case 'ore': fill = 0x94a3b8; break;
  }
  
  g.beginFill(0x020617, 0.25);
  g.lineStyle(0);
  g.drawRoundedRect(cx - w/2 + 2.5 * scale, cy - h/2 + 3.5 * scale, w, h, 3 * scale);
  g.endFill();
  
  g.beginFill(fill);
  g.lineStyle(1 * scale, 0x020617);
  g.drawRoundedRect(cx - w/2, cy - h/2, w, h, 3 * scale);
  g.endFill();
  
  g.lineStyle(0.6 * scale, 0xffffff, 0.6);
  g.drawRoundedRect(cx - w/2 + 1.5 * scale, cy - h/2 + 1.5 * scale, w - 3 * scale, h - 3 * scale);
  g.lineStyle(0);
}

const getHexHalfWidth = (y, R) => {
  const absY = Math.abs(y);
  const maxW = 0.866025 * R; // sqrt(3)/2 * R
  if (absY < R / 2) {
    return maxW;
  } else {
    return maxW * (1 - (absY - R / 2) / (R / 2));
  }
};

function drawHexBackgroundTexture(g, resource, hexX, hexY, R, scale, isMuted) {
  const localAlpha = isMuted ? 0.3 : 1.0;
  g.lineStyle(0);
  if (resource === 'brick') {
    // Subtle brick layout grid
    g.lineStyle(1 * scale, 0x7c2d12, 0.25 * localAlpha);
    const rowH = 8 * scale;
    const colW = 14 * scale;
    let rowIndex = 0;
    for (let dy = -R + 4 * scale; dy < R - 4 * scale; dy += rowH) {
      const halfW = getHexHalfWidth(dy, R);
      // Horizontal line
      g.moveTo(hexX - halfW, hexY + dy);
      g.lineTo(hexX + halfW, hexY + dy);
      
      // Vertical joints
      const shiftX = (rowIndex % 2 === 0) ? 0 : colW / 2;
      for (let dx = -R * 0.9 + shiftX; dx < R * 0.9 + shiftX; dx += colW) {
        if (Math.abs(dx) < halfW) {
          g.moveTo(hexX + dx, hexY + dy);
          g.lineTo(hexX + dx, hexY + dy + rowH);
        }
      }
      rowIndex++;
    }
  } else if (resource === 'wheat') {
    // Golden parallel curving rows of crops
    g.lineStyle(1.2 * scale, 0xd97706, 0.25 * localAlpha);
    for (let offset = -R * 0.8; offset < R * 0.8; offset += 12 * scale) {
      g.moveTo(hexX + offset - 4 * scale, hexY - R * 0.6);
      g.quadraticCurveTo(
        hexX + offset + 8 * scale, hexY,
        hexX + offset - 4 * scale, hexY + R * 0.6
      );
    }
  } else if (resource === 'sheep') {
    // Scattered small grass tufts
    const tufts = [
      { x: -18, y: -16 },
      { x: 18, y: 14 },
      { x: -20, y: 10 },
      { x: 12, y: -20 },
      { x: 0, y: 0 }
    ];
    tufts.forEach(t => {
      const gx = hexX + t.x * scale;
      const gy = hexY + t.y * scale;
      g.lineStyle(1 * scale, 0x15803d, 0.35 * localAlpha);
      g.moveTo(gx, gy);
      g.lineTo(gx - 1.5 * scale, gy - 4 * scale);
      g.moveTo(gx, gy);
      g.lineTo(gx, gy - 5 * scale);
      g.moveTo(gx, gy);
      g.lineTo(gx + 1.5 * scale, gy - 4 * scale);
    });
  } else if (resource === 'wood') {
    // Dense foliage shadows in background
    g.lineStyle(0);
    g.beginFill(0x14532d, 0.25 * localAlpha);
    const leaves = [
      { x: -22, y: -14, r: 8 },
      { x: 22, y: 12, r: 9 },
      { x: -12, y: 22, r: 8 },
      { x: 14, y: -22, r: 7 },
      { x: 20, y: -8, r: 8 },
      { x: -20, y: 8, r: 9 }
    ];
    leaves.forEach(l => {
      g.drawCircle(hexX + l.x * scale, hexY + l.y * scale, l.r * scale);
    });
    g.endFill();
  } else if (resource === 'ore') {
    // Rocky contours/cracks
    g.lineStyle(1.2 * scale, 0x334155, 0.25 * localAlpha);
    const cracks = [
      { x1: -R*0.7, y1: -R*0.3, x2: -R*0.2, y2: -R*0.5 },
      { x1: -R*0.2, y1: -R*0.5, x2: R*0.3, y2: -R*0.3 },
      { x1: -R*0.5, y1: R*0.4, x2: 0, y2: R*0.2 },
      { x1: 0, y1: R*0.2, x2: R*0.6, y2: R*0.4 },
      { x1: -R*0.8, y1: 0, x2: -R*0.5, y2: R*0.1 }
    ];
    cracks.forEach(c => {
      g.moveTo(hexX + c.x1 * scale, hexY + c.y1 * scale);
      g.lineTo(hexX + c.x2 * scale, hexY + c.y2 * scale);
    });
  } else if (resource === 'desert') {
    // Sand dune ripples
    g.lineStyle(1.2 * scale, 0xca8a04, 0.2 * localAlpha);
    for (let dy = -R * 0.6; dy < R * 0.6; dy += 14 * scale) {
      const halfW = getHexHalfWidth(dy, R);
      g.moveTo(hexX - halfW * 0.8, hexY + dy);
      g.quadraticCurveTo(
        hexX, hexY + dy + 4 * scale,
        hexX + halfW * 0.8, hexY + dy
      );
    }
  } else if (resource === 'water') {
    // Depth contours (concentric hexagons)
    g.lineStyle(1 * scale, 0x38bdf8, 0.12 * localAlpha);
    for (let rFactor = 0.45; rFactor <= 0.85; rFactor += 0.2) {
      const rTemp = R * rFactor;
      for (let i = 0; i < 6; i++) {
        const theta = (Math.PI / 6) + (i * Math.PI / 3);
        const vx = hexX + rTemp * Math.cos(theta);
        const vy = hexY + rTemp * Math.sin(theta);
        if (i === 0) g.moveTo(vx, vy);
        else g.lineTo(vx, vy);
      }
      g.closePath();
    }
    // Wave ripples
    g.lineStyle(1 * scale, 0x38bdf8, 0.35 * localAlpha);
    const waveOffsets = [
      { x: -12, y: -8 },
      { x: 12, y: -12 },
      { x: -8, y: 10 },
      { x: 10, y: 8 }
    ];
    waveOffsets.forEach(w => {
      const wx = hexX + w.x * scale;
      const wy = hexY + w.y * scale;
      g.moveTo(wx - 4 * scale, wy);
      g.quadraticCurveTo(wx - 2 * scale, wy - 2 * scale, wx, wy);
      g.quadraticCurveTo(wx + 2 * scale, wy - 2 * scale, wx + 4 * scale, wy);
    });
  }
  g.lineStyle(0);
}

function drawHexDetails(g, resource, hexX, hexY, scale, isMuted) {
  g.lineStyle(0);
  const localAlpha = isMuted ? 0.3 : 1.0;
  const lineAlpha = isMuted ? 0.25 : 1.0;

  if (resource === 'wood') {
    const treeOffsets = [
      { dx: -18, dy: -8 },
      { dx: 18, dy: -12 },
      { dx: -10, dy: 16 },
      { dx: 12, dy: 18 },
      { dx: -2, dy: -22 }
    ];
    treeOffsets.forEach((offset) => {
      const tx = hexX + offset.dx * scale;
      const ty = hexY + offset.dy * scale;

      // Cast Shadow
      g.beginFill(0x0f172a, 0.45 * localAlpha);
      g.drawEllipse(tx, ty + 6 * scale, 9 * scale, 3 * scale);
      g.endFill();

      // Trunk
      g.beginFill(0x451a03, localAlpha);
      g.drawRect(tx - 2 * scale, ty, 4 * scale, 7 * scale);
      g.endFill();

      // 3D Leaves Layer 1 (bottom)
      g.beginFill(0x22c55e, localAlpha); // Light green left
      g.drawPolygon([
        tx - 11 * scale, ty,
        tx, ty,
        tx, ty - 8 * scale
      ]);
      g.endFill();
      g.beginFill(0x15803d, localAlpha); // Dark green right
      g.drawPolygon([
        tx, ty,
        tx + 11 * scale, ty,
        tx, ty - 8 * scale
      ]);
      g.endFill();

      // 3D Leaves Layer 2 (middle)
      g.beginFill(0x4ade80, localAlpha); // Light green left
      g.drawPolygon([
        tx - 9 * scale, ty - 5 * scale,
        tx, ty - 5 * scale,
        tx, ty - 13 * scale
      ]);
      g.endFill();
      g.beginFill(0x166534, localAlpha); // Dark green right
      g.drawPolygon([
        tx, ty - 5 * scale,
        tx + 9 * scale, ty - 5 * scale,
        tx, ty - 13 * scale
      ]);
      g.endFill();

      // 3D Leaves Layer 3 (top)
      g.beginFill(0x86efac, localAlpha); // Light green left
      g.drawPolygon([
        tx - 7 * scale, ty - 10 * scale,
        tx, ty - 10 * scale,
        tx, ty - 18 * scale
      ]);
      g.endFill();
      g.beginFill(0x14532d, localAlpha); // Dark green right
      g.drawPolygon([
        tx, ty - 10 * scale,
        tx + 7 * scale, ty - 10 * scale,
        tx, ty - 18 * scale
      ]);
      g.endFill();
    });
  } else if (resource === 'sheep') {
    const sheepOffsets = [
      { dx: -16, dy: 12 },
      { dx: 18, dy: -10 },
      { dx: 2, dy: 18 }
    ];
    sheepOffsets.forEach((offset) => {
      const sx = hexX + offset.dx * scale;
      const sy = hexY + offset.dy * scale;

      // Sheep Shadow
      g.beginFill(0x0f172a, 0.25 * localAlpha);
      g.drawEllipse(sx, sy + 7 * scale, 7 * scale, 2.5 * scale);
      g.endFill();

      // Sheep Body (fluffy overlapping circles)
      g.beginFill(0xf8fafc, localAlpha);
      g.lineStyle(0.6 * scale, 0xe2e8f0, localAlpha);
      g.drawCircle(sx, sy, 4.5 * scale);
      g.drawCircle(sx - 3 * scale, sy, 3.5 * scale);
      g.drawCircle(sx + 3 * scale, sy, 3.5 * scale);
      g.drawCircle(sx, sy - 2 * scale, 3.5 * scale);
      g.endFill();

      // Head
      g.lineStyle(0);
      g.beginFill(0x1e293b, localAlpha);
      g.drawCircle(sx - 5.5 * scale, sy - 1 * scale, 2.8 * scale);
      g.endFill();

      // Legs
      g.lineStyle(1 * scale, 0x1e293b, lineAlpha);
      g.moveTo(sx - 2 * scale, sy + 3.5 * scale);
      g.lineTo(sx - 2 * scale, sy + 7.5 * scale);
      g.moveTo(sx + 2 * scale, sy + 3.5 * scale);
      g.lineTo(sx + 2 * scale, sy + 7.5 * scale);
    });
  } else if (resource === 'wheat') {
    const wheatOffsets = [
      { dx: -16, dy: -14 },
      { dx: 16, dy: 14 },
      { dx: 0, dy: -18 }
    ];
    wheatOffsets.forEach((offset) => {
      const wx = hexX + offset.dx * scale;
      const wy = hexY + offset.dy * scale;

      // Wheat Shadow
      g.beginFill(0x78350f, 0.2 * localAlpha);
      g.drawEllipse(wx, wy + 2 * scale, 6 * scale, 2 * scale);
      g.endFill();

      // Main Stem
      g.lineStyle(1.8 * scale, 0xb45309, lineAlpha);
      g.moveTo(wx, wy);
      g.lineTo(wx, wy - 18 * scale);

      // Wheat grains
      g.lineStyle(0);
      g.beginFill(0xf59e0b, localAlpha);
      for (let i = 0; i < 4; i++) {
        const gy = wy - 5 * scale - i * 3.5 * scale;
        g.drawEllipse(wx - 2.5 * scale, gy, 2.2 * scale, 1.3 * scale);
        g.drawEllipse(wx + 2.5 * scale, gy, 2.2 * scale, 1.3 * scale);
      }
      g.drawEllipse(wx, wy - 20 * scale, 1.5 * scale, 2.2 * scale);
      g.endFill();
    });
  } else if (resource === 'brick') {
    const brickOffsets = [
      { dx: -15, dy: -14 },
      { dx: 15, dy: 12 },
      { dx: -3, dy: 4 }
    ];
    brickOffsets.forEach((offset) => {
      const bx = hexX + offset.dx * scale;
      const by = hexY + offset.dy * scale;
      const w = 12 * scale;
      const h = 6 * scale;
      const d = 3 * scale; // isometric depth

      // Shadow
      g.beginFill(0x451a03, 0.35 * localAlpha);
      g.drawRect(bx - w / 2 + 1.5 * scale, by + h / 2, w, 2 * scale);
      g.endFill();

      // Front Face
      g.beginFill(0xb91c1c, localAlpha);
      g.lineStyle(0.6 * scale, 0x451a03, lineAlpha);
      g.drawRect(bx - w / 2, by - h / 2, w, h);
      g.endFill();

      // Top Highlight Face
      g.beginFill(0xf87171, localAlpha);
      g.drawPolygon([
        bx - w / 2, by - h / 2,
        bx - w / 2 + d, by - h / 2 - d,
        bx + w / 2 + d, by - h / 2 - d,
        bx + w / 2, by - h / 2
      ]);
      g.endFill();

      // Right Side Face
      g.beginFill(0x7f1d1d, localAlpha);
      g.drawPolygon([
        bx + w / 2, by - h / 2,
        bx + w / 2 + d, by - h / 2 - d,
        bx + w / 2 + d, by + h / 2 - d,
        bx + w / 2, by + h / 2
      ]);
      g.endFill();
    });
  } else if (resource === 'ore') {
    const mountainOffsets = [
      { dx: -2, dy: 12, w: 36, h: 26, h_cap: 8 },
      { dx: -18, dy: 18, w: 24, h: 18, h_cap: 5 },
      { dx: 16, dy: 20, w: 24, h: 18, h_cap: 5 }
    ];
    mountainOffsets.forEach((mtn) => {
      const mx = hexX + mtn.dx * scale;
      const my = hexY + mtn.dy * scale;
      const W = mtn.w * scale / 2;
      const H = mtn.h * scale;
      const h_cap = mtn.h_cap * scale;

      // Shadow
      g.beginFill(0x0f172a, 0.4 * localAlpha);
      g.lineStyle(0);
      g.drawPolygon([
        mx - W + 2.5 * scale, my + 2 * scale,
        mx + 2.5 * scale, my - H + 2 * scale,
        mx + W + 2.5 * scale, my + 2 * scale
      ]);
      g.endFill();

      // Mountain Base - Left side
      g.beginFill(0x94a3b8, localAlpha);
      g.lineStyle(1.2 * scale, 0x1e293b, lineAlpha);
      g.drawPolygon([
        mx - W, my,
        mx, my - H,
        mx, my
      ]);
      g.endFill();

      // Mountain Base - Right side
      g.beginFill(0x475569, localAlpha);
      g.drawPolygon([
        mx, my,
        mx, my - H,
        mx + W, my
      ]);
      g.endFill();

      // Snow Cap - Left Side
      const cap_ratio = W / H;
      g.beginFill(0xffffff, localAlpha);
      g.lineStyle(0);
      g.drawPolygon([
        mx - h_cap * cap_ratio, my - H + h_cap,
        mx, my - H,
        mx, my - H + h_cap
      ]);
      g.endFill();

      // Snow Cap - Right Side
      g.beginFill(0xe2e8f0, localAlpha);
      g.drawPolygon([
        mx, my - H + h_cap,
        mx, my - H,
        mx + h_cap * cap_ratio, my - H + h_cap
      ]);
      g.endFill();

      // Seam line
      g.lineStyle(1.2 * scale, 0x1e293b, lineAlpha);
      g.moveTo(mx, my - H);
      g.lineTo(mx, my);
    });
  } else if (resource === 'desert') {
    // Cactus (shifted to Top-Left corner)
    const ctx = hexX - 24 * scale;
    const cty = hexY - 16 * scale;
    g.lineStyle(0);
    g.beginFill(0x166534, localAlpha);
    g.drawRoundedRect(ctx - 3 * scale, cty - 16 * scale, 6 * scale, 24 * scale, 3 * scale);
    g.drawRoundedRect(ctx - 9 * scale, cty - 10 * scale, 7 * scale, 4 * scale, 2 * scale);
    g.drawRoundedRect(ctx - 9 * scale, cty - 16 * scale, 4 * scale, 8 * scale, 2 * scale);
    g.drawRoundedRect(ctx + 2 * scale, cty - 6 * scale, 7 * scale, 4 * scale, 2 * scale);
    g.drawRoundedRect(ctx + 5 * scale, cty - 12 * scale, 4 * scale, 8 * scale, 2 * scale);
    g.endFill();

    // Spines
    g.lineStyle(0.8 * scale, 0x020617, 0.6 * lineAlpha);
    const spineYs = [-12, -8, -4, 0, 4];
    spineYs.forEach(sy => {
      g.moveTo(ctx - 3 * scale, cty + sy * scale);
      g.lineTo(ctx - 5 * scale, cty + sy * scale);
      g.moveTo(ctx + 3 * scale, cty + sy * scale);
      g.lineTo(ctx + 5 * scale, cty + sy * scale);
    });

    // Scorpion (shifted to Bottom-Left corner)
    const scx = hexX - 22 * scale;
    const scy = hexY + 24 * scale;
    g.lineStyle(0);
    g.beginFill(0x0f172a, localAlpha);
    g.drawCircle(scx, scy, 4.5 * scale);
    g.endFill();

    g.lineStyle(1.5 * scale, 0x0f172a, lineAlpha);
    g.moveTo(scx, scy);
    g.quadraticCurveTo(scx + 8 * scale, scy - 4 * scale, scx + 6 * scale, scy - 12 * scale);
    g.moveTo(scx - 2 * scale, scy - 2 * scale);
    g.quadraticCurveTo(scx - 8 * scale, scy - 6 * scale, scx - 6 * scale, scy - 10 * scale);
    g.moveTo(scx + 2 * scale, scy - 2 * scale);
    g.quadraticCurveTo(scx + 8 * scale, scy - 6 * scale, scx + 6 * scale, scy - 10 * scale);

    // Steer Skull (shifted to Top-Right corner)
    const sx = hexX + 22 * scale;
    const sy = hexY - 14 * scale;
    
    // Skull Shadow
    g.beginFill(0x0f172a, 0.25 * localAlpha);
    g.lineStyle(0);
    g.drawEllipse(sx + 1.5 * scale, sy + 6.5 * scale, 6 * scale, 2 * scale);
    g.endFill();
    
    // Bone base
    g.beginFill(0xf1f5f9, localAlpha);
    g.lineStyle(0.8 * scale, 0x475569, lineAlpha);
    g.drawPolygon([
      sx - 4 * scale, sy - 5 * scale,
      sx + 4 * scale, sy - 5 * scale,
      sx + 3.5 * scale, sy - 1.5 * scale,
      sx + 1.5 * scale, sy + 5 * scale,
      sx - 1.5 * scale, sy + 5 * scale,
      sx - 3.5 * scale, sy - 1.5 * scale
    ]);
    g.endFill();
    
    // Left Horn
    g.lineStyle(1.5 * scale, 0x334155, lineAlpha);
    g.moveTo(sx - 3 * scale, sy - 4.5 * scale);
    g.quadraticCurveTo(sx - 8 * scale, sy - 7 * scale, sx - 9 * scale, sy - 1 * scale);
    
    // Right Horn
    g.moveTo(sx + 3 * scale, sy - 4.5 * scale);
    g.quadraticCurveTo(sx + 8 * scale, sy - 7 * scale, sx + 9 * scale, sy - 1 * scale);
    
    // Eye Sockets
    g.lineStyle(0);
    g.beginFill(0x334155, localAlpha);
    g.drawCircle(sx - 1.8 * scale, sy - 1.5 * scale, 1.1 * scale);
    g.drawCircle(sx + 1.8 * scale, sy - 1.5 * scale, 1.1 * scale);
    
    // Nasal cavity
    g.drawEllipse(sx, sy + 2.5 * scale, 0.8 * scale, 1.2 * scale);
    g.endFill();
  } else if (resource === 'water') {
    const fx = hexX - 10 * scale;
    const fy = hexY - 10 * scale;
    const fishAlpha = isMuted ? 0.25 : 0.8;
    
    g.lineStyle(1.2 * scale, 0xe0f2fe, fishAlpha * localAlpha);
    g.moveTo(fx - 4 * scale, fy + 2 * scale);
    g.quadraticCurveTo(fx, fy - 3 * scale, fx + 4 * scale, fy + 2 * scale);
    
    g.moveTo(fx - 4 * scale, fy + 2 * scale);
    g.lineTo(fx - 6 * scale, fy + 3.5 * scale);
    g.moveTo(fx - 4 * scale, fy + 2 * scale);
    g.lineTo(fx - 5.5 * scale, fy + 0.5 * scale);
    
    g.moveTo(fx, fy);
    g.lineTo(fx - 1 * scale, fy + 2 * scale);
  }
}

function drawPortSailIcon(g, type, cx, cy, scale) {
  g.lineStyle(0);
  if (type === 'wood') {
    // Tiny green tree
    g.beginFill(0x451a03);
    g.drawRect(cx - 0.8 * scale, cy + 1 * scale, 1.6 * scale, 3 * scale);
    g.endFill();
    g.beginFill(0x15803d);
    g.drawPolygon([
      cx - 4 * scale, cy + 1 * scale,
      cx + 4 * scale, cy + 1 * scale,
      cx, cy - 5 * scale
    ]);
    g.endFill();
  } else if (type === 'sheep') {
    // Tiny white sheep shape
    g.beginFill(0xf8fafc);
    g.drawCircle(cx, cy, 2.2 * scale);
    g.drawCircle(cx - 1.5 * scale, cy, 1.8 * scale);
    g.drawCircle(cx + 1.5 * scale, cy, 1.8 * scale);
    g.endFill();
    g.beginFill(0x1e293b);
    g.drawCircle(cx - 2.5 * scale, cy - 0.5 * scale, 1 * scale);
    g.endFill();
  } else if (type === 'wheat') {
    // Tiny gold wheat stalk
    g.lineStyle(1 * scale, 0xb45309);
    g.moveTo(cx, cy + 3 * scale);
    g.lineTo(cx, cy - 4 * scale);
    g.lineStyle(0);
    g.beginFill(0xf59e0b);
    g.drawCircle(cx - 1.2 * scale, cy - 1.5 * scale, 0.9 * scale);
    g.drawCircle(cx + 1.2 * scale, cy - 1.5 * scale, 0.9 * scale);
    g.drawCircle(cx - 1.2 * scale, cy, 0.9 * scale);
    g.drawCircle(cx + 1.2 * scale, cy, 0.9 * scale);
    g.drawCircle(cx, cy - 4.5 * scale, 0.9 * scale);
    g.endFill();
  } else if (type === 'brick') {
    // Tiny red brick rectangle
    g.beginFill(0xb91c1c);
    g.lineStyle(0.6 * scale, 0x451a03);
    g.drawRect(cx - 3.5 * scale, cy - 2 * scale, 7 * scale, 4 * scale);
    g.endFill();
  } else if (type === 'ore') {
    // Tiny grey rock shape
    g.beginFill(0x64748b);
    g.lineStyle(0.6 * scale, 0x1e293b);
    g.drawPolygon([
      cx - 3 * scale, cy + 2 * scale,
      cx - 1 * scale, cy - 2 * scale,
      cx + 2 * scale, cy - 1.5 * scale,
      cx + 3 * scale, cy + 2 * scale
    ]);
    g.endFill();
  }
}

function BoardCanvas() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const gameState = useGameStore((state) => state.gameState);
  const socket = useGameStore((state) => state.socket);
  const buildSettlement = useGameStore((state) => state.buildSettlement);
  const buildCity = useGameStore((state) => state.buildCity);
  const buildRoad = useGameStore((state) => state.buildRoad);
  const moveRobber = useGameStore((state) => state.moveRobber);
  // Expansion placement (ships, knights, merchant, progress-card board targets)
  const placementMode = useGameStore((state) => state.placementMode);
  const setPlacementMode = useGameStore((state) => state.setPlacementMode);
  const clearPlacementMode = useGameStore((state) => state.clearPlacementMode);
  const buildShip = useGameStore((state) => state.buildShip);
  const moveShip = useGameStore((state) => state.moveShip);
  const buildKnight = useGameStore((state) => state.buildKnight);
  const moveKnight = useGameStore((state) => state.moveKnight);
  const playProgressCard = useGameStore((state) => state.playProgressCard);

  // local state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredV, setHoveredV] = useState(null);
  const [hoveredE, setHoveredE] = useState(null);
  const [hoveredH, setHoveredH] = useState(null);
  const [stealTargets, setStealTargets] = useState(null);

  const pixiAppRef = useRef(null);
  const graphicsRef = useRef(null);
  const textsRef = useRef([]);

  // Fit-to-view hex scale derived from the board's extent, so any map size
  // (19-hex classic, 60+-hex seafarers scenarios, big boards) renders inside
  // the viewport. The board is centred on (0,0). REF is the half-extent that
  // maps to scale 1.0 (tuned so the standard 19-hex board ~= 1.0, matching the
  // old seafarers 42/60 for a radius-3 board).
  const boardScale = useMemo(() => {
    const hexes = gameState?.board?.hexes;
    if (!hexes || !hexes.length) return 1.0;
    let ext = 1;
    for (const h of hexes) ext = Math.max(ext, Math.abs(h.x), Math.abs(h.y));
    const REF = 210;
    return Math.max(0.3, Math.min(1.0, REF / ext));
  }, [gameState?.board]);

  // Variables for dragging
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);

  // --- Animation System ---
  const activeAnimationsRef = useRef([]);
  const drawBoardRef = useRef(null);

  const gameStateRef = useRef(gameState);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const hoveredVRef = useRef(hoveredV);
  const hoveredERef = useRef(hoveredE);
  const hoveredHRef = useRef(hoveredH);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { hoveredVRef.current = hoveredV; }, [hoveredV]);
  useEffect(() => { hoveredERef.current = hoveredE; }, [hoveredE]);
  useEffect(() => { hoveredHRef.current = hoveredH; }, [hoveredH]);

  const prevDiceRolledRef = useRef(false);

  // Slide the robber / pirate smoothly between hexes instead of teleporting.
  const prevRobberRef = useRef(null);
  const prevPirateRef = useRef(null);
  useEffect(() => {
    if (!gameState) return;
    const hexes = gameState.board.hexes;
    const reduced = prefersReducedMotion();
    const pushSlide = (prevRef, cur) => {
      const prev = prevRef.current;
      if (!reduced && cur && prev && (prev.q !== cur.q || prev.r !== cur.r)) {
        const from = hexes.find((h) => h.q === prev.q && h.r === prev.r);
        const to = hexes.find((h) => h.q === cur.q && h.r === cur.r);
        if (from && to) {
          activeAnimationsRef.current.push({
            type: 'token_slide', toQ: cur.q, toR: cur.r,
            fromX: from.x, fromY: from.y, toX: to.x, toY: to.y,
            startTime: Date.now(), duration: 450,
          });
        }
      }
      prevRef.current = cur ? { q: cur.q, r: cur.r } : null;
    };
    pushSlide(prevRobberRef, gameState.robberHex);
    pushSlide(prevPirateRef, gameState.pirateHex);
  }, [gameState?.robberHex, gameState?.pirateHex]);

  // Flash an expanding ring when a piece (settlement/city/road/ship) appears.
  const prevPiecesRef = useRef(null);
  useEffect(() => {
    if (!gameState) return;
    const B = gameState.board;
    const keys = new Set();
    const posOf = {};
    B.vertices.forEach((v) => {
      if (v.owner != null && v.building) { const k = `v${v.id}:${v.building}`; keys.add(k); posOf[k] = { x: v.x, y: v.y }; }
    });
    B.edges.forEach((e) => {
      if (e.owner != null) {
        const v1 = B.vertices[e.v1], v2 = B.vertices[e.v2];
        if (v1 && v2) { const k = `e${e.id}`; keys.add(k); posOf[k] = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 }; }
      }
    });
    const prev = prevPiecesRef.current;
    if (prev && !prefersReducedMotion()) {
      keys.forEach((k) => {
        if (!prev.has(k) && posOf[k]) {
          activeAnimationsRef.current.push({ type: 'place_pop', x: posOf[k].x, y: posOf[k].y, startTime: Date.now(), duration: 480 });
        }
      });
    }
    prevPiecesRef.current = keys;
  }, [gameState?.board]);

  useEffect(() => {
    if (!gameState) return;
    const prevDiceRolled = prevDiceRolledRef.current;
    const currentDiceRolled = gameState.diceRolled;
    const lastRoll = gameState.lastDiceRoll;

    if (!prevDiceRolled && currentDiceRolled && lastRoll && (lastRoll[0] + lastRoll[1] !== 7) && !prefersReducedMotion()) {
      const roll = lastRoll[0] + lastRoll[1];
      const scale = boardScale;
      
      gameState.board.hexes.forEach((hex) => {
        if (hex.number === roll && hex.resource !== 'desert' && hex.resource !== 'water') {
          const isBlockedByRobber = gameState.robberHex && gameState.robberHex.q === hex.q && gameState.robberHex.r === hex.r;
          if (isBlockedByRobber) return;

          // Hex Press Down
          activeAnimationsRef.current.push({
            type: 'hex_press',
            q: hex.q,
            r: hex.r,
            startTime: Date.now(),
            duration: 600
          });

          // Staggered flying cards
          let staggerDelay = 0;
          hex.vertices.forEach((vId) => {
            const v = gameState.board.vertices[vId];
            if (v && v.owner !== null) {
              const ownerSlot = gameState.slots[v.owner];
              if (ownerSlot && ownerSlot.type !== 'empty') {
                const cardCount = v.building === 'city' ? 2 : 1;
                for (let c = 0; c < cardCount; c++) {
                  activeAnimationsRef.current.push({
                    type: 'flying_card',
                    resource: hex.resource,
                    start: { x: hex.x, y: hex.y },
                    ownerIndex: ownerSlot.index,
                    isMe: ownerSlot.id === socket.id,
                    startTime: Date.now() + staggerDelay,
                    duration: 850,
                    pixiText: null
                  });
                  staggerDelay += 150;
                }
              }
            }
          });
        }
      });
    }
    prevDiceRolledRef.current = currentDiceRolled;
  }, [gameState?.diceRolled, gameState?.lastDiceRoll]);

  useEffect(() => {
    // Initialize Pixi application
    const app = new PIXI.Application({
      resizeTo: containerRef.current,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundAlpha: 0,
      view: canvasRef.current,
    });
    pixiAppRef.current = app;

    const mainGraphics = new PIXI.Graphics();
    app.stage.addChild(mainGraphics);
    graphicsRef.current = mainGraphics;

    // Continuous tick handler for animations
    const handleTick = () => {
      const activeAnims = activeAnimationsRef.current;
      if (activeAnims.length > 0) {
        const now = Date.now();
        activeAnimationsRef.current = activeAnims.filter((anim) => {
          const progress = (now - anim.startTime) / anim.duration;
          if (progress >= 1.0) {
            if (anim.pixiText) {
              app.stage.removeChild(anim.pixiText);
              anim.pixiText.destroy();
            }
            return false;
          }
          return true;
        });

        if (drawBoardRef.current) {
          drawBoardRef.current();
        }
      }
    };
    app.ticker.add(handleTick);

    // Resize handler
    const handleResize = () => {
      app.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      app.ticker.remove(handleTick);
      
      activeAnimationsRef.current.forEach(anim => {
        if (anim.pixiText) {
          try {
            app.stage.removeChild(anim.pixiText);
            anim.pixiText.destroy();
          } catch(e) {}
        }
      });
      activeAnimationsRef.current = [];

      app.destroy(false, { children: true });
    };
  }, []);

  // Compute game coordinates from screen coordinates
  const screenToGame = (screenX, screenY) => {
    if (!pixiAppRef.current) return { x: 0, y: 0 };
    const width = pixiAppRef.current.screen.width;
    const height = pixiAppRef.current.screen.height;

    const mx = screenX - width / 2;
    const my = screenY - height / 2;

    return {
      x: mx / zoom - pan.x,
      y: my / zoom - pan.y,
    };
  };

  // Helper validation functions (Client-side checks matching server logic)
  const me = gameState?.slots.find((s) => s.id === socket.id);
  const activePlayer = gameState?.slots[gameState.currentPlayerIndex];
  const isMyTurn = activePlayer && activePlayer.id === socket.id;

  const settlementsCount = me ? gameState.board.vertices.filter(v => v.owner === me.index && v.building === 'settlement').length : 0;
  const citiesCount = me ? gameState.board.vertices.filter(v => v.owner === me.index && v.building === 'city').length : 0;
  const roadsCount = me ? gameState.board.edges.filter(e => e.owner === me.index).length : 0;

  const hasResourcesForSettlement = (player) => {
    if (settlementsCount >= 5) return false;
    const r = player.resources;
    return r.wood >= 1 && r.brick >= 1 && r.sheep >= 1 && r.wheat >= 1;
  };
  const hasResourcesForRoad = (player) => {
    if (roadsCount >= 15) return false;
    const r = player.resources;
    return r.wood >= 1 && r.brick >= 1;
  };
  const hasResourcesForCity = (player) => {
    if (citiesCount >= 4) return false;
    const r = player.resources;
    return r.ore >= 3 && r.wheat >= 2;
  };

  const getAdjacentVertices = (vId) => {
    if (!gameState) return [];
    const adj = [];
    for (let e of gameState.board.edges) {
      if (e.v1 === vId) adj.push(e.v2);
      else if (e.v2 === vId) adj.push(e.v1);
    }
    return adj;
  };

  // A settlement/city must touch at least one land hex (coast or inland).
  // On classic boards every hex is land so this is always true.
  const vertexTouchesLand = (vId) =>
    gameState.board.hexes.some((h) => h.resource !== 'water' && h.vertices.includes(vId));

  const isValidSettlementVertex = (vId) => {
    if (!gameState || !me) return false;
    const v = gameState.board.vertices[vId];
    if (v.owner !== null) return false;
    if (!vertexTouchesLand(vId)) return false;

    // Distance rule
    const adj = getAdjacentVertices(vId);
    for (let adjId of adj) {
      if (gameState.board.vertices[adjId].owner !== null) return false;
    }

    if (gameState.gameState === 'setup') {
      return true;
    } else if (gameState.gameState === 'playing' && gameState.diceRolled) {
      // Must connect to player road
      return gameState.board.edges.some(
        (e) => (e.v1 === vId || e.v2 === vId) && e.owner === me.index
      );
    }
    return false;
  };

  const isValidSetupRoad = (edge) => {
    if (!gameState || !me) return false;
    if (!edge.land) return false; // roads only on land/coastal edges (seafarers)
    return edge.v1 === gameState.lastSetupSettlement || edge.v2 === gameState.lastSetupSettlement;
  };

  const isValidGameplayRoad = (edge) => {
    if (!gameState || !me) return false;
    if (edge.owner !== null) return false;
    if (!edge.land) return false; // roads only on land/coastal edges (seafarers)

    let connected = false;
    if (gameState.board.vertices[edge.v1].owner === me.index || gameState.board.vertices[edge.v2].owner === me.index) {
      connected = true;
    }
    if (!connected) {
      connected = gameState.board.edges.some(
        (e) => e.id !== edge.id && e.owner === me.index && (e.v1 === edge.v1 || e.v1 === edge.v2 || e.v2 === edge.v1 || e.v2 === edge.v2)
      );
    }
    return connected;
  };

  // Distance to segment helper
  const getDistanceToSegment = (px, py, x1, y1, x2, y2) => {
    const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  };

  // Rendering Loop
  const drawBoard = () => {
    if (!gameState || !pixiAppRef.current || !graphicsRef.current) return;

    const g = graphicsRef.current;
    g.clear();

    // Clear old text child objects
    textsRef.current.forEach((t) => pixiAppRef.current.stage.removeChild(t));
    textsRef.current = [];

    const scale = boardScale;
    const R = 60 * scale;

    const width = pixiAppRef.current.screen.width;
    const height = pixiAppRef.current.screen.height;

    // Apply translations in graphics context
    g.position.set(width / 2, height / 2);
    g.scale.set(zoom, zoom);
    g.pivot.set(-pan.x, -pan.y);

    // Draw a continuous outer coastline sandy beach outline around the landmass
    const landSegments = [];
    gameState.board.hexes.forEach((hex) => {
      if (hex.resource === 'water') return;
      for (let i = 0; i < 6; i++) {
        const v1 = hex.vertices[i];
        const v2 = hex.vertices[(i + 1) % 6];
        const key = `${Math.min(v1, v2)}-${Math.max(v1, v2)}`;
        landSegments.push({ key, v1, v2 });
      }
    });

    const segmentCounts = {};
    landSegments.forEach((seg) => {
      segmentCounts[seg.key] = (segmentCounts[seg.key] || 0) + 1;
    });

    const boundarySegments = landSegments.filter((seg) => segmentCounts[seg.key] === 1);

    const adjMap = new Map();
    boundarySegments.forEach((seg) => {
      if (!adjMap.has(seg.v1)) adjMap.set(seg.v1, []);
      if (!adjMap.has(seg.v2)) adjMap.set(seg.v2, []);
      adjMap.get(seg.v1).push(seg.v2);
      adjMap.get(seg.v2).push(seg.v1);
    });

    const visited = new Set();
    const loops = [];

    for (const [startVertex, neighbors] of adjMap.entries()) {
      if (visited.has(startVertex)) continue;

      const loop = [startVertex];
      visited.add(startVertex);

      let current = neighbors[0];
      let prev = startVertex;

      while (current !== undefined && current !== startVertex) {
        loop.push(current);
        visited.add(current);

        const nextNeighbors = adjMap.get(current) || [];
        const next = nextNeighbors.find((n) => n !== prev);
        prev = current;
        current = next;
      }

      loops.push(loop);
    }

    const drawBeachLoops = (width, color, alpha) => {
      g.lineStyle(width, color, alpha);
      loops.forEach((loop) => {
        if (loop.length < 2) return;
        const startV = gameState.board.vertices[loop[0]];
        if (!startV) return;
        g.moveTo(startV.x * scale, startV.y * scale);
        for (let i = 1; i < loop.length; i++) {
          const v = gameState.board.vertices[loop[i]];
          if (v) g.lineTo(v.x * scale, v.y * scale);
        }
        g.closePath();
      });
    };

    // draw 2D ocean refinements (compass rose, background waves, sailing ships)
    drawOceanRefinements(g, scale);

    // 0. Draw soft feathered shadow of the entire island (floats over ocean)
    g.lineStyle(16 * scale, 0x030712, 0.15);
    g.beginFill(0x030712, 0.32);
    loops.forEach((loop) => {
      if (loop.length < 2) return;
      const startV = gameState.board.vertices[loop[0]];
      if (!startV) return;
      const shX = 8 * scale;
      const shY = 12 * scale;
      g.moveTo(startV.x * scale + shX, startV.y * scale + shY);
      for (let i = 1; i < loop.length; i++) {
        const v = gameState.board.vertices[loop[i]];
        if (v) g.lineTo(v.x * scale + shX, v.y * scale + shY);
      }
      g.closePath();
    });
    g.endFill();
    g.lineStyle(0);

    drawBeachLoops(32 * scale, 0xe8d4a2, 0.3); // Outer sand glow
    drawBeachLoops(18 * scale, 0xe8d4a2, 0.6); // Middle sand layer
    drawBeachLoops(8 * scale, 0xdfc88b, 1.0);  // Inner solid beach
    g.lineStyle(0);

    // Get rolled dice sum to highlight active tiles. Only dim non-producing
    // hexes *briefly* while the post-roll animation is playing — otherwise the
    // board would stay dimmed for the whole turn, and a 7 (which matches no hex)
    // would darken the entire board.
    const rollSum = (gameState.diceRolled && gameState.lastDiceRoll) ? (gameState.lastDiceRoll[0] + gameState.lastDiceRoll[1]) : null;
    const rollAnimating = activeAnimationsRef.current.some((a) => a.type === 'hex_press');
    const lastRoll = (rollAnimating && rollSum !== 7) ? rollSum : null;

    // 1. Draw Hexes
    gameState.board.hexes.forEach((hex) => {
      let fill = 0x000000;
      let alpha = 1.0;
      switch (hex.resource) {
        case 'wood': fill = 0x2d5a27; break; // Forest green
        case 'brick': fill = 0xb84a39; break; // Terracotta clay
        case 'sheep': fill = 0x88c464; break; // Bright pasture green
        case 'wheat': fill = 0xe5b63d; break; // Golden fields
        case 'ore': fill = 0x64748b; break; // Volcanic slate gray
        case 'gold': fill = 0xf4c430; break; // Gold field (Seafarers)
        case 'desert': fill = 0xddb07e; break; // Sandy beige
        case 'water': 
          fill = 0x0f5c7a; // matches 2D ocean theme
          alpha = 0.75; // slightly opaque
          break; 
      }

      // Check for active hex press animation
      let scaleFactor = 1.0;
      let yShift = 0;
      const hexPress = activeAnimationsRef.current.find(
        (a) => a.type === 'hex_press' && a.q === hex.q && a.r === hex.r
      );
      if (hexPress) {
        const t = Math.max(0, Math.min(1, (Date.now() - hexPress.startTime) / hexPress.duration));
        const bounce = Math.sin(t * Math.PI);
        scaleFactor = 1.0 - 0.08 * bounce;
        yShift = 5 * scale * bounce;
      }

      // Check if this hex should be muted (dimmed) because it's not the rolled number
      const isBlockedByRobber = gameState.robberHex && gameState.robberHex.q === hex.q && gameState.robberHex.r === hex.r;
      const isMuted = (hex.resource !== 'water' && lastRoll !== null && (hex.number !== lastRoll || isBlockedByRobber));
      const fillAlpha = isMuted ? 0.45 : alpha;

      if (hex.resource !== 'water') {
        g.beginFill(fill, fillAlpha);
        g.lineStyle(2.5 * scale, 0xebdca5); // Sandy interlocking borders
      } else {
        g.beginFill(fill, fillAlpha);
        g.lineStyle(1.5 * scale, 0x38bdf8, 0.25); // soft blue border
      }

      const hexX = hex.x * scale;
      const hexY = hex.y * scale;

      for (let i = 0; i < 6; i++) {
        const theta = (Math.PI / 6) + (i * Math.PI / 3);
        const vx = hexX + R * scaleFactor * Math.cos(theta);
        const vy = hexY + yShift + R * scaleFactor * Math.sin(theta);
        if (i === 0) g.moveTo(vx, vy);
        else g.lineTo(vx, vy);
      }
      g.closePath();
      g.endFill();

      // Highlight active hexes that match the roll and are not blocked by Robber
      if (lastRoll !== null && hex.number === lastRoll && hex.resource !== 'water' && !isBlockedByRobber) {
        g.lineStyle(4 * scale, 0xeab308, 0.85); // glowing gold border
        for (let i = 0; i < 6; i++) {
          const theta = (Math.PI / 6) + (i * Math.PI / 3);
          const vx = hexX + (R + 1.2 * scale) * scaleFactor * Math.cos(theta);
          const vy = hexY + yShift + (R + 1.2 * scale) * scaleFactor * Math.sin(theta);
          if (i === 0) g.moveTo(vx, vy);
          else g.lineTo(vx, vy);
        }
        g.closePath();
      }

      // Draw detail vector models inside the land hexes (and textures for all)
      drawHexBackgroundTexture(g, hex.resource, hexX, hexY + yShift, R * scaleFactor, scale * scaleFactor, isMuted);
      drawHexDetails(g, hex.resource, hexX, hexY + yShift, scale * scaleFactor, isMuted);

      // Draw Number Tokens (Chits)
      if (hex.number !== null) {
        const tokenAlpha = isMuted ? 0.35 : 1.0;

        // Chit Drop Shadow
        g.beginFill(0x020617, 0.25 * tokenAlpha);
        g.lineStyle(0);
        g.drawCircle(hexX + 1.5 * scale, hexY + yShift + 2.5 * scale, 17 * scale * scaleFactor);
        g.endFill();

        // Wooden Token backing circle
        g.beginFill(0xe5c298, tokenAlpha); // light wood color
        g.lineStyle(2 * scale, 0x4a2c11, tokenAlpha); // dark brown wood grain border
        g.drawCircle(hexX, hexY + yShift, 17 * scale * scaleFactor);
        g.endFill();

        // Inner highlight ring
        g.lineStyle(0.8 * scale, 0x8a5a36, 0.4 * tokenAlpha);
        g.drawCircle(hexX, hexY + yShift, 13 * scale * scaleFactor);

        // Value text
        const isRed = hex.number === 6 || hex.number === 8;
        const textStyle = new PIXI.TextStyle({
          fontFamily: 'Outfit',
          fontSize: Math.round(13 * scale * zoom * scaleFactor),
          fontWeight: 'bold',
          fill: isRed ? '#e11d48' : '#1e293b', // bold red vs black/dark-slate
        });

        const numText = new PIXI.Text(hex.number.toString(), textStyle);
        numText.resolution = window.devicePixelRatio || 1; // crisp on retina (Text defaults to res 1)
        numText.anchor.set(0.5);
        numText.alpha = tokenAlpha;
        const stageX = width / 2 + (hexX + pan.x) * zoom;
        const stageY = height / 2 + (hexY + yShift + pan.y - 2.5 * scale * scaleFactor) * zoom; // center the number slightly higher to make room for dots
        numText.position.set(stageX, stageY);
        pixiAppRef.current.stage.addChild(numText);
        textsRef.current.push(numText);

        // Draw probability dots below the number
        const dotsCount = 6 - Math.abs(7 - hex.number);
        const dotSpacing = 4.5 * scale;
        const startDotX = hexX - ((dotsCount - 1) * dotSpacing * scaleFactor) / 2;
        const dotY = hexY + yShift + 8 * scale * scaleFactor;

        g.lineStyle(0);
        g.beginFill(isRed ? 0xe11d48 : 0x1e293b, tokenAlpha); // match red vs black/dark-slate
        for (let d = 0; d < dotsCount; d++) {
          g.drawCircle(startDotX + d * dotSpacing * scaleFactor, dotY, 1.8 * scale * scaleFactor);
        }
        g.endFill();
      }
    });

    // 1.5. Draw Ports
    const ports = gameState.board.ports || [];
    ports.forEach((port) => {
      if (!port.vertices || port.vertices.length < 2) return;
      const v1 = gameState.board.vertices[port.vertices[0]];
      const v2 = gameState.board.vertices[port.vertices[1]];
      if (!v1 || !v2) return;

      const landHex = gameState.board.hexes.find(h => 
        h.resource !== 'water' && 
        h.vertices.includes(port.vertices[0]) && 
        h.vertices.includes(port.vertices[1])
      );
      if (!landHex) return;

      const hexX = landHex.x * scale;
      const hexY = landHex.y * scale;
      const midX = ((v1.x + v2.x) / 2) * scale;
      const midY = ((v1.y + v2.y) / 2) * scale;

      const dx = midX - hexX;
      const dy = midY - hexY;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      // Project port outward from the edge midpoint
      const portX = midX + ux * 28 * scale;
      const portY = midY + uy * 28 * scale;

      // Draw connection lines to vertices (styled as dark wood plank docks)
      const perpX = -uy;
      const perpY = ux;
      const offset = 2.5 * scale;
      
      g.lineStyle(1.8 * scale, 0x4a2c11);
      // Left rail
      g.moveTo(portX + perpX * offset, portY + perpY * offset);
      g.lineTo(v1.x * scale, v1.y * scale);
      // Right rail
      g.moveTo(portX - perpX * offset, portY - perpY * offset);
      g.lineTo(v2.x * scale, v2.y * scale);

      // Plank crossbars
      for (let t = 0.25; t <= 0.75; t += 0.25) {
        const px1 = portX * t + v1.x * scale * (1 - t);
        const py1 = portY * t + v1.y * scale * (1 - t);
        const px2 = portX * t + v2.x * scale * (1 - t);
        const py2 = portY * t + v2.y * scale * (1 - t);
        g.lineStyle(2 * scale, 0x5c4033);
        g.moveTo(px1, py1);
        g.lineTo(px2, py2);
      }

      // Draw a small dock anchor node at the end
      g.lineStyle(1.5 * scale, 0x1e293b);
      g.beginFill(0x8b5a2b);
      g.drawRect(portX - 6 * scale, portY - 6 * scale, 12 * scale, 12 * scale);
      g.endFill();

      // Set up boat configuration
      let ratioText = '3:1';
      let isGeneric = true;
      switch (port.type) {
        case 'wood':
        case 'brick':
        case 'sheep':
        case 'wheat':
        case 'ore':
          ratioText = '2:1';
          isGeneric = false;
          break;
        case 'generic':
          ratioText = '3:1';
          isGeneric = true;
          break;
      }

      // Drop Shadow for Port Boat and Sail
      const shX = 2 * scale;
      const shY = 3.5 * scale;

      g.beginFill(0x020617, 0.28);
      g.lineStyle(0);
      g.moveTo(portX - 16 * scale + shX, portY + 4 * scale + shY);
      g.lineTo(portX + 16 * scale + shX, portY + 4 * scale + shY);
      g.lineTo(portX + 22 * scale + shX, portY - 2 * scale + shY);
      g.lineTo(portX - 22 * scale + shX, portY - 2 * scale + shY);
      g.closePath();
      g.endFill();

      g.beginFill(0x020617, 0.18);
      g.moveTo(portX + shX, portY - 26 * scale + shY);
      g.quadraticCurveTo(portX + 16 * scale + shX, portY - 14 * scale + shY, portX + 2 * scale + shX, portY - 4 * scale + shY);
      g.lineTo(portX + shX, portY - 4 * scale + shY);
      g.closePath();
      g.endFill();

      // Draw the wooden boat hull
      g.lineStyle(1.5 * scale, 0x3d2712);
      g.beginFill(0x5c4033); // wooden brown
      g.moveTo(portX - 16 * scale, portY + 4 * scale);
      g.lineTo(portX + 16 * scale, portY + 4 * scale);
      g.lineTo(portX + 22 * scale, portY - 2 * scale);
      g.lineTo(portX - 22 * scale, portY - 2 * scale);
      g.closePath();
      g.endFill();

      // Mast
      g.lineStyle(2 * scale, 0x3d2712);
      g.moveTo(portX, portY - 2 * scale);
      g.lineTo(portX, portY - 26 * scale);

      // White Sail (curved triangle to the right)
      g.lineStyle(1.5 * scale, 0xcbd5e1);
      g.beginFill(0xffffff);
      g.moveTo(portX, portY - 26 * scale);
      g.quadraticCurveTo(portX + 16 * scale, portY - 14 * scale, portX + 2 * scale, portY - 4 * scale);
      g.lineTo(portX, portY - 4 * scale);
      g.closePath();
      g.endFill();

      // Draw custom vector icon on the sail
      if (!isGeneric) {
        drawPortSailIcon(g, port.type, portX + 6.5 * scale, portY - 15 * scale, scale);
      }

      // Create text overlay on the sail
      const textStyle = new PIXI.TextStyle({
        fontFamily: 'Outfit',
        fontSize: Math.round(8.5 * scale * zoom),
        fontWeight: 'bold',
        fill: '#1e293b',
        align: 'center',
        lineHeight: Math.round(9 * scale * zoom)
      });

      const labelTextStr = isGeneric ? `?\n${ratioText}` : `\n${ratioText}`;
      const labelText = new PIXI.Text(labelTextStr, textStyle);
      labelText.resolution = window.devicePixelRatio || 1; // crisp on retina
      labelText.anchor.set(0.5);

      const labelYOffset = isGeneric ? -13 * scale : -7 * scale;
      const stageX = width / 2 + (portX + 7 * scale + pan.x) * zoom;
      const stageY = height / 2 + (portY + labelYOffset + pan.y) * zoom;
      labelText.position.set(stageX, stageY);
      pixiAppRef.current.stage.addChild(labelText);
      textsRef.current.push(labelText);
    });

    // 2. Draw Roads & Ships (Edges). Roads are solid colored beams; ships are
    // drawn as a colored plank route with a little boat (hull + sail) at the
    // midpoint so they read clearly differently from roads.
    gameState.board.edges.forEach((edge) => {
      if (edge.owner === null) return;
      const slot = gameState.slots[edge.owner];
      const colorHex = PIXI.utils.string2hex(slot ? slot.color : '#ffffff');
      const v1 = gameState.board.vertices[edge.v1];
      const v2 = gameState.board.vertices[edge.v2];
      const x1 = v1.x * scale, y1 = v1.y * scale, x2 = v2.x * scale, y2 = v2.y * scale;

      if (edge.type === 'ship') {
        // route line: dashed-looking thin colored line with a soft shadow
        g.lineStyle(3 * scale, 0x020617, 0.3);
        g.moveTo(x1 + 1.2 * scale, y1 + 1.8 * scale);
        g.lineTo(x2 + 1.2 * scale, y2 + 1.8 * scale);
        g.lineStyle(3 * scale, colorHex, 0.9);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);

        // little boat at the midpoint
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const s = scale;
        // hull (dark wooden shape)
        g.lineStyle(1.2 * s, 0x0f172a);
        g.beginFill(0x8a5a2b);
        g.drawPolygon([
          mx - 7 * s, my + 1 * s,
          mx + 7 * s, my + 1 * s,
          mx + 4.5 * s, my + 6 * s,
          mx - 4.5 * s, my + 6 * s,
        ]);
        g.endFill();
        // mast
        g.lineStyle(1.2 * s, 0x0f172a);
        g.moveTo(mx, my + 1 * s);
        g.lineTo(mx, my - 9 * s);
        // sail (player colour)
        g.lineStyle(1 * s, 0x0f172a);
        g.beginFill(colorHex);
        g.drawPolygon([
          mx + 0.6 * s, my - 8.5 * s,
          mx + 0.6 * s, my - 0.5 * s,
          mx + 6.5 * s, my - 2.5 * s,
        ]);
        g.endFill();
      } else {
        // road: solid colored beam with tactile drop shadow
        g.lineStyle(5 * scale, 0x020617, 0.35);
        g.moveTo(x1 + 1.2 * scale, y1 + 1.8 * scale);
        g.lineTo(x2 + 1.2 * scale, y2 + 1.8 * scale);
        g.lineStyle(5 * scale, colorHex);
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
    });

    // Per-piece scale-in factor (0 -> 1 with overshoot) from a place_pop anim.
    const piecePop = (px, py) => {
      const anim = activeAnimationsRef.current.find(
        (a) => a.type === 'place_pop' && Math.abs(a.x - px) < 0.6 && Math.abs(a.y - py) < 0.6
      );
      if (!anim) return 1;
      const t = Math.max(0, Math.min(1, (Date.now() - anim.startTime) / anim.duration));
      const c1 = 1.70158, c3 = c1 + 1; // easeOutBack
      return Math.max(0.05, 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2));
    };

    // 3. Draw Settlements & Cities (Vertices) with cast shadows
    gameState.board.vertices.forEach((v) => {
      if (v.owner !== null) {
        const slot = gameState.slots[v.owner];
        const colorHex = PIXI.utils.string2hex(slot ? slot.color : '#ffffff');

        const vx = v.x * scale;
        const vy = v.y * scale;

        // Scale-in "pop" when the piece was just built (easeOutBack overshoot).
        const ps = piecePop(v.x, v.y);
        const sc = scale * ps;

        // shadow offset
        const shX = 1.5 * scale;
        const shY = 2.0 * scale;

        if (v.building === 'city') {
          const points = [
            vx - 8 * sc, vy - 10 * sc,
            vx - 4 * sc, vy - 10 * sc,
            vx - 4 * sc, vy - 4 * sc,
            vx + 4 * sc, vy - 4 * sc,
            vx + 4 * sc, vy - 10 * sc,
            vx + 8 * sc, vy - 10 * sc,
            vx + 8 * sc, vy + 8 * sc,
            vx - 8 * sc, vy + 8 * sc,
          ];
          const shadowPoints = points.map((val, idx) => idx % 2 === 0 ? val + shX : val + shY);

          // Shadow
          g.lineStyle(0);
          g.beginFill(0x0f172a, 0.4);
          g.drawPolygon(shadowPoints);
          g.endFill();

          // Body
          g.lineStyle(2 * scale, 0x0f172a);
          g.beginFill(colorHex);
          g.drawPolygon(points);
          g.endFill();
        } else {
          const points = [
            vx, vy - 9 * sc,
            vx + 8 * sc, vy - 1 * sc,
            vx + 7 * sc, vy - 1 * sc,
            vx + 7 * sc, vy + 7 * sc,
            vx - 7 * sc, vy + 7 * sc,
            vx - 7 * sc, vy - 1 * sc,
            vx - 8 * sc, vy - 1 * sc,
          ];
          const shadowPoints = points.map((val, idx) => idx % 2 === 0 ? val + shX : val + shY);

          // Shadow
          g.lineStyle(0);
          g.beginFill(0x0f172a, 0.4);
          g.drawPolygon(shadowPoints);
          g.endFill();

          // Body
          g.lineStyle(2 * scale, 0x0f172a);
          g.beginFill(colorHex);
          g.drawPolygon(points);
          g.endFill();
        }

        // Metropolis marker (Cities & Knights)
        if (v.metropolis) {
          g.lineStyle(0);
          g.beginFill(0xfacc15, 1);
          g.drawStar(v.x * scale, (v.y - 14) * scale, 5, 5 * scale, 2.4 * scale);
          g.endFill();
        }
      }

      // Knight piece (Cities & Knights) — sits on an empty intersection
      if (v.knight) {
        const kslot = gameState.slots[v.knight.owner];
        const kcolor = PIXI.utils.string2hex(kslot ? kslot.color : '#ffffff');
        const kx = v.x * scale;
        const ky = v.y * scale;
        // shield
        g.lineStyle(2 * scale, v.knight.active ? 0x16a34a : 0x0f172a);
        g.beginFill(kcolor);
        g.drawCircle(kx, ky, 7 * scale);
        g.endFill();
        // level pips
        g.lineStyle(0);
        g.beginFill(0xffffff, 0.95);
        for (let li = 0; li < v.knight.level; li++) {
          g.drawCircle(kx - 3 * scale + li * 3 * scale, ky, 1.1 * scale);
        }
        g.endFill();
      }
    });

    // 4. Placeable Indicators (Glow ring overlays)
    if (isMyTurn && gameState.gameState !== 'gameover') {
      const meColorHex = PIXI.utils.string2hex(me ? me.color : '#3b82f6');
      
      if (gameState.gameState === 'setup') {
        if (gameState.setupSubStep === 'settlement') {
          gameState.board.vertices.forEach((v) => {
            if (isValidSettlementVertex(v.id)) {
              g.lineStyle(0);
              g.beginFill(meColorHex, 0.35);
              g.drawCircle(v.x * scale, v.y * scale, 9 * scale);
              g.endFill();

              g.beginFill(0xffffff, 0.9);
              g.lineStyle(2 * scale, meColorHex);
              g.drawCircle(v.x * scale, v.y * scale, 5 * scale);
              g.endFill();
            }
          });
        } else if (gameState.setupSubStep === 'road') {
          gameState.board.edges.forEach((e) => {
            if (isValidSetupRoad(e) && e.owner === null) {
              const v1 = gameState.board.vertices[e.v1];
              const v2 = gameState.board.vertices[e.v2];
              const cx = ((v1.x + v2.x) / 2) * scale;
              const cy = ((v1.y + v2.y) / 2) * scale;

              g.lineStyle(0);
              g.beginFill(meColorHex, 0.35);
              g.drawCircle(cx, cy, 9 * scale);
              g.endFill();

              g.beginFill(0xffffff, 0.9);
              g.lineStyle(2 * scale, meColorHex);
              g.drawCircle(cx, cy, 5 * scale);
              g.endFill();
            }
          });
        }
      } else if (gameState.gameState === 'roadBuilding') {
        gameState.board.edges.forEach((e) => {
          if (isValidGameplayRoad(e)) {
            const v1 = gameState.board.vertices[e.v1];
            const v2 = gameState.board.vertices[e.v2];
            const cx = ((v1.x + v2.x) / 2) * scale;
            const cy = ((v1.y + v2.y) / 2) * scale;

            g.lineStyle(0);
            g.beginFill(meColorHex, 0.35);
            g.drawCircle(cx, cy, 9 * scale);
            g.endFill();

            g.beginFill(0xffffff, 0.9);
            g.lineStyle(2 * scale, meColorHex);
            g.drawCircle(cx, cy, 5 * scale);
            g.endFill();
          }
        });
      } else if (gameState.gameState === 'playing' && gameState.diceRolled) {
        const hasSettlementRes = hasResourcesForSettlement(me);
        const hasRoadRes = hasResourcesForRoad(me);
        const hasCityRes = hasResourcesForCity(me);

        // Settlements
        if (hasSettlementRes) {
          gameState.board.vertices.forEach((v) => {
            if (isValidSettlementVertex(v.id)) {
              g.lineStyle(0);
              g.beginFill(meColorHex, 0.35);
              g.drawCircle(v.x * scale, v.y * scale, 9 * scale);
              g.endFill();

              g.beginFill(0xffffff, 0.9);
              g.lineStyle(2 * scale, meColorHex);
              g.drawCircle(v.x * scale, v.y * scale, 5 * scale);
              g.endFill();
            }
          });
        }

        // Cities (Upgrades)
        if (hasCityRes) {
          gameState.board.vertices.forEach((v) => {
            if (v.owner === me.index && v.building === 'settlement') {
              g.lineStyle(0);
              g.beginFill(meColorHex, 0.35);
              g.drawCircle(v.x * scale, v.y * scale, 12 * scale);
              g.endFill();

              g.beginFill(0xffffff, 0.6);
              g.lineStyle(2.5 * scale, meColorHex);
              g.drawCircle(v.x * scale, v.y * scale, 8 * scale);
              g.endFill();
            }
          });
        }

        // Roads
        if (hasRoadRes) {
          gameState.board.edges.forEach((e) => {
            if (isValidGameplayRoad(e)) {
              const v1 = gameState.board.vertices[e.v1];
              const v2 = gameState.board.vertices[e.v2];
              const cx = ((v1.x + v2.x) / 2) * scale;
              const cy = ((v1.y + v2.y) / 2) * scale;

              g.lineStyle(0);
              g.beginFill(meColorHex, 0.35);
              g.drawCircle(cx, cy, 9 * scale);
              g.endFill();

              g.beginFill(0xffffff, 0.9);
              g.lineStyle(2 * scale, meColorHex);
              g.drawCircle(cx, cy, 5 * scale);
              g.endFill();
            }
          });
        }
      }
    }

    // Interpolated position for a robber/pirate that is sliding to a hex.
    const slidePos = (qr, hex) => {
      const anim = activeAnimationsRef.current.find(
        (a) => a.type === 'token_slide' && a.toQ === qr.q && a.toR === qr.r
      );
      if (anim) {
        const t = Math.max(0, Math.min(1, (Date.now() - anim.startTime) / anim.duration));
        const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
        return { x: (anim.fromX + (anim.toX - anim.fromX) * e) * scale, y: (anim.fromY + (anim.toY - anim.fromY) * e) * scale };
      }
      return { x: hex.x * scale, y: hex.y * scale };
    };

    // 5. Draw Robber (Polished Boardgame Pawn Silhouette with Golden Collar)
    if (gameState.robberHex) {
      const hex = gameState.board.hexes.find(
        (h) => h.q === gameState.robberHex.q && h.r === gameState.robberHex.r
      );
      if (hex) {
        const rp = slidePos(gameState.robberHex, hex);
        const hexX = rp.x;
        const hexY = rp.y;

        // Shadow
        g.beginFill(0x0f172a, 0.45);
        g.lineStyle(0);
        g.drawCircle(hexX + 2.5 * scale, hexY + 14 * scale, 12 * scale);
        g.endFill();

        // Main Pawn Outline/Fill
        g.beginFill(0x1e293b);
        g.lineStyle(2.0 * scale, 0xf8fafc);
        
        // Head
        g.drawCircle(hexX, hexY - 8 * scale, 7.5 * scale);

        // Body Silhouette Polygon
        const bodyPoints = [
          hexX - 3.5 * scale, hexY - 1 * scale,
          hexX + 3.5 * scale, hexY - 1 * scale,
          hexX + 9 * scale, hexY + 13 * scale,
          hexX + 11 * scale, hexY + 13 * scale,
          hexX + 11 * scale, hexY + 16 * scale,
          hexX - 11 * scale, hexY + 16 * scale,
          hexX - 11 * scale, hexY + 13 * scale,
          hexX - 9 * scale, hexY + 13 * scale,
        ];
        g.drawPolygon(bodyPoints);
        g.endFill();

        // Golden Neck Collar
        g.beginFill(0xeab308);
        g.lineStyle(0.5 * scale, 0x1e293b);
        g.drawRect(hexX - 3.5 * scale, hexY - 2.5 * scale, 7 * scale, 3 * scale);
        g.endFill();
      }
    }

    // 5b. Draw Pirate (Seafarers) — a dark ship token on a sea hex
    if (gameState.pirateHex) {
      const hex = gameState.board.hexes.find(
        (h) => h.q === gameState.pirateHex.q && h.r === gameState.pirateHex.r
      );
      if (hex) {
        const pp = slidePos(gameState.pirateHex, hex);
        const px = pp.x;
        const py = pp.y;
        g.beginFill(0x0f172a, 0.4); g.lineStyle(0);
        g.drawEllipse(px + 2 * scale, py + 12 * scale, 13 * scale, 4 * scale); g.endFill();
        // hull
        g.beginFill(0x1e293b); g.lineStyle(2 * scale, 0xf8fafc);
        g.drawPolygon([px - 12 * scale, py + 4 * scale, px + 12 * scale, py + 4 * scale, px + 8 * scale, py + 11 * scale, px - 8 * scale, py + 11 * scale]);
        g.endFill();
        // mast + sail
        g.lineStyle(2 * scale, 0xf8fafc); g.moveTo(px, py + 4 * scale); g.lineTo(px, py - 12 * scale);
        g.beginFill(0x334155); g.lineStyle(1.5 * scale, 0xf8fafc);
        g.drawPolygon([px, py - 11 * scale, px + 9 * scale, py - 2 * scale, px, py - 2 * scale]); g.endFill();
      }
    }

    // 6. Previews & Pre-hovers (Ghost placement)
    if (isMyTurn && gameState.gameState !== 'gameover') {
      const meColorHex = PIXI.utils.string2hex(me ? me.color : '#3b82f6');
      if (hoveredV) {
        g.beginFill(meColorHex, 0.5);
        g.lineStyle(1, 0x000000);
        g.drawCircle(hoveredV.x * scale, hoveredV.y * scale, 6 * scale);
        g.endFill();
      }
      if (hoveredE) {
        const v1 = gameState.board.vertices[hoveredE.v1];
        const v2 = gameState.board.vertices[hoveredE.v2];
        g.lineStyle(4 * scale, meColorHex, 0.5);
        g.moveTo(v1.x * scale, v1.y * scale);
        g.lineTo(v2.x * scale, v2.y * scale);
      }
      if (hoveredH) {
        g.beginFill(0xffffff, 0.25);
        g.lineStyle(3 * scale, meColorHex);
        g.drawCircle(hoveredH.x * scale, hoveredH.y * scale, 45 * scale);
        g.endFill();
      }
    }

    // 6b. Placement pop — expanding ring when a piece is built.
    activeAnimationsRef.current.forEach((anim) => {
      if (anim.type !== 'place_pop') return;
      const t = Math.max(0, Math.min(1, (Date.now() - anim.startTime) / anim.duration));
      const e = 1 - Math.pow(1 - t, 2);
      const cx = anim.x * scale;
      const cy = anim.y * scale;
      const radius = (5 + 24 * e) * scale;
      g.lineStyle(3.2 * scale * (1 - t), 0xffffff, 0.85 * (1 - t));
      g.drawCircle(cx, cy, radius);
      g.lineStyle(1.6 * scale * (1 - t), 0xeab308, 0.7 * (1 - t));
      g.drawCircle(cx, cy, radius * 0.62);
    });

    // 7. Draw Flying Cards
    activeAnimationsRef.current.forEach((anim) => {
        if (anim.type !== 'flying_card') return;
        const now = Date.now();
        if (now < anim.startTime) return;
        
        const t = Math.max(0, Math.min(1, (now - anim.startTime) / anim.duration));
        
        const startX = anim.start.x * scale;
        const startY = anim.start.y * scale;
        
        let destX = -pan.x;
        let destY = (height / 2) / zoom - pan.y - 120;
        
        if (!anim.isMe) {
          destX = (width / 2) / zoom - pan.x - 120 - anim.ownerIndex * 65;
          destY = -(height / 2) / zoom - pan.y + 40;
        }
        
        const cx = startX * (1 - t) + destX * t;
        const arcHeight = -100 * scale * Math.sin(t * Math.PI);
        const cy = startY * (1 - t) + destY * t + arcHeight;
        
        drawFlyingCard(g, cx, cy, anim.resource, t, scale);
        
        let emoji = '🌲';
        switch (anim.resource) {
          case 'wood': emoji = '🌲'; break;
          case 'brick': emoji = '🧱'; break;
          case 'sheep': emoji = '🐑'; break;
          case 'wheat': emoji = '🌾'; break;
          case 'ore': emoji = '⛰️'; break;
        }
        
        if (!anim.pixiText) {
          const textStyle = new PIXI.TextStyle({
            fontFamily: 'Outfit',
            fontSize: Math.round(14 * scale * zoom),
            fontWeight: 'bold',
            fill: '#ffffff',
          });
          anim.pixiText = new PIXI.Text(emoji, textStyle);
          anim.pixiText.resolution = window.devicePixelRatio || 1; // crisp on retina
          anim.pixiText.anchor.set(0.5);
          pixiAppRef.current.stage.addChild(anim.pixiText);
        }
        
        const stageX = width / 2 + (cx + pan.x) * zoom;
        const stageY = height / 2 + (cy + pan.y) * zoom;
        anim.pixiText.position.set(stageX, stageY);
        anim.pixiText.scale.set(zoom * (1.0 + 0.25 * Math.sin(t * Math.PI)));
      });
    };

    useEffect(() => {
      drawBoardRef.current = drawBoard;
    }, [drawBoard]);

    useEffect(() => {
      drawBoard();
    }, [gameState, zoom, pan, hoveredV, hoveredE, hoveredH]);

  // Handle zooming
  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom *= zoomFactor;
    } else {
      newZoom /= zoomFactor;
    }
    setZoom(Math.min(Math.max(newZoom, 0.5), 3.0));
  };

  // Mouse Down
  const handleMouseDown = (e) => {
    isDragging.current = true;
    hasMovedRef.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panStart.current = { ...pan };
  };

  // Mouse Move
  const handleMouseMove = (e) => {
    if (!gameState) return;

    if (isDragging.current) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.hypot(dx, dy) > 2) {
        hasMovedRef.current = true;
      }
      setPan({
        x: panStart.current.x + dx / zoom,
        y: panStart.current.y + dy / zoom,
      });
      return;
    }

    // Find hover elements
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * canvasRef.current.width / (window.devicePixelRatio || 1);
    const my = ((e.clientY - rect.top) / rect.height) * canvasRef.current.height / (window.devicePixelRatio || 1);

    const gameCoords = screenToGame(mx, my);

    const scale = boardScale;

    let foundV = null;
    let foundE = null;
    let foundH = null;

    if (isMyTurn && gameState.gameState !== 'gameover') {
      if (placementMode) {
        const pm = placementMode.kind;
        const wantEdge = (pred) => {
          for (let edge of gameState.board.edges) {
            if (!pred(edge)) continue;
            const v1 = gameState.board.vertices[edge.v1];
            const v2 = gameState.board.vertices[edge.v2];
            if (getDistanceToSegment(gameCoords.x, gameCoords.y, v1.x * scale, v1.y * scale, v2.x * scale, v2.y * scale) < 8) { foundE = edge; break; }
          }
        };
        const wantVertex = (pred) => {
          for (let v of gameState.board.vertices) {
            if (pred(v) && Math.hypot(v.x * scale - gameCoords.x, v.y * scale - gameCoords.y) < 14) { foundV = v; break; }
          }
        };
        const wantHex = (pred) => {
          for (let hex of gameState.board.hexes) {
            if (pred(hex) && Math.hypot(hex.x * scale - gameCoords.x, hex.y * scale - gameCoords.y) < 45 * scale) { foundH = hex; break; }
          }
        };
        const card = placementMode.data?.card;
        if (pm === 'ship' || pm === 'moveShipTo') wantEdge((e) => e.owner === null && e.sea);
        else if (pm === 'moveShipFrom') wantEdge((e) => e.owner === me.index && e.type === 'ship');
        else if (pm === 'knight') wantVertex((v) => v.owner === null && !v.knight);
        else if (pm === 'moveKnightFrom') wantVertex((v) => v.knight && v.knight.owner === me.index);
        else if (pm === 'moveKnightTo') wantVertex((v) => v.owner === null && !v.knight);
        else if (pm === 'progressCard' && card === 'Merchant') wantHex((h) => !['water', 'desert', 'gold'].includes(h.resource));
        else if (pm === 'progressCard' && (card === 'Intrigue' || card === 'Deserter')) wantVertex((v) => v.knight && v.knight.owner !== me.index);
        else if (pm === 'progressCard' && card === 'Deserter2') wantVertex((v) => v.owner === null && !v.knight);
        else if (pm === 'progressCard' && card === 'Diplomat') wantEdge((e) => e.owner !== null && e.type !== 'ship');
        else if (pm === 'progressCard' && (card === 'Inventor' || card === 'Inventor2')) wantHex((h) => h.number != null && ![2, 6, 8, 12].includes(h.number));
      } else if (gameState.gameState === 'setup') {
        if (gameState.setupSubStep === 'settlement') {
          for (let v of gameState.board.vertices) {
            if (Math.hypot(v.x * scale - gameCoords.x, v.y * scale - gameCoords.y) < 14) {
              if (isValidSettlementVertex(v.id)) {
                foundV = v;
                break;
              }
            }
          }
        } else if (gameState.setupSubStep === 'road') {
          for (let edge of gameState.board.edges) {
            if (isValidSetupRoad(edge) && edge.owner === null) {
              const v1 = gameState.board.vertices[edge.v1];
              const v2 = gameState.board.vertices[edge.v2];
              const dist = getDistanceToSegment(gameCoords.x, gameCoords.y, v1.x * scale, v1.y * scale, v2.x * scale, v2.y * scale);
              if (dist < 8) {
                foundE = edge;
                break;
              }
            }
          }
        }
      } else if (gameState.gameState === 'roadBuilding') {
        for (let edge of gameState.board.edges) {
          if (isValidGameplayRoad(edge)) {
            const v1 = gameState.board.vertices[edge.v1];
            const v2 = gameState.board.vertices[edge.v2];
            const dist = getDistanceToSegment(gameCoords.x, gameCoords.y, v1.x * scale, v1.y * scale, v2.x * scale, v2.y * scale);
            if (dist < 8) {
              foundE = edge;
              break;
            }
          }
        }
      } else if (gameState.gameState === 'playing' && gameState.diceRolled) {
        const hasSettlementRes = hasResourcesForSettlement(me);
        const hasRoadRes = hasResourcesForRoad(me);
        const hasCityRes = hasResourcesForCity(me);

        // Check City
        if (hasCityRes) {
          for (let v of gameState.board.vertices) {
            if (v.owner === me.index && v.building === 'settlement') {
              if (Math.hypot(v.x * scale - gameCoords.x, v.y * scale - gameCoords.y) < 14) {
                foundV = v;
                break;
              }
            }
          }
        }

        // Check Settlement
        if (!foundV && hasSettlementRes) {
          for (let v of gameState.board.vertices) {
            if (isValidSettlementVertex(v.id)) {
              if (Math.hypot(v.x * scale - gameCoords.x, v.y * scale - gameCoords.y) < 14) {
                foundV = v;
                break;
              }
            }
          }
        }

        // Check Road
        if (!foundV && hasRoadRes) {
          for (let edge of gameState.board.edges) {
            if (isValidGameplayRoad(edge)) {
              const v1 = gameState.board.vertices[edge.v1];
              const v2 = gameState.board.vertices[edge.v2];
              const dist = getDistanceToSegment(gameCoords.x, gameCoords.y, v1.x * scale, v1.y * scale, v2.x * scale, v2.y * scale);
              if (dist < 8) {
                foundE = edge;
                break;
              }
            }
          }
        }
      } else if (gameState.gameState === 'robberMove') {
        for (let hex of gameState.board.hexes) {
          if (hex.resource !== 'water') {
            if (Math.hypot(hex.x * scale - gameCoords.x, hex.y * scale - gameCoords.y) < 45 * scale) {
              if (!(gameState.robberHex && gameState.robberHex.q === hex.q && gameState.robberHex.r === hex.r)) {
                foundH = hex;
                break;
              }
            }
          }
        }
      }
    }

    setHoveredV(foundV);
    setHoveredE(foundE);
    setHoveredH(foundH);
  };

  // Mouse Up
  const handleMouseUp = () => {
    isDragging.current = false;
  };

  // Click handler for placing items
  const handleCanvasClick = () => {
    if (hasMovedRef.current) return;

    // Expansion placement modes take priority over normal clicks.
    if (placementMode) {
      const pm = placementMode.kind;
      const card = placementMode.data?.card;
      if (pm === 'ship' && hoveredE) { buildShip(hoveredE.id); clearPlacementMode(); setHoveredE(null); return; }
      if (pm === 'moveShipFrom' && hoveredE) { setPlacementMode({ kind: 'moveShipTo', data: { from: hoveredE.id } }); setHoveredE(null); return; }
      if (pm === 'moveShipTo' && hoveredE) { moveShip(placementMode.data.from, hoveredE.id); clearPlacementMode(); setHoveredE(null); return; }
      if (pm === 'knight' && hoveredV) { buildKnight(hoveredV.id); clearPlacementMode(); setHoveredV(null); return; }
      if (pm === 'moveKnightFrom' && hoveredV) { setPlacementMode({ kind: 'moveKnightTo', data: { from: hoveredV.id } }); setHoveredV(null); return; }
      if (pm === 'moveKnightTo' && hoveredV) { moveKnight(placementMode.data.from, hoveredV.id); clearPlacementMode(); setHoveredV(null); return; }
      if (pm === 'progressCard') {
        if (card === 'Merchant' && hoveredH) { playProgressCard('Merchant', { q: hoveredH.q, r: hoveredH.r }); clearPlacementMode(); setHoveredH(null); return; }
        if (card === 'Intrigue' && hoveredV) { playProgressCard('Intrigue', { targetVertex: hoveredV.id }); clearPlacementMode(); setHoveredV(null); return; }
        if (card === 'Diplomat' && hoveredE) { playProgressCard('Diplomat', { edge: hoveredE.id }); clearPlacementMode(); setHoveredE(null); return; }
        if (card === 'Deserter' && hoveredV) { setPlacementMode({ kind: 'progressCard', data: { card: 'Deserter2', targetVertex: hoveredV.id } }); setHoveredV(null); return; }
        if (card === 'Deserter2' && hoveredV) { playProgressCard('Deserter', { targetVertex: placementMode.data.targetVertex, placeVertex: hoveredV.id }); clearPlacementMode(); setHoveredV(null); return; }
        if (card === 'Inventor' && hoveredH) { setPlacementMode({ kind: 'progressCard', data: { card: 'Inventor2', hex1: { q: hoveredH.q, r: hoveredH.r } } }); setHoveredH(null); return; }
        if (card === 'Inventor2' && hoveredH) { playProgressCard('Inventor', { hex1: placementMode.data.hex1, hex2: { q: hoveredH.q, r: hoveredH.r } }); clearPlacementMode(); setHoveredH(null); return; }
      }
      return; // swallow the click while in placement mode
    }

    if (gameState?.gameState === 'robberMove' && hoveredH) {
      // Find adjacent opponents who have cards
      const adjacentOpponents = [];
      const hexVertices = hoveredH.vertices || [];
      hexVertices.forEach((vId) => {
        const v = gameState.board.vertices[vId];
        if (v && v.owner !== null && v.owner !== me?.index) {
          const opponent = gameState.slots[v.owner];
          if (opponent && opponent.type !== 'empty') {
            const totalRes = Object.values(opponent.resources).reduce((a, b) => a + b, 0);
            if (totalRes > 0) {
              if (!adjacentOpponents.some((o) => o.index === opponent.index)) {
                adjacentOpponents.push({
                  index: opponent.index,
                  username: opponent.username,
                  color: opponent.color,
                  cardsCount: totalRes,
                });
              }
            }
          }
        }
      });

      if (adjacentOpponents.length > 1) {
        setStealTargets({ q: hoveredH.q, r: hoveredH.r, opponents: adjacentOpponents });
      } else {
        moveRobber(hoveredH.q, hoveredH.r);
        setHoveredH(null);
      }
    } else if (hoveredV) {
      if (hoveredV.owner === me?.index && hoveredV.building === 'settlement') {
        buildCity(hoveredV.id);
      } else {
        buildSettlement(hoveredV.id);
      }
      setHoveredV(null);
    } else if (hoveredE) {
      buildRoad(hoveredE.id);
      setHoveredE(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-default overflow-hidden"
      style={{
        background: "radial-gradient(120% 120% at 50% 22%, #8fc4d4 0%, #5fa0b6 48%, #3d7d94 100%)",
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleCanvasClick}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {stealTargets && (
        <div 
          className="absolute inset-0 bg-black/40 backdrop-blur-sm z-40 flex items-center justify-center p-4 select-none"
          onClick={(e) => {
            e.stopPropagation();
            setStealTargets(null);
          }}
        >
          <div 
            className="bg-white border border-[color:var(--border)] rounded-2xl p-6 max-w-[360px] w-full shadow-[var(--shadow-3)] text-center flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-[color:var(--text)] uppercase tracking-tight">Steal Resource Card</h3>
            <p className="text-xs text-[color:var(--muted)] font-bold">
              The hex has settlements from multiple opponents. Choose who to steal from:
            </p>
            <div className="flex flex-col gap-2 my-2">
              {stealTargets.opponents.map((opp) => (
                <button
                  key={opp.index}
                  onClick={(e) => {
                    e.stopPropagation();
                    socket.emit('moveRobber', { q: stealTargets.q, r: stealTargets.r, targetPlayerIndex: opp.index });
                    setStealTargets(null);
                    setHoveredH(null);
                  }}
                  className="flex items-center justify-between border border-[color:var(--border)] bg-white hover:bg-[color:var(--surface-2)] rounded-xl p-3 active:translate-y-0.5 transition-all text-xs font-black shadow-[var(--shadow-1)] cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 rounded-full border border-[color:var(--border-strong)]" style={{ background: opp.color }} />
                    <span className="text-[color:var(--text)]">{opp.username}</span>
                  </div>
                  <span className="text-[color:var(--muted)]">{opp.cardsCount} cards</span>
                </button>
              ))}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setStealTargets(null);
              }}
              className="py-2.5 bg-[color:var(--surface-2)] border border-[color:var(--border)] font-bold rounded-xl text-xs uppercase shadow-[var(--shadow-1)] active:translate-y-0.5 cursor-pointer"
            >
              Cancel Move
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default BoardCanvas;
