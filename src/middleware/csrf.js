const crypto = require("crypto");

function constantTimeEquals(left, right) {
  const leftBuf = Buffer.from(String(left || ""));
  const rightBuf = Buffer.from(String(right || ""));

  if (leftBuf.length !== rightBuf.length || leftBuf.length === 0) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function createCsrfProtection() {
  function attachToken(req, res, next) {
    if (!req.session) {
      return next();
    }

    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }

    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }

  function readToken(req) {
    return (
      req.body?._csrf ||
      req.query?._csrf ||
      req.headers["x-csrf-token"] ||
      req.headers["x-xsrf-token"] ||
      ""
    );
  }

  function verifyTokenStrict(req, res, next) {
    const method = String(req.method || "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      return next();
    }

    const sessionToken = req.session?.csrfToken;
    const requestToken = readToken(req);

    if (!constantTimeEquals(requestToken, sessionToken)) {
      return res.status(403).render("error", {
        title: req.__("error.server"),
        message: req.__("error.csrfInvalid"),
      });
    }

    return next();
  }

  function verifyToken(req, res, next) {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();

    // Multipart requests are verified after multer parses fields in specific routes.
    if (contentType.startsWith("multipart/form-data")) {
      return next();
    }

    return verifyTokenStrict(req, res, next);
  }

  return {
    attachToken,
    verifyToken,
    verifyTokenStrict,
  };
}

module.exports = {
  createCsrfProtection,
};
