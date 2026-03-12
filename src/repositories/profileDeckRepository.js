function createProfileDeckRepository({ pool }) {
  async function getUserProfileData(userId) {
    const [userRows] = await pool.query(
      `
      SELECT id, username, role, companion_app_name, companion_username
      FROM users
      WHERE id = ?
      `,
      [userId]
    );

    const [history] = await pool.query(
      `
      SELECT companion_username, created_at
      FROM companion_username_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [userId]
    );

    const [decklists] = await pool.query(
      `
      SELECT id, title, format, created_at
      FROM decklists
      WHERE user_id = ?
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return {
      user: userRows[0] || null,
      history,
      decklists,
    };
  }

  async function getUserCompanionUsername(userId) {
    const [rows] = await pool.query("SELECT companion_username FROM users WHERE id = ?", [userId]);
    return rows[0]?.companion_username || "";
  }

  async function updateUserCompanionProfile(userId, appName, companionUsername) {
    await pool.query(
      `
      UPDATE users
      SET companion_app_name = ?, companion_username = ?
      WHERE id = ?
      `,
      [appName || null, companionUsername || null, userId]
    );
  }

  async function addCompanionUsernameHistory(userId, companionUsername) {
    await pool.query(
      `
      INSERT INTO companion_username_history (user_id, companion_username)
      VALUES (?, ?)
      `,
      [userId, companionUsername]
    );
  }

  async function upsertPlayerAlias(userId, aliasName) {
    await pool.query(
      `
      INSERT INTO player_aliases (user_id, alias_name)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
      `,
      [userId, aliasName]
    );
  }

  async function createDecklist({ userId, title, format, rawList, rawSideboard }) {
    await pool.query(
      `
      INSERT INTO decklists (user_id, title, format, raw_list, raw_sideboard)
      VALUES (?, ?, ?, ?, ?)
      `,
      [userId, title, format, rawList, rawSideboard || null]
    );
  }

  async function findDecklistById(decklistId) {
    const [rows] = await pool.query(
      `
      SELECT d.id, d.user_id, d.title, d.format, d.raw_list, d.raw_sideboard, d.created_at, u.username
      FROM decklists d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = ?
      `,
      [decklistId]
    );

    return rows[0] || null;
  }

  async function findDecklistEditableById(decklistId) {
    const [rows] = await pool.query(
      `
      SELECT id, user_id, title, format, raw_list, raw_sideboard
      FROM decklists
      WHERE id = ?
      `,
      [decklistId]
    );

    return rows[0] || null;
  }

  async function updateDecklist({ decklistId, title, format, rawList, rawSideboard }) {
    await pool.query(
      `
      UPDATE decklists
      SET title = ?, format = ?, raw_list = ?, raw_sideboard = ?
      WHERE id = ?
      `,
      [title, format, rawList, rawSideboard || null, decklistId]
    );
  }

  async function deleteDecklist(decklistId) {
    await pool.query("DELETE FROM decklists WHERE id = ?", [decklistId]);
  }

  return {
    getUserProfileData,
    getUserCompanionUsername,
    updateUserCompanionProfile,
    addCompanionUsernameHistory,
    upsertPlayerAlias,
    createDecklist,
    findDecklistById,
    findDecklistEditableById,
    updateDecklist,
    deleteDecklist,
  };
}

module.exports = {
  createProfileDeckRepository,
};
