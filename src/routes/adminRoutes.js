const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const sanitizeHtml = require("sanitize-html");
const { extractCompanionStandingsFromImage } = require("../services/companionImportService");

function createAdminRouter({
  adminRepository,
  requireRole,
  hasRole,
  getCompanionApps,
  isEmailConfirmationRequired,
  getSetupValues,
  getLeaderboardMinEvents,
  verifyCsrfTokenStrict,
}) {
  const router = express.Router();

  function sanitizePlainText(value) {
    return sanitizeHtml(String(value || "").trim(), {
      allowedTags: [],
      allowedAttributes: {},
    });
  }

  function sanitizeArticleContent(value) {
    return sanitizeHtml(String(value || "").trim(), {
      allowedTags: [
        "p",
        "br",
        "strong",
        "em",
        "u",
        "h2",
        "h3",
        "ul",
        "ol",
        "li",
        "a",
        "blockquote",
        "code",
        "pre",
        "img",
      ],
      allowedAttributes: {
        a: ["href", "target", "rel"],
        img: ["src", "alt", "title"],
        li: ["data-list"],
      },
      allowedSchemes: ["http", "https", "mailto"],
    });
  }

  function toSlug(input) {
    return String(input || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function toArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === undefined || value === null) {
      return [];
    }
    return [value];
  }

  function normalizePlayerKey(name) {
    return String(name || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function cleanImportedPlayerName(name) {
    let cleaned = String(name || "")
      .replace(/\.{2,}/g, " ")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // OCR garbage often appends percentages/ranks/next-row fragments after the name.
    cleaned = cleaned.replace(/%.*$/g, "").trim();

    const firstDigitIndex = cleaned.search(/\d/);
    if (firstDigitIndex >= 0) {
      cleaned = cleaned.slice(0, firstDigitIndex).trim();
    }

    // Remove short all-caps tail tokens like "BN" that commonly appear from OCR artifacts.
    while (/\s[A-Z]{1,3}$/.test(cleaned)) {
      cleaned = cleaned.replace(/\s[A-Z]{1,3}$/, "").trim();
    }

    cleaned = cleaned
      .replace(/\s+/g, " ")
      .replace(/[\-.,;:]+$/g, "")
      .trim();

    return cleaned.slice(0, 120);
  }

  function resolveDuplicateKey(existingKeys, key) {
    if (!key) {
      return "";
    }

    for (const existingKey of existingKeys) {
      if (existingKey === key) {
        return existingKey;
      }

      // Treat contained variants as duplicates, e.g. "raphaelkohl" vs "raphaelkohlbn".
      if (key.length >= 8 && existingKey.length >= 8 && (existingKey.includes(key) || key.includes(existingKey))) {
        return existingKey;
      }
    }

    return key;
  }

  function scoreImportedRow(row) {
    const games = Number(row.wins || 0) + Number(row.losses || 0) + Number(row.draws || 0);
    const wins = Number(row.wins || 0);
    const rank = Number(row.rank || 999);
    return (games * 1000) + (wins * 10) - rank;
  }

  function dedupeImportedRows(rows) {
    const byPlayer = new Map();
    for (const row of rows) {
      const playerName = cleanImportedPlayerName(row.playerName);
      const key = normalizePlayerKey(playerName);
      if (!key) {
        continue;
      }

      const resolvedKey = resolveDuplicateKey([...byPlayer.keys()], key);
      const normalizedRow = {
        ...row,
        playerName,
      };

      const current = byPlayer.get(resolvedKey);
      if (!current || scoreImportedRow(normalizedRow) > scoreImportedRow(current)) {
        byPlayer.set(resolvedKey, normalizedRow);
      }
    }

    return [...byPlayer.values()].sort((a, b) => {
      const rankDelta = Number(a.rank || 999) - Number(b.rank || 999);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return String(a.playerName || "").localeCompare(String(b.playerName || ""));
    });
  }

  function parseRowsFromCommitBody(body) {
    const ranks = toArray(body.row_rank);
    const names = toArray(body.row_player_name);
    const decks = toArray(body.row_deck);
    const wins = toArray(body.row_wins);
    const losses = toArray(body.row_losses);
    const draws = toArray(body.row_draws);
    const included = new Set(toArray(body.include_row).map((value) => Number(value)));

    const rows = [];
    const count = Math.max(ranks.length, names.length, decks.length, wins.length, losses.length, draws.length);
    for (let i = 0; i < count; i += 1) {
      if (!included.has(i)) {
        continue;
      }

      const playerName = cleanImportedPlayerName(names[i]);
      const rowDeck = String(sanitizePlainText(decks[i] || "")).slice(0, 120).trim();
      const rank = Number(ranks[i] || 0);
      const rowWins = Number(wins[i] || 0);
      const rowLosses = Number(losses[i] || 0);
      const rowDraws = Number(draws[i] || 0);

      if (!playerName) {
        continue;
      }

      if ([rowWins, rowLosses, rowDraws].some((value) => Number.isNaN(value) || value < 0)) {
        continue;
      }

      rows.push({
        rank: Number.isNaN(rank) ? 0 : rank,
        playerName,
        deck: rowDeck,
        wins: rowWins,
        losses: rowLosses,
        draws: rowDraws,
      });
    }

    return rows;
  }

  async function loadAdminDashboardData() {
    return adminRepository.getAdminDashboardData();
  }

  async function loadAdminSettingsData() {
    const companionApps = await getCompanionApps();
    const emailConfirmationRequired = await isEmailConfirmationRequired();
    const setupValues = typeof getSetupValues === "function" ? await getSetupValues() : { site_name: "" };
    const leaderboardMinEvents =
      typeof getLeaderboardMinEvents === "function" ? await getLeaderboardMinEvents() : 1;
    return {
      companionApps,
      emailConfirmationRequired,
      siteName: String(setupValues.site_name || "").trim(),
      leaderboardMinEvents,
    };
  }

  const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "news");
  fs.mkdirSync(uploadDir, { recursive: true });

  const importUploadDir = path.join(__dirname, "..", "..", "public", "uploads", "imports");
  fs.mkdirSync(importUploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
        cb(null, `news-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) {
        return cb(null, true);
      }
      return cb(null, false);
    },
  });

  const importUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, importUploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
        cb(null, `import-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
      },
    }),
    limits: {
      fileSize: 8 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (String(file.mimetype || "").startsWith("image/")) {
        return cb(null, true);
      }
      return cb(null, false);
    },
  });

  function uploadNewsImage(req, res, next) {
    upload.single("image")(req, res, (error) => {
      if (error) {
        if (req.params.articleId) {
          return res.redirect(`/admin/news/${req.params.articleId}/edit?error_key=flash.admin.newsImageInvalid`);
        }
        return res.redirect("/admin/news/new?error_key=flash.admin.newsImageInvalid");
      }

      if (typeof verifyCsrfTokenStrict === "function") {
        return verifyCsrfTokenStrict(req, res, next);
      }

      return next();
    });
  }

  function uploadCompanionScreenshots(req, res, next) {
    importUpload.array("screenshots", 10)(req, res, (error) => {
      if (error) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.screenshotImageInvalid");
      }

      if (typeof verifyCsrfTokenStrict === "function") {
        return verifyCsrfTokenStrict(req, res, next);
      }

      return next();
    });
  }

  router.get("/admin", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { tournaments, recentEntries, users, newsArticles } = await loadAdminDashboardData();

      return res.render("admin", {
        title: req.__("admin.title"),
        stats: {
          tournaments: tournaments.length,
          recentEntries: recentEntries.length,
          users: users.length,
          newsArticles: newsArticles.length,
        },
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/tournaments", requireRole("maintainer"), async (req, res, next) => {
    try {
      const name = String(req.body.name || "").trim();
      const playedOn = String(req.body.played_on || "").trim();

      if (!name || !playedOn) {
        return res.redirect("/admin/tournaments?error_key=flash.admin.tournamentRequired");
      }

      await adminRepository.createTournament(name, playedOn);
      return res.redirect("/admin/tournaments?message_key=flash.admin.tournamentSaved");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/tournaments/:tournamentId/update", requireRole("maintainer"), async (req, res, next) => {
    try {
      const tournamentId = Number(req.params.tournamentId || 0);
      const name = String(req.body.name || "").trim();
      const playedOn = String(req.body.played_on || "").trim();

      if (!tournamentId || !name || !playedOn) {
        return res.redirect("/admin/tournaments/manage?error_key=flash.admin.tournamentRequired");
      }

      const updated = await adminRepository.updateTournament(tournamentId, name, playedOn);
      if (!updated) {
        return res.redirect("/admin/tournaments/manage?error_key=flash.tournament.notFound");
      }

      return res.redirect("/admin/tournaments/manage?message_key=flash.admin.tournamentUpdated");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/tournaments/manage", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { tournaments } = await loadAdminDashboardData();

      return res.render("admin-tournaments-manage", {
        title: req.__("admin.manageTournaments"),
        tournaments,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/tournaments/:tournamentId/delete", requireRole("maintainer"), async (req, res, next) => {
    try {
      const tournamentId = Number(req.params.tournamentId || 0);
      if (!tournamentId) {
        return res.redirect("/admin/tournaments/manage?error_key=flash.tournament.invalidId");
      }

      const deleted = await adminRepository.deleteTournament(tournamentId);
      if (!deleted) {
        return res.redirect("/admin/tournaments/manage?error_key=flash.tournament.notFound");
      }

      return res.redirect("/admin/tournaments/manage?message_key=flash.admin.tournamentDeleted");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/news", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { newsArticles } = await loadAdminDashboardData();

      return res.render("admin-news", {
        title: req.__("admin.newsLatest"),
        newsArticles,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/news/new", requireRole("maintainer"), async (req, res, next) => {
    try {
      return res.render("admin-news-new", {
        title: req.__("admin.newsCreate"),
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/news", requireRole("maintainer"), uploadNewsImage, async (req, res, next) => {
    try {
      const title = sanitizePlainText(req.body.title);
      const content = String(req.body.content_html || req.body.content || "").trim();
      const isPublished = String(req.body.is_published || "1") === "1";
      const publishedAtRaw = String(req.body.published_at || "").trim();
      const articleType = String(req.body.article_type || "news").trim() === "footer_page" ? "footer_page" : "news";
      const pageSlugInput = sanitizePlainText(req.body.page_slug);
      const pageSlug = articleType === "footer_page" ? toSlug(pageSlugInput || title) : null;

      if (!title || !content) {
        return res.redirect("/admin/news/new?error_key=flash.admin.newsTitleContentRequired");
      }

      if (articleType === "footer_page" && !pageSlug) {
        return res.redirect("/admin/news/new?error_key=flash.admin.footerSlugRequired");
      }

      const publishedAt = publishedAtRaw ? new Date(publishedAtRaw) : new Date();
      if (Number.isNaN(publishedAt.getTime())) {
        return res.redirect("/admin/news/new?error_key=flash.admin.newsPublishedDateInvalid");
      }

      const safeContent = sanitizeArticleContent(content);

      if (!safeContent.trim()) {
        return res.redirect("/admin/news/new?error_key=flash.admin.newsTitleContentRequired");
      }

      const imageUrl = req.file ? `/uploads/news/${req.file.filename}` : null;

      await adminRepository.createNewsArticle({
        title,
        articleType,
        pageSlug,
        content: safeContent,
        imageUrl,
        authorUserId: req.session.userId,
        isPublished,
        publishedAt,
      });

      return res.redirect("/admin/news?message_key=flash.admin.newsSaved");
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.redirect("/admin/news/new?error_key=flash.admin.footerSlugExists");
      }
      return next(error);
    }
  });

  router.get("/admin/news/:articleId/edit", requireRole("maintainer"), async (req, res, next) => {
    try {
      const articleId = Number(req.params.articleId);
      if (Number.isNaN(articleId)) {
        return res.redirect("/admin/news?error_key=flash.admin.newsInvalidId");
      }

      const article = await adminRepository.findNewsArticleById(articleId);
      if (!article) {
        return res.redirect("/admin/news?error_key=flash.admin.newsNotFound");
      }

      return res.render("admin-news-edit", {
        title: req.__("admin.newsEdit"),
        article,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/news/:articleId/update", requireRole("maintainer"), uploadNewsImage, async (req, res, next) => {
    try {
      const articleId = Number(req.params.articleId);
      if (Number.isNaN(articleId)) {
        return res.redirect("/admin/news?error_key=flash.admin.newsInvalidId");
      }

      const existing = await adminRepository.findNewsArticleById(articleId);
      if (!existing) {
        return res.redirect("/admin/news?error_key=flash.admin.newsNotFound");
      }

      const title = sanitizePlainText(req.body.title);
      const content = String(req.body.content_html || req.body.content || "").trim();
      const isPublished = String(req.body.is_published || "1") === "1";
      const publishedAtRaw = String(req.body.published_at || "").trim();
      const removeImage = String(req.body.remove_image || "0") === "1";
      const articleType = String(req.body.article_type || "news").trim() === "footer_page" ? "footer_page" : "news";
      const pageSlugInput = sanitizePlainText(req.body.page_slug);
      const pageSlug = articleType === "footer_page" ? toSlug(pageSlugInput || title) : null;

      if (!title || !content) {
        return res.redirect(`/admin/news/${articleId}/edit?error_key=flash.admin.newsTitleContentRequired`);
      }

      if (articleType === "footer_page" && !pageSlug) {
        return res.redirect(`/admin/news/${articleId}/edit?error_key=flash.admin.footerSlugRequired`);
      }

      const publishedAt = publishedAtRaw ? new Date(publishedAtRaw) : new Date();
      if (Number.isNaN(publishedAt.getTime())) {
        return res.redirect(`/admin/news/${articleId}/edit?error_key=flash.admin.newsPublishedDateInvalid`);
      }

      const safeContent = sanitizeArticleContent(content);

      if (!safeContent.trim()) {
        return res.redirect(`/admin/news/${articleId}/edit?error_key=flash.admin.newsTitleContentRequired`);
      }

      let imageProvided = false;
      let imageUrl = null;

      if (req.file) {
        imageProvided = true;
        imageUrl = `/uploads/news/${req.file.filename}`;
      } else if (removeImage) {
        imageProvided = true;
        imageUrl = null;
      }

      await adminRepository.updateNewsArticle({
        articleId,
        title,
        articleType,
        pageSlug,
        content: safeContent,
        imageUrl,
        imageProvided,
        isPublished,
        publishedAt,
      });

      return res.redirect("/admin/news?message_key=flash.admin.newsUpdated");
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.redirect(`/admin/news/${articleId}/edit?error_key=flash.admin.footerSlugExists`);
      }
      return next(error);
    }
  });

  router.get("/admin/tournaments", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { tournaments } = await loadAdminDashboardData();

      return res.render("admin-tournaments", {
        title: req.__("admin.createTournament"),
        tournaments,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/entries/new", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { tournaments, users, decklists } = await loadAdminDashboardData();

      return res.render("admin-entry-new", {
        title: req.__("admin.addEntry"),
        tournaments,
        users,
        decklists,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/entries", requireRole("maintainer"), async (req, res, next) => {
    try {
      const { recentEntries } = await loadAdminDashboardData();

      return res.render("admin-entries", {
        title: req.__("admin.recentEntries"),
        recentEntries,
        canManageUsers: hasRole(req.session.role, "admin"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/admin/entries/import-screenshot",
    requireRole("maintainer"),
    uploadCompanionScreenshots,
    async (req, res, next) => {
      const uploadPaths = [];

      try {
        const tournamentId = Number(req.body.tournament_id || 0);
        const defaultDeckRaw = sanitizePlainText(req.body.default_deck || "");
        const defaultDeck = String(defaultDeckRaw || "Unknown (Companion import)").slice(0, 120);

        if (!tournamentId) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.tournamentOnlyRequired");
        }

        if (!Array.isArray(req.files) || req.files.length === 0) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.screenshotImageRequired");
        }

        const parsedRows = [];
        for (const file of req.files) {
          if (!file?.path) {
            continue;
          }

          uploadPaths.push(file.path);
          const imageBuffer = await fs.promises.readFile(file.path);
          const { entries } = await extractCompanionStandingsFromImage(imageBuffer);
          parsedRows.push(...entries);
        }

        if (!parsedRows.length) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.screenshotNoRows");
        }

        const dedupedRows = dedupeImportedRows(parsedRows);
        const duplicatesRemoved = Math.max(0, parsedRows.length - dedupedRows.length);
        const { tournaments } = await loadAdminDashboardData();
        const selectedTournament = tournaments.find((item) => Number(item.id) === tournamentId) || null;

        return res.render("admin-entry-import-preview", {
          title: req.__("admin.importCompanionPreview"),
          canManageUsers: hasRole(req.session.role, "admin"),
          tournamentId,
          defaultDeck,
          selectedTournament,
          rows: dedupedRows,
          sourceRowsCount: parsedRows.length,
          duplicatesRemoved,
          message: res.locals.queryMessage,
          error: res.locals.queryError,
        });
      } catch (error) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.screenshotParseFailed");
      } finally {
        await Promise.all(uploadPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => {})));
      }
    }
  );

  router.post("/admin/entries/import-screenshot/commit", requireRole("maintainer"), async (req, res, next) => {
    try {
      const tournamentId = Number(req.body.tournament_id || 0);
      const defaultDeckRaw = sanitizePlainText(req.body.default_deck || "");
      const defaultDeck = String(defaultDeckRaw || "").slice(0, 120).trim();
      const fallbackDeck = defaultDeck || "Unknown (Companion import)";

      if (!tournamentId) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.tournamentOnlyRequired");
      }

      const editedRows = parseRowsFromCommitBody(req.body);
      const dedupedRows = dedupeImportedRows(editedRows);

      if (!dedupedRows.length) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.screenshotNoRows");
      }

      for (const row of dedupedRows) {
        const rowDeck = String(row.deck || "").trim();
        await adminRepository.createEntry({
          tournamentId,
          playerName: row.playerName,
          userId: null,
          decklistId: null,
          deck: rowDeck || fallbackDeck,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
        });
      }

      const duplicatesRemoved = Math.max(0, editedRows.length - dedupedRows.length);
      const importedMessage =
        duplicatesRemoved > 0
          ? `${req.__("flash.admin.screenshotImported")}: ${dedupedRows.length} (${req.__("flash.admin.screenshotDuplicatesRemoved")} ${duplicatesRemoved})`
          : `${req.__("flash.admin.screenshotImported")}: ${dedupedRows.length}`;

      return res.redirect(`/admin/entries?message=${encodeURIComponent(importedMessage)}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/entries", requireRole("maintainer"), async (req, res, next) => {
    try {
      const tournamentId = Number(req.body.tournament_id || 0);
      const selectedUserId = Number(req.body.user_id || 0);
      const decklistId = Number(req.body.decklist_id || 0);
      const manualDeck = String(req.body.deck || "").trim();
      const enteredName = String(req.body.player_name || "").trim();

      if (!tournamentId) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.tournamentOnlyRequired");
      }

      let finalUserId = null;
      let finalPlayerName = enteredName;
      let finalDecklistId = null;

      if (selectedUserId > 0) {
        const selectedUser = await adminRepository.findUserBasicById(selectedUserId);
        if (!selectedUser) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.selectedUserNotFound");
        }

        finalUserId = selectedUser.id;
        if (!finalPlayerName) {
          finalPlayerName = selectedUser.companion_username || selectedUser.username;
        }
      }

      if (!finalUserId && finalPlayerName) {
        finalUserId = await adminRepository.findAliasUserId(finalPlayerName);
      }

      if (!finalPlayerName) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.playerNameOrUserRequired");
      }

      let finalDeck = manualDeck;
      if (decklistId > 0) {
        const selectedDecklist = await adminRepository.findDecklistById(decklistId);
        if (!selectedDecklist) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.selectedDecklistNotFound");
        }

        if (selectedUserId > 0 && selectedDecklist.user_id !== selectedUserId) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.decklistWrongSelectedUser");
        }

        if (selectedUserId === 0 && finalUserId && selectedDecklist.user_id !== finalUserId) {
          return res.redirect("/admin/entries/new?error_key=flash.admin.decklistWrongLinkedUser");
        }

        finalDeck = selectedDecklist.title;
        finalDecklistId = selectedDecklist.id;
      }

      if (!finalDeck) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.deckOrDecklistRequired");
      }

      const cleanWins = Number(req.body.wins || 0);
      const cleanLosses = Number(req.body.losses || 0);
      const cleanDraws = Number(req.body.draws || 0);

      if ([cleanWins, cleanLosses, cleanDraws].some((value) => Number.isNaN(value) || value < 0)) {
        return res.redirect("/admin/entries/new?error_key=flash.admin.wldNonNegative");
      }

      await adminRepository.createEntry({
        tournamentId,
        playerName: finalPlayerName,
        userId: finalUserId,
        decklistId: finalDecklistId,
        deck: finalDeck,
        wins: cleanWins,
        losses: cleanLosses,
        draws: cleanDraws,
      });

      return res.redirect("/admin/entries?message_key=flash.admin.entrySaved");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/users", requireRole("admin"), async (req, res, next) => {
    try {
      const { users, unmappedNames } = await loadAdminDashboardData();
      const { companionApps } = await loadAdminSettingsData();

      return res.render("admin-users", {
        title: req.__("admin.navUserManagement"),
        users,
        unmappedNames,
        companionApps,
        canManageUsers: true,
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/users/role", requireRole("admin"), async (req, res, next) => {
    try {
      const userId = Number(req.body.user_id || 0);
      const role = String(req.body.role || "").trim();

      if (!userId || !["user", "maintainer", "admin"].includes(role)) {
        return res.redirect("/admin/users?error_key=flash.admin.validUserRoleRequired");
      }

      await adminRepository.updateUserRole(userId, role);
      return res.redirect("/admin/users?message_key=flash.admin.userRoleUpdated");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/admin/settings", requireRole("admin"), async (req, res, next) => {
    try {
      const { emailConfirmationRequired, siteName, leaderboardMinEvents } = await loadAdminSettingsData();

      return res.render("admin-settings", {
        title: req.__("admin.navSettings"),
        emailConfirmationRequired,
        siteName,
        leaderboardMinEvents,
        canManageUsers: true,
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/settings/registration", requireRole("admin"), async (req, res, next) => {
    try {
      const required = String(req.body.registration_email_confirmation_required || "0") === "1" ? "1" : "0";
      await adminRepository.updateRegistrationEmailSetting(required);

      return res.redirect("/admin/settings?message_key=flash.admin.registrationPolicyUpdated");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/settings/site-name", requireRole("admin"), async (req, res, next) => {
    try {
      const siteName = String(req.body.site_name || "").trim();
      if (!siteName) {
        return res.redirect("/admin/settings?error_key=flash.admin.siteNameRequired");
      }

      await adminRepository.updateSiteNameSetting(siteName);
      return res.redirect("/admin/settings?message_key=flash.admin.siteNameUpdated");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/settings/leaderboard", requireRole("admin"), async (req, res, next) => {
    try {
      const minEvents = Number(req.body.leaderboard_min_events_for_winrate || 1);
      if (!Number.isInteger(minEvents) || minEvents < 1) {
        return res.redirect("/admin/settings?error_key=flash.admin.leaderboardMinEventsInvalid");
      }

      await adminRepository.updateLeaderboardMinEventsSetting(minEvents);
      return res.redirect("/admin/settings?message_key=flash.admin.leaderboardMinEventsUpdated");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/apps", requireRole("admin"), async (req, res, next) => {
    try {
      const appName = String(req.body.app_name || "").trim();
      if (!appName) {
        return res.redirect("/admin/users?error_key=flash.admin.appNameRequired");
      }

      await adminRepository.upsertCompanionApp(appName);

      return res.redirect("/admin/users?message_key=flash.admin.companionAppSaved");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/admin/aliases/map", requireRole("admin"), async (req, res, next) => {
    try {
      const aliasName = String(req.body.alias_name || "").trim();
      const userId = Number(req.body.user_id || 0);

      if (!aliasName || !userId) {
        return res.redirect("/admin/users?error_key=flash.admin.aliasAndUserRequired");
      }

      await adminRepository.mapAliasToUser(aliasName, userId);

      return res.redirect("/admin/users?message_key=flash.admin.aliasMapped");
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminRouter,
};
