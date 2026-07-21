import React from 'react';

// Tiny SVG thumbnail of a map's topology (land / water / gold cells).
// `hexes` is the metadata array from /api/maps: [{ q, r, kind }].
const KIND_FILL = {
  water: '#7fb4c6',
  land: '#d8b982',
  gold: '#e9b949',
};
const KIND_STROKE = {
  water: '#5f9aad',
  land: '#b7924f',
  gold: '#c9911f',
};

const R = 9; // px per hex
const SQRT3 = Math.sqrt(3);

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const theta = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(`${(cx + r * Math.cos(theta)).toFixed(1)},${(cy + r * Math.sin(theta)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function MapPreview({ hexes, className, style }) {
  if (!hexes || !hexes.length) return null;

  const cells = hexes.map((h) => ({
    ...h,
    x: R * SQRT3 * (h.q + h.r / 2),
    y: R * 1.5 * h.r,
  }));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  cells.forEach((c) => {
    minX = Math.min(minX, c.x - R);
    maxX = Math.max(maxX, c.x + R);
    minY = Math.min(minY, c.y - R);
    maxY = Math.max(maxY, c.y + R);
  });
  const pad = 2;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;

  return (
    <svg
      className={className}
      style={style}
      viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* water first (background), then land/gold on top */}
      {cells
        .slice()
        .sort((a, b) => (a.kind === 'water' ? -1 : 1) - (b.kind === 'water' ? -1 : 1))
        .map((c, i) => (
          <polygon
            key={i}
            points={hexPoints(c.x, c.y, R - 0.6)}
            fill={KIND_FILL[c.kind] || '#ccc'}
            stroke={KIND_STROKE[c.kind] || '#999'}
            strokeWidth="0.6"
          />
        ))}
    </svg>
  );
}

export default MapPreview;
