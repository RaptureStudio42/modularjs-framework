#!/usr/bin/env bash

# --- 1. Préparatifs ---

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PACK_DIR="$TMP_DIR/pack"
PROJECT_DIR="$TMP_DIR/project"
mkdir -p "$PACK_DIR" "$PROJECT_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

step() {
  local label="$1"; shift
  if "$@" > "$TMP_DIR/last.log" 2>&1; then
    echo "✓ $label"
  else
    echo "✗ $label"
    echo "--- sortie de l'étape en échec ---"
    cat "$TMP_DIR/last.log"
    exit 1
  fi
}

check() {
  local label="$1" path="$2"
  if [ -e "$path" ]; then
    echo "✓ $label"
  else
    echo "✗ $label ($path introuvable)"
    exit 1
  fi
}

# --- 2. Build + pack du paquet (jamais dans le dépôt) ---

echo "▶ dist frais avant pack"
step "build:self" npm --prefix "$ROOT_DIR" run build:self

echo "▶ npm pack"
step "npm pack → $PACK_DIR" npm --prefix "$ROOT_DIR" pack --pack-destination "$PACK_DIR"

TARBALL="$(ls "$PACK_DIR"/modularjs-framework-*.tgz | head -n1)"
if [ -z "$TARBALL" ]; then
  echo "✗ tarball introuvable après npm pack"
  exit 1
fi
echo "✓ tarball produit : $(basename "$TARBALL")"

# --- 3. Projet vierge + installation du tarball ---

cd "$PROJECT_DIR" || exit 1
step "npm init -y (projet vierge)" npm init -y
step "npm install du tarball" npm install "$TARBALL"

# --- 4. CLI mjs — help, init, check, build ---

step "npx mjs --help répond" npx mjs --help
step "npx mjs init (scaffold)" npx mjs init
check "mjs.config.json scaffoldé" "$PROJECT_DIR/mjs.config.json"
check "app/modularjs/hello.mjs scaffoldé" "$PROJECT_DIR/app/modularjs/hello.mjs"
step "npx mjs check" npx mjs check
step "npx mjs build" npx mjs build
check "bundle compilé" "$PROJECT_DIR/public/modularjs/bundle.js"

# --- 5. Résolution des exports du package.json ---

step "import('modularjs-framework') résout" node -e "import('modularjs-framework').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })"
# './cli' exécute le CLI dès l'import (pas de garde main-module) : argv factice ('x' comble
# node/script, '--help' répond et sort en 0 sans toucher au disque)
step "import('modularjs-framework/cli') résout" node -e "import('modularjs-framework/cli').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })" -- x --help
step "import('modularjs-framework/testing') résout" node -e "import('modularjs-framework/testing').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })"
step "import('modularjs-framework/ws') résout" node -e "import('modularjs-framework/ws').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })"
step "import('modularjs-framework/mjs-server') résout" node -e "import('modularjs-framework/mjs-server').then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })"

echo ""
echo "✓ répétition générale VERTE de bout en bout"
