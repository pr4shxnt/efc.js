#!/usr/bin/env bash
# Skills/install.sh
# Installs EFC Claude Code skills from this repo into ~/.claude/skills/
# Run once after cloning, or again after updating skill files.
#
# Usage:
#   bash Skills/install.sh            # symlink (default — edits here reflect immediately)
#   bash Skills/install.sh --copy     # copy instead of symlink

set -euo pipefail

cat << 'ART'
              e x p r e s s - f i l e - c l u s t e r

ART

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/Skills"
SKILLS_DEST="$HOME/.claude/skills"
MODE="symlink"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --copy) MODE="copy" ;;
    --help)
      echo "Usage: bash Skills/install.sh [--copy]"
      echo "  (default) symlink — changes in Skills/ are reflected immediately"
      echo "  --copy    copy files — useful when the repo path may move"
      exit 0
      ;;
  esac
done

echo "Installing EFC skills → $SKILLS_DEST"
echo "Mode: $MODE"
echo ""

mkdir -p "$SKILLS_DEST"

# Find all skill directories (each contains a SKILL.md)
for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  dest="$SKILLS_DEST/$skill_name"

  # Remove existing installation (symlink or directory)
  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -d "$dest" ]; then
    rm -rf "$dest"
  fi

  if [ "$MODE" = "symlink" ]; then
    ln -s "$skill_dir" "$dest"
    echo "  ✓  symlinked  $skill_name  →  $dest"
  else
    cp -r "$skill_dir" "$dest"
    echo "  ✓  copied     $skill_name  →  $dest"
  fi
done

echo ""
echo "Done. Reload Claude Code (or start a new session) for skills to take effect."
echo "Invoke with: /efc"
