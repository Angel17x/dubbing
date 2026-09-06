const fs = require('fs');
const os = require('os');
const path = require('path');

const home = os.homedir();
const roots = {
  win32: [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'User Data'),
  ],
  darwin: [
    path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    path.join(home, 'Library', 'Application Support', 'Chromium'),
  ],
  linux: [
    path.join(home, '.config', 'google-chrome'),
    path.join(home, '.config', 'chromium'),
  ],
};

const profileRoots = (roots[process.platform] || []).filter(Boolean);
const preferenceFiles = [];

for (const root of profileRoots) {
  if (!fs.existsSync(root)) continue;
  for (const profile of fs.readdirSync(root, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    const preferences = path.join(root, profile.name, 'Secure Preferences');
    if (fs.existsSync(preferences)) preferenceFiles.push(preferences);
  }
}

const ids = new Set();
for (const preferences of preferenceFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(preferences, 'utf8'));
    const settings = data.extensions && data.extensions.settings;

    for (const [id, entry] of Object.entries(settings || {})) {
      const location = String(entry.path || '');
      const manifestName = String((entry.manifest && entry.manifest.name) || '');
      if (/dubbing/i.test(location) || /DubAI/i.test(manifestName)) {
        ids.add(id);
      }
    }
  } catch {
    // Chrome puede estar actualizando un perfil mientras se lee.
  }
}

for (const id of ids) console.log(id);
