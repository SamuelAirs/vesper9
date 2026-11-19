import SwiftUI
import UIKit
import WebKit

/// The console's page in a web view.
///
/// The page is the standalone console (the engine, every app and a simulated node in one file),
/// built by ios/build-web.py into the app's Web folder, with the app's own layer in its head
/// (ios/layer/app.js and app.css). This class is the other end of that layer:
///  - before the page runs it hands over the saved items it keeps (SaveStore) and the app to open
///    first, if the launch arguments name one (`-VesperLaunch orbit`, used for the build's pictures);
///  - it keeps its copy of the saves current from the page's messages;
///  - it answers each press of the on-screen button with the phone's haptics;
///  - it tells the page the web view's real size, which the page fits its layout to.
@MainActor
final class Console: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private let saves = SaveStore()
    private let pressDown = UIImpactFeedbackGenerator(style: .rigid)
    private let pressUp = UIImpactFeedbackGenerator(style: .light)
    private weak var web: ConsoleWebView?
    private var size = CGSize.zero

    func makeWebView() -> ConsoleWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        // The console's tones start with the first press; nothing plays before one.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let content = WKUserContentController()
        content.add(self, name: "vesper")
        content.addUserScript(WKUserScript(source: handover(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = content

        let web = ConsoleWebView(frame: .zero, configuration: configuration)
        let screen = UIColor(red: 12 / 255, green: 20 / 255, blue: 17 / 255, alpha: 1)
        web.isOpaque = false
        web.backgroundColor = screen
        web.scrollView.backgroundColor = screen
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.scrollView.showsHorizontalScrollIndicator = false
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.navigationDelegate = self
        #if DEBUG
        web.isInspectable = true
        #endif
        web.onSize = { [weak self] size in self?.sized(size) }
        self.web = web
        load(web)
        return web
    }

    /// What the page is given before any of it runs: `window.__vesperNative`.
    private func handover() -> String {
        var given: [String: Any] = ["saved": saves.items]
        let arguments = ProcessInfo.processInfo.arguments
        if let at = arguments.firstIndex(of: "-VesperLaunch"), at + 1 < arguments.count {
            given["launch"] = arguments[at + 1]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: given),
              let json = String(data: data, encoding: .utf8) else {
            return "window.__vesperNative = { saved: {} };"
        }
        return "window.__vesperNative = \(json);"
    }

    private func load(_ web: WKWebView) {
        guard let folder = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            web.loadHTMLString("<body style='background:#0c1411;color:#d9e5c9;font:16px monospace;padding:40px'>VESPER-9: the console's page is missing from this build.</body>", baseURL: nil)
            return
        }
        web.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
    }

    // MARK: The page's messages

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "vesper", let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        switch type {
        case "saves":
            if let items = body["items"] as? [String: String] { saves.replace(with: items) }
        case "save":
            if let key = body["key"] as? String, let value = body["value"] as? String { saves.set(key, value) }
        case "remove":
            if let key = body["key"] as? String { saves.remove(key) }
        case "clear":
            saves.replace(with: [:])
        case "press":
            if (body["down"] as? Bool) == true {
                pressDown.impactOccurred(intensity: 0.9)
                pressUp.prepare()
            } else {
                pressUp.impactOccurred(intensity: 0.6)
                pressDown.prepare()
            }
        case "ready":
            pressDown.prepare()
        default:
            break
        }
    }

    // MARK: Size

    private func sized(_ size: CGSize) {
        guard size.width > 0, size.height > 0, size != self.size else { return }
        self.size = size
        tellSize()
    }

    private func tellSize() {
        guard size.width > 0, size.height > 0 else { return }
        web?.evaluateJavaScript("window.vesperApp && window.vesperApp.fit(\(Double(size.width)), \(Double(size.height)));", completionHandler: nil)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        tellSize()
    }

    /// Only the console's own page is shown here; any other link opens in the phone's browser.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.isFileURL || url.scheme == "about" { return .allow }
        if url.scheme == "https" || url.scheme == "http" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return .cancel
    }

    /// iOS can end the page's process while the app is in the background: show the page again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load(webView)
    }
}

/// The web view, saying when its size changes (a turn of the phone, the Duo opening).
final class ConsoleWebView: WKWebView {
    var onSize: (@MainActor (CGSize) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onSize?(bounds.size)
    }
}

struct ConsoleView: UIViewRepresentable {
    func makeCoordinator() -> Console {
        Console()
    }

    func makeUIView(context: Context) -> ConsoleWebView {
        context.coordinator.makeWebView()
    }

    func updateUIView(_ view: ConsoleWebView, context: Context) {}
}
