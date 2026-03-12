# MTG Tournament Stats

Single-app MTG tournament tracker built with Express + EJS + MySQL.

## Features

### Public features

- News feed as homepage (`/` redirects to `/news` after setup)
- News articles with rich text and optional images
- Footer links to custom content pages (powered by article content)
- Leaderboard (`/leaderboard`) with three sections:
	- Top 10 players by points
	- Top 10 players by win chance (filtered by minimum events setting)
	- Full player list with stats
- Meta dashboard (`/meta`) with:
	- year tabs (`Gesamt` + available years)
	- KPI cards (tournaments, players, decks, entries)
	- responsive pie chart + legend
	- deck performance table
- Tournament list and detail pages (`/tournaments`, `/tournaments/:id`)
- Deck detail pages with Scryfall enrichment and TXT export
- Light/Dark theme toggle in header (saved in browser localStorage)

### Authentication and account

- User registration and login (bcrypt password hashes)
- Optional email verification flow (`/verify-email`)
- Role model: `user`, `maintainer`, `admin`
- Language switching (`en`/`de`)

### User profile and decklists

- Companion app + companion username profile fields
- Companion username history
- Decklist CRUD (main + sideboard)
- Deck detail with Scryfall card lookups
- Deck export as text file (`/decklists/:decklistId/export.txt`)

### Admin and maintainer features

Split admin area with dedicated pages:

- Dashboard: `/admin`
- News list: `/admin/news`
- Create news: `/admin/news/new`
- Edit news: `/admin/news/:articleId/edit`
- Tournaments: `/admin/tournaments`
- Add entry: `/admin/entries/new`
- Recent entries: `/admin/entries`
- User management (admin only): `/admin/users`
- Settings (admin only): `/admin/settings`

News/content management includes:

- WYSIWYG editing (Quill)
- Image upload support (multer)
- HTML sanitization (sanitize-html)
- Article type support:
	- `news`
	- `footer_page` (adds link in footer to `/pages/:slug`)

Admin-only management includes:

- Role assignment
- Legacy alias mapping to registered users
- Companion app list management
- Registration confirmation policy
- Website title update (`site_name` in `app_settings`)
- Leaderboard threshold setting: minimum events required for win-rate top 10

### Security hardening

- Parameterized SQL queries (mysql2 placeholders)
- Password hashing with bcrypt
- CSRF protection for state-changing requests (including multipart admin news forms)
- Session secret enforcement in production (`SESSION_SECRET` required)
- Rate limiting on authentication endpoints (`/login`, `/register`, `/admin/login`)
- Explicit request body size limits for urlencoded parser
- Upload restrictions for news images (MIME check + max file size)

## Install

```bash
npm install
```

## Configure environment

Copy `.env.example` to `.env` and set your MySQL credentials.

Required for production:

- `SESSION_SECRET`

If email confirmation is enabled, configure:

- `APP_BASE_URL`
- `MAIL_FROM`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

## Database schema

Schema is auto-created/updated on startup (first request).

- Database from `DB_NAME` is created if missing.
- Tables are created/updated automatically (users, settings, tournaments, entries, decklists, news articles, aliases, and more).

Optional manual setup is available in `sql/schema.sql`.

```bash
mysql -u root -p < sql/schema.sql
```

## Run

Development:

```bash
npm run dev
```

Production start:

```bash
npm start
```

Tests:

```bash
npm test
```

## First-time setup

- First run redirects `/` to setup.
- Step 1: create first admin (`/setup`).
- Step 2: configure base settings (`/setup/config`):
	- site name
	- default format
	- timezone
	- email confirmation requirement

After setup, homepage is `/news`.

## Permissions summary

- `user`: profile + decklists
- `maintainer`: all user features + tournaments/entries/news management
- `admin`: all maintainer features + users/settings management

## Notes

- Points formula: `wins * 3 + draws`
- Header/title branding uses configured `site_name` from DB (fallbacks to locale labels)
- Footer links are generated from published `footer_page` articles
- Win-rate leaderboard uses admin-configured minimum events threshold
