#!/usr/bin/env python3
# Raspberry Pi (Linux) webview shell: a GTK window with the system WebKitGTK serving the Vite build (game/) over
# app://game, like the Electron and macOS WebKit apps, so absolute paths and fetch() work. Same 1280x960 window.
# Needs: sudo apt install python3-gi gir1.2-webkit2-4.1   (Raspberry Pi OS Bookworm; Bullseye: gir1.2-webkit2-4.0)
import mimetypes
import os
import sys

import gi

gi.require_version('Gtk', '3.0')
try:
    gi.require_version('WebKit2', '4.1')
except ValueError:
    gi.require_version('WebKit2', '4.0')
from gi.repository import Gio, GLib, Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.realpath(__file__))
ROOT = os.path.join(HERE, 'game')
MIME = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html',
        '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'}


def serve(req):
    rel = GLib.uri_unescape_string(req.get_path() or '/', None) or '/'
    path = os.path.normpath(os.path.join(ROOT, 'index.html' if rel == '/' else rel.lstrip('/')))
    if not path.startswith(ROOT + os.sep) or not os.path.isfile(path):
        req.finish_error(GLib.Error.new_literal(Gio.io_error_quark(), 'not found', Gio.IOErrorEnum.NOT_FOUND))
        return
    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
    req.finish(Gio.File.new_for_path(path).read(None), os.path.getsize(path), mime)


def main():
    if not os.path.isfile(os.path.join(ROOT, 'index.html')):
        sys.exit(f'error: {ROOT} missing')
    ctx = WebKit2.WebContext.get_default()
    ctx.register_uri_scheme('app', serve)
    sec = ctx.get_security_manager()
    sec.register_uri_scheme_as_secure('app')        # secure context: AudioWorklet, gamepads
    sec.register_uri_scheme_as_cors_enabled('app')  # fetch() of the game's own files

    view = WebKit2.WebView.new_with_context(ctx)
    s = view.get_settings()
    s.set_enable_webgl(True)
    s.set_enable_webaudio(True)
    s.set_media_playback_requires_user_gesture(False)
    s.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)

    win = Gtk.Window(title='MarioKart64JS')
    win.set_default_size(1280, 960)
    icon = os.path.join(HERE, 'MK64JS.png')
    if os.path.isfile(icon):
        win.set_icon_from_file(icon)
    win.add(view)
    win.connect('destroy', Gtk.main_quit)
    win.show_all()
    view.load_uri('app://game/index.html')
    Gtk.main()


if __name__ == '__main__':
    main()
