"use client";

/**
 * StadiumMap — uses the official loanDepot park seating chart image
 * as the background, with a pulsing SVG highlight overlaid on the
 * correct section. Coordinates are expressed as % of image dimensions.
 *
 * Image must be placed at /public/loandepot-map.jpg
 */

// Section center coordinates as [left%, top%] of the 3300×2100 image.
// Calibrated by pixel-measuring label positions in the official MLB PNG.
const SECTION_COORDS: Record<string, [number, number]> = {
  // ── Lower bowl (1-32) ────────────────────────────────────────
  // First-base side (1-9): measured from crop showing sections 1-6 clearly
  "1":  [47, 13], "2":  [48, 18], "3":  [49, 23], "4":  [50, 27],
  "5":  [51, 31], "6":  [52, 35], "7":  [53, 39], "8":  [54, 43],
  "9":  [55, 47],
  // Curving toward home plate (10-16)
  "10": [54, 51], "11": [53, 55], "12": [52, 59],
  "13": [51, 63], "14": [51, 66], "15": [50, 70], "16": [50, 73],
  // Behind home plate (17-22)
  "17": [50, 76], "18": [50, 79], "19": [50, 82],
  "20": [48, 84], "21": [46, 85], "22": [44, 84],
  // Third-base side (23-32): mirror arc
  "23": [42, 82], "24": [40, 80], "25": [38, 77],
  "26": [36, 73], "27": [34, 68], "28": [31, 62],
  "29": [28, 56], "30": [25, 50], "31": [22, 44], "32": [20, 38],

  // ── Field level (FL) ────────────────────────────────────────
  "FL1": [47, 51], "FL2": [47, 55], "FL3": [47, 58],
  "FL4": [47, 62], "FL5": [47, 65], "FL6": [47, 68],
  "FL7": [47, 72], "FL8": [47, 75], "FL9": [47, 78], "FL10": [47, 81],
  "FL12": [49, 73], "FL13": [50, 76], "FL14": [50, 79],

  // ── Promenade / Club (200s) ──────────────────────────────────
  // First-base side (201-211): measured from crop, x≈48-59%
  "201": [48, 15], "202": [50, 20], "203": [52, 24], "204": [55, 28],
  "205": [57, 32], "206": [58, 36], "207": [59, 40], "208": [59, 44],
  "209": [59, 48], "210": [58, 52], "211": [57, 56],
  // Home plate / third-base side (219-228)
  "219": [54, 79], "220": [52, 83], "221": [50, 86],
  "222": [48, 89], "223": [46, 91], "224": [44, 91],
  "225": [42, 90], "226": [40, 89], "227": [37, 87], "228": [34, 85],

  // ── Vista / Upper (300s) ─────────────────────────────────────
  // First-base side (302-314): measured from crops, x≈52-63%
  "302": [52, 10], "303": [55, 13], "304": [57, 15], "305": [60, 19],
  "306": [62, 24], "307": [63, 30], "308": [63, 36], "309": [63, 42],
  "310": [62, 48], "311": [61, 54], "312": [60, 60], "313": [59, 67],
  "314": [58, 74],
  // Home plate / third-base side (315-327)
  "315": [58, 80], "316": [59, 86], "317": [56, 90], "318": [53, 93],
  "319": [49, 94], "320": [45, 95], "321": [41, 93], "322": [37, 91],
  "323": [33, 89], "324": [29, 87], "325": [25, 85], "326": [21, 82],
  "327": [17, 77],

  // ── Outfield (34-40) ─────────────────────────────────────────
  "34": [21, 20], "35": [24, 19], "36": [28, 18],
  "37": [31, 17], "38": [33, 17], "39": [36, 17], "40": [38, 16],

  // ── Home Run Porch (134-141) ─────────────────────────────────
  "134": [14, 15], "135": [17, 13], "136": [20, 12], "137": [24,  9],
  "138": [27,  8], "139": [30,  7], "140": [33,  7], "141": [37,  7],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCoords(section: string): [number, number] | null {
  const t = normalize(section);
  // Exact key match
  for (const [key, coords] of Object.entries(SECTION_COORDS)) {
    if (normalize(key) === t) return coords;
  }
  // Strip leading "sec" / "section" prefix
  const stripped = t.replace(/^section/, "").replace(/^sec/, "");
  for (const [key, coords] of Object.entries(SECTION_COORDS)) {
    if (normalize(key) === stripped) return coords;
  }
  return null;
}

export default function StadiumMap({ highlightSection }: { highlightSection?: string }) {
  const coords = highlightSection ? findCoords(highlightSection) : null;

  return (
    <div className="relative w-full select-none">
      {/* Official loanDepot park seating chart */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/loandepot-map.png"
        alt="loanDepot park seating chart"
        className="w-full rounded-xl"
        draggable={false}
      />

      {/* Highlight overlay */}
      {coords && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${coords[0]}%`,
            top: `${coords[1]}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          {/* Outer pulsing ring */}
          <div
            className="absolute rounded-full border-2 border-blue-400"
            style={{
              width: 42,
              height: 42,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
              opacity: 0.7,
            }}
          />
          {/* Solid centre dot */}
          <div
            className="relative rounded-full bg-blue-500 border-2 border-white shadow-lg"
            style={{ width: 22, height: 22, opacity: 0.92 }}
          />
        </div>
      )}

      {/* Callout label */}
      {highlightSection && coords && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${coords[0]}%`,
            top: `${coords[1]}%`,
            transform: coords[0] > 55
              ? "translate(16px, -50%)"   // label to the right
              : "translate(calc(-100% - 16px), -50%)",
          }}
        >
          <div className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-lg shadow-lg whitespace-nowrap">
            Section {highlightSection}
          </div>
        </div>
      )}

      {/* Section not found warning */}
      {highlightSection && !coords && (
        <div className="mt-2 text-center text-xs text-yellow-500">
          Section {highlightSection} — location not mapped yet
        </div>
      )}

      {/* Tailwind keyframe for ping (in case not already in global CSS) */}
      <style>{`
        @keyframes ping {
          75%, 100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
