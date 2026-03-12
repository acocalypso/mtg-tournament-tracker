function createAdminRepository({ pool }) {
  async function getAdminDashboardData() {
    const [tournaments] = await pool.query(
      "SELECT id, name, played_on FROM tournaments ORDER BY played_on DESC, id DESC"
    );

    const [recentEntries] = await pool.query(
      `
      SELECT
        e.id,
        e.user_id,
        COALESCE(e.decklist_id, dl.id) AS decklist_id,
        e.player_name,
        e.deck,
        e.wins,
        e.losses,
        e.draws,
        t.name AS tournament_name,
        u.username AS linked_username
      FROM entries e
      JOIN tournaments t ON t.id = e.tournament_id
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN (
        SELECT user_id, title, MAX(id) AS id
        FROM decklists
        GROUP BY user_id, title
      ) dl ON dl.user_id = e.user_id AND dl.title = e.deck
      ORDER BY e.id DESC
      LIMIT 10
      `
    );

    const [users] = await pool.query(
      `
      SELECT id, username, email, email_verified_at, role, companion_app_name, companion_username
      FROM users
      ORDER BY username ASC
      `
    );

    const [unmappedNames] = await pool.query(
      `
      SELECT e.player_name, COUNT(*) AS entries_count
      FROM entries e
      WHERE e.user_id IS NULL
      GROUP BY e.player_name
      ORDER BY entries_count DESC, e.player_name ASC
      LIMIT 50
      `
    );

    const [decklists] = await pool.query(
      `
      SELECT d.id, d.user_id, d.title, d.format, u.username
      FROM decklists d
      JOIN users u ON u.id = d.user_id
      ORDER BY u.username ASC, d.title ASC
      `
    );

    const [newsArticles] = await pool.query(
      `
      SELECT
        n.id,
        n.title,
          n.article_type,
          n.page_slug,
        n.image_url,
        n.is_published,
        n.published_at,
        n.created_at,
        u.username AS author_username
      FROM news_articles n
      LEFT JOIN users u ON u.id = n.author_user_id
      ORDER BY n.published_at DESC, n.id DESC
      LIMIT 10
      `
    );

    return {
      tournaments,
      recentEntries,
      users,
      unmappedNames,
      decklists,
      newsArticles,
    };
  }

  async function createTournament(name, playedOn) {
    await pool.query("INSERT INTO tournaments (name, played_on) VALUES (?, ?)", [name, playedOn]);
  }

  async function findUserBasicById(userId) {
    const [rows] = await pool.query(
      "SELECT id, username, companion_username FROM users WHERE id = ?",
      [userId]
    );
    return rows[0] || null;
  }

  async function findAliasUserId(aliasName) {
    const [rows] = await pool.query("SELECT user_id FROM player_aliases WHERE alias_name = ? LIMIT 1", [aliasName]);
    return rows[0]?.user_id || null;
  }

  async function createEntry({ tournamentId, playerName, userId, decklistId, deck, wins, losses, draws }) {
    await pool.query(
      `
      INSERT INTO entries (tournament_id, player_name, user_id, decklist_id, deck, wins, losses, draws)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [tournamentId, playerName, userId, decklistId || null, deck, wins, losses, draws]
    );
  }

  async function findDecklistById(decklistId) {
    const [rows] = await pool.query(
      `
      SELECT id, user_id, title, format
      FROM decklists
      WHERE id = ?
      LIMIT 1
      `,
      [decklistId]
    );

    return rows[0] || null;
  }

  async function updateUserRole(userId, role) {
    await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
  }

  async function updateRegistrationEmailSetting(required) {
    await pool.query(
      `
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('registration_email_confirmation_required', ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [required]
    );
  }

  async function updateSiteNameSetting(siteName) {
    await pool.query(
      `
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('site_name', ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [siteName]
    );
  }

  async function updateLeaderboardMinEventsSetting(minEvents) {
    await pool.query(
      `
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('leaderboard_min_events_for_winrate', ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
      `,
      [String(minEvents)]
    );
  }

  async function upsertCompanionApp(appName) {
    await pool.query(
      `
      INSERT INTO companion_apps (app_name)
      VALUES (?)
      ON DUPLICATE KEY UPDATE is_active = 1
      `,
      [appName]
    );
  }

  async function mapAliasToUser(aliasName, userId) {
    await pool.query(
      `
      INSERT INTO player_aliases (user_id, alias_name)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
      `,
      [userId, aliasName]
    );

    await pool.query("UPDATE entries SET user_id = ? WHERE user_id IS NULL AND player_name = ?", [
      userId,
      aliasName,
    ]);
  }

  async function createNewsArticle({ title, articleType, pageSlug, content, imageUrl, authorUserId, isPublished, publishedAt }) {
    await pool.query(
      `
      INSERT INTO news_articles (title, article_type, page_slug, content, image_url, author_user_id, is_published, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        title,
        articleType || "news",
        pageSlug || null,
        content,
        imageUrl || null,
        authorUserId || null,
        isPublished ? 1 : 0,
        publishedAt,
      ]
    );
  }

  async function findNewsArticleById(articleId) {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        title,
        article_type,
        page_slug,
        content,
        image_url,
        author_user_id,
        is_published,
        published_at
      FROM news_articles
      WHERE id = ?
      LIMIT 1
      `,
      [articleId]
    );

    return rows[0] || null;
  }

  async function updateNewsArticle({
    articleId,
    title,
    articleType,
    pageSlug,
    content,
    imageUrl,
    imageProvided,
    isPublished,
    publishedAt,
  }) {
    if (imageProvided) {
      await pool.query(
        `
        UPDATE news_articles
        SET title = ?,
            article_type = ?,
            page_slug = ?,
            content = ?,
            image_url = ?,
            is_published = ?,
            published_at = ?
        WHERE id = ?
        `,
        [title, articleType || "news", pageSlug || null, content, imageUrl, isPublished ? 1 : 0, publishedAt, articleId]
      );
      return;
    }

    await pool.query(
      `
      UPDATE news_articles
      SET title = ?,
          article_type = ?,
          page_slug = ?,
          content = ?,
          is_published = ?,
          published_at = ?
      WHERE id = ?
      `,
      [title, articleType || "news", pageSlug || null, content, isPublished ? 1 : 0, publishedAt, articleId]
    );
  }

  return {
    getAdminDashboardData,
    createTournament,
    findUserBasicById,
    findAliasUserId,
    findDecklistById,
    createEntry,
    updateUserRole,
    updateRegistrationEmailSetting,
    updateSiteNameSetting,
    updateLeaderboardMinEventsSetting,
    upsertCompanionApp,
    mapAliasToUser,
    createNewsArticle,
    findNewsArticleById,
    updateNewsArticle,
  };
}

module.exports = {
  createAdminRepository,
};
