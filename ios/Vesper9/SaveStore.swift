import Foundation

/// The app's own copy of the console's saved items (scores, progress, settings, timers).
///
/// The console keeps them in the web view's storage, which iOS may empty; this copy is one JSON
/// file in the app's Application Support folder, which iOS keeps and backs up with the phone.
/// The page reads it only for items the web view no longer has (ios/layer/app.js).
final class SaveStore {
    private(set) var items: [String: String] = [:]
    private let file: URL
    private let queue = DispatchQueue(label: "com.samuelairs.vesper9.saves")

    init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        file = folder.appendingPathComponent("saves.json")
        if let data = try? Data(contentsOf: file),
           let read = try? JSONDecoder().decode([String: String].self, from: data) {
            items = read
        }
    }

    func set(_ key: String, _ value: String) {
        guard items[key] != value else { return }
        items[key] = value
        write()
    }

    func remove(_ key: String) {
        guard items.removeValue(forKey: key) != nil else { return }
        write()
    }

    func replace(with new: [String: String]) {
        guard new != items else { return }
        items = new
        write()
    }

    /// Whole file, replaced in one step, off the main thread and in order.
    private func write() {
        let snapshot = items
        let file = self.file
        queue.async {
            guard let data = try? JSONEncoder().encode(snapshot) else { return }
            try? data.write(to: file, options: .atomic)
        }
    }
}
