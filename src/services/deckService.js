const scryfallCardCache = new Map();

function parseDecklist(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(sideboard|mainboard|commander)\b/i.test(line));

  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    const qty = Number(match[1]);
    const cardName = match[2]
      .trim()
      .replace(/\s+\([^)]*\)\s*$/g, "")
      .replace(/\s+\[[^\]]*\]\s*$/g, "")
      .trim();

    if (!Number.isNaN(qty) && qty > 0 && cardName) {
      parsed.push({ quantity: qty, cardName });
    }
  }

  return parsed;
}

function normalizeCardLookupName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^\/\//, "")
    .replace(/\s+\([^)]*\)\s*$/g, "")
    .replace(/\s+\[[^\]]*\]\s*$/g, "")
    .trim();
}

function fallbackImageDataUri(cardName) {
  const safeName = String(cardName || "Unknown").replace(/[&<>"']/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='488' height='680'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#2f5e56'/><stop offset='100%' stop-color='#7d2f2f'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><rect x='18' y='18' width='452' height='644' rx='24' ry='24' fill='none' stroke='#fff' stroke-opacity='0.7' stroke-width='4'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='28' font-family='Arial, sans-serif' fill='#fff'>${safeName}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function toCardDetails(data, requestedName) {
  const imageUri =
    data?.image_uris?.normal ||
    data?.image_uris?.small ||
    data?.card_faces?.[0]?.image_uris?.normal ||
    data?.card_faces?.[0]?.image_uris?.small ||
    fallbackImageDataUri(data?.name || requestedName);

  return {
    cardName: data?.name || requestedName,
    typeLine: data?.type_line || "",
    manaCost: data?.mana_cost || "",
    oracleText: data?.oracle_text || data?.card_faces?.[0]?.oracle_text || "",
    imageUri,
    scryfallUri: data?.scryfall_uri || "",
  };
}

async function fetchScryfallCardByName(name) {
  const normalized = normalizeCardLookupName(name);
  const cacheKey = normalized.toLowerCase();

  if (scryfallCardCache.has(cacheKey)) {
    return scryfallCardCache.get(cacheKey);
  }

  const endpoints = [
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(normalized)}`,
    `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(normalized)}`,
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!\"${normalized}\"`)}`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const data = payload?.data?.[0] || payload;
      if (!data || data.object === "error") {
        continue;
      }

      const details = toCardDetails(data, normalized);
      scryfallCardCache.set(cacheKey, details);
      return details;
    } catch (_error) {
      // Try the next endpoint.
    }
  }

  const fallback = toCardDetails(null, normalized);
  scryfallCardCache.set(cacheKey, fallback);
  return fallback;
}

async function lookupScryfallCards(deckCards) {
  const uniqueNames = [...new Set(deckCards.map((item) => normalizeCardLookupName(item.cardName)).filter(Boolean))].slice(
    0,
    120
  );
  const cardMap = new Map();

  await Promise.all(
    uniqueNames.map(async (name) => {
      const details = await fetchScryfallCardByName(name);
      cardMap.set(name.toLowerCase(), details);
    })
  );

  return deckCards.map((card) => {
    const normalized = normalizeCardLookupName(card.cardName).toLowerCase();
    return {
      ...card,
      details: cardMap.get(normalized) || toCardDetails(null, card.cardName),
    };
  });
}

module.exports = {
  parseDecklist,
  lookupScryfallCards,
};
