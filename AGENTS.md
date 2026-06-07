# Project Rules

- After changing `acfun动态.user.js`, run `python update-tampermonkey.py` from this directory so Tampermonkey sees a higher `@version` and the local update server is available.
- Use `python update-tampermonkey.py --no-bump` only when the script content was not changed and you only need to restart or verify the local update server.
