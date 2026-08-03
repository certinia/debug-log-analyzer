/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Stands in for a `.css` / `.scss` import under jest. The build's CSS plugin compiles those to a
 * string (and injects a `<style>`); jest has no such transform, so a component that adopts real
 * styles — every one that takes `globalStyles`, which carries the `--lana-*` tokens — would fail
 * to load. jsdom applies no styling anyway, so an empty sheet loses no coverage.
 */
export default '';
