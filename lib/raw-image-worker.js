import process from 'node:process';

import { describeScene, inspectTarget, parseRadiumSceneFull, renderRadiumImage, replaceRadiumImage, replaceAssetFile, renderSceneFramePreview, streamAssetRange } from './raw-image-backend.js';
import { extractRuleDisplayGraphFromRawImage } from './rule-graph-extractor.js';
import { exportNativeSpikeSoundScript } from './spike-sound-native.js';

process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') {
    process.exit(0);
  }
});

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'inspect') {
    const [targetPath] = args;
    const result = await inspectTarget(targetPath);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'cat') {
    const [targetPath, assetPath, rawStart, rawEnd] = args;
    const start = Number(rawStart || 0);
    const end = rawEnd === undefined || rawEnd === '' ? null : Number(rawEnd);
    await streamAssetRange(targetPath, assetPath, start, end, process.stdout);
    return;
  }

  if (command === 'scene') {
    const [targetPath, scenePath] = args;
    const result = await describeScene(targetPath, scenePath);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'radium-scene') {
    const [targetPath, scenePath] = args;
    const parsed = await parseRadiumSceneFull(targetPath, scenePath);
    const { _parseResult, ...serializable } = parsed;
    process.stdout.write(JSON.stringify(serializable));
    return;
  }

  if (command === 'radium-image') {
    const [targetPath, scenePath, imageId] = args;
    const result = await renderRadiumImage(targetPath, scenePath, imageId);
    process.stdout.write(result.buffer);
    return;
  }

  if (command === 'radium-image-replace') {
    const [targetPath, scenePath, imageId, pngPath] = args;
    const pngBuffer = await import('node:fs/promises').then((m) => m.readFile(pngPath));
    const result = await replaceRadiumImage(targetPath, scenePath, imageId, pngBuffer);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'asset-replace') {
    const [targetPath, assetPath, filePath] = args;
    const buffer = await import('node:fs/promises').then((m) => m.readFile(filePath));
    const result = await replaceAssetFile(targetPath, assetPath, buffer);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'graph') {
    const [targetPath] = args;
    const result = await extractRuleDisplayGraphFromRawImage(targetPath);
    process.stdout.write(JSON.stringify(result));
    return;
  }

  if (command === 'scene-frame') {
    const [targetPath, scenePath, assetPath] = args;
    const result = await renderSceneFramePreview(targetPath, scenePath, assetPath);
    process.stdout.write(result.buffer);
    return;
  }

  if (command === 'sound-export') {
    const [targetPath, rawPartitionIndex, gameRoot, rawScriptIndex, outputPath] = args;
    const partitionIndex = Number(rawPartitionIndex);
    const scriptIndex = Number(rawScriptIndex);
    if (!Number.isInteger(partitionIndex) || partitionIndex < 0) {
      throw new Error(`Invalid partition index for sound export: ${rawPartitionIndex}`);
    }
    if (!Number.isInteger(scriptIndex) || scriptIndex < 0) {
      throw new Error(`Invalid script index for sound export: ${rawScriptIndex}`);
    }
    const result = await exportNativeSpikeSoundScript(
      targetPath,
      partitionIndex,
      gameRoot || '',
      scriptIndex,
      outputPath,
    );
    process.stdout.write(String(result));
    return;
  }

  throw new Error(`Unknown raw-image worker command: ${command}`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
