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
            guard let host = self.bridge?.webView else { return }
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
    private static let inset: CGFloat = 7
    private static let disc: CGFloat = 34
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
    private let plus = UIButton(configuration: .glass())
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
        applyHeader(state["header"] as? [String: Any])
        applyComposer(state["composer"] as? [String: Any])
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

    private func applyActions(_ buttons: [[String: Any]]) {
        let kinds = buttons.map { $0["kind"] as? String ?? "" }
        if kinds != actionKinds {
            let leaving = zip(actions, actionKinds).map { ($0, $1) }
            let wasWorking = actionKinds.contains("stop")
            actions = kinds.enumerated().map { index, kind in makeAction(kind, index: index) }
            actions.forEach(capsule.contentView.addSubview)
            actionKinds = kinds
            layoutComposer()
            let working = kinds.contains("stop")
            for (button, kind) in leaving {
                button.isUserInteractionEnabled = false
                if wasWorking && !working && (kind == "stop" || kind == "mic") {
                    if kind == "stop" { capsule.contentView.bringSubviewToFront(button) }
                    ComposerMotion.leave(button, kind: kind) { button.removeFromSuperview() }
                } else {
                    button.removeFromSuperview()
                }
            }
            let had = Set(leaving.map { $0.1 })
            for (button, kind) in zip(actions, kinds) {
                if (kind == "send" || kind == "micSend") && !had.contains(kind) { ComposerMotion.popIn(button) }
                else if kind == "stop" && !wasWorking { ComposerMotion.stopIn(button) }
                else if kind == "mic" && working && !wasWorking { ComposerMotion.micIn(button) }
                else if kind == "mic" && wasWorking && !working { ComposerMotion.glyphIn(button) }
            }
        }
        for (button, data) in zip(actions, buttons) {
            button.isEnabled = !(data["disabled"] as? Bool ?? false)
            if let label = data["label"] as? String, !label.isEmpty { button.accessibilityLabel = label }
        }
    }

    private func makeAction(_ kind: String, index: Int) -> UIButton {
        let prominent = kind == "send" || kind == "micSend"
        let button = UIButton(configuration: prominent ? .prominentGlass() : kind == "followUp" ? .plain() : .glass())
        let symbol: String
        switch kind {
        case "mic": symbol = "mic.fill"
        case "send", "micSend": symbol = "arrow.up"
        case "stop": symbol = "stop.fill"
        case "waits": symbol = "clock"
        case "followUp": symbol = "chevron.up"
        case "discard": symbol = "xmark"
        default: symbol = "circle"
        }
        button.configuration?.cornerStyle = .capsule
        button.configuration?.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: prominent ? 16 : 15, weight: prominent ? .bold : .semibold))
        button.configuration?.baseForegroundColor = prominent ? .white : kind == "mic" ? .secondaryLabel : .label
        if prominent { button.tintColor = accent }
        button.addAction(UIAction { [weak self] _ in self?.emit(["type": "button", "index": index]) }, for: .touchUpInside)
        return button
    }

    private func show(_ view: UIView, _ visible: Bool, _ shown: inout Bool) {
        guard visible != shown else { return }
        shown = visible
        if visible { view.isHidden = false }
        UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
            view.alpha = visible ? 1 : 0
        } completion: { _ in
            if !visible && view.alpha == 0 { view.isHidden = true }
        }
    }

    // MARK: layout

    private func layoutComposer() {
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
            UIView.animate(springDuration: 0.3, bounce: 0) { self.host?.layoutIfNeeded() }
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
            layoutComposer()
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

    private static func glyph(_ button: UIButton) -> UIView {
        button.layoutIfNeeded()
        return button.imageView ?? button
    }

    private static func run(_ duration: TimeInterval, _ timing: UITimingCurveProvider, delay: TimeInterval = 0, _ change: @escaping () -> Void, done: (() -> Void)? = nil) {
        let animator = UIViewPropertyAnimator(duration: duration, timingParameters: timing)
        animator.addAnimations(change)
        if let done { animator.addCompletion { _ in done() } }
        animator.startAnimation(afterDelay: delay)
    }

    /// composer-stop-in: the square turns in from a quarter turn back, small and soft (260ms)
    static func stopIn(_ button: UIButton) {
        let view = glyph(button)
        view.alpha = 0
        if !reduced { view.transform = CGAffineTransform(rotationAngle: -.pi / 4).scaledBy(x: 0.4, y: 0.4) }
        run(0.26, glyphEase) { view.alpha = 1; view.transform = .identity }
    }

    /// composer-mic-in: the small mic springs in beside Stop from 10pt toward it (420ms, a few percent of give, 40ms late)
    static func micIn(_ button: UIButton) {
        button.alpha = 0
        if reduced { run(0.2, glyphEase) { button.alpha = 1 }; return }
        button.transform = CGAffineTransform(translationX: 10, y: 0).scaledBy(x: 0.6, y: 0.6)
        UIView.animate(springDuration: 0.42, bounce: 0.2, initialSpringVelocity: 0, delay: 0.04, options: [.allowUserInteraction]) {
            button.alpha = 1
            button.transform = .identity
        }
    }

    /// composer-glyph-in: the glyph that comes back to the round button pops in (200ms)
    static func glyphIn(_ button: UIButton) {
        let view = glyph(button)
        view.alpha = 0
        if !reduced { view.transform = CGAffineTransform(scaleX: 0.5, y: 0.5) }
        run(0.2, glyphEase) { view.alpha = 1; view.transform = .identity }
    }

    /// send arriving with the first character: m-pop, from .9 on the release spring
    static func popIn(_ button: UIButton) {
        button.alpha = 0
        if reduced { run(0.2, glyphEase) { button.alpha = 1 }; return }
        button.transform = CGAffineTransform(scaleX: 0.9, y: 0.9)
        UIView.animate(springDuration: 0.34, bounce: 0.2) { button.alpha = 1; button.transform = .identity }
    }

    /// the turn over: Stop's disc fades and shrinks over the mic coming back (composer-glyph-out, 200ms) and the small
    /// mic beside it slips back out (composer-mic-out, 150ms)
    static func leave(_ button: UIButton, kind: String, done: @escaping () -> Void) {
        if kind == "stop" {
            run(0.2, glyphEase, { button.alpha = 0; if !reduced { button.transform = CGAffineTransform(scaleX: 0.5, y: 0.5) } }, done: done)
        } else {
            run(0.15, leaveEase, { button.alpha = 0; if !reduced { button.transform = CGAffineTransform(translationX: 10, y: 0).scaledBy(x: 0.6, y: 0.6) } }, done: done)
        }
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
