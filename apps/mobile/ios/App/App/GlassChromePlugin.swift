import Capacitor
import UIKit
import WebKit

/// The chat's header and composer in the system's Liquid Glass (iOS 26+), drawn over the web view so the glass bends the
/// transcript scrolling under it. A web view cannot draw this material itself. The page keeps its own header and
/// composer in place, invisible, and this plugin hands every tap and keystroke back to them. Older iOS answers
/// unsupported and the page draws its own chrome.
@objc(GlassChromePlugin)
public class GlassChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GlassChromePlugin"
    public let jsName = "DuskGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "supported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setText", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setAvatar", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "focus", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "blur", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnNone),
    ]

    private var chrome: AnyObject?

    @objc func supported(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) { call.resolve(["supported": true]) } else { call.resolve(["supported": false]) }
    }

    @available(iOS 26.0, *)
    private func withChrome(_ body: @escaping (ChatGlassChrome) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let chrome = self.chrome as? ChatGlassChrome { body(chrome); return }
            guard let host = self.bridge?.nativeHost else { return }
            let chrome = ChatGlassChrome(host: host) { [weak self] event in self?.notifyListeners("glass", data: event) }
            self.chrome = chrome
            body(chrome)
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        let options = call.options as? [String: Any] ?? [:]
        withChrome { $0.apply(options) }
    }

    @objc func setText(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        let text = call.getString("text") ?? ""
        let seq = call.getInt("seq") ?? 0
        withChrome { $0.setText(text, seq: seq) }
    }

    @objc func setAvatar(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        let data = call.getString("data")
        withChrome { $0.setAvatar(data) }
    }

    @objc func focus(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        withChrome { $0.focus() }
    }

    @objc func blur(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        withChrome { $0.blur() }
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { return }
        withChrome { $0.apply([:]) }
    }
}

/// Lets touches through everywhere but on its own controls.
private class PassthroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

/// A 36pt disc that answers the 44pt square around it (HIG minimum hit region).
private class DiscButton: UIButton {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.insetBy(dx: min(0, (bounds.width - 44) / 2), dy: min(0, (bounds.height - 44) / 2)).contains(point)
    }
}

private struct Frame {
    let rect: CGRect
    init?(_ value: Any?) {
        guard let d = value as? [String: Any], let x = (d["x"] as? NSNumber)?.doubleValue, let y = (d["y"] as? NSNumber)?.doubleValue,
              let w = (d["w"] as? NSNumber)?.doubleValue, let h = (d["h"] as? NSNumber)?.doubleValue else { return nil }
        rect = CGRect(x: x, y: y, width: w, height: h)
    }
}

@available(iOS 26.0, *)
final class ChatGlassChrome: NSObject, UITextViewDelegate {
    private static let capsuleHeight: CGFloat = 48
    private static let inset: CGFloat = 6
    private static let disc: CGFloat = 36
    private static let maxLines: CGFloat = 5

    private weak var host: UIView?
    private let emit: ([String: Any]) -> Void

    private let header = PassthroughView()
    private let back = UIButton(configuration: .glass())
    private let pill = UIButton(configuration: .glass())
    private let right = UIButton(configuration: .glass())
    private let liveDot = UIView()

    private let composer = PassthroughView()
    private let capsule = UIVisualEffectView(effect: UIGlassEffect(style: .regular))
    private let plus = DiscButton(configuration: .glass())
    private let text = UITextView()
    private let placeholder = UILabel()
    private let voice = UILabel()
    private var actions: [UIButton] = []
    private var actionKinds: [String] = []

    private var leading: NSLayoutConstraint!
    private var width: NSLayoutConstraint!
    private var height: NSLayoutConstraint!
    private var bottom: NSLayoutConstraint!

    private var headerShown = false
    private var composerShown = false
    /// the page draws its own chrome in the same place (a sheet over the chat), or did until now: the two swap at once,
    /// never crossfade, or both show (or neither) for the length of the fade
    private var handoff = false
    private var instant = false
    private var returnSends = true
    private var textSeq = 0
    private var reportedHeight: CGFloat = 0
    private var accent = UIColor.systemBlue
    private var avatar: UIImage?
    private var name = ""

