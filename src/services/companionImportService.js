const { createWorker } = require("tesseract.js");
const sharp = require("sharp");

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeRankToken(token) {
  return String(token || "")
    .replace(/[Il]/g, "1")
    .replace(/[oO]/g, "0");
}

function parseLeadingRank(line) {
  const match = String(line || "").match(/^([0-9IlOo]{1,2})\s+(.+)$/);
  if (!match) {
    return null;
  }

  const rank = Number(normalizeRankToken(match[1]));
  if (!Number.isInteger(rank) || rank <= 0 || rank > 64) {
    return null;
  }

  return {
    rank,
    remainder: match[2],
  };
}

function parseRow(line) {
  const leading = parseLeadingRank(line);
  if (!leading) {
    return null;
  }

  const rank = leading.rank;
  const remainder = leading.remainder;

  const wldMatch = remainder.match(/(\d+)\s*[-–—:]\s*(\d+)\s*[-–—:]\s*(\d+)/);
  if (!wldMatch) {
    return null;
  }

  const wins = Number(wldMatch[1]);
  const losses = Number(wldMatch[2]);
  const draws = Number(wldMatch[3]);

  if ([wins, losses, draws].some((value) => Number.isNaN(value) || value < 0)) {
    return null;
  }

  const prefix = remainder.slice(0, wldMatch.index).trim();
  let name = prefix;

  // Companion standings usually include points before W-L-D; strip trailing points token when present.
  const trailingPoints = prefix.match(/\s(\d{1,3})$/);
  if (trailingPoints) {
    name = prefix.slice(0, trailingPoints.index).trim();
  }

  name = name
    .replace(/\.{2,}$/g, "")
    .replace(/[|]+$/g, "")
    .trim();

  if (name.length < 2) {
    return null;
  }

  return {
    rank,
    playerName: name,
    wins,
    losses,
    draws,
  };
}

function scoreCandidate(row) {
  const base = row.playerName.length;
  const punctuationPenalty = /\.$/.test(row.playerName) ? 3 : 0;
  return base - punctuationPenalty;
}

function mergeByRank(candidateLists) {
  const byRank = new Map();

  for (const list of candidateLists) {
    for (const row of list) {
      const current = byRank.get(row.rank);
      if (!current || scoreCandidate(row) > scoreCandidate(current)) {
        byRank.set(row.rank, row);
      }
    }
  }

  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

async function buildImageVariants(buffer) {
  const image = sharp(buffer, { failOn: "none" });
  const metadata = await image.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);

  // Upscaling helps Tesseract on mobile screenshots with small text.
  const upscaleWidth = width > 0 ? Math.max(width, Math.round(width * 1.8)) : null;

  const variants = [];
  variants.push(buffer);

  if (upscaleWidth) {
    const base = sharp(buffer, { failOn: "none" }).resize({
      width: upscaleWidth,
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });

    variants.push(await base.clone().grayscale().normalize().sharpen().toBuffer());
    variants.push(await base.clone().grayscale().normalize().threshold(150).toBuffer());
    variants.push(await base.clone().grayscale().negate().normalize().threshold(140).toBuffer());

    if (height > 0) {
      const cropTop = Math.max(0, Math.round(height * 0.22));
      const cropHeight = Math.max(1, Math.round(height * 0.68));

      variants.push(
        await base
          .clone()
          .extract({
            left: 0,
            top: cropTop,
            width: upscaleWidth,
            height: Math.min(cropHeight, Math.max(1, Math.round(height * 1.8) - cropTop)),
          })
          .grayscale()
          .normalize()
          .threshold(145)
          .toBuffer()
      );
    }
  }

  return variants;
}

function parseCompanionStandingsText(rawText) {
  const lines = normalizeWhitespace(rawText);
  const parsed = [];

  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i] || "";
    if (!/^[0-9IlOo]{1,2}\s+/.test(current)) {
      continue;
    }

    let consumed = 0;
    let best = null;

    for (let span = 1; span <= 3; span += 1) {
      if (i + span - 1 >= lines.length) {
        break;
      }

      const combined = lines.slice(i, i + span).join(" ");
      const candidate = parseRow(combined);
      if (!candidate) {
        continue;
      }

      if (!best || scoreCandidate(candidate) > scoreCandidate(best)) {
        best = candidate;
        consumed = span - 1;
      }
    }

    if (best) {
      parsed.push(best);
      i += consumed;
    }
  }

  const uniqueByRank = new Map();
  for (const row of parsed) {
    const current = uniqueByRank.get(row.rank);
    if (!current || scoreCandidate(row) > scoreCandidate(current)) {
      uniqueByRank.set(row.rank, row);
    }
  }

  return [...uniqueByRank.values()].sort((a, b) => a.rank - b.rank);
}

async function extractCompanionStandingsFromImage(buffer) {
  const worker = await createWorker("eng+deu");

  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });

    let variants = [buffer];
    try {
      variants = await buildImageVariants(buffer);
    } catch (_error) {
      // If preprocessing fails for any reason, continue with original image.
    }

    const texts = [];
    const parsedCandidates = [];

    for (const variant of variants) {
      const result = await worker.recognize(variant);
      const text = String(result?.data?.text || "");
      texts.push(text);
      parsedCandidates.push(parseCompanionStandingsText(text));
    }

    const text = texts.join("\n\n----- OCR PASS -----\n\n");
    const entries = mergeByRank(parsedCandidates);

    return {
      text,
      entries,
    };
  } finally {
    await worker.terminate();
  }
}

module.exports = {
  extractCompanionStandingsFromImage,
  parseCompanionStandingsText,
};
