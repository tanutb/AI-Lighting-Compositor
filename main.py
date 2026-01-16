import os
import shutil
import asyncio
import mimetypes
import time
import sys
from typing import Optional
from pathlib import Path
from functools import lru_cache

from fastapi import FastAPI, Request, File, UploadFile, Form
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from google import genai
from google.genai import types

# Path Helper for PyInstaller
def resource_path(relative_path):
    """Get absolute path to resource, works for dev and for PyInstaller"""
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


from fastapi.middleware.cors import CORSMiddleware

# Configuration
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Writable paths (local disk)
if getattr(sys, 'frozen', False):
    app_dir = Path(sys.executable).parent
else:
    app_dir = Path(__file__).parent

UPLOAD_FOLDER = app_dir / "user_data" / "uploads"
GENERATED_FOLDER = app_dir / "user_data" / "generated"
SYSTEM_PROMPT_FILE = app_dir / "user_data" / "system_prompt.txt"

# Create directories
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
GENERATED_FOLDER.mkdir(parents=True, exist_ok=True)

# Ensure system prompt exists in user_data
if not SYSTEM_PROMPT_FILE.exists():
    default_prompt_path = resource_path("system_prompt.txt")
    if os.path.exists(default_prompt_path):
        shutil.copy(default_prompt_path, SYSTEM_PROMPT_FILE)
    else:
        with open(SYSTEM_PROMPT_FILE, "w") as f:
            f.write("You are a professional cinematic lighting artist. Generate a lighting-only pass.")

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

# Cache for system prompt
_system_prompt_cache = {"content": None, "mtime": 0}


def get_system_prompt_cached() -> str:
    """Get system prompt with file-based caching"""
    global _system_prompt_cache

    if not SYSTEM_PROMPT_FILE.exists():
        return ""

    current_mtime = SYSTEM_PROMPT_FILE.stat().st_mtime

    if _system_prompt_cache["mtime"] != current_mtime:
        with open(SYSTEM_PROMPT_FILE, "r", encoding="utf-8") as f:
            _system_prompt_cache["content"] = f.read()
            _system_prompt_cache["mtime"] = current_mtime

    return _system_prompt_cache["content"] or ""


# Mount Static Files
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_FOLDER)), name="uploads")
app.mount("/static/generated", StaticFiles(directory=str(GENERATED_FOLDER)), name="generated")
app.mount("/static", StaticFiles(directory=resource_path("static")), name="static")

# Templates
templates = Jinja2Templates(directory=resource_path("templates"))


# Models
class SystemPromptUpdate(BaseModel):
    content: str


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# Async file write helper
async def async_write_file(filepath: Path, data: bytes):
    """Write file asynchronously using thread pool"""
    def _write():
        with open(filepath, "wb") as f:
            f.write(data)
    await asyncio.to_thread(_write)


async def async_copy_file(source, dest: Path):
    """Copy uploaded file asynchronously"""
    def _copy():
        with open(dest, "wb") as buffer:
            shutil.copyfileobj(source, buffer)
    await asyncio.to_thread(_copy)


@app.get("/", response_class=HTMLResponse)
async def upload_page(request: Request):
    return templates.TemplateResponse("upload.html", {"request": request})


@app.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    if not file.filename:
        return RedirectResponse(url="/", status_code=303)

    if allowed_file(file.filename):
        filename = Path(file.filename).name.replace(" ", "_")
        filepath = UPLOAD_FOLDER / filename

        # Read content first (required for async operations)
        content = await file.read()
        await async_write_file(filepath, content)

        return RedirectResponse(url=f"/workspace?filename={filename}", status_code=303)

    return RedirectResponse(url="/", status_code=303)


