# Contributing

Edit `src/`, then run `npm run check`. Commit the matching `dist/` files and confirm them with `node scripts/build.mjs --verify`. Keep asset paths relative and runtime dependencies at zero.

Add Node regression tests for engine, cache, or storage changes. Document any intentional change to trading behavior in the changelog. Check both desktop and narrow layouts when changing the terminal.
