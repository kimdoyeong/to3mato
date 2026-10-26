import fs from 'node:fs';
import { supabaseConfiguration } from '../electron/auth.mjs';
const configuration = supabaseConfiguration(process.env);
if (!configuration || !configuration.url.startsWith('https://'))
  throw new Error(
    'Set TO3MATO_SUPABASE_URL and TO3MATO_SUPABASE_PUBLISHABLE_KEY for the production project.',
  );
fs.writeFileSync(
  new URL('../electron/supabase-config.json', import.meta.url),
  JSON.stringify(
    { url: configuration.url, publishableKey: configuration.key },
    null,
    2,
  ) + '\n',
);
console.log('Supabase public application configuration saved.');
