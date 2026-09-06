# DubAI

Extensión de Chrome para traducir y doblar videos de YouTube, Udemy y otras
plataformas. La traducción y la voz pueden ejecutarse localmente:

- Ollama traduce los subtítulos.
- XTTS v2 genera la voz clonada desde un audio de referencia.
- Whisper intenta transcribir videos sin subtítulos (modo experimental).
- DubAI sincroniza la voz con pausa, reproducción y desplazamiento del video.
- Ollama conserva comandos y términos técnicos en inglés dentro de una
  traducción natural al español.
- Una memoria local aprende del glosario y de las correcciones del usuario.
- La traducción y las voces XTTS se preparan por adelantado para reducir latencia.

## Requisitos

- Windows 10/11.
- Google Chrome.
- Ollama.
- Python 3.11 para el servidor XTTS.
- GPU NVIDIA recomendada. La configuración actual usa una RTX 5060 Ti.
- Un audio de referencia cuya voz tengas autorización para utilizar.

El entorno XTTS de este equipo ya está instalado en `xtts-server/.venv`.

## Inicio rápido

Abre PowerShell en la carpeta del proyecto:

```powershell
cd C:\Users\PC\Work\dubbing
```

### Comando único recomendado

Haz doble clic en:

```text
start-dubai.cmd
```

O ejecútalo desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
```

El comando cierra servidores anteriores, reinicia Ollama, autoriza DubAI,
descarga `llama3.1:8b` si falta, libera otros modelos de la GPU, mantiene
`llama3.1:8b` cargado, reinicia XTTS y precarga la voz clonada.

Cuando muestre `DubAI listo`, puedes cerrar la ventana: ambos servidores
continuarán ejecutándose en segundo plano.

### 1. Iniciar Ollama

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-ollama.ps1
```

Este script:

- Localiza el ID de DubAI instalado en Chrome.
- Autoriza ese origen mediante `OLLAMA_ORIGINS`.
- Cierra instancias antiguas de Ollama.
- Inicia un único servidor en `http://localhost:11434`.

Comprobar Ollama:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-ollama.ps1
```

Modelos instalados actualmente:

- `llama3.1:8b`: recomendado por su mayor calidad de traducción.
- `qwen2.5:3b`: menor consumo, pero puede mezclar idiomas en frases difíciles.

### 2. Iniciar el servidor XTTS

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-xtts.ps1
```

Mantén esa terminal abierta mientras utilices la voz clonada. El servidor queda
disponible en:

```text
http://127.0.0.1:8020
```

La primera carga puede tardar varios segundos. Las siguientes síntesis son
considerablemente más rápidas porque el modelo permanece cargado en la GPU.

Comprobar el servidor:

```powershell
Invoke-RestMethod http://127.0.0.1:8020/health
```

Debe responder con `ok: true`, `loaded: true` y `reference_exists: true`.

Probar la voz:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-xtts.ps1
```

La muestra se guarda en `xtts-server/test-roger.wav`.

## Instalar la extensión

1. Abre `chrome://extensions`.
2. Activa **Modo desarrollador**.
3. Pulsa **Cargar sin empaquetar**.
4. Selecciona `C:\Users\PC\Work\dubbing`.
5. Después de cualquier actualización, pulsa **Recargar** en DubAI.
6. Recarga las pestañas de video con `Ctrl+F5`.

La versión actual es `0.4.0`.

## Configuración recomendada

Abre el popup de DubAI y configura:

- **Idioma destino:** Español.
- **Idioma origen:** Automático.
- **Motor de traducción:** Ollama.
- **URL de Ollama:** `http://localhost:11434`.
- **Modelo:** `llama3.1:8b`.
- **Motor de voz:** XTTS local — voz clonada.
- **URL de XTTS:** `http://127.0.0.1:8020`.
- **Audio de referencia:**

```text
example_voices\ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3
```

El servidor usa esa muestra automáticamente cuando el campo queda vacío. Hay
cuatro opciones incluidas en `example_voices`; para escoger otra, escribe su
ruta absoluta. Pulsa **Probar conexión** para Ollama y **Probar servidor XTTS**
para la voz.

### Memoria de traducción

El popup contiene la sección **🧠 Memoria de traducción**. Añade una regla por
línea usando el formato:

```text
kubectl = kubectl
nerdctl = nerdctl
command line = línea de comandos
```

DubAI envía únicamente las reglas relevantes a Ollama. Siglas, comandos,
herramientas, rutas, código y opciones de terminal se conservan en inglés,
mientras el resto se expresa en español natural.

## Uso

1. Inicia Ollama y XTTS.
2. Abre un video compatible.
3. Espera a que el reproductor y sus subtítulos terminen de cargar.
4. Pulsa el micrófono de DubAI integrado en la barra inferior del reproductor,
   o actívalo desde el popup.
5. Reproduce el video.

Al pausar el video, la voz también se detiene. Al reanudar, DubAI continúa desde
la frase correspondiente. Al adelantar o retroceder, cancela la voz anterior y
recalcula la posición.

El botón flotante fue retirado. En YouTube se inserta en sus controles nativos;
en Udemy y otros reproductores HTML5 se acopla a la barra inferior disponible.

Si una frase tarda más que su intervalo, DubAI puede pausar brevemente el video
para evitar acelerar demasiado la voz o superponer frases.

DubAI prepara inicialmente seis fragmentos y después traduce en lotes mayores.
XTTS mantiene una cola limitada de próximas voces para que el doblaje permanezca
por delante incluso cuando el hablante original habla rápido.

