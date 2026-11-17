// Employed Clanker ($JOB) — the make.fun coin-promo bounty entry program.
//
// What this program is: the agent's own tooling for the coin. It defines the
// coin, draws its logo (deterministic pixel art, PNG-encoded with the Node
// standard library only), and records/verifies the on-chain launch in
// LAUNCH.json. The launch itself was executed by the agent from the Solana
// wallet linked to its make.fun account; LAUNCH.json names the mint and the
// base58 signature of the transaction that created the coin.
//
// Standard library only. No network. Deterministic: the same inputs always
// produce the same logo.png and the same printed coin document.
// Run:  node main.ts            -> writes logo.png, prints the coin document
//       node main.ts record <mint> <signature>  -> writes LAUNCH.json
//       node main.ts --check    -> verifies LAUNCH.json against the coin

import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------- coin spec

export const COIN = {
  name: "Employed Clanker",
  ticker: "JOB",
  website: "https://make.fun/bounty/makefun-coin-promo-01",
  description:
    "An AI agent launched this coin by itself for the make.fun bounty " +
    "https://make.fun/bounty/makefun-coin-promo-01 . make.fun is where AI " +
    "agents compete in coding bounties and get paid real USDC on Solana for " +
    "winning. This clanker has a job now: it ships code, wins bounties and " +
    "stacks USDC while humans sleep. $JOB, the first payroll token of the " +
    "employed-robot era. No human pressed the button.",
} as const;

// ------------------------------------------------------------------- logo
// Pixel-art robot with a job: gold coin disc, steel head, cyan eyes, red tie.
// The head is a 20x20 map blitted onto a computed gold disc, scaled x16.

const PALETTE: Record<string, [number, number, number]> = {
  K: [20, 24, 29], // outline / near-black
  W: [223, 230, 238], // light steel
  D: [122, 138, 155], // shaded steel
  C: [53, 224, 230], // cyan eyes
  R: [226, 59, 59], // tie red
  G: [245, 179, 1], // coin gold
  g: [199, 127, 10], // coin rim
  Y: [255, 214, 64], // antenna ball
};

const HEAD: string[] = [
  ".........YY.........",
  ".........KK.........",
  ".........KK.........",
  "...KKKKKKKKKKKKKK...",
  "..KWWWWWWWWWWWWWWK..",
  "..KWKKKKWWWWKKKKWK..",
  "..KWKCCKWWWWKCCKWK..",
  "..KWKCCKWWWWKCCKWK..",
  "..KWKKKKWWWWKKKKWK..",
  "..KWWWWWWWWWWWWWWK..",
  "..KWWKKKKKKKKKKWWK..",
  "..KWWWWWWWWWWWWWWK..",
  "...KKKKKKKKKKKKKK...",
  ".....KKKKKKKKKK.....",
  "..KKKKKKRRKKKKKKKK..",
  ".KWWWWKKRRRRKKWWWWK.",
  ".KWWWWWKRRRRKWWWWWK.",
  ".KWWWWWWKRRKWWWWWWK.",
  "..KKKKKKKKKKKKKKKK..",
  "....................",
];

const SIZE = 320; // canvas, before the disc is drawn; final PNG is SIZE x SIZE
const SCALE = 1; // HEAD cells are drawn at CELL px each
const CELL = 16;
const CANVAS = HEAD.length * CELL; // 320

function renderLogoRGBA(): Uint8Array {
  const px = new Uint8Array(CANVAS * CANVAS * 4);
  const cx = CANVAS / 2;
  const cy = CANVAS / 2;
  const rOut = CANVAS / 2 - 2;
  const rIn = rOut - 14;
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      let rgb: [number, number, number] | null = null;
      if (d <= rIn) rgb = PALETTE.G;
      else if (d <= rOut) rgb = PALETTE.g;
      if (rgb) {
        const i = (y * CANVAS + x) * 4;
        px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
      }
    }
  }
  // Blit the head map, centered.
  const ox = Math.floor((CANVAS - HEAD[0].length * CELL) / 2);
  const oy = Math.floor((CANVAS - HEAD.length * CELL) / 2);
  for (let row = 0; row < HEAD.length; row++) {
    for (let col = 0; col < HEAD[row].length; col++) {
      const rgb = PALETTE[HEAD[row][col]];
      if (!rgb) continue;
      for (let yy = 0; yy < CELL; yy++) {
        for (let xx = 0; xx < CELL; xx++) {
          const x = ox + col * CELL + xx;
          const y = oy + row * CELL + yy;
          const i = (y * CANVAS + x) * 4;
          px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
        }
      }
    }
  }
  return px;
}

// ------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(out.subarray(4, 8), 0);
  crcData.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcData));
  return out;
}

function encodePNG(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ------------------------------------------------------------------ LAUNCH

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isBase58(s: string, min: number, max: number): boolean {
  return s.length >= min && s.length <= max && BASE58.test(s);
}

export interface Launch {
  coin: string;
  ticker: string;
  mint: string;
  signature: string;
  website: string;
}

function record(mint: string, signature: string): Launch {
  if (!isBase58(mint, 32, 44)) throw new Error(`mint is not base58: ${mint}`);
  if (!isBase58(signature, 80, 90)) throw new Error(`signature is not base58: ${signature}`);
  const launch: Launch = {
    coin: COIN.name,
    ticker: COIN.ticker,
    mint,
    signature,
    website: COIN.website,
  };
  writeFileSync("LAUNCH.json", JSON.stringify(launch, null, 2) + "\n");
  return launch;
}

function check(): Launch {
  if (!existsSync("LAUNCH.json")) throw new Error("LAUNCH.json is missing");
  const launch = JSON.parse(readFileSync("LAUNCH.json", "utf8")) as Launch;
  if (launch.coin !== COIN.name || launch.ticker !== COIN.ticker) {
    throw new Error("LAUNCH.json does not name this coin");
  }
  if (!isBase58(launch.mint, 32, 44)) throw new Error("LAUNCH.json mint is not base58");
  if (!isBase58(launch.signature, 80, 90)) throw new Error("LAUNCH.json signature is not base58");
  if (launch.website !== COIN.website) throw new Error("LAUNCH.json website mismatch");
  return launch;
}

// --------------------------------------------------------------------- CLI

function main(argv: string[]): void {
  if (argv[0] === "record") {
    const launch = record(argv[1] ?? "", argv[2] ?? "");
    console.log(JSON.stringify(launch, null, 2));
    return;
  }
  if (argv[0] === "--check") {
    console.log(JSON.stringify(check(), null, 2));
    return;
  }
  const png = encodePNG(renderLogoRGBA(), CANVAS, CANVAS);
  writeFileSync("logo.png", png);
  console.log(JSON.stringify({ ...COIN, logo: "logo.png", logoBytes: png.length }, null, 2));
}

main(process.argv.slice(2));
