const requiredSetupKeys = [
  "site_name",
  "default_format",
  "timezone",
  "registration_email_confirmation_required",
];

const consentSettingKeys = [
  "consent_banner_enabled",
  "consent_policy_version",
  "consent_banner_text_en",
  "consent_banner_text_de",
  "consent_details_en",
  "consent_details_de",
  "consent_privacy_url_en",
  "consent_privacy_url_de",
];

const defaultConsentContent = {
  enabled: "0",
  policyVersion: "1",
  bannerTextEn:
    "We use technically necessary cookies for core functionality. Optional analytics and marketing cookies are only used with your consent.",
  bannerTextDe:
    "Wir verwenden technisch notwendige Cookies für die Grundfunktionen. Optionale Analyse- und Marketing-Cookies setzen wir nur mit Ihrer Einwilligung.",
  detailsEn:
    "Necessary cookies are required to provide secure login, language preferences, and core site features. Analytics cookies help us improve content, and marketing cookies are used for external campaign measurement only after consent.",
  detailsDe:
    "Notwendige Cookies sind für sicheren Login, Spracheinstellungen und Grundfunktionen der Website erforderlich. Analyse-Cookies helfen uns, Inhalte zu verbessern. Marketing-Cookies werden nur nach Einwilligung für externe Kampagnenmessung verwendet.",
  privacyUrlEn: "/pages/privacy-policy",
  privacyUrlDe: "/pages/datenschutz",
};

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
      WHERE setting_key IN (?, ?, ?, ?, ?)
      `,
      [...requiredSetupKeys, "default_locale"]
    );

    const settingMap = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
    return {
      site_name: settingMap.get("site_name") || "",
      default_format: settingMap.get("default_format") || "Modern",
      timezone: settingMap.get("timezone") || "UTC",
      registration_email_confirmation_required:
        settingMap.get("registration_email_confirmation_required") || "0",
      default_locale: settingMap.get("default_locale") || "en",
    };
  }

  async function getDefaultLocale() {
    const [rows] = await pool.query(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'default_locale' LIMIT 1"
    );

    const locale = String(rows[0]?.setting_value || "en").trim().toLowerCase();
    return ["en", "de"].includes(locale) ? locale : "en";
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

  async function getConsentSettings() {
    const placeholders = consentSettingKeys.map(() => "?").join(", ");
    const [rows] = await pool.query(
      `
      SELECT setting_key, setting_value
      FROM app_settings
      WHERE setting_key IN (${placeholders})
      `,
      consentSettingKeys
    );

    const map = new Map(rows.map((row) => [row.setting_key, String(row.setting_value || "")]));
    return {
      enabled: map.get("consent_banner_enabled") || defaultConsentContent.enabled,
      policyVersion: map.get("consent_policy_version") || defaultConsentContent.policyVersion,
      bannerTextEn: map.get("consent_banner_text_en") || defaultConsentContent.bannerTextEn,
      bannerTextDe: map.get("consent_banner_text_de") || defaultConsentContent.bannerTextDe,
      detailsEn: map.get("consent_details_en") || defaultConsentContent.detailsEn,
      detailsDe: map.get("consent_details_de") || defaultConsentContent.detailsDe,
      privacyUrlEn: map.get("consent_privacy_url_en") || defaultConsentContent.privacyUrlEn,
      privacyUrlDe: map.get("consent_privacy_url_de") || defaultConsentContent.privacyUrlDe,
    };
  }

  async function updateConsentSettings(settings) {
    const entries = Object.entries(settings);
    const queries = entries.map(([key, value]) =>
      pool.query(
        `
        INSERT INTO app_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
        `,
        [key, String(value ?? "")]
      )
    );

    await Promise.all(queries);
  }

  return {
    getCompanionApps,
    getDeckFormats,
    isSetupComplete,
    isEmailConfirmationRequired,
    getSetupValues,
    getDefaultLocale,
    getSiteName,
    getLeaderboardMinEvents,
    getConsentSettings,
    updateConsentSettings,
  };
}

module.exports = {
  createSettingsService,
  requiredSetupKeys,
};
