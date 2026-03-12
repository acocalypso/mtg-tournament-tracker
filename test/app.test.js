const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/createApp");

function makeDefaultStubs({ adminCount = 0, setupComplete = false } = {}) {
  return {
    services: {
      schemaService: {
        ensureSchema: async () => {},
      },
      settingsService: {
        getCompanionApps: async () => [],
        getDeckFormats: async () => [],
        isSetupComplete: async () => setupComplete,
        isEmailConfirmationRequired: async () => false,
        getSetupValues: async () => ({
          site_name: "",
          default_format: "Modern",
          timezone: "UTC",
          registration_email_confirmation_required: "0",
        }),
      },
      emailService: {
        isValidEmail: () => true,
        buildTokenHash: (token) => token,
        sendVerificationEmail: async () => true,
      },
    },
    repositories: {
      authRepository: {
        countAdmins: async () => adminCount,
        insertAdminLegacy: async () => {},
        insertAdminUser: async () => 1,
        upsertSetupSettings: async () => {},
        insertUserRegistration: async () => {},
        findUserForLogin: async () => null,
        findVerificationRecord: async () => null,
        markEmailVerified: async () => {},
      },
      profileDeckRepository: {
        getUserProfileData: async () => ({ user: null, history: [], decklists: [] }),
        getUserCompanionUsername: async () => "",
        updateUserCompanionProfile: async () => {},
        addCompanionUsernameHistory: async () => {},
        upsertPlayerAlias: async () => {},
        createDecklist: async () => {},
        findDecklistById: async () => null,
        findDecklistEditableById: async () => null,
        updateDecklist: async () => {},
        deleteDecklist: async () => {},
      },
      adminRepository: {
        getAdminDashboardData: async () => ({ tournaments: [], recentEntries: [], users: [], unmappedNames: [] }),
        createTournament: async () => {},
        findUserBasicById: async () => null,
        findAliasUserId: async () => null,
        createEntry: async () => {},
        updateUserRole: async () => {},
        updateRegistrationEmailSetting: async () => {},
        upsertCompanionApp: async () => {},
        mapAliasToUser: async () => {},
      },
      publicRepository: {
        getLeaderboard: async () => [],
        getMeta: async () => ({ meta: [], totalEntries: 0 }),
        getTournaments: async () => [],
        ping: async () => {},
      },
    },
  };
}

test("GET / redirects to setup when no admin exists", async () => {
  const stubs = makeDefaultStubs({ adminCount: 0, setupComplete: false });
  const { app } = createApp(stubs);

  const response = await request(app).get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/setup");
});

test("GET / redirects to login when setup incomplete and admin exists", async () => {
  const stubs = makeDefaultStubs({ adminCount: 1, setupComplete: false });
  const { app } = createApp(stubs);

  const response = await request(app).get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/login?message_key=flash.setup.adminMustFinish");
});

test("GET / redirects to news when setup is complete", async () => {
  const stubs = makeDefaultStubs({ adminCount: 1, setupComplete: true });
  const { app } = createApp(stubs);

  const response = await request(app).get("/");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/news");
});

test("GET /health returns ok payload", async () => {
  const stubs = makeDefaultStubs({ adminCount: 1, setupComplete: true });
  const { app } = createApp(stubs);

  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok" });
});
