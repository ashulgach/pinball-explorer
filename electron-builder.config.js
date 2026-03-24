export default {
  appId: 'com.pinball-explorer.app',
  productName: 'Pinball Explorer',
  directories: {
    output: 'release',
  },
  files: [
    'electron/**',
    'public/**',
    'lib/**',
    'server.js',
    'package.json',
  ],
  asarUnpack: [
    'lib/**',
    'node_modules/ext2fs/**',
    'node_modules/balena-image-fs/**',
    'node_modules/partitioninfo/**',
    'node_modules/file-disk/**',
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  win: {
    target: ['nsis'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Development',
  },
  publish: {
    provider: 'github',
    owner: 'OWNER',
    repo: 'pinball-explorer',
  },
};
