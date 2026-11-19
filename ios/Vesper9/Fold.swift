import UIKit

// The iPhone Duo (iOS 27.1), a folding iPhone. Its inner display is 951 x 669 points opened like a
// book (the crease a 40-point band down the middle at x 455.5, the status bar a column of 84 at the
// right) and 669 x 951 turned (the band across at y 455.5, the status bar a row of 82 along the
// top); closed, its outer display is an ordinary phone (466 x 678). The crease comes from iOS
// 27.1's reserved regions (the "division" kind) and the hinge from UIHingeInteraction (closed,
// part open, flat). This file is Boxset's DuoFold.swift, which reads them on Sam's Duo, cut down
// to what VESPER-9 needs: the page lays itself out (ios/layer/app.css), so all that is wanted
// here is what to tell it. Every other iPhone and iPad, and the Duo closed, is `.plain`.
//
// The simulator can't fold, so the build's pictures ask for one on the command line:
// `-VesperFold across|down` (a pretend 40-point crease across or down the middle of the window,
// which is made the Duo's own size with the Duo's safe areas) and `-VesperHinge half` (part open;
// flat when not given).

/// What the hinge says, where there is one.
enum Hinge: Equatable {
    case none
    case closed
    case partlyOpen
    case flat
}

/// How the phone is held, from its crease and its hinge. The raw values are the page's words.
enum Posture: String, Equatable {
    /// No fold: every other iPhone and iPad, and the Duo closed.
    case plain
    /// Opened flat, the crease down the middle.
    case openBook
    /// Part folded, the crease down the middle, held like a book.
    case halfBook
    /// Opened flat and turned, the crease across the middle.
    case openTall
    /// Part folded, the crease across, the lower half on the table like a laptop's keyboard deck.
    case laptop

    /// From the crease (nil: none) and whether it is folded now. The hinge's own word wins over
    /// the crease's when it has one: part open is folded, fully open is flat.
    static func of(crease: CGRect?, active: Bool, hinge: Hinge) -> Posture {
        guard let crease, !crease.isNull, !crease.isInfinite, max(crease.width, crease.height) > 0 else { return .plain }
        let folded: Bool
        switch hinge {
        case .partlyOpen: folded = true
        case .flat: folded = false
        case .closed, .none: folded = active
        }
        let down = crease.height >= crease.width
        switch (down, folded) {
        case (true, false): return .openBook
        case (true, true): return .halfBook
        case (false, false): return .openTall
        case (false, true): return .laptop
        }
    }
}

/// The fold, as the page is told it.
struct Fold: Equatable {
    var posture = Posture.plain
    /// The crease's band in the window's coordinates; nil when plain.
    var crease: CGRect?
    /// The window's size when it was read.
    var window = CGSize.zero
    /// The window's own safe areas when it was read: on the Duo its status column or row, and
    /// the home bar.
    var safe = UIEdgeInsets.zero
    /// A folding phone, open or closed. Its status bar is a column or row of its own beside the
    /// picture, kept clear whether or not anything is shown in it, so the app shows it there
    /// (VesperApp.swift). Known by its hinge, its crease, or side safe areas that differ (the
    /// Duo's column is at one side; every other iPhone's and iPad's sides are equal).
    var folding = false

    static let plain = Fold()

    /// For the page: `vesperApp.fold(...)` takes exactly this (ios/layer/app.js).
    var forPage: [String: Any] {
        var told: [String: Any] = [
            "posture": posture.rawValue,
            "window": [Double(window.width), Double(window.height)],
            "safe": [Double(safe.top), Double(safe.right), Double(safe.bottom), Double(safe.left)],
        ]
        if let crease, posture != .plain {
            told["crease"] = [Double(crease.minX), Double(crease.minY), Double(crease.width), Double(crease.height)]
        }
        return told
    }
}

/// The launch arguments that fake a fold on the simulator.
enum FoldDemo {
    /// `-VesperFold across|down`: a pretend crease (nil: the device's own).
    static let fold: String? = value(after: "-VesperFold")
    /// `-VesperHinge half`: the pretend fold part open; anything else, flat.
    static let half: Bool = value(after: "-VesperHinge") == "half"

    private static func value(after flag: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
        return arguments[i + 1]
    }

    /// The Duo's inner display for a pretend fold: 669 x 951 turned, 951 x 669 opened like a book.
    static var size: CGSize? {
        guard let fold else { return nil }
        return fold == "across" ? CGSize(width: 669, height: 951) : CGSize(width: 951, height: 669)
    }

    /// The Duo's safe areas there: the status row at the top turned, the status column at the
    /// right of a book; the home bar below.
    static var insets: UIEdgeInsets? {
        guard let fold else { return nil }
        return fold == "across" ? UIEdgeInsets(top: 82, left: 0, bottom: 34, right: 0)
            : UIEdgeInsets(top: 0, left: 0, bottom: 34, right: 84)
    }

    /// For the build's pictures: the window of `view` made the Duo's size, at the screen's top
    /// left. Nothing happens without a pretend fold.
    @MainActor
    static func dress(_ view: UIView) {
        guard let size, let window = view.window else { return }
        if window.frame.size != size || window.frame.origin != .zero {
            window.frame = CGRect(origin: .zero, size: size)
        }
    }
}

