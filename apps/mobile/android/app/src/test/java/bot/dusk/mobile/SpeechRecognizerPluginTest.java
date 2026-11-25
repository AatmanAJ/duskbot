package bot.dusk.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.speech.SpeechRecognizer;
import org.junit.Test;

public class SpeechRecognizerPluginTest {

    @Test
    public void aMissingOfflineLanguageRetriesOnlineOnce() {
        assertTrue(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, true, 35));
        assertTrue(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, true, 31));
        assertFalse(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, false, 35));
    }

    @Test
    public void otherErrorsAndOlderPhonesDoNotRetryOnline() {
        assertFalse(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_NO_MATCH, true, 35));
        assertFalse(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_AUDIO, true, 35));
        assertFalse(SpeechRecognizerPlugin.retryOnline(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, true, 30));
    }
}
