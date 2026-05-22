export function getSafeEnv(): NodeJS.ProcessEnv {
  const safeEnv = { ...process.env };

  const BANNED_KEYS = [
    'GETIT_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'GEMINI_API_KEY',
    'GROQ_API_KEY',
    'DEEPSEEK_API_KEY',
    'TOGETHER_API_KEY',
    'MISTRAL_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'NPM_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'SECRET_KEY',
    'PASSWORD',
    'API_KEY',
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
