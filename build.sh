#!/bin/bash
# Builds the NOVA site into dist/. Uses only cat, mkdir and cp, so it runs on Netlify with nothing installed.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/assets
cat src/*.js > dist/assets/nova.js
{
cat <<'HEAD'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="NOVA AI: one command center for chat, code, research, games, images and planning.">
<title>NOVA AI</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Rajdhani:wght@500;600;700&family=Sora:wght@600;700&display=swap">
<style>
HEAD
cat nova.css
cat nova-plus.css
cat <<'MID'
</style>
</head>
<body>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js"></script>
<script src="/assets/nova.js"></script>
</body>
</html>
MID
} > dist/index.html
cp public/favicon.svg dist/favicon.svg
echo "built dist/index.html"
