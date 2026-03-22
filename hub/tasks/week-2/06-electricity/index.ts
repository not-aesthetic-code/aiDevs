import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Connection directions for a tile
type Direction = "N" | "S" | "E" | "W";
type TileConnections = Direction[];

interface Tile {
  row: number;
  col: number;
  connections: TileConnections;
  label: string; // ASCII representation e.g. "┼", "─", "│", "┐" etc.
}

// Probe pixel brightness at a specific position (0=black, 255=white)
async function getBrightness(
  pixels: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number
): Promise<number> {
  const idx = (y * width + x) * channels;
  return (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
}

// Sample a horizontal strip near the center of a tile edge to detect a wire
async function hasConnection(
  pixels: Buffer,
  width: number,
  channels: number,
  tileX: number,
  tileY: number,
  tileW: number,
  tileH: number,
  direction: Direction,
  threshold = 100 // brightness below = dark = wire present
): Promise<boolean> {
  const cx = tileX + Math.round(tileW / 2);
  const cy = tileY + Math.round(tileH / 2);
  const margin = 4;

  let sampleX: number, sampleY: number;
  switch (direction) {
    case "N":
      sampleX = cx;
      sampleY = tileY + margin;
      break;
    case "S":
      sampleX = cx;
      sampleY = tileY + tileH - margin;
      break;
    case "E":
      sampleX = tileX + tileW - margin;
      sampleY = cy;
      break;
    case "W":
      sampleX = tileX + margin;
      sampleY = cy;
      break;
  }

  const brightness = await getBrightness(pixels, width, channels, sampleX, sampleY);
  return brightness < threshold;
}

function connectionsToLabel(c: TileConnections): string {
  const n = c.includes("N");
  const s = c.includes("S");
  const e = c.includes("E");
  const w = c.includes("W");

  if (n && s && e && w) return "┼";
  if (n && s && e) return "├";
  if (n && s && w) return "┤";
  if (n && e && w) return "┴";
  if (s && e && w) return "┬";
  if (n && s) return "│";
  if (e && w) return "─";
  if (n && e) return "└";
  if (n && w) return "┘";
  if (s && e) return "┌";
  if (s && w) return "┐";
  if (n) return "╵";
  if (s) return "╷";
  if (e) return "╶";
  if (w) return "╴";
  return " ";
}

async function analyzeImage(
  imagePath: string,
  outputDir: string,
  label: string
): Promise<Tile[][]> {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const { width = 0, height = 0 } = meta;

  console.log(`\n[${label}] Image size: ${width}x${height}`);

  // The 3x3 circuit grid occupies the right portion of the image.
  // Left ~25% is component icons; title is at top ~15%.
  // These offsets are estimates — adjust if results are wrong.
  const gridLeft = Math.round(width * 0.27);
  const gridTop = Math.round(height * 0.14);
  const gridRight = Math.round(width * 0.98);
  const gridBottom = Math.round(height * 0.98);

  const gridW = gridRight - gridLeft;
  const gridH = gridBottom - gridTop;
  const tileW = Math.round(gridW / 3);
  const tileH = Math.round(gridH / 3);

  console.log(
    `Grid region: (${gridLeft},${gridTop}) → (${gridRight},${gridBottom})  tile: ${tileW}x${tileH}`
  );

  // Extract raw pixels (RGB)
  const { data: pixels, info } = await img
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels as number;

  fs.mkdirSync(outputDir, { recursive: true });

  const grid: Tile[][] = [];

  for (let row = 0; row < 3; row++) {
    const gridRow: Tile[] = [];
    for (let col = 0; col < 3; col++) {
      const tileX = gridLeft + col * tileW;
      const tileY = gridTop + row * tileH;

      // Save the tile as a separate PNG
      const tilePath = path.join(outputDir, `tile_${row}_${col}.png`);
      await sharp(imagePath)
        .extract({ left: tileX, top: tileY, width: tileW, height: tileH })
        .toFile(tilePath);

      // Detect connections on each side
      const connections: TileConnections = [];
      for (const dir of ["N", "S", "E", "W"] as Direction[]) {
        if (
          await hasConnection(
            pixels,
            info.width,
            channels,
            tileX,
            tileY,
            tileW,
            tileH,
            dir
          )
        ) {
          connections.push(dir);
        }
      }

      const tile: Tile = {
        row,
        col,
        connections,
        label: connectionsToLabel(connections),
      };
      gridRow.push(tile);
    }
    grid.push(gridRow);
  }

  return grid;
}

function printGrid(grid: Tile[][]): void {
  console.log("┌───┬───┬───┐");
  for (let row = 0; row < 3; row++) {
    const cells = grid[row].map((t) => ` ${t.label} `).join("│");
    console.log(`│${cells}│`);
    if (row < 2) console.log("├───┼───┼───┤");
  }
  console.log("└───┴───┴───┘");
}

async function main() {
  const baseDir = __dirname;
  const initialPath = path.join(baseDir, "initialCircuit.png");
  const solvedPath = path.join(baseDir, "solved_electricity.png");

  const initialGrid = await analyzeImage(
    initialPath,
    path.join(baseDir, "tiles_initial"),
    "Initial"
  );
  console.log("\nInitial circuit:");
  printGrid(initialGrid);

  const solvedGrid = await analyzeImage(
    solvedPath,
    path.join(baseDir, "tiles_solved"),
    "Solved"
  );
  console.log("\nSolved circuit:");
  printGrid(solvedGrid);

  // Show JSON representation
  const toJson = (grid: Tile[][]) =>
    grid.map((row) =>
      row.map((t) => ({ connections: t.connections, label: t.label }))
    );

  console.log("\nInitial JSON:");
  console.log(JSON.stringify(toJson(initialGrid), null, 2));
  console.log("\nSolved JSON:");
  console.log(JSON.stringify(toJson(solvedGrid), null, 2));
}

main().catch(console.error);
