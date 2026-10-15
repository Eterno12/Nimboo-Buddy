package app.nimboo.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte JS → widget: o app grava widget.json e chama refresh() para o Android redesenhar. */
@CapacitorPlugin(name = "NimbooWidget")
public class NimbooWidgetPlugin extends Plugin {
    @PluginMethod
    public void refresh(PluginCall call) {
        NimbooWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