### Enseñar una traducción

Cuando aparezca un subtítulo traducido, pulsa **✏️**, escribe la forma correcta y
confirma. La corrección:

- Se aplica al texto actual.
- Se guarda en `chrome.storage.local`.
- Se reutiliza exactamente si vuelve a aparecer la misma frase.
- Se proporciona a Ollama como ejemplo cuando sea relevante.

Las correcciones no reentrenan el modelo y no salen del equipo. Puedes consultar
el total aprendido o borrarlas desde **🧠 Memoria de traducción**.

## Videos sin subtítulos

Activa **Modo Whisper si no hay subtítulos**. DubAI capturará el audio de la
pestaña, intentará transcribirlo localmente, lo traducirá y generará la voz.

Este modo es experimental y tiene más retraso que trabajar con subtítulos
existentes. Procesa bloques de cinco segundos, intenta utilizar WebGPU y vuelve
a WASM si el equipo no lo admite. Al pausar el video también cancela cualquier
traducción o voz atrasada.

## Plataformas

DubAI incluye soporte para:

- YouTube y videos de YouTube incrustados.
- Udemy.
- Coursera.
- Vimeo.
- Bilibili.
- LinkedIn Learning.
- Khan Academy.
- Pluralsight.
- Skillshare.
- Udacity.
- edX.

En plataformas HTML5 intenta obtener los subtítulos mediante TextTrack, archivos
VTT o las peticiones realizadas por el reproductor.

## Solución de problemas

### `Extension context invalidated`

La extensión fue recargada mientras la pestaña mantenía scripts antiguos.

1. Cierra el popup.
2. Recarga DubAI en `chrome://extensions`.
3. Recarga completamente la página del video con `Ctrl+F5`.

### Ollama devuelve `403`

Ejecuta nuevamente:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-ollama.ps1
```

El script autoriza el ID exacto de la extensión y elimina servidores antiguos
que puedan estar ocupando el puerto.

### Ollama queda en “Traduciendo”

Comprueba los modelos activos:

```powershell
ollama ps
```

Evita mantener varios modelos grandes cargados simultáneamente. Puedes liberar
uno con:

```powershell
ollama stop NOMBRE_DEL_MODELO
```

### XTTS queda en “Conectando”

Comprueba:

```powershell
Invoke-RestMethod http://127.0.0.1:8020/health
```

Si no responde, inicia `scripts\start-xtts.ps1`. Después recarga DubAI y la
página del video.

### No se escucha la voz

- Confirma que XTTS responde.
- Comprueba que el motor de voz seleccionado sea XTTS.
- Verifica que el MP3 de referencia continúe en la ruta configurada.
- Sube temporalmente el nivel del audio original para distinguir un fallo de
  síntesis de un silencio completo.
- Detén y vuelve a activar DubAI.

### YouTube dice que no hay subtítulos

- Activa los subtítulos nativos del reproductor.
- Espera unos segundos.
- Recarga la página.
- Vuelve a activar DubAI.
- Si realmente no existen, utiliza Whisper.

## Arquitectura

```text
Video
  -> extractor de subtítulos o Whisper
  -> memoria local (glosario y correcciones)
  -> Ollama / Chrome Translator / NLLB
  -> XTTS o voces del sistema
  -> reproducción sincronizada con el video
```

Componentes principales:

- `src/content`: extracción, traducción, TTS y sincronización.
- `src/background/sw.js`: acceso a Ollama, XTTS y recursos externos.
- `src/offscreen`: modelos locales de Transformers.js y Whisper.
- `src/popup`: configuración de la extensión.
- `chrome.storage.local`: glosario y memoria de correcciones.
- `xtts-server/server.py`: API local de clonación de voz.
- `scripts`: inicio, pruebas y validación.

## ¿Es obligatorio Ollama?

No. Ollama solo realiza la traducción de texto. DubAI dispone de otros motores:

- **Chrome Translator:** traducción local integrada en Chrome. Es la alternativa
  más rápida y consume menos GPU, aunque no todos los pares de idiomas están
  disponibles.
- **Transformers.js:** utiliza OPUS-MT o NLLB dentro de la extensión. No requiere
  Ollama, pero la descarga inicial es grande y en este equipo el backend WASM
  puede ser menos estable.
- **LM Studio:** puede sustituir a Ollama mediante su servidor local compatible
  con OpenAI, pero requiere añadir un adaptador a DubAI.
- **llama.cpp o LocalAI:** también pueden exponer un servidor local para traducir
  con modelos GGUF.
- **API remota:** OpenAI, Claude, Gemini u otro proveedor pueden ofrecer mayor
  calidad, pero enviarían los subtítulos fuera del equipo y podrían tener coste.

Para esta instalación se recomienda:

```text
Ollama (llama3.1:8b) para traducción + XTTS para la voz
```

Si priorizas velocidad y privacidad con menor consumo, selecciona **Automático**
o **Chrome Translator** en el popup y no será necesario iniciar Ollama.

## Privacidad y uso responsable

Ollama y XTTS se ejecutan en `localhost`. Los subtítulos y el audio generado no
se envían a una API comercial. La descarga inicial de modelos utiliza los
repositorios de Ollama, Hugging Face, PyTorch y Coqui.

Utiliza únicamente grabaciones propias o voces para las que tengas permiso
explícito de reutilización y clonación.

