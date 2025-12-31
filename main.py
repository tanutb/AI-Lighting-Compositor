import os
import shutil
import asyncio
import base64
import mimetypes
import time
import sys
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, Request, File, UploadFile, Form, Body
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from google import genai
from google.genai import types

# Path Helper for PyInstaller
def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

# Configuration
app = FastAPI()

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

# Mount Static Files
# 1. Mount writable folders specifically to match frontend routes
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_FOLDER)), name="uploads")
app.mount("/static/generated", StaticFiles(directory=str(GENERATED_FOLDER)), name="generated")

# 2. Mount bundled read-only static assets (css/js)
# Note: Frontend requests /static/css/style.css.
# We mount the bundled 'static' folder to /static. 
# FastAPI prioritizes specific mounts, so the above two take precedence for their subpaths.
app.mount("/static", StaticFiles(directory=resource_path("static")), name="static")

# Templates
templates = Jinja2Templates(directory=resource_path("templates"))

# Models
class SystemPromptUpdate(BaseModel):
    content: str

def allowed_file(filename: str):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
        
        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        return RedirectResponse(url=f"/workspace?filename={filename}", status_code=303)
    
    return RedirectResponse(url="/", status_code=303)

@app.get("/workspace", response_class=HTMLResponse)
async def workspace(request: Request, filename: str = ""):
    if not filename:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("workspace.html", {"request": request, "filename": filename})

# --- System Prompt Endpoints ---

@app.get("/system-prompt")
async def get_system_prompt():
    if SYSTEM_PROMPT_FILE.exists():
        with open(SYSTEM_PROMPT_FILE, "r") as f:
            return JSONResponse({"content": f.read()})
    return JSONResponse({"content": ""})

@app.post("/system-prompt")
async def update_system_prompt(update: SystemPromptUpdate):
    with open(SYSTEM_PROMPT_FILE, "w") as f:
        f.write(update.content)
    return JSONResponse({"status": "success"})

# --- Generation Endpoint ---

def save_binary_file(file_name, data):
    with open(file_name, "wb") as f:
        f.write(data)
    print(f"File saved to: {file_name}")

@app.post("/generate")
async def generate_lighting(
    filename: str = Form(...),
    prompt: str = Form(...),
    api_key: str = Form(None)
):
    """
    Generation using Google GenAI SDK (Gemini 3 Pro).
    """
    
    # 1. Validate Input
    image_path = UPLOAD_FOLDER / filename
    if not image_path.exists():
        return JSONResponse({"error": "Base image not found"}, status_code=404)

    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
             return JSONResponse({"error": "API Key is required"}, status_code=401)

    # 2. Read System Prompt
    system_prompt_content = ""
    if SYSTEM_PROMPT_FILE.exists():
        with open(SYSTEM_PROMPT_FILE, "r") as f:
            system_prompt_content = f.read()

    try:
        client = genai.Client(api_key=api_key)
        model = "gemini-3-pro-image-preview"
        
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        
        mime_type = "image/jpeg"
        if filename.lower().endswith(".png"):
            mime_type = "image/png"
        elif filename.lower().endswith(".webp"):
            mime_type = "image/webp"

        full_prompt = f"{system_prompt_content}\n\nUser Request: {prompt}"

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
            response_modalities=[
                "IMAGE", 
            ],
            image_config=types.ImageConfig(
                image_size="1K", 
            ),
        )
        
        generated_filename = None
        
        def run_genai():
            nonlocal generated_filename
            file_index = int(time.time())
            
            # Using synchronous stream in thread
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
                            if guess: ext = guess
                        
                        # Use stem to avoid double extension (e.g. image.jpg.png)
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
    # Multiprocessing support for PyInstaller
    import multiprocessing
    multiprocessing.freeze_support()
    
    uvicorn.run(app, host="127.0.0.1", port=8000)