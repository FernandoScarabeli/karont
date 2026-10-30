#!/usr/bin/env bash
# Uso: source scripts/local-env.sh
# Runtime e configuração locais; não altera o Node do sistema.
karont_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -x "$karont_root/.tools/node-v24.22.1-linux-x64/bin/node" ]]; then
  echo 'Node local ausente em .tools/node-v24.22.1-linux-x64.' >&2
  return 1 2>/dev/null || exit 1
fi
export PATH="$karont_root/.tools/node-v24.22.1-linux-x64/bin:$PATH"
export npm_config_cache="$karont_root/.tools/npm-cache"
export KARONT_DOTS_CONFIG="$karont_root/.tools/dots.json"
unset karont_root
