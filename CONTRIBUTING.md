# Contributing

Thank you for helping improve Lunixi Node.js SDK.

## How this repository works

This repository is published from Lunixi's internal source repository. Each
release arrives here as a single `Release x.y.z` commit with a `vx.y.z` tag, so
pull requests cannot be merged here directly.

- **Bugs and requests:** open an [issue](https://github.com/Lunixi-Payment/lunixi-node/issues/new/choose).
  This is the fastest way to get a fix.
- **Code suggestions:** you are welcome to open a pull request to show the
  change. We apply it in the source repository, credit you in the changelog and
  close the pull request when the release that contains it is published.

## Running it locally

```bash
npm run lint
npm test
```

## Before you open an issue

- Check that you are on the latest release.
- Include the Lunixi `requestId` from the error if you have one; it lets us
  find the request on our side.
- Never paste API keys, private keys, webhook secrets, tokens or customer data.
  For security problems follow [SECURITY.md](SECURITY.md) instead.

## Documentation

Integration guides are at https://docs.lunixi.com/sdks/node.
