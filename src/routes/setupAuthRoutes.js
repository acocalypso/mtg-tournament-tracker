const bcrypt = require("bcrypt");
const crypto = require("crypto");
const express = require("express");

function createSetupAuthRouter({
  authRepository,
  appBaseUrl,
  hasAnyAdmin,
  hasRole,
  isSetupComplete,
  getSetupValues,
  isEmailConfirmationRequired,
  isValidEmail,
  buildTokenHash,
  sendVerificationEmail,
  requireSetupAdmin,
}) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      if (!(await isSetupComplete())) {
        if (req.session?.userId && hasRole(req.session.role, "admin")) {
          return res.redirect("/setup/config");
        }
        return res.redirect("/login?message_key=flash.setup.adminMustFinish");
      }

      return res.redirect("/news");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/setup", async (req, res, next) => {
    try {
      if (await hasAnyAdmin()) {
        if (await isSetupComplete()) {
          return res.redirect(req.session?.userId ? "/news" : "/login");
        }

        if (req.session?.userId && hasRole(req.session.role, "admin")) {
          return res.redirect("/setup/config");
        }

        return res.redirect("/login?message_key=flash.setup.adminMustFinish");
      }

      return res.render("setup", {
        title: req.__("setup.title"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/setup", async (req, res, next) => {
    try {
      if (await hasAnyAdmin()) {
        return res.redirect("/login");
      }

      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");
      const confirmPassword = String(req.body.confirm_password || "");

      if (!username || !password || !confirmPassword) {
        return res.redirect("/setup?error_key=flash.common.allFieldsRequired");
      }

      if (password !== confirmPassword) {
        return res.redirect("/setup?error_key=flash.auth.passwordsMismatch");
      }

      if (password.length < 10) {
        return res.redirect("/setup?error_key=flash.auth.passwordMin10");
      }

      const passwordHash = await bcrypt.hash(password, 12);
      await authRepository.insertAdminLegacy(username, passwordHash);
      const insertId = await authRepository.insertAdminUser(username, passwordHash);

      req.session.userId = insertId;
      req.session.username = username;
      req.session.role = "admin";

      return res.redirect("/setup/config?message_key=flash.setup.adminCreated");
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.redirect("/setup?error_key=flash.auth.usernameExists");
      }

      return next(error);
    }
  });

  router.get("/setup/config", requireSetupAdmin, async (req, res, next) => {
    try {
      const values = await getSetupValues();
      return res.render("setup-config", {
        title: req.__("setupConfig.title"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
        values,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/setup/config", requireSetupAdmin, async (req, res, next) => {
    try {
      const siteName = String(req.body.site_name || "").trim();
      const defaultFormat = String(req.body.default_format || "").trim();
      const timezone = String(req.body.timezone || "").trim();
      const defaultLocaleRaw = String(req.body.default_locale || "en").trim().toLowerCase();
      const defaultLocale = ["en", "de"].includes(defaultLocaleRaw) ? defaultLocaleRaw : "en";
      const registrationEmailConfirmationRequired =
        String(req.body.registration_email_confirmation_required || "0") === "1" ? "1" : "0";

      if (!siteName || !defaultFormat || !timezone) {
        return res.redirect("/setup/config?error_key=flash.setup.allSetupFieldsRequired");
      }

      await authRepository.upsertSetupSettings({
        site_name: siteName,
        default_format: defaultFormat,
        timezone,
        default_locale: defaultLocale,
        registration_email_confirmation_required: registrationEmailConfirmationRequired,
      });

      return res.redirect("/admin?message_key=flash.setup.completed");
    } catch (error) {
      return next(error);
    }
  });

  router.get("/register", async (req, res, next) => {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      if (!(await isSetupComplete())) {
        return res.redirect("/login?message_key=flash.setup.adminMustFinish");
      }

      if (req.session?.userId) {
        return res.redirect("/leaderboard");
      }

      return res.render("register", {
        title: req.__("register.register"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/register", async (req, res, next) => {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      const username = String(req.body.username || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      const confirmPassword = String(req.body.confirm_password || "");

      if (!username || !email || !password || !confirmPassword) {
        return res.redirect("/register?error_key=flash.common.allFieldsRequired");
      }

      if (!isValidEmail(email)) {
        return res.redirect("/register?error_key=flash.auth.invalidEmail");
      }

      if (password !== confirmPassword) {
        return res.redirect("/register?error_key=flash.auth.passwordsMismatch");
      }

      if (password.length < 10) {
        return res.redirect("/register?error_key=flash.auth.passwordMin10");
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const requiresConfirmation = await isEmailConfirmationRequired();

      let token = null;
      let tokenHash = null;
      let tokenExpiry = null;

      if (requiresConfirmation) {
        token = crypto.randomBytes(32).toString("hex");
        tokenHash = buildTokenHash(token);
        tokenExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24);
      }

      await authRepository.insertUserRegistration({
        username,
        passwordHash,
        email,
        requiresConfirmation,
        tokenHash,
        tokenExpiry,
      });

      if (!requiresConfirmation) {
        return res.redirect("/login?message_key=flash.auth.accountCreated");
      }

      let mailSent = false;
      try {
        mailSent = await sendVerificationEmail(email, token);
      } catch (mailError) {
        console.error("Failed to send verification email:", mailError);
      }

      if (mailSent) {
        return res.redirect("/login?message_key=flash.auth.accountCreatedCheckEmail");
      }

      const verifyUrl = `${appBaseUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
      return res.redirect(
        `/login?message=${encodeURIComponent(req.__("flash.auth.accountCreatedManualVerify") + " " + verifyUrl)}`
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") {
        return res.redirect("/register?error_key=flash.auth.usernameOrEmailExists");
      }

      return next(error);
    }
  });

  router.get("/login", async (req, res, next) => {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      if (req.session?.userId) {
        if (hasRole(req.session.role, "maintainer")) {
          return res.redirect("/admin");
        }
        return res.redirect("/profile");
      }

      return res.render("login", {
        title: req.__("login.title"),
        message: res.locals.queryMessage,
        error: res.locals.queryError,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");

      if (!username || !password) {
        return res.redirect("/login?error_key=flash.auth.credentialsRequired");
      }

      const user = await authRepository.findUserForLogin(username);

      if (!user) {
        return res.redirect("/login?error_key=flash.auth.invalidCredentials");
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.redirect("/login?error_key=flash.auth.invalidCredentials");
      }

      if ((await isEmailConfirmationRequired()) && !user.email_verified_at) {
        return res.redirect("/login?error_key=flash.auth.verifyEmailFirst");
      }

      req.session.regenerate(async (sessionError) => {
        if (sessionError) {
          return next(sessionError);
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;

        if (!(await isSetupComplete()) && hasRole(user.role, "admin")) {
          return res.redirect("/setup/config?message_key=flash.setup.completeToContinue");
        }

        if (!(await isSetupComplete())) {
          return res.redirect("/login?error_key=flash.setup.notFinished");
        }

        if (hasRole(user.role, "maintainer")) {
          return res.redirect("/admin");
        }

        return res.redirect("/profile");
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/verify-email", async (req, res, next) => {
    try {
      const token = String(req.query.token || "").trim();
      const email = String(req.query.email || "").trim().toLowerCase();

      if (!token || !email) {
        return res.redirect("/login?error_key=flash.auth.invalidVerificationLink");
      }

      const tokenHash = buildTokenHash(token);
      const user = await authRepository.findVerificationRecord(email, tokenHash);

      if (!user) {
        return res.redirect("/login?error_key=flash.auth.verificationInvalidUsed");
      }

      if (!user.email_verification_expires_at || new Date(user.email_verification_expires_at) < new Date()) {
        return res.redirect("/login?error_key=flash.auth.verificationExpired");
      }

      await authRepository.markEmailVerified(user.id);
      return res.redirect("/login?message_key=flash.auth.emailVerified");
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      res.clearCookie("connect.sid");
      return res.redirect("/login?message_key=flash.auth.loggedOut");
    });
  });

  router.get("/admin/login", (req, res) => {
    return res.redirect("/login");
  });

  router.post("/admin/login", (req, res) => {
    return res.redirect("/login");
  });

  router.post("/admin/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        return next(error);
      }

      res.clearCookie("connect.sid");
      return res.redirect("/login?message_key=flash.auth.loggedOut");
    });
  });

  return router;
}

module.exports = {
  createSetupAuthRouter,
};
