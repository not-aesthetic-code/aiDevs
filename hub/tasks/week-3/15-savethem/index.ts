/**
 * SaveThem Task (S03E15)
 *
 * Plans the optimal route for a messenger to reach the city of Skolwin
 * on a 10×10 terrain grid with 10 fuel and 10 food units.
 *
 * Discovered API structure:
 *   /api/toolsearch  – tool discovery (query = natural language)
 *   /api/maps        – get terrain map (query = city name, e.g. "Skolwin")
 *   /api/wehicles    – vehicle stats  (query = vehicle name)
 *   /api/books       – movement notes (query = topic)
 *
 * Terrain rules (from /api/books):
 *   '.'  – passable, no extra cost
 *   'T'  – passable; powered vehicles pay +0.2 extra fuel
 *   'W'  – water; only non-powered vehicles (horse, walk) OR walk-mode can cross
 *   'R'  – rocks; completely impassable for everyone
 *   'S'  – start marker (treated as passable)
 *   'G'  – goal marker (treated as passable)
 *
 * Vehicle data (from /api/wehicles):
 *   rocket  fuel=1.0 food=0.1  cannot cross water
 *   car     fuel=0.7 food=1.0  cannot cross water
 *   horse   fuel=0.0 food=1.6  can cross water
 *   walk    fuel=0.0 food=2.5  can cross water
 *
 * Dismount rule (from /api/books "vehicle-selection"):
 *   At any time the traveler may dismount and continue on foot.
 *   Walk-mode rates: fuel=0, food=2.5 per move.
 *   "dismount" is a valid step command in the answer array.
 */

import "dotenv/config";
import { HUB_API_KEY, hubVerify } from "../../shared/hub.js";

const TASK = "savethem";
const INITIAL_FUEL = 10;
const INITIAL_FOOD = 10;
const GRID_SIZE = 10;
const SCALE = 10;          // multiply fuel/food by SCALE to keep arithmetic in integers
const WALK_FOOD = 2.5;     // food/move in walk-mode (after dismount)

// ── Types ─────────────────────────────────────────────────────────────────────

type Direction   = "up" | "down" | "left" | "right";
type StepCommand = Direction | "dismount";

interface MapGrid {
  cells:    string[][];
  startRow: number;
  startCol: number;
  goalRow:  number;
  goalCol:  number;
}

