const requiredSetupKeys = [
  "site_name",
  "default_format",
  "timezone",
  "registration_email_confirmation_required",
];

function createSettingsService({ pool }) {
  async function getCompanionApps() {
    const [rows] = await pool.query(
      "SELECT id, app_name FROM companion_apps WHERE is_active = 1 ORDER BY app_name ASC"
    );
    return rows;
  }

  async function getDeckFormats() {
    const [rows] = await pool.query(
      "SELECT id, format_name FROM app_formats WHERE is_active = 1 ORDER BY sort_order ASC, format_name ASC"
    );
    return rows;
  }

  async function isSetupComplete() {
    const [rows] = await pool.query(
      `
      SELECT setting_key, setting_value
      FROM app_settings
      WHERE setting_key IN (?, ?, ?, ?)
      `,
      requiredSetupKeys
    );

    const settings = new Map(rows.map((row) => [row.setting_key, String(row.setting_value || "").trim()]));
    return requiredSetupKeys.every((key) => settings.has(key) && settings.get(key));
  }

  async function isEmailConfirmationRequired() {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'registration_email_confirmation_required' LIMIT 1"
    );
    const rawValue = String(rows[0]?.setting_value || "0").trim().toLowerCase();
    return rawValue === "1" || rawValue === "true" || rawValue === "yes";
  }

  async function getSetupValues() {
    const [rows] = await pool.query(
      `
      SELECT setting_key, setting_value
      FROM app_settings
      WHERE setting_key IN (?, ?, ?, ?)
      `,
      requiredSetupKeys
    );

    const settingMap = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
    return {
      site_name: settingMap.get("site_name") || "",
      default_format: settingMap.get("default_format") || "Modern",
      timezone: settingMap.get("timezone") || "UTC",
      registration_email_confirmation_required:
        settingMap.get("registration_email_confirmation_required") || "0",
    };
  }

  async function getSiteName() {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'site_name' LIMIT 1"
    );
    return String(rows[0]?.setting_value || "").trim();
  }

  async function getLeaderboardMinEvents() {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'leaderboard_min_events_for_winrate' LIMIT 1"
    );

    const raw = Number(rows[0]?.setting_value || 1);
    if (!Number.isInteger(raw) || raw < 1) {
      return 1;
    }
    return raw;
  }

  return {
    getCompanionApps,
    getDeckFormats,
    isSetupComplete,
    isEmailConfirmationRequired,
    getSetupValues,
    getSiteName,
    getLeaderboardMinEvents,
  };
}

module.exports = {
  createSettingsService,
  requiredSetupKeys,
};
