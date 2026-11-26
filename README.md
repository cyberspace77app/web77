# CyberSpace77 — web77

CyberSpace77 is a modern, open-source, decentralized, social media web app powered by the hive blockchain.

It is designed as a single-page application (SPA) that runs directly in your browser with minimal requirements. You can also run it locally on your PC, improving resilience against censorship and reducing dependence on any single app, website, or hosting provider.

## Features

- Decentralized social media app
- Zap content creators with bitcoin lightning
- QR code support (share and scan usernames, login with a QR code)
- Lightweight and ultra-fast browser-based SPA
- Core features supported: posting, upvoting, commenting, feed, profiles, tags, communities
- Wallet integration: send, delegate, convert hbd, stake/unstake, account creation tools
- Key management tools: generate keys, QR codes, change password, account recovery
- Keyboard support (J K L Z P / keys)
- Block producers (Witness) and Proposals explorer
- Supports Hive Keychain and login with your Posting key or a QR code on mobile
- Can be run locally on your own PC
- Open source (MIT license)
- Powered by the hive blockchain

## Production

Visit the live version:

https://cyberspace77.com/

## Run locally

Clone or download the repository, then start the included Python server:

```
python server.py --port 8777
```

The default port is **8777**.

Then open 127.0.0.1:8777 in your web browser.

## Status

**Alpha software:** CyberSpace77 is currently under active alpha development. Moving fast and breaking stuff. Reviewing transactions before you sign them recommended, as always. **Use at your own risk.**

## Dependencies

@noble/hashes, @noble/curves, @noble/ciphers, DOMPurify, esm.sh/@getalby/sdk, cdn.jsdelivr.net, maplibre-gl-js, openfreemap, openstreetmap, photon, google fonts

## Hive

CyberSpace77 is powered by the [hive blockchain](https://hive.io/), a web3 fast & scalable ecosystem with zero fees, optimized for social media and dapps.
