export function getSafeEnv(): NodeJS.ProcessEnv {
  const safeEnv = { ...process.env };
  
  const BANNED_KEYS = [
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'SECRET_KEY',
    'PASSWORD',
    'API_KEY'
  ];

  for (const key of Object.keys(safeEnv)) {
    const upperKey = key.toUpperCase();
    if (
      BANNED_KEYS.includes(upperKey) ||
      upperKey.includes('SECRET') ||
      upperKey.includes('TOKEN') ||
      upperKey.includes('PASSWORD') ||
      upperKey.includes('KEY') ||
      upperKey.includes('AUTH') ||
      upperKey.includes('CREDENTIAL') ||
      upperKey.includes('PRIVATE')
    ) {
      delete safeEnv[key];
    }
  }

  return safeEnv;
}
