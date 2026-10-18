#!/bin/sh
#
#   Deploy ./dist to the static host.
#
#   A step that fails stops the deploy: the backup is the rollback point,
#   and without `set -e` a failed one would go on to the rsync.
#
#   The site is served from wattyzer; HOST can be overridden for a test
#   host (HOST=otherhost ./deploy_yunovideo.sh).
#
set -eu

SITE="yunovideo.com"
HOST="${HOST:-wattyzer}"

if [ ! -f ./dist/index.html ]; then
    echo "no ./dist/index.html: run 'npm run build' first" >&2
    exit 1
fi

#
#   Backup
#
BACKUP_DIR="/yuneta/gui/backups/$SITE/$(date +%Y%m%d_%H%M%S)"
ssh "yuneta@$HOST" "mkdir -p '$BACKUP_DIR' && cp -a '/yuneta/gui/$SITE/.' '$BACKUP_DIR/'"

#
#   Upload
#
rsync -avzL --delete \
    --exclude \.webassets-cache --exclude \.sass-cache --exclude \.cache \
    --filter 'P images/*' \
    ./dist/ \
    "yuneta@$HOST:/yuneta/gui/$SITE"

#
#   Read back what is served
#
echo
echo "deployed: $(grep '"version"' package.json)"
echo "served:   $(curl -s "https://$SITE/version.json" || echo '(could not read)')"
