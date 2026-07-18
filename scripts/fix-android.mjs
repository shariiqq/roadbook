// Post-`cap add android` patches. Runs in CI before the Gradle build.
//   1) add the permissions background-geolocation + file saving need
//   2) patch MainActivity to request "all files access" once, so saved
//      drives land in a visible Documents/Roadbook folder on Android 11+.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* ---------- 1. Manifest permissions ---------- */
const manifest = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifest)) {
  console.error('AndroidManifest.xml not found at', manifest);
  process.exit(1);
}
let xml = readFileSync(manifest, 'utf8');

const perms = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_EXTERNAL_STORAGE'
];

const lines = perms
  .filter(p => !xml.includes(`android:name="${p}"`))
  .map(p => `    <uses-permission android:name="${p}" />`);

if (lines.length) {
  xml = xml.replace(/(<manifest[^>]*>)/, `$1\n${lines.join('\n')}`);
  writeFileSync(manifest, xml);
  console.log('Added permissions:\n' + lines.join('\n'));
} else {
  console.log('All required permissions already present.');
}

/* ---------- 2. Request all-files access in MainActivity ---------- */
const javaRoot = 'android/app/src/main/java';
let mainActivity = null;
if (existsSync(javaRoot)) {
  for (const entry of readdirSync(javaRoot, { recursive: true })) {
    if (String(entry).endsWith('MainActivity.java')) {
      mainActivity = join(javaRoot, String(entry));
      break;
    }
  }
}

if (!mainActivity) {
  console.warn('MainActivity.java not found — skipping all-files-access patch.');
} else {
  const existing = readFileSync(mainActivity, 'utf8');
  const pkg = (existing.match(/package\s+([\w.]+);/) || [])[1] || 'com.roadbook.app';
  const java = `package ${pkg};

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RoadbookFile.class);
        super.onCreate(savedInstanceState);
        // On Android 11+, saving to the visible Documents folder needs all-files access.
        // Send the user to the system toggle once; after they allow it, this never fires again.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                } catch (Exception ignored) {}
            }
        }
    }
}
`;
  writeFileSync(mainActivity, java);
  console.log('Patched MainActivity for all-files access at', mainActivity);

  /* ---------- 3. Native file-slice reader (for the offline map) ---------- */
  // Reads small byte ranges straight off disk with RandomAccessFile - the same
  // approach native map apps use. Avoids the WebView HTTP layer entirely.
  const pluginJava = `package ${pkg};

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.RandomAccessFile;

@CapacitorPlugin(name = "RoadbookFile")
public class RoadbookFile extends Plugin {

    private static String clean(String p) {
        if (p == null) return null;
        if (p.startsWith("file://")) p = p.substring(7);
        return p;
    }

    @PluginMethod
    public void size(PluginCall call) {
        String path = clean(call.getString("path"));
        if (path == null) { call.reject("no path"); return; }
        File f = new File(path);
        JSObject ret = new JSObject();
        ret.put("size", f.exists() ? f.length() : 0);
        ret.put("exists", f.exists());
        call.resolve(ret);
    }

    @PluginMethod
    public void readSlice(PluginCall call) {
        String path = clean(call.getString("path"));
        Double offD = call.getDouble("offset");
        Integer lenI = call.getInt("length");
        if (path == null || offD == null || lenI == null) { call.reject("bad args"); return; }
        long offset = offD.longValue();
        int length = lenI.intValue();
        if (length <= 0 || length > 33554432) { call.reject("bad length"); return; }
        RandomAccessFile raf = null;
        try {
            raf = new RandomAccessFile(path, "r");
            raf.seek(offset);
            byte[] buf = new byte[length];
            int total = 0;
            while (total < length) {
                int n = raf.read(buf, total, length - total);
                if (n < 0) break;
                total += n;
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(buf, 0, total, Base64.NO_WRAP));
            ret.put("length", total);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        } finally {
            if (raf != null) { try { raf.close(); } catch (Exception ignored) {} }
        }
    }
}
`;
  const pluginPath = join(mainActivity, '..', 'RoadbookFile.java');
  writeFileSync(pluginPath, pluginJava);
  console.log('Wrote native file-slice plugin at', pluginPath);
}
