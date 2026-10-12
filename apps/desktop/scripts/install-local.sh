#!/bin/sh
# Installs the packaged app for the current user (no root): ~/.local/opt/co-write, a `co-write`
# command, a launcher entry with the icon, and co-write as the default app for Markdown.
# Run `pnpm install:local` from apps/desktop; re-run it to update.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
data=${XDG_DATA_HOME:-$HOME/.local/share}
opt=$HOME/.local/opt/co-write

pnpm --dir "$here" exec electron-vite build
pnpm --dir "$here" exec electron-builder --linux dir

rm -rf "$opt"
mkdir -p "$opt" "$HOME/.local/bin" "$data/applications" "$data/icons/hicolor/scalable/apps" "$data/icons/hicolor/512x512/apps"
cp -a "$here/dist/linux-unpacked/." "$opt/"
ln -sf "$opt/co-write" "$HOME/.local/bin/co-write"
cp "$here/resources/icon.svg" "$data/icons/hicolor/scalable/apps/co-write.svg"
cp "$here/resources/icon.png" "$data/icons/hicolor/512x512/apps/co-write.png"

cat > "$data/applications/co-write.desktop" <<DESKTOP
[Desktop Entry]
Name=co-write
Comment=Collaborative Markdown editor
Exec=$opt/co-write %U
Icon=co-write
Terminal=false
Type=Application
StartupWMClass=co-write
MimeType=text/markdown;
Categories=Office;TextEditor;
DESKTOP

update-desktop-database "$data/applications" 2>/dev/null || true
xdg-mime default co-write.desktop text/markdown
echo "Installed to $opt; default for text/markdown: $(xdg-mime query default text/markdown)"
