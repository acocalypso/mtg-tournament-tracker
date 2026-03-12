const mysql = require("mysql2/promise");

function escapeIdentifier(value) {
  return `\`${String(value).replace(/`/g, "``")}\``;
}

async function runSafeSchemaChange(connection, query) {
  try {
    await connection.query(query);
  } catch (error) {
    const ignorable = new Set(["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_FK_DUP_NAME"]);
    if (!ignorable.has(error.code)) {
      throw error;
    }
  }
}

function createSchemaService({ dbConfig, dbName }) {
  let schemaReady = false;
  let schemaInitPromise = null;

  async function ensureSchema() {
    if (schemaReady) {
      return;
    }

    if (schemaInitPromise) {
      return schemaInitPromise;
    }

    const dbNameId = escapeIdentifier(dbName);

    schemaInitPromise = (async () => {
      const connection = await mysql.createConnection(dbConfig);

      try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbNameId}`);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(80) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email VARCHAR(190) DEFAULT NULL,
            email_verified_at DATETIME DEFAULT NULL,
            email_verification_token_hash VARCHAR(128) DEFAULT NULL,
            email_verification_expires_at DATETIME DEFAULT NULL,
            role ENUM('user', 'maintainer', 'admin') NOT NULL DEFAULT 'user',
            companion_app_name VARCHAR(120) DEFAULT NULL,
            companion_username VARCHAR(120) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_users_username (username),
            UNIQUE KEY uniq_users_email (email)
          )
        `);

        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.users ADD COLUMN IF NOT EXISTS email VARCHAR(190) DEFAULT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.users ADD COLUMN IF NOT EXISTS email_verified_at DATETIME DEFAULT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.users ADD COLUMN IF NOT EXISTS email_verification_token_hash VARCHAR(128) DEFAULT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.users ADD COLUMN IF NOT EXISTS email_verification_expires_at DATETIME DEFAULT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.users ADD UNIQUE KEY uniq_users_email (email)`
        );

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.admins (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(80) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_admins_username (username)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.app_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(80) NOT NULL,
            setting_value VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_app_settings_key (setting_key)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.companion_apps (
            id INT AUTO_INCREMENT PRIMARY KEY,
            app_name VARCHAR(120) NOT NULL,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_companion_apps_name (app_name)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.app_formats (
            id INT AUTO_INCREMENT PRIMARY KEY,
            format_name VARCHAR(80) NOT NULL,
            sort_order INT NOT NULL DEFAULT 100,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_app_formats_name (format_name)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.news_articles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(180) NOT NULL,
            article_type ENUM('news', 'footer_page') NOT NULL DEFAULT 'news',
            page_slug VARCHAR(180) DEFAULT NULL,
            content TEXT NOT NULL,
            image_url VARCHAR(255) DEFAULT NULL,
            author_user_id INT NULL,
            is_published TINYINT(1) NOT NULL DEFAULT 1,
            published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_news_articles_author
              FOREIGN KEY (author_user_id)
              REFERENCES ${dbNameId}.users (id)
              ON DELETE SET NULL,
            UNIQUE KEY uniq_news_articles_page_slug (page_slug),
            INDEX idx_news_articles_published (is_published, published_at)
          )
        `);

        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.news_articles ADD COLUMN IF NOT EXISTS article_type ENUM('news', 'footer_page') NOT NULL DEFAULT 'news'`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.news_articles ADD COLUMN IF NOT EXISTS page_slug VARCHAR(180) DEFAULT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.news_articles ADD UNIQUE KEY uniq_news_articles_page_slug (page_slug)`
        );

        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.news_articles ADD COLUMN IF NOT EXISTS image_url VARCHAR(255) DEFAULT NULL`
        );

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.tournaments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            played_on DATE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.player_aliases (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            alias_name VARCHAR(120) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_player_aliases_user
              FOREIGN KEY (user_id)
              REFERENCES ${dbNameId}.users (id)
              ON DELETE CASCADE,
            UNIQUE KEY uniq_player_aliases_alias (alias_name),
            INDEX idx_player_aliases_user (user_id)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.companion_username_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            companion_username VARCHAR(120) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_companion_history_user
              FOREIGN KEY (user_id)
              REFERENCES ${dbNameId}.users (id)
              ON DELETE CASCADE,
            INDEX idx_companion_history_user (user_id)
          )
        `);

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.decklists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(160) NOT NULL,
            format VARCHAR(60) NOT NULL,
            raw_list TEXT NOT NULL,
            raw_sideboard TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_decklists_user
              FOREIGN KEY (user_id)
              REFERENCES ${dbNameId}.users (id)
              ON DELETE CASCADE,
            INDEX idx_decklists_user (user_id)
          )
        `);

        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.decklists ADD COLUMN IF NOT EXISTS raw_sideboard TEXT NULL`
        );

        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${dbNameId}.entries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tournament_id INT NOT NULL,
            player_name VARCHAR(120) NOT NULL,
            deck VARCHAR(120) NOT NULL,
            wins INT NOT NULL DEFAULT 0,
            losses INT NOT NULL DEFAULT 0,
            draws INT NOT NULL DEFAULT 0,
            user_id INT NULL,
            decklist_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_entries_tournament
              FOREIGN KEY (tournament_id)
              REFERENCES ${dbNameId}.tournaments (id)
              ON DELETE CASCADE,
            CONSTRAINT fk_entries_user
              FOREIGN KEY (user_id)
              REFERENCES ${dbNameId}.users (id)
              ON DELETE SET NULL,
            INDEX idx_entries_player_name (player_name),
            INDEX idx_entries_deck (deck),
            INDEX idx_entries_user_id (user_id),
            INDEX idx_entries_decklist_id (decklist_id)
          )
        `);

        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.entries ADD COLUMN IF NOT EXISTS user_id INT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.entries ADD INDEX idx_entries_user_id (user_id)`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.entries ADD COLUMN IF NOT EXISTS decklist_id INT NULL`
        );
        await runSafeSchemaChange(
          connection,
          `ALTER TABLE ${dbNameId}.entries ADD INDEX idx_entries_decklist_id (decklist_id)`
        );

        await connection.query(`
          INSERT INTO ${dbNameId}.users (username, password_hash, role)
          SELECT a.username, a.password_hash, 'admin'
          FROM ${dbNameId}.admins a
          LEFT JOIN ${dbNameId}.users u ON u.username = a.username
          WHERE u.id IS NULL
        `);

        await connection.query(
          `
          INSERT INTO ${dbNameId}.companion_apps (app_name)
          VALUES ('Companion')
          ON DUPLICATE KEY UPDATE app_name = VALUES(app_name)
          `
        );

        await connection.query(
          `
          INSERT INTO ${dbNameId}.app_formats (format_name, sort_order)
          VALUES
            ('Standard', 10),
            ('Pioneer', 20),
            ('Modern', 30),
            ('Legacy', 40),
            ('Vintage', 50),
            ('Commander', 60),
            ('Pauper', 70),
            ('Other', 999)
          ON DUPLICATE KEY UPDATE format_name = VALUES(format_name)
          `
        );

        schemaReady = true;
      } finally {
        await connection.end();
      }
    })()
      .catch((error) => {
        schemaReady = false;
        throw error;
      })
      .finally(() => {
        schemaInitPromise = null;
      });

    return schemaInitPromise;
  }

  return {
    ensureSchema,
  };
}

module.exports = {
  createSchemaService,
};
