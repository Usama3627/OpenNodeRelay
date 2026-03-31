# Contributing to OpenNodeRelay

First off, thank you for considering contributing to OpenNodeRelay! It's people like you that make OpenNodeRelay such a great tool. 

## Where do I go from here?

If you've noticed a bug or have a feature request, make one! It's generally best if you get confirmation of your bug or approval for your feature request this way before starting to code.

## Fork & create a branch

If this is something you think you can fix, then fork OpenNodeRelay and create a branch with a descriptive name.

A good branch name would be (where issue #325 is the ticket you're working on):

```sh
git checkout -b 325-add-dark-mode
```

## Get the test suite running

Make sure everything is working correctly before you begin. We have unit tests in the Rust daemon, React Native mobile app, and the Cloudflare Signaling Server.

Ensure you install dependencies:
- Mobile: `npm install` inside the `mobile` folder.
- Signaling: `npm install` inside the `signaling` folder.
- Daemon: `cargo build` inside the `daemon` folder.

## Implement your fix or feature

At this point, you're ready to make your changes! Feel free to ask for help; everyone is a beginner at first :smile_cat:

## Submit a Pull Request

Once you've made your changes, open a Pull Request (PR). We will review it and merge it once it looks good.

Thanks again for your contribution!
