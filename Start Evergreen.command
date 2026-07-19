#!/bin/zsh
cd "$(dirname "$0")" || exit 1
chmod +x start-evergreen.sh
./start-evergreen.sh