    init(host: UIView, emit: @escaping ([String: Any]) -> Void) {
        self.host = host
        self.emit = emit
        super.init()
        build(in: host)
    }

    private func build(in host: UIView) {
        header.frame = host.bounds
        header.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        header.alpha = 0
        header.isHidden = true
        host.addSubview(header)
        round(back, symbol: "chevron.left", label: "Back") { [weak self] in self?.emit(["type": "tap", "target": "back"]) }
        round(right, symbol: "display", label: "Computer") { [weak self] in self?.emit(["type": "tap", "target": "right"]) }
        pill.configuration?.cornerStyle = .capsule
        pill.configuration?.imagePadding = 8
        pill.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 7, bottom: 0, trailing: 16)
        pill.configuration?.titleLineBreakMode = .byTruncatingTail
        pill.addAction(UIAction { [weak self] _ in self?.emit(["type": "tap", "target": "title"]) }, for: .touchUpInside)
        liveDot.backgroundColor = .systemGreen
        liveDot.layer.cornerRadius = 4
        liveDot.isUserInteractionEnabled = false
        liveDot.isHidden = true
        right.addSubview(liveDot)
        [back, pill, right].forEach(header.addSubview)

        composer.translatesAutoresizingMaskIntoConstraints = false
        composer.alpha = 0
        composer.isHidden = true
        host.addSubview(composer)
        capsule.cornerConfiguration = .capsule(maximumRadius: Self.capsuleHeight / 2)
        capsule.frame = composer.bounds
        capsule.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        capsule.contentView.isUserInteractionEnabled = true
        composer.addSubview(capsule)

