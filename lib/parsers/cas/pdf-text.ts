/**
 * PDF → text-lines extraction for CAS documents, via pdfjs-dist (pure JS,
 * fully local — no worker, no network, no font fetching). Password-protected
 * PDFs are decrypted in memory; the password is never stored or logged.
 *
 * pdf.js returns positioned text fragments, not lines. Fragments are grouped
 * into visual lines by their y coordinate (small tolerance for baseline
 * jitter) and ordered by x, so downstream parsers see one table row per line.
 */

export class PdfPasswordError extends Error {
  constructor(message = "PDF is password-protected — the password is missing or wrong.") {
    super(message);
    this.name = "PdfPasswordError";
  }
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
}

/** Extract each page as an array of line strings (top to bottom). */
export async function extractPdfLines(data: Uint8Array, password?: string): Promise<string[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let task;
  let doc;
  try {
    task = pdfjs.getDocument({
      // pdf.js takes ownership of the buffer and rejects Node Buffers —
      // copy into a plain Uint8Array so callers keep theirs.
      data: new Uint8Array(data),
      password,
      useSystemFonts: true,
      disableFontFace: true,
    });
    doc = await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") throw new PdfPasswordError();
    throw err;
  }

  try {
    const pages: string[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items as TextItemLike[]));
      page.cleanup();
    }
    return pages;
  } finally {
    await task?.destroy();
  }
}

const Y_TOLERANCE = 2.5; // baseline jitter within one visual line, in PDF units

function itemsToLines(items: TextItemLike[]): string[] {
  const frags = items
    .filter((i) => i.str.trim() !== "")
    .map((i) => ({ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width }));

  // Group into lines by y (PDF y grows upward → sort descending = top first).
  frags.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; frags: typeof frags }> = [];
  for (const f of frags) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - f.y) <= Y_TOLERANCE) line.frags.push(f);
    else lines.push({ y: f.y, frags: [f] });
  }

  return lines.map(({ frags: lf }) => {
    lf.sort((a, b) => a.x - b.x);
    let out = "";
    let prevEnd = null as number | null;
    for (const f of lf) {
      // Insert a space at any visual gap; fragments that continue a word abut.
      if (prevEnd !== null) out += f.x - prevEnd > 1 ? " " : "";
      out += f.text;
      prevEnd = f.x + f.width;
    }
    return out.replace(/\s+/g, " ").trim();
  });
}
