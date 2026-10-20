const { build } = require('./package.json');

process.env.APPLE_KEYCHAIN_PROFILE ||= 'to3mato-notary';

module.exports = {
  ...build,
  extends: null,
  directories: { ...build.directories, output: 'release/distribution' },
  forceCodeSigning: true,
  publish: {
    provider: 'generic',
    url: 'https://downloads.to3mato.doyeong.dev',
    channel: 'latest',
    useMultipleRangeRequest: false,
  },
  mac: {
    ...build.mac,
    identity: process.env.CSC_NAME || 'H2RM6XYB9D',
    type: 'distribution',
    hardenedRuntime: true,
    entitlementsInherit: 'electron/entitlements.mac.plist',
    target: ['dmg', 'zip'],
    // Staple the app before either archive is created. Never modify the resulting ZIP.
    notarize: true,
  },
  dmg: { ...build.dmg, sign: true },
};
