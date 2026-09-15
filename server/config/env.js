export const STARTUP_REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PUBLIC_KEY',
];

export const OPTIONAL_ENV = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'APPLE_CLIENT_ID',
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'ONESIGNAL_APP_ID',
  'ONESIGNAL_API_KEY',
  'MONETAG_PUBLISHER_ID',
  'MONETAG_ZONE_ID',
  'MONETAG_DIRECT_LINK',
];

const validators = {
  MONGO_URI: value => Boolean(value && value.trim()),
  JWT_SECRET: value => Boolean(value && value.length >= 32),
  CLOUDINARY_CLOUD_NAME: value => Boolean(value && value.trim()),
  CLOUDINARY_API_KEY: value => Boolean(value && value.trim()),
  CLOUDINARY_API_SECRET: value => Boolean(value && value.trim()),
  PAYSTACK_SECRET_KEY: value => Boolean(value && value.trim()),
  PAYSTACK_PUBLIC_KEY: value => Boolean(value && value.trim()),
  RESEND_API_KEY: value => Boolean(value && value.trim()),
  RESEND_FROM_EMAIL: value => Boolean(value && /.+@.+\..+/.test(value)),
  RESEND_FROM_NAME: value => true,
  GOOGLE_CLIENT_ID: value => Boolean(value && value.trim()),
  GOOGLE_CLIENT_SECRET: value => Boolean(value && value.trim()),
  GITHUB_CLIENT_ID: value => Boolean(value && value.trim()),
  GITHUB_CLIENT_SECRET: value => Boolean(value && value.trim()),
  APPLE_CLIENT_ID: value => Boolean(value && value.trim()),
  APPLE_TEAM_ID: value => Boolean(value && value.trim()),
  APPLE_KEY_ID: value => Boolean(value && value.trim()),
  APPLE_PRIVATE_KEY: value => Boolean(value && value.trim()),
  ONESIGNAL_APP_ID: value => Boolean(value && value.trim()),
  ONESIGNAL_API_KEY: value => Boolean(value && value.trim()),
  MONETAG_PUBLISHER_ID: value => Boolean(value && value.trim()),
  MONETAG_ZONE_ID: value => Boolean(value && value.trim()),
  MONETAG_DIRECT_LINK: value => Boolean(value && value.trim()),
};

export function getEnvironmentStatus() {
  const all = [...STARTUP_REQUIRED_ENV, ...OPTIONAL_ENV];
  return Object.fromEntries(all.map(name => [name, process.env[name] ? 'PRESENT' : 'MISSING']));
}

export function assertRequiredEnv() {
  const missing = [];

  for (const name of STARTUP_REQUIRED_ENV) {
    const value = process.env[name];
    if (!validators[name]?.(value)) {
      missing.push(name);
    }
  }

  if (missing.length) {
    throw new Error(`Missing or invalid required environment variables: ${missing.join(', ')}`);
  }

  console.log('ENV CHECK:');
  for (const name of [...STARTUP_REQUIRED_ENV, ...OPTIONAL_ENV]) {
    console.log(`${name}: ${process.env[name] ? 'PRESENT' : 'MISSING'}`);
  }

  return getEnvironmentStatus();
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export const REQUIRED_ENV = STARTUP_REQUIRED_ENV;
export default { STARTUP_REQUIRED_ENV, OPTIONAL_ENV, REQUIRED_ENV, getEnvironmentStatus, assertRequiredEnv, isResendConfigured };
