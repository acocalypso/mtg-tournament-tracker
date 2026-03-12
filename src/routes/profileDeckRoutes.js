const express = require("express");

function createProfileDeckRouter({
  profileDeckRepository,
  requireAuth,
  hasRole,
  getCompanionApps,
  getDeckFormats,
  parseDecklist,
  lookupScryfallCards,
}) {
  const router = express.Router();

  router.get("/profile", requireAuth, async (req, res, next) => {
    try {
      const { user, history, decklists } = await profileDeckRepository.getUserProfileData(req.session.userId);

      const [companionApps, formats] = await Promise.all([getCompanionApps(), getDeckFormats()]);

      const selectedAppName =
        user?.companion_app_name && companionApps.some((appItem) => appItem.app_name === user.companion_app_name)
          ? user.companion_app_name
          : "Companion";

      return res.render("profile", {
        title: req.__("nav.profile"),
        user: {
          ...user,
          companion_app_name: selectedAppName,
        },
        history,
        decklists,
        companionApps,
        formats,
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/profile", requireAuth, async (req, res, next) => {
    try {
      const companionAppName = String(req.body.companion_app_name || "").trim();
      const companionUsername = String(req.body.companion_username || "").trim();

      const companionApps = await getCompanionApps();
      const isValidApp = companionApps.some((appItem) => appItem.app_name === companionAppName);
      if (!isValidApp) {
        return res.redirect("/profile?error_key=flash.profile.validAppRequired");
      }

      const previousUsername = String(
        await profileDeckRepository.getUserCompanionUsername(req.session.userId)
      ).trim();

      await profileDeckRepository.updateUserCompanionProfile(
        req.session.userId,
        companionAppName,
        companionUsername
      );

      if (companionUsername && companionUsername !== previousUsername) {
        await profileDeckRepository.addCompanionUsernameHistory(req.session.userId, companionUsername);
        await profileDeckRepository.upsertPlayerAlias(req.session.userId, companionUsername);
      }

      return res.redirect("/profile?message_key=flash.profile.updated");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/decklists", requireAuth, async (req, res, next) => {
    try {
      const title = String(req.body.title || "").trim();
      const format = String(req.body.format || "").trim();
      const rawList = String(req.body.raw_list || "").trim();
      const rawSideboard = String(req.body.raw_sideboard || "").trim();

      if (!title || !format || !rawList) {
        return res.redirect("/profile?error_key=flash.decklist.requiredFields");
      }

      const formats = await getDeckFormats();
      const isValidFormat = formats.some((item) => item.format_name === format);
      if (!isValidFormat) {
        return res.redirect("/profile?error_key=flash.decklist.validFormatRequired");
      }

      await profileDeckRepository.createDecklist({
        userId: req.session.userId,
        title,
        format,
        rawList,
        rawSideboard,
      });

      return res.redirect("/profile?message_key=flash.decklist.saved");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/decklists/:decklistId/edit", requireAuth, async (req, res, next) => {
    try {
      const decklistId = Number(req.params.decklistId);
      if (Number.isNaN(decklistId)) {
        return res.redirect("/profile?error_key=flash.decklist.invalidId");
      }

      const decklist = await profileDeckRepository.findDecklistEditableById(decklistId);

      if (!decklist) {
        return res.redirect("/profile?error_key=flash.decklist.notFound");
      }

      const isOwner = decklist.user_id === req.session.userId;
      if (!isOwner && !hasRole(req.session.role, "maintainer")) {
        return res.redirect("/profile?error_key=flash.decklist.cannotEdit");
      }

      const formats = await getDeckFormats();
      return res.render("decklist-edit", {
        title: req.__("deckEdit.title"),
        decklist,
        formats,
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/decklists/:decklistId/update", requireAuth, async (req, res, next) => {
    try {
      const decklistId = Number(req.params.decklistId);
      if (Number.isNaN(decklistId)) {
        return res.redirect("/profile?error_key=flash.decklist.invalidId");
      }

      const decklist = await profileDeckRepository.findDecklistEditableById(decklistId);
      if (!decklist) {
        return res.redirect("/profile?error_key=flash.decklist.notFound");
      }

      const isOwner = decklist.user_id === req.session.userId;
      if (!isOwner && !hasRole(req.session.role, "maintainer")) {
        return res.redirect("/profile?error_key=flash.decklist.cannotEdit");
      }

      const title = String(req.body.title || "").trim();
      const format = String(req.body.format || "").trim();
      const rawList = String(req.body.raw_list || "").trim();
      const rawSideboard = String(req.body.raw_sideboard || "").trim();

      if (!title || !format || !rawList) {
        return res.redirect(`/decklists/${decklistId}/edit?error_key=flash.decklist.updateRequired`);
      }

      const formats = await getDeckFormats();
      const isValidFormat = formats.some((item) => item.format_name === format);
      if (!isValidFormat) {
        return res.redirect(`/decklists/${decklistId}/edit?error_key=flash.decklist.validFormatRequired`);
      }

      await profileDeckRepository.updateDecklist({
        decklistId,
        title,
        format,
        rawList,
        rawSideboard,
      });

      return res.redirect(`/decklists/${decklistId}?message_key=flash.decklist.updated`);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/decklists/:decklistId/delete", requireAuth, async (req, res, next) => {
    try {
      const decklistId = Number(req.params.decklistId);
      if (Number.isNaN(decklistId)) {
        return res.redirect("/profile?error_key=flash.decklist.invalidId");
      }

      const decklist = await profileDeckRepository.findDecklistEditableById(decklistId);
      if (!decklist) {
        return res.redirect("/profile?error_key=flash.decklist.notFound");
      }

      const isOwner = decklist.user_id === req.session.userId;
      if (!isOwner && !hasRole(req.session.role, "maintainer")) {
        return res.redirect("/profile?error_key=flash.decklist.cannotDelete");
      }

      await profileDeckRepository.deleteDecklist(decklistId);
      return res.redirect("/profile?message_key=flash.decklist.deleted");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/decklists/:decklistId", async (req, res, next) => {
    try {
      const decklistId = Number(req.params.decklistId);
      if (Number.isNaN(decklistId)) {
        return res.redirect("/tournaments?error_key=flash.decklist.invalidId");
      }

      const decklist = await profileDeckRepository.findDecklistById(decklistId);

      if (!decklist) {
        return res.redirect("/tournaments?error_key=flash.decklist.notFound");
      }

      const mainboardCards = parseDecklist(decklist.raw_list);
      const sideboardCards = parseDecklist(decklist.raw_sideboard || "");
      const [mainboardWithDetails, sideboardWithDetails] = await Promise.all([
        lookupScryfallCards(mainboardCards),
        lookupScryfallCards(sideboardCards),
      ]);

      return res.render("decklist-detail", {
        title: decklist.title,
        decklist,
        mainboardCards: mainboardWithDetails,
        sideboardCards: sideboardWithDetails,
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/decklists/:decklistId/export.txt", async (req, res, next) => {
    try {
      const decklistId = Number(req.params.decklistId);
      if (Number.isNaN(decklistId)) {
        return res.redirect("/tournaments?error_key=flash.decklist.invalidId");
      }

      const decklist = await profileDeckRepository.findDecklistById(decklistId);
      if (!decklist) {
        return res.redirect("/tournaments?error_key=flash.decklist.notFound");
      }

      const cleanTitle = String(decklist.title || "decklist")
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-")
        .trim();
      const filename = `${cleanTitle || "decklist"}.txt`;

      const bodyLines = [
        `Title: ${decklist.title}`,
        `Format: ${decklist.format}`,
        `Owner: ${decklist.username}`,
        "",
        "Mainboard:",
        String(decklist.raw_list || "").trim() || "(empty)",
      ];

      const sideboardText = String(decklist.raw_sideboard || "").trim();
      if (sideboardText) {
        bodyLines.push("", "Sideboard:", sideboardText);
      }

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(bodyLines.join("\n") + "\n");
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  createProfileDeckRouter,
};
