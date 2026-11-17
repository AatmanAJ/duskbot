import Capacitor
import UIKit

class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(QrScannerPlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
        bridge?.registerPluginInstance(SpeechRecognizerPlugin())
        bridge?.registerPluginInstance(GlassChromePlugin())
        // iOS 26 gives the web view's scroll view a top edge effect that draws a pale band under the status bar; the
        // page scrolls inside itself, so the effect never tracks its content
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
            webView?.scrollView.bottomEdgeEffect.isHidden = true
        }
    }
}
