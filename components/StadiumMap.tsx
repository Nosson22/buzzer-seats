"use client";

/**
 * StadiumMap — uses the official loanDepot park seating chart image
 * as the background, with a pulsing SVG highlight overlaid on the
 * correct section. Coordinates are expressed as % of image dimensions.
 *
 * Image must be placed at /public/loandepot-map.jpg
 */

// Section center coordinates as [left%, top%] of the image.
// Estimated from the official MLB seating chart.
const SECTION_COORDS: Record<string, [number, number]> = {
  // ── Lower bowl (1-32) ────────────────────────────────────────
  "1":  [72, 24], "2":  [70, 29], "3":  [67, 34], "4":  [64, 44],
  "5":  [61, 49], "6":  [59, 53], "7":  [57, 57], "8":  [56, 61],
  "9":  [56, 65], "10": [56, 69], "11": [57, 72], "12": [58, 76],
  "13": [59, 77], "14": [59, 80], "15": [58, 83], "16": [57, 85],
  "17": [55, 87], "18": [52, 88], "19": [50, 88], "20": [48, 87],
  "21": [46, 86], "22": [44, 84], "23": [41, 81], "24": [39, 78],
  "25": [37, 75], "26": [35, 71], "27": [33, 67], "28": [32, 63],
  "29": [31, 59], "30": [30, 54], "31": [30, 49], "32": [31, 44],

  // ── Field level (FL) ────────────────────────────────────────
  "FL1": [65, 54], "FL2": [64, 58], "FL3": [64, 62],
  "FL4": [63, 66], "FL5": [63, 70], "FL6": [63, 74],
  "FL7": [62, 78], "FL8": [62, 81],
  "FL9": [57, 80], "FL10": [55, 80], "FL11": [53, 80],
  "FL14": [59, 77], "FL15": [60, 80], "FL16": [60, 83],

  // ── Promenade / Club (200s) ──────────────────────────────────
  "201": [76, 23], "202": [73, 29], "203": [70, 34], "204": [67, 39],
  "205": [64, 44], "206": [61, 49], "207": [59, 54], "208": [58, 59],
  "209": [58, 63], "210": [58, 67], "211": [58, 71],
  "219": [62, 86], "220": [60, 89], "221": [57, 90], "222": [54, 90],
  "223": [51, 90], "224": [47, 90], "225": [44, 89], "226": [41, 87],
  "227": [38, 85], "228": [35, 82],

  // ── Vista / Upper (300s) ─────────────────────────────────────
  "302": [80, 22], "303": [79, 27], "304": [77, 32], "305": [76, 38],
  "306": [74, 43], "307": [72, 49], "308": [70, 55], "309": [69, 61],
  "310": [69, 67], "311": [69, 72], "312": [69, 77], "313": [70, 82],
  "314": [70, 87], "315": [68, 92], "316": [65, 95], "317": [61, 96],
  "318": [57, 97], "319": [53, 97], "320": [49, 95], "321": [44, 93],
  "322": [40, 91], "323": [36, 89], "324": [32, 86], "325": [28, 83],
  "326": [25, 79], "327": [22, 75],

  // ── Outfield (34-40) ─────────────────────────────────────────
  "34": [27, 19], "35": [31, 16], "36": [36, 14],
  "37": [41, 13], "38": [44, 12], "39": [47, 12], "40": [50, 12],

  // ── Home Run Porch (134-141) ─────────────────────────────────
  "134": [17, 22], "135": [22, 17], "136": [27, 14], "137": [31, 12],
  "138": [35, 10], "139": [40, 9],  "140": [44, 9],  "141": [49, 9],
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
