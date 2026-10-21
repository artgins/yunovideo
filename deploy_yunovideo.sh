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
#   A first deploy to a host has nothing to back up: without the test, the
#   cp of a missing directory would stop it there (set -e).
ssh "yuneta@$HOST" "mkdir -p '$BACKUP_DIR' && if [ -d '/yuneta/gui/$SITE' ]; then cp -a '/yuneta/gui/$SITE/.' '$BACKUP_DIR/'; fi"

#
#   Upload
#
# --delay-updates + --delete-after: the new files land together at the end
# of the upload and the old ones are removed only after them, so a page
# loaded during the upload never gets an index.html whose chunks are not
# there yet. A tab still running the old build is told by its
# C_YUI_UPDATE_WATCH bar (gobj-ui) to reload.
rsync -avzL --delete-after --delay-updates \
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
