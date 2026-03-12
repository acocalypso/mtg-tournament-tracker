CREATE DATABASE IF NOT EXISTS mtg_tournaments;
USE mtg_tournaments;

CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_admins_username (username)
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(80) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_app_settings_key (setting_key)
);

CREATE TABLE IF NOT EXISTS companion_apps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  app_name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_companion_apps_name (app_name)
);

CREATE TABLE IF NOT EXISTS app_formats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  format_name VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_app_formats_name (format_name)
);

CREATE TABLE IF NOT EXISTS news_articles (
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
    REFERENCES users (id)
    ON DELETE SET NULL,
  UNIQUE KEY uniq_news_articles_page_slug (page_slug),
  INDEX idx_news_articles_published (is_published, published_at)
);

CREATE TABLE IF NOT EXISTS player_aliases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  alias_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_player_aliases_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE,
  UNIQUE KEY uniq_player_aliases_alias (alias_name),
  INDEX idx_player_aliases_user (user_id)
);

CREATE TABLE IF NOT EXISTS companion_username_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  companion_username VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_companion_history_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE,
  INDEX idx_companion_history_user (user_id)
);

CREATE TABLE IF NOT EXISTS decklists (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  format VARCHAR(60) NOT NULL,
  raw_list TEXT NOT NULL,
  raw_sideboard TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_decklists_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE,
  INDEX idx_decklists_user (user_id)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  played_on DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
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
    REFERENCES tournaments (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_entries_user
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE SET NULL,
  INDEX idx_entries_player_name (player_name),
  INDEX idx_entries_deck (deck),
  INDEX idx_entries_user_id (user_id),
  INDEX idx_entries_decklist_id (decklist_id)
);

INSERT INTO users (username, password_hash, role)
SELECT a.username, a.password_hash, 'admin'
FROM admins a
LEFT JOIN users u ON u.username = a.username
WHERE u.id IS NULL;

INSERT INTO companion_apps (app_name)
VALUES ('Companion')
ON DUPLICATE KEY UPDATE app_name = VALUES(app_name);

INSERT INTO app_formats (format_name, sort_order)
VALUES
  ('Standard', 10),
  ('Pioneer', 20),
  ('Modern', 30),
  ('Legacy', 40),
  ('Vintage', 50),
  ('Commander', 60),
  ('Pauper', 70),
  ('Other', 999)
ON DUPLICATE KEY UPDATE format_name = VALUES(format_name);
