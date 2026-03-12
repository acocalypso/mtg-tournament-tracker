function createAuthGuards({ hasAnyAdmin, isSetupComplete, hasRole }) {
  function requireAuth(req, res, next) {
    if (!req.session?.userId) {
      return res.redirect("/login?error_key=flash.auth.loginRequired");
    }

    return next();
  }

  function requireRole(requiredRole) {
    return async (req, res, next) => {
      try {
        if (!(await hasAnyAdmin())) {
          return res.redirect("/setup");
        }

        if (!req.session?.userId) {
          return res.redirect("/login?error_key=flash.auth.loginRequired");
        }

        if (!(await isSetupComplete())) {
          return res.redirect("/setup/config?error_key=flash.auth.completeSetupFirst");
        }

        if (!hasRole(req.session.role, requiredRole)) {
          return res.redirect("/leaderboard?error_key=flash.auth.noPermission");
        }

        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  async function requireSetupAdmin(req, res, next) {
    try {
      if (!(await hasAnyAdmin())) {
        return res.redirect("/setup");
      }

      if (!req.session?.userId) {
        return res.redirect("/login?message_key=flash.auth.loginAsAdmin");
      }

      if (!hasRole(req.session.role, "admin")) {
        return res.redirect("/leaderboard?error_key=flash.auth.onlyAdminSetup");
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }

  return {
    requireAuth,
    requireRole,
    requireSetupAdmin,
  };
}

module.exports = {
  createAuthGuards,
};
