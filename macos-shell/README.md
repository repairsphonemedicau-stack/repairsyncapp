# RepairSync macOS DMG Wrapper

This Electron shell loads `https://repairsync.qld.one` as a macOS app and packages it as a DMG first.

## Commands

```sh
npm install
npm run start
npm run dist:dmg
```

The DMG output is written to `macos-shell/dist/`.

## Notes

- Sign in with Apple and Google use the hosted RepairSync web flow.
- Desktop notifications are enabled through Electron notification permissions and the preload bridge.
- Apple StoreKit subscriptions are not available in a DMG. StoreKit/IAP requires a Mac App Store build path.
