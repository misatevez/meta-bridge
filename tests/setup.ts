process.env.META_VERIFY_TOKEN = 'test-verify-token-deadbeefdeadbeef';
process.env.META_APP_SECRET = 'test-app-secret-cafebabecafebabe';
process.env.BRIDGE_API_KEY = 'test-bridge-key-abc123';
process.env.LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
// Prevent real WABA / Meta credentials from leaking into unit tests
process.env.META_WABA_ID = '';
process.env.META_PHONE_NUMBER_ID = '';
process.env.META_ACCESS_TOKEN = '';
// Stable secret for WS JWT generation in tests
process.env.WS_JWT_SECRET = 'test-ws-jwt-secret-for-tests-abc123';