        round(plus, symbol: "plus", label: "Add") { [weak self] in self?.emit(["type": "tap", "target": "plus"]) }
        text.backgroundColor = .clear
        text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true
        text.textContainerInset = .zero
        text.textContainer.lineFragmentPadding = 0
        text.isScrollEnabled = false
        text.returnKeyType = .send
        text.delegate = self
        placeholder.font = text.font
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.textColor = .placeholderText
        placeholder.lineBreakMode = .byTruncatingTail
        placeholder.isUserInteractionEnabled = false
        voice.font = text.font
        voice.textColor = .secondaryLabel
        voice.lineBreakMode = .byTruncatingHead
        voice.isHidden = true
        [plus, text, placeholder, voice].forEach(capsule.contentView.addSubview)
        capsule.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(capsuleTapped)))

        leading = composer.leadingAnchor.constraint(equalTo: host.leadingAnchor)
        width = composer.widthAnchor.constraint(equalToConstant: 300)
        height = composer.heightAnchor.constraint(equalToConstant: Self.capsuleHeight)
        bottom = composer.bottomAnchor.constraint(equalTo: host.keyboardLayoutGuide.topAnchor, constant: -8)
        NSLayoutConstraint.activate([leading, width, height, bottom])

        NotificationCenter.default.addObserver(self, selector: #selector(contentSizeChanged), name: UIContentSizeCategory.didChangeNotification, object: nil)
    }

    private func round(_ button: UIButton, symbol: String, label: String, action: @escaping () -> Void) {
        button.configuration?.cornerStyle = .capsule
        button.configuration?.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold))
        button.configuration?.baseForegroundColor = .label
        button.accessibilityLabel = label
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    }

    // MARK: state from the page

    func apply(_ state: [String: Any]) {
        if let dark = state["dark"] as? Bool {
            let style: UIUserInterfaceStyle = dark ? .dark : .light
            header.overrideUserInterfaceStyle = style
            composer.overrideUserInterfaceStyle = style
        }
        if let hex = state["accent"] as? String, let color = UIColor(cssHex: hex) { accent = color }
        let handing = state["handoff"] as? Bool ?? false
        instant = handing || handoff
        handoff = handing
        applyHeader(state["header"] as? [String: Any])
        applyComposer(state["composer"] as? [String: Any])
        keepOnTop()
    }

    /// views the system adds to the host later must not land over the chrome and take its taps
    private func keepOnTop() {
        guard let host, headerShown || composerShown else { return }
        let tail = Array(host.subviews.suffix(2))
        if tail.first !== header || tail.last !== composer {
            host.bringSubviewToFront(header)
            host.bringSubviewToFront(composer)
        }
    }

    private func applyHeader(_ data: [String: Any]?) {
        guard let data, let backFrame = Frame(data["back"]), let titleFrame = Frame(data["title"]) else {
            show(header, false, &headerShown)
            return
        }
        back.frame = backFrame.rect
        if let label = data["backLabel"] as? String, !label.isEmpty { back.accessibilityLabel = label }
        let newName = data["name"] as? String ?? ""
        if newName != name { name = newName; refreshPill() }
        pill.accessibilityLabel = data["titleLabel"] as? String ?? newName
        if let rightFrame = Frame(data["right"]) {
            right.isHidden = false
            right.frame = rightFrame.rect
            right.accessibilityLabel = data["rightLabel"] as? String
            liveDot.isHidden = !(data["live"] as? Bool ?? false)
            liveDot.frame = CGRect(x: rightFrame.rect.width - 14, y: 6, width: 8, height: 8)
        } else {
            right.isHidden = true
        }
        let side: CGFloat = 16 + 44 + 8
        let maxWidth = max(80, (host?.bounds.width ?? 390) - side * 2)
        let fitted = pill.sizeThatFits(CGSize(width: maxWidth, height: 44))
        let pillWidth = min(maxWidth, ceil(fitted.width))
        pill.frame = CGRect(x: titleFrame.rect.midX - pillWidth / 2, y: titleFrame.rect.midY - 22, width: pillWidth, height: 44)
        show(header, true, &headerShown)
    }

    private func refreshPill() {
        var title = AttributedString(name)
        title.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        pill.configuration?.attributedTitle = title
        pill.configuration?.baseForegroundColor = .label
        pill.configuration?.image = avatar
    }

    func setAvatar(_ data: String?) {
        avatar = data.flatMap(Self.image(fromDataURL:)).map { Self.pixelScaled($0, to: CGSize(width: 30, height: 30)) }
        refreshPill()
    }

    private func applyComposer(_ data: [String: Any]?) {
        guard let data, let frame = Frame(data["frame"]), host != nil else {
            if text.isFirstResponder { text.resignFirstResponder() }
            show(composer, false, &composerShown)
            return
        }
        leading.constant = frame.rect.minX
        width.constant = frame.rect.width
        if let gap = (data["gap"] as? NSNumber)?.doubleValue { bottom.constant = -CGFloat(max(0, gap)) }
        plus.isHidden = !(data["plus"] as? Bool ?? true)
        if let label = data["plusLabel"] as? String, !label.isEmpty { plus.accessibilityLabel = label }
        placeholder.text = data["placeholder"] as? String ?? ""
        text.isEditable = !(data["disabled"] as? Bool ?? false)
        returnSends = data["returnSends"] as? Bool ?? true
        text.returnKeyType = returnSends ? .send : .default
        let heard = data["voice"] as? String
        voice.isHidden = heard == nil
        voice.text = heard
        text.isHidden = heard != nil
        if heard != nil, text.isFirstResponder { text.resignFirstResponder() }
        applyActions(data["buttons"] as? [[String: Any]] ?? [])
        updatePlaceholder()
        layoutComposer()
        show(composer, true, &composerShown)
    }

    /// the round button at the end of the pill: the mic at rest, Send once there is text, Stop while the bot works
    private static let slotKinds: Set<String> = ["mic", "send", "micSend", "stop", "waits"]

    private func applyActions(_ buttons: [[String: Any]]) {
        let kinds = buttons.map { $0["kind"] as? String ?? "" }
        if kinds != actionKinds {
            let oldKinds = actionKinds
            // the mic beside the round button (Send, or a working bot's Stop): it springs out of the round button and
            // slips back into it, as composer-mic-in and composer-mic-out do on the page
            let hadBeside = oldKinds.dropLast().contains("mic")
            let hasBeside = kinds.dropLast().contains("mic")
            // the slot keeps one button and one frame through mic, Send and Stop: only its symbol changes
            let keep: UIButton? = {
                guard let last = actions.last, let was = oldKinds.last, let now = kinds.last,
                      Self.slotKinds.contains(was), Self.slotKinds.contains(now) else { return nil }
                return last
            }()
            let leaving = zip(actions, oldKinds).filter { $0.0 !== keep }
            actions = kinds.enumerated().map { index, kind in
                if index == kinds.count - 1, let keep {
                    configure(keep, kind: kind, index: index)
                    return keep
                }
                let button = DiscButton(configuration: .glass())
                configure(button, kind: kind, index: index)
                capsule.contentView.addSubview(button)
                return button
            }
            actionKinds = kinds
            layoutComposer()
            for (button, kind) in leaving {
                button.isUserInteractionEnabled = false
                if kind == "mic" && hadBeside && !hasBeside && keep != nil {
                    ComposerMotion.leave(button) { button.removeFromSuperview() }
                } else {
                    button.removeFromSuperview()
                }
            }
            let had = Set(oldKinds)
            for (index, (button, kind)) in zip(actions, kinds).enumerated() where button !== keep {
                if kind == "mic" && index < kinds.count - 1 && !hadBeside && keep != nil { ComposerMotion.micIn(button) }
                else if (kind == "send" || kind == "micSend") && !had.contains(kind) { ComposerMotion.popIn(button) }
            }
        }
        for (button, data) in zip(actions, buttons) {
            button.isEnabled = !(data["disabled"] as? Bool ?? false)
            if let label = data["label"] as? String, !label.isEmpty { button.accessibilityLabel = label }
            paint(button, kind: data["kind"] as? String ?? "", fill: data["fill"] as? String, ink: data["ink"] as? String)
        }
    }

    private static func prominent(_ kind: String) -> Bool { kind == "send" || kind == "micSend" }

    /// Send wears the page's own fill for it (the bot's button, per the app's light or dark look, as on the desktop)
    private func paint(_ button: UIButton, kind: String, fill: String?, ink: String?) {
        guard Self.prominent(kind) else { return }
        let tint = fill.flatMap(UIColor.init(cssHex:)) ?? accent
        let foreground = ink.flatMap(UIColor.init(cssHex:)) ?? .white
        if button.tintColor != tint { button.tintColor = tint }
        if button.configuration?.baseForegroundColor != foreground { button.configuration?.baseForegroundColor = foreground }
    }

    private func configure(_ button: UIButton, kind: String, index: Int) {
        let prominent = Self.prominent(kind)
        var config: UIButton.Configuration = prominent ? .prominentGlass() : kind == "followUp" ? .plain() : .glass()
        let symbol: String
        let size: CGFloat
        let weight: UIImage.SymbolWeight
        switch kind {
        case "mic": (symbol, size, weight) = ("mic.fill", 17, .semibold)
        case "send", "micSend": (symbol, size, weight) = ("arrow.up", 16, .bold)
        // a filled square reads larger than an arrow at the same point size
        case "stop": (symbol, size, weight) = ("stop.fill", 13, .bold)
        case "waits": (symbol, size, weight) = ("clock", 16, .semibold)
        case "followUp": (symbol, size, weight) = ("chevron.up", 15, .semibold)
        case "discard": (symbol, size, weight) = ("xmark", 15, .semibold)
        default: (symbol, size, weight) = ("circle", 15, .semibold)
        }
        config.cornerStyle = .capsule
        config.contentInsets = .zero
        config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: size, weight: weight)
        config.image = UIImage(systemName: symbol)
        config.symbolContentTransition = UISymbolContentTransition(UIAccessibility.isReduceMotionEnabled ? .automatic : .replace)
        config.baseForegroundColor = prominent ? .white : kind == "mic" ? .secondaryLabel : .label
        button.configuration = config
        button.tintColor = prominent ? accent : nil
        button.enumerateEventHandlers { action, _, event, _ in if let action { button.removeAction(action, for: event) } }
        button.addAction(UIAction { [weak self] _ in self?.emit(["type": "button", "index": index, "kind": kind]) }, for: .touchUpInside)
    }

    private func show(_ view: UIView, _ visible: Bool, _ shown: inout Bool) {
        guard visible != shown else { return }
        shown = visible
        if instant {
            view.layer.removeAllAnimations()
            view.alpha = visible ? 1 : 0
            view.isHidden = !visible
            return
        }
        if visible { view.isHidden = false }
        UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            view.alpha = visible ? 1 : 0
        } completion: { _ in
            if !visible && view.alpha == 0 { view.isHidden = true }
        }
    }

    // MARK: layout

    /// `animated` false when the page set the text (a send clearing it): the page re-pins the chat to the new height in
    /// the same frame, so the capsule must not spring there behind it
    private func layoutComposer(animated: Bool = true) {
        let w = width.constant
        let line = text.font?.lineHeight ?? 20
        let side = Self.inset + Self.disc + 8
        let actionsWidth = actionKinds.reduce(CGFloat(0)) { $0 + Self.actionWidth($1) + 6 }
        let leadingX = plus.isHidden ? 16 : side
        let fieldWidth = max(40, w - leadingX - actionsWidth - (actions.isEmpty ? 16 : Self.inset + 2))
        let fitted = text.sizeThatFits(CGSize(width: fieldWidth, height: .greatestFiniteMagnitude)).height
        let maxText = ceil(line * Self.maxLines)
        let textHeight = min(max(line, ceil(fitted)), maxText)
        text.isScrollEnabled = fitted > maxText
        let pad = (Self.capsuleHeight - line) / 2
        let h = max(Self.capsuleHeight, textHeight + pad * 2)
        if height.constant != h {
            height.constant = h
            if animated { UIView.animate(springDuration: 0.3, bounce: 0) { self.host?.layoutIfNeeded() } } else { host?.layoutIfNeeded() }
        }
        let discY = h - Self.inset - Self.disc
        plus.frame = CGRect(x: Self.inset, y: discY, width: Self.disc, height: Self.disc)
        text.frame = CGRect(x: leadingX, y: pad, width: fieldWidth, height: h - pad * 2)
        placeholder.frame = CGRect(x: leadingX, y: pad, width: fieldWidth, height: line)
        voice.frame = placeholder.frame
        var x = w - Self.inset
        for (button, kind) in zip(actions, actionKinds).reversed() {
            let bw = Self.actionWidth(kind)
            x -= bw
            button.frame = CGRect(x: x, y: discY, width: bw, height: Self.disc)
            x -= 6
        }
        if h != reportedHeight {
            reportedHeight = h
            emit(["type": "height", "height": h])
        }
    }

    private static func actionWidth(_ kind: String) -> CGFloat { kind == "followUp" ? 24 : disc }

    @objc private func contentSizeChanged() { layoutComposer() }

    @objc private func capsuleTapped() { focus() }

    // MARK: text

    func setText(_ value: String, seq: Int) {
        guard seq > textSeq else { return }
        textSeq = seq
        if text.text != value {
            text.text = value
            updatePlaceholder()
            layoutComposer(animated: false)
        }
    }

    func focus() {
        guard composerShown, text.isEditable, !text.isHidden else { return }
        text.becomeFirstResponder()
    }

    func blur() {
        if text.isFirstResponder { text.resignFirstResponder() }
    }

    private func updatePlaceholder() {
        placeholder.isHidden = !(text.text ?? "").isEmpty || !voice.isHidden
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
        if returnSends && replacement == "\n" {
            emit(["type": "submit"])
            return false
        }
        return true
    }

    func textViewDidChange(_ textView: UITextView) {
        updatePlaceholder()
        layoutComposer()
        emit(["type": "text", "text": textView.text ?? ""])
    }

    func textViewDidBeginEditing(_ textView: UITextView) { emit(["type": "focus", "focused": true]) }
    func textViewDidEndEditing(_ textView: UITextView) { emit(["type": "focus", "focused": false]) }

    // MARK: images

    private static func image(fromDataURL url: String) -> UIImage? {
        guard let comma = url.firstIndex(of: ","), url.hasPrefix("data:image/") else { return nil }
        guard let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    /// pixel art stays crisp: nearest neighbour, then the 30pt circle the pill shows
    private static func pixelScaled(_ image: UIImage, to size: CGSize) -> UIImage {
        let format = UIGraphicsImageRendererFormat.preferred()
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
            context.cgContext.interpolationQuality = .none
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: size.width / 2).addClip()
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return rendered.withRenderingMode(.alwaysOriginal)
    }
}

