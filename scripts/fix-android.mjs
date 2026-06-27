// Adds the permissions the background-geolocation plugin needs.
// Runs in CI after `npx cap add android`, before the Gradle build.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const path = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(path)) {
  console.error('AndroidManifest.xml not found at', path);
  process.exit(1);
}
let xml = readFileSync(path, 'utf8');

const perms = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK'
];

const lines = perms
  .filter(p => !xml.includes(`android:name="${p}"`))
  .map(p => `    <uses-permission android:name="${p}" />`);

if (lines.length) {
  // Insert right after the opening <manifest ...> tag
  xml = xml.replace(/(<manifest[^>]*>)/, `$1\n${lines.join('\n')}`);
  writeFileSync(path, xml);
  console.log('Added permissions:\n' + lines.join('\n'));
} else {
  console.log('All required permissions already present.');
}
