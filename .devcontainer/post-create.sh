#!/bin/sh
set -e

npm install -g npm@latest
npm ci
npm run build
npm install -g @openai/codex
npm install -g @github/copilot
