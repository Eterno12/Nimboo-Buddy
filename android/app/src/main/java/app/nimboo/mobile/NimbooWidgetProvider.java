package app.nimboo.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Widget da tela inicial: o mascote na pose do momento + as próximas tarefas.
 *
 * O app (JS) grava `widget.json` e este código só lê. Widget não anima, então cada pose é um PNG
 * pré-renderizado em assets/poses (scripts/render-poses.cjs). "Concluir" não abre o app: a ação vai
 * para `widget_inbox.json` e o app aplica quando abrir; o resumo local já some com a tarefa.
 */
public class NimbooWidgetProvider extends AppWidgetProvider {
    static final String ACTION_COMPLETE = "app.nimboo.mobile.WIDGET_COMPLETE";
    static final String EXTRA_TASK_ID = "taskId";
    private static final String SNAPSHOT = "widget.json";
    private static final String INBOX = "widget_inbox.json";

    private static final int[] ROWS = {R.id.row0, R.id.row1, R.id.row2};
    private static final int[] TITLES = {R.id.title0, R.id.title1, R.id.title2};
    private static final int[] DUES = {R.id.due0, R.id.due1, R.id.due2};
    private static final int[] DONES = {R.id.done0, R.id.done1, R.id.done2};

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_COMPLETE.equals(intent.getAction())) {
            String taskId = intent.getStringExtra(EXTRA_TASK_ID);
            if (taskId != null) complete(context, taskId);
        }
        super.onReceive(context, intent);
    }

    /** Redesenha todos os widgets (chamado pelo plugin quando o app grava um resumo novo). */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, NimbooWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    /** Anota a ação na caixa de entrada e tira a tarefa do resumo local. */
    private static void complete(Context context, String taskId) {
        try {
            File inbox = new File(dataDir(context), INBOX);
            JSONArray actions = new JSONArray();
            String old = read(inbox);
            if (old != null) actions = new JSONArray(old);
            JSONObject action = new JSONObject();
            action.put("action", "complete");
            action.put("taskId", taskId);
            actions.put(action);
            write(inbox, actions.toString());

            File file = new File(dataDir(context), SNAPSHOT);
            String text = read(file);
            if (text != null) {
                JSONObject snap = new JSONObject(text);
                JSONArray tasks = snap.optJSONArray("tasks");
                JSONArray kept = new JSONArray();
                if (tasks != null) {
                    for (int i = 0; i < tasks.length(); i++) {
                        JSONObject t = tasks.getJSONObject(i);
                        if (!taskId.equals(t.optString("id"))) kept.put(t);
                    }
                }
                snap.put("tasks", kept);
                snap.put("total", Math.max(0, snap.optInt("total") - 1));
                write(file, snap.toString());
            }
        } catch (Exception ignored) {
            // sem resumo/caixa legível: o app reescreve tudo na próxima abertura
        }
        refreshAll(context);
    }

    static RemoteViews build(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_today);
        PendingIntent open = PendingIntent.getActivity(
                context, 0, new Intent(context, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        v.setOnClickPendingIntent(R.id.widget_root, open);

        JSONObject snap = null;
        try {
            String text = read(new File(dataDir(context), SNAPSHOT));
            if (text != null) snap = new JSONObject(text);
        } catch (Exception ignored) {
        }
        if (snap == null) {
            v.setTextViewText(R.id.headline, context.getString(R.string.widget_empty));
            v.setTextViewText(R.id.subline, "");
            for (int row : ROWS) v.setViewVisibility(row, View.GONE);
            return v;
        }

        String name = snap.optString("name", "Nimboo");
        int overdue = snap.optInt("overdue");
        int today = snap.optInt("today");
        int total = snap.optInt("total");
        v.setTextViewText(R.id.headline, name);
        if (overdue > 0) {
            v.setTextViewText(R.id.subline, overdue == 1 ? "1 atrasada" : overdue + " atrasadas");
        } else if (today > 0) {
            v.setTextViewText(R.id.subline, today == 1 ? "1 tarefa hoje" : today + " tarefas hoje");
        } else if (total > 0) {
            v.setTextViewText(R.id.subline, total == 1 ? "1 pendente" : total + " pendentes");
        } else {
            v.setTextViewText(R.id.subline, "Tudo em dia");
        }

        Bitmap pose = pose(context, snap);
        if (pose != null) v.setImageViewBitmap(R.id.mascot, pose);

        JSONArray tasks = snap.optJSONArray("tasks");
        for (int i = 0; i < ROWS.length; i++) {
            JSONObject t = tasks != null && i < tasks.length() ? tasks.optJSONObject(i) : null;
            if (t == null) {
                v.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setTextViewText(TITLES[i], t.optString("title"));
            v.setTextViewText(DUES[i], t.optString("due"));
            v.setTextColor(DUES[i], t.optBoolean("overdue") ? 0xFFD64545 : 0xFF7A7A8C);
            Intent done = new Intent(context, NimbooWidgetProvider.class);
            done.setAction(ACTION_COMPLETE);
            done.putExtra(EXTRA_TASK_ID, t.optString("id"));
            // requestCode distinto por linha, senão o Android reaproveita o PendingIntent da outra tarefa
            PendingIntent pi = PendingIntent.getBroadcast(
                    context, 100 + i, done, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            v.setOnClickPendingIntent(DONES[i], pi);
        }
        return v;
    }

    private static Bitmap pose(Context context, JSONObject snap) {
        String character = snap.optString("character", "mochi");
        String color = snap.optString("color", "mint");
        String skin = snap.isNull("skin") ? "none" : snap.optString("skin", "none");
        String pose = snap.optString("pose", "idle");
        String[] candidates = {
                character + "_" + color + "_" + skin + "_" + pose,
                character + "_" + color + "_none_" + pose,
                character + "_mint_none_" + pose,
                "mochi_mint_none_idle",
        };
        for (String name : candidates) {
            try (InputStream in = context.getAssets().open("poses/" + name + ".png")) {
                return BitmapFactory.decodeStream(in);
            } catch (Exception ignored) {
                // tenta o próximo (cor/acessório sem pose renderizada)
            }
        }
        return null;
    }

    /** Mesma pasta que o Filesystem do Capacitor usa para Directory.Data. */
    static File dataDir(Context context) {
        return context.getFilesDir();
    }

    private static String read(File f) throws Exception {
        if (!f.exists()) return null;
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void write(File f, String text) throws Exception {
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }
}
