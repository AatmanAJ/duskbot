package bot.dusk.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeechRecognizerPlugin.class);
        registerPlugin(PushSetupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
