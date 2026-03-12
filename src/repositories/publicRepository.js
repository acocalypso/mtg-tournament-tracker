function createPublicRepository({ pool }) {
  async function getNewsArticles(limit = 20) {
    const [rows] = await pool.query(
      `
      SELECT
        n.id,
        n.title,
        n.article_type,
        n.page_slug,
        n.content,
        n.image_url,
        n.published_at,
        u.username AS author_username
      FROM news_articles n
      LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.article_type = 'news'
        AND n.is_published = 1
        AND n.published_at <= NOW()
      ORDER BY n.published_at DESC, n.id DESC
      LIMIT ?
      `,
      [Number(limit) || 20]
    );

    return rows;
  }

  async function getFooterLinks(limit = 20) {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        title,
        page_slug
      FROM news_articles
      WHERE article_type = 'footer_page'
        AND is_published = 1
        AND page_slug IS NOT NULL
        AND page_slug <> ''
      ORDER BY published_at DESC, id DESC
      LIMIT ?
      `,
      [Number(limit) || 20]
    );

    return rows;
  }

  async function findFooterPageBySlug(pageSlug) {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        title,
        page_slug,
        content,
        image_url,
        published_at,
        is_published
      FROM news_articles
      WHERE article_type = 'footer_page'
        AND page_slug = ?
        AND is_published = 1
        AND published_at <= NOW()
      LIMIT 1
      `,
      [pageSlug]
    );

    return rows[0] || null;
  }

  async function getLeaderboard() {
    const [rows] = await pool.query(
      `
      SELECT
        player_name,
        CAST(SUM(wins) AS UNSIGNED) AS wins,
        CAST(SUM(losses) AS UNSIGNED) AS losses,
        CAST(SUM(draws) AS UNSIGNED) AS draws,
        CAST(SUM((wins * 3) + draws) AS UNSIGNED) AS points,
        ROUND((SUM(wins) / NULLIF(SUM(wins + losses + draws), 0)) * 100, 2) AS win_rate
      FROM entries
      GROUP BY player_name
      ORDER BY points DESC, wins DESC, player_name ASC
      `
    );

    const [deckRefs] = await pool.query(
      `
      SELECT
        e.player_name,
        e.deck,
        COALESCE(e.decklist_id, dl.id) AS decklist_id
      FROM entries e
      LEFT JOIN (
        SELECT user_id, title, MAX(id) AS id
        FROM decklists
        GROUP BY user_id, title
      ) dl ON dl.user_id = e.user_id AND dl.title = e.deck
      ORDER BY e.player_name ASC, e.deck ASC
      `
    );

    const decksByPlayer = new Map();
    for (const ref of deckRefs) {
      const key = String(ref.player_name || "");
      if (!decksByPlayer.has(key)) {
        decksByPlayer.set(key, []);
      }

      const list = decksByPlayer.get(key);
      const already = list.some((item) => item.name === ref.deck && Number(item.decklistId || 0) === Number(ref.decklist_id || 0));
      if (!already) {
        list.push({
          name: ref.deck,
          decklistId: ref.decklist_id || null,
        });
      }
    }

    for (const row of rows) {
      const decks = decksByPlayer.get(String(row.player_name || "")) || [];
      row.decks = decks;
      row.deck_count = decks.length;
    }

    return rows;
  }

  async function getMeta(options = {}) {
    const selectedYear = Number(options.year || 0);
    const hasYearFilter = Number.isInteger(selectedYear) && selectedYear > 0;

    const whereClause = hasYearFilter ? "WHERE YEAR(t.played_on) = ?" : "";
    const whereParams = hasYearFilter ? [selectedYear] : [];

    const [meta] = await pool.query(
      `
      SELECT
        e.deck,
        COUNT(*) AS pilots,
        SUM(e.wins) AS wins,
        SUM(e.losses) AS losses,
        SUM(e.draws) AS draws,
        SUM((e.wins * 3) + e.draws) AS points,
        ROUND((SUM(e.wins) / NULLIF(SUM(e.wins + e.losses + e.draws), 0)) * 100, 2) AS win_rate
      FROM entries e
      JOIN tournaments t ON t.id = e.tournament_id
      ${whereClause}
      GROUP BY e.deck
      ORDER BY pilots DESC, points DESC, e.deck ASC
      `,
      whereParams
    );

    const [totalRows] = await pool.query(
      `
      SELECT COUNT(*) AS total_entries
      FROM entries e
      JOIN tournaments t ON t.id = e.tournament_id
      ${whereClause}
      `,
      whereParams
    );

    const [statsRows] = await pool.query(
      `
      SELECT
        COUNT(DISTINCT t.id) AS tournaments_count,
        COUNT(DISTINCT e.player_name) AS players_count,
        COUNT(DISTINCT e.deck) AS decks_count,
        COUNT(*) AS total_entries
      FROM entries e
      JOIN tournaments t ON t.id = e.tournament_id
      ${whereClause}
      `,
      whereParams
    );

    const [yearRows] = await pool.query(
      `
      SELECT DISTINCT YEAR(played_on) AS year
      FROM tournaments
      WHERE played_on IS NOT NULL
      ORDER BY year DESC
      `
    );

    return {
      meta,
      totalEntries: totalRows[0]?.total_entries || 0,
      stats: {
        tournaments: statsRows[0]?.tournaments_count || 0,
        players: statsRows[0]?.players_count || 0,
        decks: statsRows[0]?.decks_count || 0,
        totalEntries: statsRows[0]?.total_entries || 0,
      },
      years: yearRows
        .map((row) => Number(row.year))
        .filter((value) => Number.isInteger(value) && value > 0),
    };
  }

  async function getTournaments() {
    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        t.played_on,
        COUNT(e.id) AS entries
      FROM tournaments t
      LEFT JOIN entries e ON e.tournament_id = t.id
      GROUP BY t.id
      ORDER BY t.played_on DESC, t.id DESC
      `
    );

    return rows;
  }

  async function getTournamentDetails(tournamentId) {
    const [tournamentRows] = await pool.query(
      `
      SELECT id, name, played_on
      FROM tournaments
      WHERE id = ?
      LIMIT 1
      `,
      [tournamentId]
    );

    const tournament = tournamentRows[0] || null;
    if (!tournament) {
      return null;
    }

    const [participants] = await pool.query(
      `
      SELECT
        e.id,
        COALESCE(e.decklist_id, dl.id) AS decklist_id,
        e.player_name,
        e.deck,
        e.wins,
        e.losses,
        e.draws,
        ((e.wins * 3) + e.draws) AS points,
        ROUND((e.wins / NULLIF((e.wins + e.losses + e.draws), 0)) * 100, 2) AS win_rate,
        u.username AS linked_username
      FROM entries e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN (
        SELECT user_id, title, MAX(id) AS id
        FROM decklists
        GROUP BY user_id, title
      ) dl ON dl.user_id = e.user_id AND dl.title = e.deck
      WHERE e.tournament_id = ?
      ORDER BY points DESC, e.wins DESC, e.player_name ASC
      `,
      [tournamentId]
    );

    const [deckStats] = await pool.query(
      `
      SELECT
        e.deck,
        COUNT(*) AS pilots,
        SUM(e.wins) AS wins,
        SUM(e.losses) AS losses,
        SUM(e.draws) AS draws,
        SUM((e.wins * 3) + e.draws) AS points,
        ROUND((SUM(e.wins) / NULLIF(SUM(e.wins + e.losses + e.draws), 0)) * 100, 2) AS win_rate
      FROM entries e
      WHERE e.tournament_id = ?
      GROUP BY e.deck
      ORDER BY pilots DESC, points DESC, e.deck ASC
      `,
      [tournamentId]
    );

    return {
      tournament,
      participants,
      deckStats,
    };
  }

  async function ping() {
    await pool.query("SELECT 1");
  }

  return {
    getNewsArticles,
    getFooterLinks,
    findFooterPageBySlug,
    getLeaderboard,
    getMeta,
    getTournaments,
    getTournamentDetails,
    ping,
  };
}

module.exports = {
  createPublicRepository,
};
