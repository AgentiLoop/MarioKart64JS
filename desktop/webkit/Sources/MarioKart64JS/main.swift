// WebKit shell: serves the Vite build (Resources/game) over app://game so absolute paths and fetch() work.
import AppKit
import UniformTypeIdentifiers
import WebKit

final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    let root = Bundle.main.resourceURL!.appendingPathComponent("game").standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        let rel = url.path.removingPercentEncoding ?? url.path
        let file = root.appendingPathComponent(rel == "/" ? "index.html" : rel).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(r); task.didReceive(Data()); task.didFinish(); return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)"])!
        task.didReceive(r); task.didReceive(data); task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let handler = GameSchemeHandler()

    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(handler, forURLScheme: "app")
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 960), configuration: config)
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
        web.load(URLRequest(url: URL(string: "app://game/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let menu = NSMenu(), appItem = NSMenuItem()
menu.addItem(appItem)
appItem.submenu = NSMenu()
appItem.submenu!.addItem(withTitle: "Quit MarioKart64JS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
app.mainMenu = menu
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
