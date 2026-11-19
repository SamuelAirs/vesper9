import SwiftUI
import UIKit
import WebKit

/// The console's page in a web view.
///
/// The page is the standalone console (the engine, every app and a simulated node in one file),
/// built by ios/build-web.py into the app's Web folder, with the app's own layer in its head
/// (ios/layer/app.js and app.css). This class is the other end of that layer:
///  - before the page runs it hands over the saved items it keeps (SaveStore), the console's own
///    saves if the person has put that file in the app's folder, the fold as first read, and
///    the app to open first if the launch arguments name one (`-VesperLaunch orbit`, used for
///    the build's pictures);
///  - it keeps its copy of the saves current from the page's messages;
///  - it answers each press of the on-screen button, and each tap on the on-screen case, with
///    the phone's haptics;
///  - it tells the page the window's size, its safe areas and, on iPhone Duo, where the crease
///    is and how the phone is held (Fold.swift), which the page lays itself out by.
@MainActor
final class Console: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private let saves = SaveStore()
    private let pressDown = UIImpactFeedbackGenerator(style: .rigid)
    private let pressUp = UIImpactFeedbackGenerator(style: .light)
    private let knock = UIImpactFeedbackGenerator(style: .soft)
    private weak var web: WKWebView?
    private var fold = Fold.plain
    private var started = false
    private var loaded = false

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        // The console's tones start with the first press; nothing plays before one.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let content = WKUserContentController()
        content.add(self, name: "vesper")
        configuration.userContentController = content

        let web = WKWebView(frame: .zero, configuration: configuration)
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

        // Over the whole view and never touched: it reads the window's size, safe areas and fold.
        let probe = FoldProbe(frame: web.bounds)
        probe.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        probe.onFold = { [weak self] fold in self?.folded(fold) }
        web.addSubview(probe)

        self.web = web
        Console.leaveNote()
        // The page is loaded at the probe's first reading, which comes as the view joins its
        // window, so its first picture is already laid out for the fold. Should no reading
        // come, it is loaded anyway.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            self?.start()
        }
        return web
    }

    private func start() {
        guard !started, let web = self.web else { return }
        started = true
        load(web)
    }

    // MARK: What the page is given

    /// What the page is given before any of it runs: `window.__vesperNative`. Made again for
    /// every load, so a page shown again gets the saves as they are now and never a file that
    /// has already been taken in.
    private func handover() -> String {
        var given: [String: Any] = ["saved": saves.items]
        let arguments = ProcessInfo.processInfo.arguments
        if let at = arguments.firstIndex(of: "-VesperLaunch"), at + 1 < arguments.count {
            given["launch"] = arguments[at + 1]
        }
        if let brought = Console.consoleSaves() {
            given["import"] = brought
        }
        if fold.window.width > 0, fold.window.height > 0 {
            given["fold"] = fold.forPage
        }
        guard let data = try? JSONSerialization.data(withJSONObject: given),
              let json = String(data: data, encoding: .utf8) else {
            return "window.__vesperNative = { saved: {} };"
        }
        return "window.__vesperNative = \(json);"
    }

    private func load(_ web: WKWebView) {
        loaded = false
        let content = web.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(source: handover(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        guard let folder = Bundle.main.url(forResource: "Web", withExtension: nil) else {
            web.loadHTMLString("<body style='background:#0c1411;color:#d9e5c9;font:16px monospace;padding:40px'>VESPER-9: the console's page is missing from this build.</body>", baseURL: nil)
            return
        }
        web.loadFileURL(folder.appendingPathComponent("index.html"), allowingReadAccessTo: folder)
    }

    // MARK: The console's own saves

    /// The app's folder, which the Files app shows as "VESPER-9" under On My iPhone.
    private static var documents: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    }

    private static let consoleSavesName = "console-saves.json"
    private static let broughtOverName = "console-saves (brought over).json"

    /// The console's saves, made from the Pi's data by ios/console-saves.py, if the person has
    /// put the file in the app's folder: an object with `scores` or `progress`.
    private static func consoleSaves() -> [String: Any]? {
        guard let file = documents?.appendingPathComponent(consoleSavesName),
              let data = try? Data(contentsOf: file), data.count < 8_000_000,
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              object["scores"] != nil || object["progress"] != nil else { return nil }
        return object
    }

    /// The page has taken the file in: set it aside under another name, so it is taken in once.
    private static func setConsoleSavesAside() {
        guard let folder = documents else { return }
        let done = folder.appendingPathComponent(broughtOverName)
        try? FileManager.default.removeItem(at: done)
        try? FileManager.default.moveItem(at: folder.appendingPathComponent(consoleSavesName), to: done)
    }

    /// A few words in the app's folder saying what it is for (and so that Files shows it).
    private static func leaveNote() {
        guard let folder = documents else { return }
        let note = folder.appendingPathComponent("READ ME.txt")
        guard !FileManager.default.fileExists(atPath: note.path) else { return }
        let words = """
        VESPER-9

        To bring over the progress and best scores from the console itself, put the file
        console-saves.json in this folder and open VESPER-9 again. It is taken in once and then
        renamed. This phone's settings are left as they are.

        """
        try? words.write(to: note, atomically: true, encoding: .utf8)
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
        case "imported":
            Console.setConsoleSavesAside()
        case "press":
            if (body["down"] as? Bool) == true {
                pressDown.impactOccurred(intensity: 0.9)
                pressUp.prepare()
            } else {
                pressUp.impactOccurred(intensity: 0.6)
                pressDown.prepare()
            }
        case "knock":
            // A tap on the case, on screen: softer than the button.
            knock.impactOccurred(intensity: 0.8)
        case "ready":
            pressDown.prepare()
        default:
            break
        }
    }

    // MARK: The window and the fold

    private func folded(_ new: Fold) {
        guard new != fold else { return }
        fold = new
        // Standing on the table like a small laptop, the console is looked at more than it is
        // touched: the screen stays on.
        UIApplication.shared.isIdleTimerDisabled = new.posture == .laptop
        if started { tellFold() } else { start() }
    }

    private func tellFold() {
        guard loaded, fold.window.width > 0, fold.window.height > 0,
              let data = try? JSONSerialization.data(withJSONObject: fold.forPage),
              let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.vesperApp && window.vesperApp.fold(\(json));", completionHandler: nil)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        tellFold()
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

struct ConsoleView: UIViewRepresentable {
    func makeCoordinator() -> Console {
        Console()
    }

    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.makeWebView()
    }

    func updateUIView(_ view: WKWebView, context: Context) {}
}