/// The desktop composer's swaps (src/styles/composer.css) in UIKit: the same curves and durations, so a turn starting
/// and ending moves the same on both. Reduce Motion keeps the fades and drops the travel.
@available(iOS 26.0, *)
private enum ComposerMotion {
    static let glyphEase = UICubicTimingParameters(controlPoint1: CGPoint(x: 0.22, y: 1), controlPoint2: CGPoint(x: 0.36, y: 1))
    static let leaveEase = UICubicTimingParameters(controlPoint1: CGPoint(x: 0.4, y: 0), controlPoint2: CGPoint(x: 1, y: 1))
    static var reduced: Bool { UIAccessibility.isReduceMotionEnabled }

    private static func run(_ duration: TimeInterval, _ timing: UITimingCurveProvider, delay: TimeInterval = 0, _ change: @escaping () -> Void, done: (() -> Void)? = nil) {
        let animator = UIViewPropertyAnimator(duration: duration, timingParameters: timing)
        animator.addAnimations(change)
        if let done { animator.addCompletion { _ in done() } }
        animator.startAnimation(afterDelay: delay)
    }

    /// composer-mic-in: the mic springs out of the round button (Send, or Stop) from 10pt toward it and .6 of its size
    /// (420ms on --composer-bounce, a few percent of give, 40ms late)
    static func micIn(_ button: UIButton) {
        button.alpha = 0
        if reduced { run(0.2, glyphEase) { button.alpha = 1 }; return }
        button.transform = CGAffineTransform(translationX: 10, y: 0).scaledBy(x: 0.6, y: 0.6)
        UIView.animate(springDuration: 0.42, bounce: 0.2, initialSpringVelocity: 0, delay: 0.04, options: [.allowUserInteraction]) {
            button.alpha = 1
            button.transform = .identity
        }
    }

    /// send arriving with the first character: m-pop, from .9 on the release spring
    static func popIn(_ button: UIButton) {
        button.alpha = 0
        if reduced { run(0.2, glyphEase) { button.alpha = 1 }; return }
        button.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        UIView.animate(springDuration: 0.34, bounce: 0.2) { button.alpha = 1; button.transform = .identity }
    }

    /// composer-mic-out: the mic beside the round button slips back into it (150ms) as the field empties or the turn ends
    static func leave(_ button: UIButton, done: @escaping () -> Void) {
        run(0.15, leaveEase, { button.alpha = 0; if !reduced { button.transform = CGAffineTransform(translationX: 10, y: 0).scaledBy(x: 0.6, y: 0.6) } }, done: done)
    }
}

private extension UIColor {
    convenience init?(cssHex value: String) {
        var hex = value.trimmingCharacters(in: .whitespaces)
        guard hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, let n = UInt32(hex, radix: 16) else { return nil }
        self.init(red: CGFloat((n >> 16) & 0xff) / 255, green: CGFloat((n >> 8) & 0xff) / 255, blue: CGFloat(n & 0xff) / 255, alpha: 1)
    }
}
