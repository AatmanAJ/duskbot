import Capacitor
import UIKit
import WebKit

/// The screen's root view: the web view fills it and the app's native layers (glass chrome, camera) sit beside it.
/// Inside WKWebView, UIKit and WebKit add views of their own after ours (iOS 26's scroll edge pocket at the top), which
/// can cover a layer and take its touches.
final class WebContainerView: UIView {}

extension CAPBridgeProtocol {
    /// Where the app's native layers go: the container round the web view, or the web view itself before it has one.
    var nativeHost: UIView? {
        guard let web = webView else { return nil }
        return web.superview as? WebContainerView ?? web
    }
}

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(QrScannerPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(SpeechRecognizerPlugin())
        bridge?.registerPluginInstance(GlassChromePlugin())
        bridge?.registerPluginInstance(NativeMenuPlugin())
        // iOS 26 gives the web view's scroll view a top edge effect that draws a pale band under the status bar; the
        // page scrolls inside itself, so the effect never tracks its content
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
            webView?.scrollView.bottomEdgeEffect.isHidden = true
        }
    }

    /// Capacitor makes the web view the controller's view (its loadView is final). Put it in a container instead, so a
    /// context menu interaction can watch it from outside (one on WKWebView itself fights the page's touch events) and
    /// native layers can stack above it.
    override open func viewDidLoad() {
        super.viewDidLoad()
        guard let web = webView, view === web else { return }
        let root = WebContainerView(frame: web.frame)
        root.backgroundColor = web.backgroundColor
        root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.frame = root.bounds
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.addSubview(web)
        view = root
    }
}