interface Vehicle {
  name:           string;
  fuelPerMove:    number;   // base fuel consumed per move
  foodPerMove:    number;   // base food consumed per move
  canCrossWater:  boolean;  // false for rocket/car
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function post<T = unknown>(path: string, query: string): Promise<T> {
  const url = `${process.env.HUB_BASE_URL}${path}`;
  console.log(`[POST] ${path} | "${query}"`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: HUB_API_KEY, query }),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as T;
  console.log(`  → ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchMap(city: string): Promise<MapGrid> {
  const raw = await post<Record<string, unknown>>("/api/maps", city);
  if (raw.code !== 241) throw new Error(`Map error for "${city}": ${raw.message}`);

  const grid = raw.map as string[][];
  let startRow = 0, startCol = 0, goalRow = 0, goalCol = 0;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === "S") { startRow = r; startCol = c; }
      if (grid[r][c] === "G") { goalRow  = r; goalCol  = c; }
    }
  }

  return { cells: grid, startRow, startCol, goalRow, goalCol };
}

async function fetchVehicles(): Promise<Vehicle[]> {
  // Known vehicle names (from the API error message when queried with unknown name)
  const names = ["rocket", "car", "horse", "walk"];
  const vehicles: Vehicle[] = [];

  for (const name of names) {
    const raw = await post<Record<string, unknown>>("/api/wehicles", name);
    if (raw.code !== 230) { console.warn(`  [skip] ${name}: ${raw.message}`); continue; }
    const c = raw.consumption as { fuel: number; food: number };
    vehicles.push({
      name,
      fuelPerMove:   c.fuel,
      foodPerMove:   c.food,
      // rocket and car explicitly cannot cross water per API notes
      canCrossWater: name !== "rocket" && name !== "car",
    });
  }

  return vehicles;
}

// ── Terrain helpers ───────────────────────────────────────────────────────────

const DIRS: [Direction, number, number][] = [
  ["up",    -1,  0],
  ["down",   1,  0],
  ["left",   0, -1],
  ["right",  0,  1],
];

/**
 * Is the target cell passable given current travel mode?
 * walkMode = true means the traveler is on foot (after dismounting).
 */
function passable(cell: string, walkMode: boolean, vehicle: Vehicle): boolean {
  if (cell === "R") return false;
  if (cell === "W") return walkMode || vehicle.canCrossWater;
  return true;  // '.', 'T', 'S', 'G'
}

/** Extra fuel consumed when a powered vehicle enters a tree tile. */
function treeFuelPenalty(cell: string, powered: boolean): number {
  return powered && cell === "T" ? 0.2 : 0;
}

// ── BFS pathfinding ───────────────────────────────────────────────────────────
//
// State: (row, col, fuel×SCALE, food×SCALE, walkMode)
//
// walkMode starts false.  When the traveler dismounts, walkMode becomes true and
// all subsequent moves use WALK rates (fuel=0, food=2.5 per move).
//
// BFS guarantees shortest path in terms of total step-count.

interface BFSState {
  row:      number;
  col:      number;
  fuel:     number;      // ×SCALE
  food:     number;      // ×SCALE
  walkMode: boolean;
  path:     StepCommand[];
}

function bfsFind(map: MapGrid, vehicle: Vehicle): StepCommand[] | null {
  const initFuel = INITIAL_FUEL * SCALE;
  const initFood = INITIAL_FOOD * SCALE;

  const vFuelBase = Math.round(vehicle.fuelPerMove * SCALE);
  const vFood     = Math.round(vehicle.foodPerMove * SCALE);
  const wFood     = Math.round(WALK_FOOD          * SCALE);   // 25
  const powered   = vehicle.fuelPerMove > 0;

  const queue: BFSState[] = [{
    row: map.startRow, col: map.startCol,
    fuel: initFuel, food: initFood,
    walkMode: false, path: [],
  }];

  const visited = new Set<string>();

  while (queue.length > 0) {
    const s = queue.shift()!;
    const key = `${s.row},${s.col},${s.fuel},${s.food},${s.walkMode ? 1 : 0}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (s.row === map.goalRow && s.col === map.goalCol) return s.path;

    // ── Move in current mode ──────────────────────────────────────────────────
    for (const [dir, dr, dc] of DIRS) {
      const nr = s.row + dr;
      const nc = s.col + dc;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;

      const cell = map.cells[nr][nc];
      if (!passable(cell, s.walkMode, vehicle)) continue;

      let fuelCost: number;
      let foodCost: number;

      if (s.walkMode) {
        fuelCost = 0;
        foodCost = wFood;
      } else {
        fuelCost = vFuelBase + Math.round(treeFuelPenalty(cell, powered) * SCALE);
        foodCost = vFood;
      }

      const nf = s.fuel - fuelCost;
      const nfd = s.food - foodCost;
      if (nf < 0 || nfd < 0) continue;

      queue.push({
        row: nr, col: nc,
        fuel: nf, food: nfd,
        walkMode: s.walkMode,
        path: [...s.path, dir],
      });
    }

    // ── Dismount (switch to walk-mode) ────────────────────────────────────────
    // Available any time when not already in walk-mode.
    // Walk rates (fuel=0, food=2.5) are worse in food but allow crossing water.
    if (!s.walkMode) {
      queue.push({
        row: s.row, col: s.col,
        fuel: s.fuel, food: s.food,
        walkMode: true,
        path: [...s.path, "dismount"],
      });
    }
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  console.log("=== SaveThem Task ===");
  console.log(`Hub: ${process.env.HUB_BASE_URL ?? "(not set)"}`);

  // Phase 1 – Map
  console.log("\n[Phase 1] Fetching map for Skolwin...");
  const map = await fetchMap("Skolwin");
  console.log(`  Start : row=${map.startRow} col=${map.startCol}`);
  console.log(`  Goal  : row=${map.goalRow}  col=${map.goalCol}`);
  console.log("  Grid  :");
  for (let r = 0; r < map.cells.length; r++) {
    console.log(`    ${r}: ${map.cells[r].join("")}`);
  }

  // Phase 2 – Vehicles
  console.log("\n[Phase 2] Fetching vehicle data...");
  const vehicles = await fetchVehicles();
  for (const v of vehicles) {
    console.log(`  ${v.name.padEnd(6)}: fuel=${v.fuelPerMove} food=${v.foodPerMove} waterOK=${v.canCrossWater}`);
  }

  // Phase 3 – Pathfinding
  console.log("\n[Phase 3] BFS pathfinding for each vehicle...");
  let best: { vehicle: string; path: StepCommand[] } | null = null;

  for (const v of vehicles) {
    const path = bfsFind(map, v);
    if (path) {
      const fuelUsed = path.filter(s => s !== "dismount").length * v.fuelPerMove;  // approximate
      console.log(`  ✓ ${v.name}: ${path.length} commands → [${path.join(", ")}]`);
      if (!best || path.length < best.path.length) best = { vehicle: v.name, path };
    } else {
      console.log(`  ✗ ${v.name}: no valid path within resource limits`);
    }
  }

  if (!best) {
    console.error("\n[Error] No valid route found for any vehicle!");
    process.exit(1);
  }

  console.log(`\n  Best vehicle : ${best.vehicle}`);
  console.log(`  Path (${best.path.length} steps): [${best.path.join(", ")}]`);

  // Phase 4 – Submit
  console.log("\n[Phase 4] Submitting to hub...");
  const answer: string[] = [best.vehicle, ...best.path];
  console.log(`  answer = ${JSON.stringify(answer)}`);

  const result = await hubVerify(TASK, answer);
  console.log("[Hub]", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
