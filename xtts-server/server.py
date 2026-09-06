import io
import os
import threading
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

os.environ.setdefault("COQUI_TOS_AGREED", "1")

MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REFERENCE = Path(
    os.environ.get(
        "DUBAI_VOICE_REFERENCE",
        PROJECT_ROOT
        / "example_voices"
        / "ElevenLabs_2026-09-06T02_00_43_Roger - Laid-Back, Casual, Resonant_pre_sp100_s50_sb75_se0_b_m2.mp3",
    )
)

app = FastAPI(title="DubAI XTTS", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

model = None
model_lock = threading.Lock()


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    language: str = "es"
    reference: str | None = None


def load_model():
    global model
    if model is not None:
        return model
    with model_lock:
        if model is None:
            from TTS.api import TTS

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = TTS(MODEL_NAME).to(device)
    return model


@app.get("/health")
def health():
    return {
        "ok": True,
        "loaded": model is not None,
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "reference": str(DEFAULT_REFERENCE),
        "reference_exists": DEFAULT_REFERENCE.is_file(),
    }


@app.post("/load")
def load():
    try:
        load_model()
        return {"ok": True, "loaded": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/tts")
def synthesize(req: SynthesisRequest):
    reference = Path(req.reference) if req.reference else DEFAULT_REFERENCE
    if not reference.is_file():
        raise HTTPException(status_code=400, detail=f"No existe la referencia: {reference}")

    try:
        tts = load_model()
        with model_lock:
            samples = tts.tts(
                text=req.text.strip(),
                speaker_wav=str(reference),
                language=req.language,
                split_sentences=False,
            )
        sample_rate = int(tts.synthesizer.output_sample_rate)
        output = io.BytesIO()
        sf.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
        return Response(content=output.getvalue(), media_type="audio/wav")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