/// Where the crease is, read from a view (iOS 27.1's division region).
@MainActor
enum Crease {
    struct Reading: Equatable {
        /// In the window's coordinates.
        let frame: CGRect
        /// Part folded there now; false while the phone lies flat (the crease is still there).
        let active: Bool
    }

    /// The band measured on the Duo, used for the pretend one.
    static let band: CGFloat = 40

    static func read(in view: UIView) -> Reading? {
        guard let window = view.window ?? (view as? UIWindow) else { return nil }
        if let faked = FoldDemo.fold {
            let b = window.bounds
            if faked == "across" {
                return Reading(frame: CGRect(x: 0, y: (b.height / 2 - band / 2).rounded(), width: b.width, height: band), active: FoldDemo.half)
            }
            return Reading(frame: CGRect(x: (b.width / 2 - band / 2).rounded(), y: 0, width: band, height: b.height), active: FoldDemo.half)
        }
        if #available(iOS 27.1, *) {
            for region in view.reservedRegions(kind: .division, options: .includeInactive) {
                let f = region.frame
                guard !f.isNull, !f.isInfinite, max(f.width, f.height) > 0 else { continue }
                return Reading(frame: view.convert(f, to: nil), active: region.isActive)
            }
        }
        return nil
    }

    /// The fold read from a view now, with what the hinge last said.
    static func fold(in view: UIView, hinge: Hinge) -> Fold {
        guard let window = view.window ?? (view as? UIWindow) else { return .plain }
        let reading = read(in: view)
        let said: Hinge = FoldDemo.fold != nil ? (FoldDemo.half ? .partlyOpen : .flat) : hinge
        let posture = Posture.of(crease: reading?.frame, active: reading?.active ?? false, hinge: said)
        let safe = FoldDemo.insets ?? window.safeAreaInsets
        let folding: Bool
        if let faked = FoldDemo.fold {
            // The pretend fold is on an iPad, whose status bar is a row along the top: the Duo's
            // too when turned upright, but not opened like a book, where it is the column at
            // the right. The pretend book goes without, its column left empty.
            folding = faked == "across"
        } else {
            folding = hinge != Hinge.none || reading != nil || safe.left != safe.right
        }
        return Fold(posture: posture, crease: posture == .plain ? nil : reading?.frame, window: window.bounds.size,
                    safe: safe, folding: folding)
    }
}

/// An invisible view over the console that watches the fold of its window: the crease at once
/// when the window changes (a turn, the other display), the hinge only once it has stayed put
/// for a moment, so nothing jumps while the phone is being folded. It is never in the way of a
/// touch.
final class FoldProbe: UIView {
    /// Told each reading; the console passes it on to the page when it has changed.
    var onFold: (@MainActor (Fold) -> Void)?
    private var hinge = Hinge.none
    private var watching = false
    private var seenSize = CGSize.zero
    private var shown = Posture.plain
    private var settle: Task<Void, Never>?
    private var again: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { return nil }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? { nil }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let window else {
            settle?.cancel()
            settle = nil
            return
        }
        if !watching {
            watching = true
            watchHinge()
        }
        FoldDemo.dress(self)
        seenSize = window.bounds.size
        readNow()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        FoldDemo.dress(self)
        let size = window?.bounds.size ?? .zero
        guard size != seenSize else { return }
        seenSize = size
        readNow()
    }

    /// The window's safe areas changed (a turn, the other display): read again.
    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        guard window != nil else { return }
        readNow()
    }

    private func watchHinge() {
        if #available(iOS 27.1, *) {
            addInteraction(UIHingeInteraction { [weak self] _, update in
                guard let self else { return }
                var state = Hinge.none
                if let h = update.hinge {
                    switch h.status {
                    case .closed: state = .closed
                    case .partiallyOpen: state = .partlyOpen
                    case .fullyOpen: state = .flat
                    default: state = .none
                    }
                }
                guard state != self.hinge else { return }
                self.hinge = state
                self.hingeMoved()
            })
        }
    }

    /// The window changed: read at once, and again once a turn has finished (the regions can
    /// follow a moment after the bounds).
    private func readNow() {
        settle?.cancel()
        settle = nil
        publish(settled: false)
        again?.cancel()
        again = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 450_000_000)
            guard !Task.isCancelled, let self, self.settle == nil else { return }
            self.publish(settled: false)
        }
    }

    /// The hinge moved: nothing changes until it has stayed put for a moment.
    private func hingeMoved() {
        settle?.cancel()
        settle = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled, let self else { return }
            self.settle = nil
            self.publish(settled: true)
        }
    }

    private func publish(settled: Bool) {
        guard window != nil else { return }
        let fold = Crease.fold(in: self, hinge: hinge)
        // A soft click as a fold lands on a new posture, as Sam's other Duo apps do.
        if settled, fold.posture != shown, fold.posture != .plain {
            UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.5)
        }
        shown = fold.posture
        onFold?(fold)
    }
}
