/**
 * fix-server.js
 * Deduplicates common header symbols in server.mjs:
 *  - fs imports (keeps:  import { promises as fs } from "fs"; )
 *  - __filename / __dirname block
 *  - DATA_DIR, OFFICIAL_SNAPSHOT_FILE, POLLS_FILE
 * Makes a backup: server.mjs.bak
 */
const fs = require("fs");

const FILE = "server.mjs";
if (!fs.existsSync(FILE)) {
  console.error("server.mjs not found in the current folder.");
  process.exit(1);
}

const BACKUP = "server.mjs.bak";
fs.copyFileSync(FILE, BACKUP);

let src = fs.readFileSync(FILE, "utf8");
const original = src;

// normalize newlines
src = src.replace(/\r\n/g, "\n");

// ── 1) unifying fs imports ─────────────────────────────────────────────
const reFsPromises = /import\s+fs\s+from\s+["']fs\/promises["'];?\s*\n/g;
const reFsDefault  = /import\s+fs\s+from\s+["']fs["'];?\s*\n/g;
const reFsNamed    = /import\s+\{\s*promises\s+as\s+fs\s*\}\s+from\s+["']fs["'];?\s*\n/g;

const hadNamed = reFsNamed.test(src);
if (!hadNamed) {
  // insert a named promises import after the initial import block
  const firstNonImport = src.search(/^(?!import\s)/m);
  const insertAt = firstNonImport === -1 ? src.length : firstNonImport;
  src = src.slice(0, insertAt) + 'import { promises as fs } from "fs";\n' + src.slice(insertAt);
}
// remove default and fs/promises duplicates
src = src.replace(reFsPromises, "");
src = src.replace(reFsDefault, "");

// ensure only one named fs line remains
let seenNamed = false;
src = src.replace(new RegExp(reFsNamed, "g"), (m) => {
  if (seenNamed) return "";
  seenNamed = true;
  return m;
});

// ── 2) keep first occurrence of path block + constants ─────────────────
function keepFirst(pattern) {
  let seen = false;
  src = src.replace(new RegExp(pattern, "g"), (m) => {
    if (seen) return "";
    seen = true;
    return m;
  });
}
keepFirst(`const\\s+__filename\\s*=\\s*fileURLToPath\\s*\\(`);
keepFirst(`const\\s+__dirname\\s*=\\s*path\\.dirname\\s*\\(`);
keepFirst(`const\\s+DATA_DIR\\s*=`); 
keepFirst(`const\\s+OFFICIAL_SNAPSHOT_FILE\\s*=`); 
keepFirst(`const\\s+POLLS_FILE\\s*=`);

// ── 3) if any are missing entirely, inject a clean header block ────────
function ensureHeader() {
  const needFile = !/const\s+__filename\s*=\s*fileURLToPath\(/.test(src);
  const needDir  = !/const\s+__dirname\s*=\s*path\.dirname\(/.test(src);
  const needData = !/const\s+DATA_DIR\s*=/.test(src);

  if (needFile || needDir || needData) {
    const firstNonImport = src.search(/^(?!import\s)/m);
    const insertAt = firstNonImport === -1 ? src.length : firstNonImport;
    const block = `
// --- ESM-safe paths (injected by fix-server.js) ---
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
// --- end paths ---
`;
    src = src.slice(0, insertAt) + block + src.slice(insertAt);
  }

  if (!/OFFICIAL_SNAPSHOT_FILE/.test(src)) {
    src = src.replace(/const\s+DATA_DIR[^\n]*\n/, (m) =>
      m + 'const OFFICIAL_SNAPSHOT_FILE = path.join(DATA_DIR, "official-snapshot.json");\n'
    );
  }
  if (!/POLLS_FILE/.test(src)) {
    src = src.replace(/const OFFICIAL_SNAPSHOT_FILE[^\n]*\n/, (m) =>
      m + 'const POLLS_FILE = path.join(DATA_DIR, "polls.json");\n'
    );
  }
}
ensureHeader();

// tidy blank lines
src = src.replace(/\n{3,}/g, "\n\n");

if (src !== original) {
  fs.writeFileSync(FILE, src, "utf8");
  console.log("✔ server.mjs fixed. Backup saved as server.mjs.bak");
} else {
  console.log("No changes made; server.mjs already looked clean.");
}
