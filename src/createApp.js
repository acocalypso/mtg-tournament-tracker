const express = require("express");
const i18n = require("i18n");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const pool = require("./db");
const { createSchemaService } = require("./services/schemaService");
const { createSettingsService } = require("./services/settingsService");
const { createEmailService } = require("./services/emailService");
const { parseDecklist, lookupScryfallCards } = require("./services/deckService");
const { createAuthGuards } = require("./middleware/authGuards");
const { createCsrfProtection } = require("./middleware/csrf");
const { createSetupAuthRouter } = require("./routes/setupAuthRoutes");
const { createProfileDeckRouter } = require("./routes/profileDeckRoutes");
const { createPublicRouter } = require("./routes/publicRoutes");
const { createAdminRouter } = require("./routes/adminRoutes");
const { createAuthRepository } = require("./repositories/authRepository");
const { createProfileDeckRepository } = require("./repositories/profileDeckRepository");
const { createAdminRepository } = require("./repositories/adminRepository");
const { createPublicRepository } = require("./repositories/publicRepository");

function createApp(options = {}) {
  const app = express();

  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || "";

  i18n.configure({
    locales: ["en", "de"],
    defaultLocale: "en",
    directory: path.join(__dirname, "locales"),
    objectNotation: false,
    autoReload: false,
    updateFiles: false,
    syncFiles: false,
  });

  const config = {
    port: Number(options.port || process.env.PORT || 3000),
    isProd: options.isProd ?? process.env.NODE_ENV === "production",
    dbConfig: options.dbConfig || {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
    },
    dbName: options.dbName || process.env.DB_NAME || "mtg_tournaments",
    appBaseUrl: options.appBaseUrl || process.env.APP_BASE_URL || `http://localhost:${options.port || process.env.PORT || 3000}`,
    roleWeight: {
      user: 1,
      maintainer: 2,
      admin: 3,
    },
  };

  if (config.isProd && !sessionSecret) {
    throw new Error("FATAL: SESSION_SECRET is required in production.");
  }

  const services = options.services || {};
  const repositories = options.repositories || {};

  const schemaService = services.schemaService || createSchemaService({ dbConfig: config.dbConfig, dbName: config.dbName });
  const settingsService = services.settingsService || createSettingsService({ pool });
  const emailService =
    services.emailService ||
    createEmailService({
      appBaseUrl: config.appBaseUrl,
      mailFrom: process.env.MAIL_FROM || "noreply@mtg.local",
      smtpHost: process.env.SMTP_HOST,
      smtpPort: process.env.SMTP_PORT,
      smtpUser: process.env.SMTP_USER,
      smtpPass: process.env.SMTP_PASS,
    });

  const authRepository = repositories.authRepository || createAuthRepository({ pool });
  const profileDeckRepository = repositories.profileDeckRepository || createProfileDeckRepository({ pool });
  const adminRepository = repositories.adminRepository || createAdminRepository({ pool });
  const publicRepository = repositories.publicRepository || createPublicRepository({ pool });

  const {
    getCompanionApps,
    getDeckFormats,
    isSetupComplete,
    isEmailConfirmationRequired,
    getSetupValues,
    getSiteName,
    getLeaderboardMinEvents,
  } = settingsService;

  const { isValidEmail, buildTokenHash, sendVerificationEmail } = emailService;
  const csrfProtection = createCsrfProtection();

  function hasRole(currentRole, requiredRole) {
    return (config.roleWeight[currentRole] || 0) >= (config.roleWeight[requiredRole] || 0);
  }

  async function hasAnyAdmin() {
    return (await authRepository.countAdmins()) > 0;
  }

  const { requireAuth, requireRole, requireSetupAdmin } = createAuthGuards({
    hasAnyAdmin,
    isSetupComplete,
    hasRole,
  });

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "..", "views"));

  app.use(
    session({
      secret: sessionSecret || "please-change-this-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8,
      },
    })
  );

  app.use(express.urlencoded({ extended: true, limit: "200kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(i18n.init);

  function createPostRateLimiter(maxRequests) {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => String(req.method || "GET").toUpperCase() !== "POST",
      handler: (req, res) => {
        res.status(429).send(req.__("error.tooManyRequests"));
      },
    });
  }

  app.use("/login", createPostRateLimiter(5));
  app.use("/register", createPostRateLimiter(5));
  app.use("/admin/login", createPostRateLimiter(5));

  app.use((req, res, next) => {
    if (req.session?.locale) {
      req.setLocale(req.session.locale);
    }
    next();
  });

  app.use(csrfProtection.attachToken);
  app.use(csrfProtection.verifyToken);

  app.use((req, res, next) => {
    const resolveQueryText = (name) => {
      const key = req.query?.[`${name}_key`];
      if (key) {
        return req.__(String(key));
      }

      const raw = req.query?.[name];
      return raw ? String(raw) : "";
    };

    res.locals.queryMessage = resolveQueryText("message");
    res.locals.queryError = resolveQueryText("error");
    next();
  });

  app.use((req, res, next) => {
    res.locals.t = req.__.bind(req);
    res.locals.currentLocale = req.getLocale();
    res.locals.requestPath = req.originalUrl || "/";
    res.locals.isAuthenticated = Boolean(req.session?.userId);
    res.locals.currentUsername = req.session?.username || "";
    res.locals.currentUserRole = req.session?.role || "guest";
    res.locals.isStaff = hasRole(req.session?.role, "maintainer");
    next();
  });

  app.post("/language", (req, res) => {
    const locale = String(req.body.locale || "en");
    const returnTo = String(req.body.return_to || "/");
    if (["en", "de"].includes(locale)) {
      req.setLocale(locale);
      req.session.locale = locale;
    }

    return res.redirect(returnTo);
  });

  app.use(async (req, res, next) => {
    try {
      await schemaService.ensureSchema();
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.use(async (req, res, next) => {
    try {
      if (typeof getSiteName !== "function") {
        res.locals.siteName = "";
        return next();
      }

      res.locals.siteName = await getSiteName();
      return next();
    } catch (_error) {
      res.locals.siteName = "";
      return next();
    }
  });

  app.use(async (req, res, next) => {
    try {
      if (typeof publicRepository.getFooterLinks !== "function") {
        res.locals.footerLinks = [];
        return next();
      }

      res.locals.footerLinks = await publicRepository.getFooterLinks();
      return next();
    } catch (_error) {
      res.locals.footerLinks = [];
      return next();
    }
  });

  app.use(
    createSetupAuthRouter({
      authRepository,
      appBaseUrl: config.appBaseUrl,
      hasAnyAdmin,
      hasRole,
      isSetupComplete,
      getSetupValues,
      isEmailConfirmationRequired,
      isValidEmail,
      buildTokenHash,
      sendVerificationEmail,
      requireSetupAdmin,
    })
  );

  app.use(
    createProfileDeckRouter({
      profileDeckRepository,
      requireAuth,
      hasRole,
      getCompanionApps,
      getDeckFormats,
      parseDecklist,
      lookupScryfallCards,
    })
  );

  app.use(createPublicRouter({ publicRepository, getLeaderboardMinEvents }));

  app.use(
    createAdminRouter({
      adminRepository,
      requireRole,
      hasRole,
      getCompanionApps,
      isEmailConfirmationRequired,
      getSetupValues,
      getLeaderboardMinEvents,
      verifyCsrfTokenStrict: csrfProtection.verifyTokenStrict,
    })
  );

  app.use((error, req, res, next) => {
    console.error(error);

    let message = req.__("error.generic");
    if (error.code === "ER_ACCESS_DENIED_ERROR") {
      message = req.__("error.dbAccessDenied");
    } else if (error.code === "ECONNREFUSED") {
      message = req.__("error.dbConnectionRefused");
    }

    res.status(500).render("error", {
      title: req.__("error.server"),
      message,
    });
  });

  return { app, config };
}

module.exports = {
  createApp,
};
