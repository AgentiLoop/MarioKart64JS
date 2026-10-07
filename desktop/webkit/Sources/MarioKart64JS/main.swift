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
