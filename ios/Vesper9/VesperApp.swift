import SwiftUI

/// VESPER-9 on iPhone: one full-screen web view showing the console's own page (Console.swift).
/// The page keeps clear of the status area and the home bar itself (ios/layer/10-base.css), so
/// the view covers the whole display.
///
/// The status bar is hidden, as in any game, except on a folding phone: iPhone Duo keeps a
/// column (or, turned, a row) for it beside the picture whether or not anything is shown there,
/// so the clock and the battery may as well be.
@main
struct VesperApp: App {
    @State private var statusBar = false

    var body: some Scene {
        WindowGroup {
            ConsoleView(statusBar: $statusBar)
                .ignoresSafeArea()
                .background(Color(red: 12 / 255, green: 20 / 255, blue: 17 / 255).ignoresSafeArea())
                .statusBarHidden(!statusBar)
                .persistentSystemOverlays(.hidden)
                // The button is at the bottom of the screen: a swipe home takes a second swipe.
                .defersSystemGestures(on: .all)
                .preferredColorScheme(.dark)
        }
    }
}
