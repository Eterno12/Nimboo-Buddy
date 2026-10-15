# Nimboo no Android — ambiente e comandos

Plano: [`PLANO-MOBILE.md`](PLANO-MOBILE.md). Decisões: D55 (nuvem) e D56 (banco do celular).

## Ambiente (instalado em `G:\Android`, fora do C:)

| Item | Caminho |
|---|---|
| JDK 21 (Temurin) | `G:\Android\jdk\jdk-21.0.12.1+1` |
| Android SDK | `G:\Android\sdk` (`cmdline-tools\latest`, `platform-tools`, `platforms;android-35`, `build-tools;35.0.0`) |

Variáveis usadas nos comandos (PowerShell):

```powershell
$env:JAVA_HOME = 'G:\Android\jdk\jdk-21.0.12.1+1'
$env:ANDROID_HOME = 'G:\Android\sdk'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

## Comandos

```bash
npm run dev:mobile          # app no navegador (http://localhost:5174), banco em IndexedDB
npm run build:mobile        # gera dist-mobile/
npm run test:e2e:mobile     # app web no Chromium com servidor falso
npx cap sync android        # copia dist-mobile para o projeto Android
cd android && ./gradlew assembleDebug    # gera android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk   # celular com depuração USB
```

Compilar no PowerShell (o `local.properties` usa barras normais: `sdk.dir=G:/Android/sdk`):

```powershell
cd G:\Mochi-Desktop\android
$env:JAVA_HOME='G:\Android\jdk\jdk-21.0.12.1+1'; $env:ANDROID_HOME='G:\Android\sdk'; $env:GRADLE_USER_HOME='G:\Android\gradle-home'
.\gradlew.bat assembleDebug
& 'G:\Android\sdk\platform-tools\adb.exe' install -r app\build\outputs\apk\debug\app-debug.apk
```

## Arquitetura resumida
- `mobile/src/` — casca do app (React). `mobile/db/` — banco sql.js + persistência.
- No Android o banco é um arquivo no armazenamento privado do app (`@capacitor/filesystem`);
  no navegador, IndexedDB. A sessão (tokens) é cifrada com AES-GCM e uma chave não extraível.
- A sincronização é o mesmo motor do PC (`shared/sync/engine.ts`).
