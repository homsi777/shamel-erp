#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const inputPath = path.join(__dirname, '../electron/Icon.png');
const pngOutputPath = path.join(__dirname, '../electron/icon.png');
const icoOutputPath = path.join(__dirname, '../electron/icon.ico');

if (!fs.existsSync(inputPath)) {
  console.error('✗ Icon.png not found in electron/ directory');
  process.exit(1);
}

async function processIcon() {
  try {
    const image = await Jimp.read(inputPath);

    console.log(`Current icon size: ${image.width}x${image.height}`);

    if (image.width !== 256 || image.height !== 256) {
      await image.resize({ w: 256, h: 256 });
      console.log('Resized to: 256x256');
    }

    // Write a normalized PNG first.
    await image.write(pngOutputPath);

    // Generate a real ICO file (valid ICO header) for Windows packaging.
    const { default: pngToIco } = await import('png-to-ico');
    const icoBuffer = await pngToIco(pngOutputPath);
    fs.writeFileSync(icoOutputPath, icoBuffer);

    console.log('Icon processed successfully.');
    console.log('electron/Icon.png -> electron/icon.png (256x256)');
    console.log('electron/icon.png -> electron/icon.ico (real ICO)');
  } catch (err) {
    console.error('✗ Processing failed:', err.message);
    process.exit(1);
  }
}

processIcon();

