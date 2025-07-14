#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 Clearing development caches...');

// Clear Vite cache
const viteCacheDir = path.join(process.cwd(), 'node_modules', '.vite');
if (fs.existsSync(viteCacheDir)) {
  fs.rmSync(viteCacheDir, { recursive: true, force: true });
  console.log('✅ Cleared Vite cache');
} else {
  console.log('ℹ️  Vite cache directory not found');
}

// Clear dist directory
const distDir = path.join(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
  console.log('✅ Cleared dist directory');
} else {
  console.log('ℹ️  Dist directory not found');
}

// Clear any .vite directories
const rootViteDir = path.join(process.cwd(), '.vite');
if (fs.existsSync(rootViteDir)) {
  fs.rmSync(rootViteDir, { recursive: true, force: true });
  console.log('✅ Cleared root .vite directory');
} else {
  console.log('ℹ️  Root .vite directory not found');
}

// Clear log files
const logFiles = ['npm-debug.log', 'yarn-debug.log', 'yarn-error.log'];
logFiles.forEach(logFile => {
  const logPath = path.join(process.cwd(), logFile);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
    console.log(`✅ Cleared ${logFile}`);
  }
});

console.log('🎉 Cache clearing complete!');
console.log('');
console.log('Next steps:');
console.log('1. Clear browser cache (Ctrl+Shift+Delete)');
console.log('2. Or do a hard refresh (Ctrl+Shift+R)');
console.log('3. Restart the dev server: npm run dev'); 