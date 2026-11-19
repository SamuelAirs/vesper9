import SwiftUI

/// VESPER-9 on iPhone: one full-screen web view showing the console's own page (Console.swift).
/// The page keeps clear of the status area and the home bar itself (ios/layer/app.css), so the
/// view covers the whole display.
@main
struct VesperApp: App {
    var body: some Scene {
        WindowGroup {
            ConsoleView()
                .ignoresSafeArea()
                .background(Color(red: 12 / 255, green: 20 / 255, blue: 17 / 255).ignoresSafeArea())
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                // The button is at the bottom of the screen: a swipe home takes a second swipe.
                .defersSystemGestures(on: .all)
                .preferredColorScheme(.dark)
        }
    }
}
