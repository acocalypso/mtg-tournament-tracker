function createAuthRepository({ pool }) {
  async function countAdmins() {
    const [rows] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
    return rows[0]?.total || 0;
  }

  async function insertAdminLegacy(username, passwordHash) {
    await pool.query("INSERT INTO admins (username, password_hash) VALUES (?, ?)", [username, passwordHash]);
  }

  async function insertAdminUser(username, passwordHash) {
    const [result] = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
      [username, passwordHash]
    );
    return result.insertId;
  }

  async function upsertSetupSettings(settings) {
    const entries = Object.entries(settings);
    const queries = entries.map(([key, value]) =>
      pool.query(
        `
        INSERT INTO app_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
        `,
        [key, value]
      )
    );

    await Promise.all(queries);
  }

  async function insertUserRegistration({ username, passwordHash, email, requiresConfirmation, tokenHash, tokenExpiry }) {
    await pool.query(
      `
      INSERT INTO users (
        username,
        password_hash,
        email,
        email_verified_at,
        email_verification_token_hash,
        email_verification_expires_at,
        role
      )
      VALUES (?, ?, ?, ?, ?, ?, 'user')
      `,
      [username, passwordHash, email, requiresConfirmation ? null : new Date(), tokenHash, tokenExpiry]
    );
  }

  async function findUserForLogin(username) {
    const [rows] = await pool.query(
      "SELECT id, username, password_hash, email_verified_at, role FROM users WHERE username = ?",
      [username]
    );
    return rows[0] || null;
  }

  async function findVerificationRecord(email, tokenHash) {
    const [rows] = await pool.query(
      `
      SELECT id, email_verification_expires_at
      FROM users
      WHERE email = ? AND email_verification_token_hash = ?
      LIMIT 1
      `,
      [email, tokenHash]
    );

    return rows[0] || null;
  }

  async function markEmailVerified(userId) {
    await pool.query(
      `
      UPDATE users
      SET email_verified_at = NOW(),
          email_verification_token_hash = NULL,
          email_verification_expires_at = NULL
      WHERE id = ?
      `,
      [userId]
    );
  }

  return {
    countAdmins,
    insertAdminLegacy,
    insertAdminUser,
    upsertSetupSettings,
    insertUserRegistration,
    findUserForLogin,
    findVerificationRecord,
    markEmailVerified,
  };
}

module.exports = {
  createAuthRepository,
};
