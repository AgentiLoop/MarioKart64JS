#!/usr/bin/env python3
# Linux / Raspberry Pi webview shell: a GTK window with the system WebKitGTK that opens the hosted game by its web
# address (no game files bundled). Same 1280x960 window. Usage: mk64js.py [url]
# Needs: sudo apt install python3-gi gir1.2-webkit2-4.1   (Raspberry Pi OS Bookworm; Bullseye: gir1.2-webkit2-4.0)
import os
import sys

import gi

gi.require_version('Gtk', '3.0')
try:
    gi.require_version('WebKit2', '4.1')
except ValueError:
    gi.require_version('WebKit2', '4.0')
from gi.repository import Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.realpath(__file__))
URL = 'https://mk64js.gokart.games/play'


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MK64_WEB_URL', URL)
    view = WebKit2.WebView()
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
    view.load_uri(url)
    Gtk.main()


if __name__ == '__main__':
    main()