@app.post("/api/save-composite")
async def save_composite(file: UploadFile = File(...)):
    if not file.filename:
        return JSONResponse({"error": "No filename"}, status_code=400)

    original_name = Path(file.filename).name.replace(" ", "_")
    name, ext = os.path.splitext(original_name)
    timestamp = int(time.time())
    filename = f"{name}_edit_{timestamp}{ext}"

    filepath = UPLOAD_FOLDER / filename

    try:
        content = await file.read()
        await async_write_file(filepath, content)
        return JSONResponse({"filename": filename, "url": f"/static/uploads/{filename}"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/workspace", response_class=HTMLResponse)
async def workspace(request: Request, filename: str = ""):
    if not filename:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("workspace.html", {
        "request": request,
        "filename": filename,
        "version": int(time.time())
    })


@app.get("/photo-editor", response_class=HTMLResponse)
async def photo_editor(request: Request, image: str = ""):
    """Photo Editor - Professional image editing tools"""
    return templates.TemplateResponse("photo-editor.html", {
        "request": request,
        "image": image,
        "version": int(time.time())
    })


@app.get("/editor-upload", response_class=HTMLResponse)
async def editor_upload_page(request: Request):
    return templates.TemplateResponse("editor-upload.html", {
        "request": request,
        "version": int(time.time())
    })


@app.post("/api/editor-upload")
async def api_editor_upload(file: UploadFile = File(...)):
    if not file.filename:
        return RedirectResponse(url="/editor-upload", status_code=303)

    original_name = Path(file.filename).name.replace(" ", "_")
    name, ext = os.path.splitext(original_name)
    timestamp = int(time.time())
    filename = f"{name}_edit_{timestamp}{ext}"

    filepath = UPLOAD_FOLDER / filename

    try:
        content = await file.read()
        await async_write_file(filepath, content)
        return RedirectResponse(url=f"/photo-editor?image={filename}", status_code=303)
    except Exception as e:
        return RedirectResponse(url="/editor-upload", status_code=303)


# --- System Prompt Endpoints ---

@app.get("/system-prompt")
async def get_system_prompt():
    content = get_system_prompt_cached()
    return JSONResponse({"content": content})


@app.post("/system-prompt")
async def update_system_prompt(update: SystemPromptUpdate):
    global _system_prompt_cache

    def _write():
        with open(SYSTEM_PROMPT_FILE, "w", encoding="utf-8") as f:
            f.write(update.content)

    await asyncio.to_thread(_write)

    # Invalidate cache
    _system_prompt_cache["mtime"] = 0

    return JSONResponse({"status": "success"})


# --- Generation Endpoint ---

def save_binary_file(file_path: Path, data: bytes):
    with open(file_path, "wb") as f:
        f.write(data)


@app.post("/generate")
async def generate_lighting(
    filename: str = Form(...),
    prompt: str = Form(...),
    api_key: str = Form(None)
):
    """Generation using Google GenAI SDK (Gemini 3 Pro)."""

    # 1. Validate Input
    image_path = UPLOAD_FOLDER / filename
    if not image_path.exists():
        return JSONResponse({"error": "Base image not found"}, status_code=404)

    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return JSONResponse({"error": "API Key is required"}, status_code=401)

    # 2. Read System Prompt (cached)
    system_prompt_content = get_system_prompt_cached()

    try:
        # Read image file asynchronously
        def _read_image():
            with open(image_path, "rb") as f:
                return f.read()

        image_bytes = await asyncio.to_thread(_read_image)

        # Determine MIME type
        suffix = image_path.suffix.lower()
        mime_type_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif"
        }
        mime_type = mime_type_map.get(suffix, "image/jpeg")

        full_prompt = f"{system_prompt_content}\n\nUser Request: {prompt}"

        # Prepare request
        client = genai.Client(api_key=api_key)
        model = "gemini-3-pro-image-preview"

        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    types.Part.from_text(text=full_prompt),
                ],
            ),
        ]

        generate_content_config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(image_size="1K"),
        )

        generated_filename = None

        def run_genai():
            nonlocal generated_filename
            file_index = int(time.time())

            for chunk in client.models.generate_content_stream(
                model=model,
                contents=contents,
                config=generate_content_config,
            ):
                if (
                    chunk.candidates is None
                    or chunk.candidates[0].content is None
                    or chunk.candidates[0].content.parts is None
                ):
                    continue

                for part in chunk.candidates[0].content.parts:
                    if part.inline_data and part.inline_data.data:
                        inline_data = part.inline_data
                        data_buffer = inline_data.data

                        ext = ".png"
                        if inline_data.mime_type:
                            guess = mimetypes.guess_extension(inline_data.mime_type)
                            if guess:
                                ext = guess

                        base_name = Path(filename).stem
                        fname = f"gen_{file_index}_{base_name}{ext}"
                        out_path = GENERATED_FOLDER / fname

                        save_binary_file(out_path, data_buffer)
                        generated_filename = fname
                        return

        await asyncio.to_thread(run_genai)

        if generated_filename:
            return JSONResponse({"url": f"/static/generated/{generated_filename}"})
        else:
            return JSONResponse({"error": "No image generated by model"}, status_code=500)

    except Exception as e:
        print(f"GenAI Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == '__main__':
    import uvicorn
    import multiprocessing
    multiprocessing.freeze_support()

    uvicorn.run(app, host="127.0.0.1", port=8000)
