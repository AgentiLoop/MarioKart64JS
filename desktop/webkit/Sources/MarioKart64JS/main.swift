// WebKit shell: a WKWebView that opens the hosted game by its web address (Info.plist MK64WebURL). No game files bundled.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    // Develop > Show Web Inspector (⌥⌘I): opens WebKit's inspector attached to this window (SPI _inspector.show).
    @objc func showWebInspector(_ sender: Any?) {
        guard let web, web.responds(to: NSSelectorFromString("_inspector")),
              let inspector = web.value(forKey: "_inspector") as? NSObject,
              inspector.responds(to: NSSelectorFromString("show")) else { return }
        inspector.perform(NSSelectorFromString("show"))
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        // right-click > Inspect Element inside the app itself (WKPreferences developerExtrasEnabled, set via KVC)
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 960), configuration: config)
        self.web = web
        if #available(macOS 13.3, *) { web.isInspectable = true }   // Safari > Develop > <this Mac> > MarioKart64JS: console shows the [net] logs
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "MarioKart64JS"
        window.backgroundColor = .black
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        // WKWebView reports devicePixelRatio = 1 on Retina for custom-scheme (app://) pages, so the canvas
        // renders at half resolution. Force the real backing scale (SPI used by Electron/Playwright); redo
        // it when the window moves to a screen with a different scale.
        let setScale = { [weak web, weak window] in
            let sel = NSSelectorFromString("_setOverrideDeviceScaleFactor:")
            guard let web, let scale = window?.backingScaleFactor, web.responds(to: sel) else { return }
            typealias Fn = @convention(c) (AnyObject, Selector, CGFloat) -> Void
            unsafeBitCast(web.method(for: sel), to: Fn.self)(web, sel, scale)
        }
        setScale()
        NotificationCenter.default.addObserver(forName: NSWindow.didChangeBackingPropertiesNotification,
                                               object: window, queue: .main) { _ in setScale() }
        let start = (Bundle.main.object(forInfoDictionaryKey: "MK64WebURL") as? String) ?? "https://mk64js.gokart.games/play"
        web.load(URLRequest(url: URL(string: start)!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let menu = NSMenu(), appItem = NSMenuItem()
menu.addItem(appItem)
appItem.submenu = NSMenu()
appItem.submenu!.addItem(withTitle: "Quit MarioKart64JS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
let delegate = AppDelegate()
let devItem = NSMenuItem()
menu.addItem(devItem)
devItem.submenu = NSMenu(title: "Develop")
let inspectItem = devItem.submenu!.addItem(withTitle: "Show Web Inspector",
                                           action: #selector(AppDelegate.showWebInspector(_:)), keyEquivalent: "i")
inspectItem.keyEquivalentModifierMask = [.command, .option]
inspectItem.target = delegate
app.mainMenu = menu
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
