const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const platform = process.argv[2];
if (platform !== 'chrome' && platform !== 'firefox') {
  console.error('Invalid platform. Choose "chrome" or "firefox".');
  process.exit(1);
}

console.log(`Compiling TypeScript for ${platform}...`);
try {
  execSync('npx tsc', { stdio: 'inherit' });
} catch (e) {
  console.error('TypeScript compilation failed');
  process.exit(1);
}

const buildDir = path.join(__dirname, 'build', platform);
const srcDestDir = path.join(buildDir, 'src');
const popupDestDir = path.join(srcDestDir, 'popup');

// Clean and recreate dirs
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(popupDestDir, { recursive: true });

// Copy manifest
fs.copyFileSync(
  path.join(__dirname, `manifest.${platform}.json`),
  path.join(buildDir, 'manifest.json')
);

// Copy source JS files
const filesToCopy = [
  { src: 'src/background.js', dest: 'src/background.js' },
  { src: 'src/content.js', dest: 'src/content.js' },
  { src: 'src/ws-client.js', dest: 'src/ws-client.js' },
  { src: 'src/popup/index.html', dest: 'src/popup/index.html' },
  { src: 'src/popup/popup.js', dest: 'src/popup/popup.js' },
  { src: 'src/popup/popup.css', dest: 'src/popup/popup.css' }
];

filesToCopy.forEach(f => {
  fs.copyFileSync(
    path.join(__dirname, f.src),
    path.join(buildDir, f.dest)
  );
});

// Zip the directory
console.log(`Packaging extension zip for ${platform}...`);
const zipName = `clavis-extension-${platform}.zip`;
const absoluteZipPath = path.join(__dirname, zipName);

try {
  // Delete old zip if it exists
  if (fs.existsSync(absoluteZipPath)) {
    fs.unlinkSync(absoluteZipPath);
  }
  // Run zip command relative to build directory
  execSync(`zip -r "${absoluteZipPath}" .`, { cwd: buildDir, stdio: 'inherit' });
  console.log(`Successfully built and packaged: ${zipName}`);

  if (platform === 'firefox') {
    console.log('Packaging extension source code ZIP for Firefox AMO human review...');
    const sourceZipName = 'clavis-extension-firefox-source.zip';
    const absoluteSourceZipPath = path.join(__dirname, sourceZipName);
    if (fs.existsSync(absoluteSourceZipPath)) {
      fs.unlinkSync(absoluteSourceZipPath);
    }
    execSync(`zip -r "${absoluteSourceZipPath}" src manifest.firefox.json tsconfig.json package.json build.js`, { cwd: __dirname, stdio: 'inherit' });
    console.log(`Successfully packaged source code: ${sourceZipName}`);
  }
} catch (e) {
  console.error(`Failed to package ${zipName}:`, e);
}
