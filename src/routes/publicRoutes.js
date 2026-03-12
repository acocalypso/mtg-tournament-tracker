const express = require("express");

function createPublicRouter({ publicRepository, getLeaderboardMinEvents }) {
  const router = express.Router();

  router.get("/news", async (req, res, next) => {
    try {
      const articles = await publicRepository.getNewsArticles();

      return res.render("news", {
        title: req.__("news.title"),
        articles,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/pages/:pageSlug", async (req, res, next) => {
    try {
      const pageSlug = String(req.params.pageSlug || "").trim();
      if (!pageSlug) {
        return res.redirect("/news?error_key=flash.footerPage.invalid");
      }

      const page = await publicRepository.findFooterPageBySlug(pageSlug);
      if (!page) {
        return res.redirect("/news?error_key=flash.footerPage.notFound");
      }

      return res.render("footer-page", {
        title: page.title,
        page,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/leaderboard", async (req, res, next) => {
    try {
      const minEvents = typeof getLeaderboardMinEvents === "function" ? await getLeaderboardMinEvents() : 1;
      const leaderboard = await publicRepository.getLeaderboard({ minEvents });

      return res.render("leaderboard", {
        title: req.__("nav.leaderboard"),
        leaderboard,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/meta", async (req, res, next) => {
    try {
      const rawYear = String(req.query.year || "all").trim().toLowerCase();
      const selectedYear = rawYear === "all" ? null : Number(rawYear);

      const { meta, totalEntries, stats, years } = await publicRepository.getMeta({
        year: Number.isInteger(selectedYear) && selectedYear > 0 ? selectedYear : null,
      });

      return res.render("meta", {
        title: req.__("nav.meta"),
        meta,
        totalEntries,
        stats,
        years,
        selectedYear: Number.isInteger(selectedYear) && selectedYear > 0 ? selectedYear : null,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/tournaments", async (req, res, next) => {
    try {
      const rows = await publicRepository.getTournaments();

      return res.render("tournaments", {
        title: req.__("nav.tournaments"),
        tournaments: rows,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/tournaments/:tournamentId", async (req, res, next) => {
    try {
      const tournamentId = Number(req.params.tournamentId);
      if (Number.isNaN(tournamentId)) {
        return res.redirect("/tournaments?error_key=flash.tournament.invalidId");
      }

      const details = await publicRepository.getTournamentDetails(tournamentId);
      if (!details) {
        return res.redirect("/tournaments?error_key=flash.tournament.notFound");
      }

      return res.render("tournament-detail", {
        title: details.tournament.name,
        tournament: details.tournament,
        participants: details.participants,
        deckStats: details.deckStats,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/health", async (req, res) => {
    try {
      await publicRepository.ping();
      return res.json({ status: "ok" });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  });

  return router;
}

module.exports = {
  createPublicRouter,
};
