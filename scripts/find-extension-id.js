const fs = require('fs');
const path = require('path');

const preferences = path.join(
  process.env.LOCALAPPDATA,
  'Google',
  'Chrome',
  'User Data',
  'Default',
  'Secure Preferences'
);

const data = JSON.parse(fs.readFileSync(preferences, 'utf8'));
const settings = data.extensions && data.extensions.settings;

for (const [id, entry] of Object.entries(settings || {})) {
  const location = String(entry.path || '');
  const manifestName = String((entry.manifest && entry.manifest.name) || '');
  if (/dubbing/i.test(location) || /DubAI/i.test(manifestName)) {
    console.log(id);
  }
}
