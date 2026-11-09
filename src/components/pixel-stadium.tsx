import { mulberry32 } from "@/lib/simulate";

const W = 320;
const H = 110;
const HORIZON = 62;

const crowdColors = ["#ff5a3c", "#f0c14a", "#f1f7ef", "#3ecf6e", "#8eab96", "#5a7a66", "#234d36", "#123024"];

function scene() {
  const random = mulberry32(1888);
  const stars = Array.from({ length: 34 }, () => ({ x: Math.floor(random() * W), y: Math.floor(random() * 26), big: random() > 0.85 }));
  const crowd: { x: number; y: number; color: string; twinkle: boolean }[] = [];
  for (let row = 0; row < 7; row += 1) {
    const y = 40 + row * 3;
    for (let x = 6 + (row % 2); x < W - 6; x += 2) {
      if (random() > 0.72) continue;
      crowd.push({ x, y, color: crowdColors[Math.floor(random() * crowdColors.length)], twinkle: random() > 0.93 });
    }
  }
  return { stars, crowd };
}

const { stars, crowd } = scene();

function Floodlight({ x, flip }: { x: number; flip?: boolean }) {
  const dir = flip ? -1 : 1;
  return (
    <g>
      <polygon points={`${x + 4},14 ${x + 4 + dir * 120},${HORIZON + 40} ${x + 4 + dir * 30},${HORIZON + 40}`} fill="url(#beam)" opacity="0.55" />
      <rect x={x + 3} y={14} width={2} height={34} fill="#1a3d28" />
      <rect x={x} y={8} width={8} height={6} fill="#1a3d28" />
      {[0, 1, 2].map((col) => [0, 1].map((row) => <rect key={`${col}-${row}`} x={x + 1 + col * 2} y={9 + row * 2} width={1.5} height={1.5} fill="#fff6d0" />))}
      <rect x={x - 3} y={5} width={14} height={12} fill="#f0c14a" opacity="0.14" />
    </g>
  );
}

export function PixelStadium({ className = "" }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`pixelated block w-full ${className}`} shapeRendering="crispEdges" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9a0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f0c14a" stopOpacity="0" />
        </linearGradient>
      </defs>
      {["#06140e", "#071811", "#081c14", "#0a2218", "#0c281c"].map((color, index) => (
        <rect key={color} x={0} y={index * 8} width={W} height={8} fill={color} />
      ))}
      <rect x={0} y={40} width={W} height={HORIZON - 40} fill="#0c281c" />
      {stars.map((star, index) => (
        <rect key={index} x={star.x} y={star.y} width={star.big ? 2 : 1} height={star.big ? 2 : 1} fill="#f1f7ef" opacity={star.big ? 0.8 : 0.4} className={index % 5 === 0 ? "animate-blink" : undefined} style={{ animationDelay: `${(index % 7) * 0.3}s` }} />
      ))}
      <rect x={256} y={10} width={8} height={8} fill="#f0c14a" opacity="0.9" />
      <rect x={258} y={8} width={4} height={12} fill="#f0c14a" opacity="0.9" />
      <rect x={254} y={12} width={12} height={4} fill="#f0c14a" opacity="0.9" />

      <rect x={0} y={36} width={W} height={26} fill="#0e2418" />
      <rect x={0} y={36} width={W} height={2} fill="#234d36" />
      {crowd.map((dot, index) => (
        <rect key={index} x={dot.x} y={dot.y} width={1} height={2} fill={dot.color} opacity={0.92} className={dot.twinkle ? "animate-blink" : undefined} style={dot.twinkle ? { animationDelay: `${(index % 9) * 0.17}s` } : undefined} />
      ))}
      <rect x={0} y={HORIZON - 2} width={W} height={2} fill="#3ecf6e" opacity="0.95" />
      <rect x={40} y={HORIZON - 2} width={60} height={2} fill="#f0c14a" opacity="0.9" />
      <rect x={210} y={HORIZON - 2} width={70} height={2} fill="#ff5a3c" opacity="0.85" />

      <Floodlight x={18} />
      <Floodlight x={W - 26} flip />

      {Array.from({ length: 6 }, (_, index) => {
        const y = HORIZON + [0, 5, 11, 18, 26, 35][index];
        const h = [5, 6, 7, 8, 9, 13][index];
        return <rect key={index} x={0} y={y} width={W} height={h} fill={index % 2 === 0 ? "#0f3b2c" : "#12452f" } />;
      })}
      <rect x={0} y={HORIZON} width={W} height={1} fill="#d7e8d9" opacity="0.55" />
      <rect x={W / 2 - 0.5} y={HORIZON} width={1} height={H - HORIZON} fill="#d7e8d9" opacity="0.45" />
      <ellipse cx={W / 2} cy={HORIZON + 18} rx={18} ry={8} fill="none" stroke="#d7e8d9" strokeWidth="1" opacity="0.4" />
      <rect x={W / 2 - 1} y={HORIZON + 16} width={2} height={2} fill="#f1f7ef" className="animate-bob" />
    </svg>
  );
}
