import os
import shutil
import asyncio
import base64
import mimetypes
import time
from typing import Optional
from pathlib import Path
import cv2
import numpy as np

from fastapi import FastAPI, Request, File, UploadFile, Form, Body
from fastapi.responses import RedirectResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from google import genai
from google.genai import types

# Configuration
app = FastAPI()
UPLOAD_FOLDER = Path("static/uploads")
GENERATED_FOLDER = Path("static/generated")
SYSTEM_PROMPT_FILE = Path("system_prompt.txt")

UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
GENERATED_FOLDER.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

# Ensure system prompt exists
if not SYSTEM_PROMPT_FILE.exists():
    with open(SYSTEM_PROMPT_FILE, "w") as f:
        f.write("You are a professional cinematic lighting artist. Generate a lighting-only pass.")

# Mount Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates
templates = Jinja2Templates(directory="templates")

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

# --- Alignment Logic ---

def align_images(base_path, layer_path):
    # Load images
    img1 = cv2.imread(str(base_path))  # Base
    img2 = cv2.imread(str(layer_path)) # Layer to align
    
    if img1 is None or img2 is None:
        raise Exception("Could not load images for alignment")

    # Convert to grayscale
    gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
    gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)

    # Initialize ORB detector
    orb = cv2.ORB_create(nfeatures=5000)

    # Find keypoints and descriptors
    kp1, des1 = orb.detectAndCompute(gray1, None)
    kp2, des2 = orb.detectAndCompute(gray2, None)

    if des1 is None or des2 is None:
         raise Exception("Could not detect features")

    # Match features
    matcher = cv2.DescriptorMatcher_create(cv2.DESCRIPTOR_MATCHER_BRUTEFORCE_HAMMING)
    matches = matcher.match(des1, des2, None)

    # Sort matches by score
    matches = sorted(matches, key=lambda x: x.distance, reverse=False)

    # Remove poor matches
    numGoodMatches = int(len(matches) * 0.15)
    matches = matches[:numGoodMatches]

    if len(matches) < 4:
         raise Exception("Not enough matches found for alignment")

    # Extract location of good matches
    points1 = np.zeros((len(matches), 2), dtype=np.float32)
    points2 = np.zeros((len(matches), 2), dtype=np.float32)

    for i, match in enumerate(matches):
        points1[i, :] = kp1[match.queryIdx].pt
        points2[i, :] = kp2[match.trainIdx].pt

    # Find homography
    h, mask = cv2.findHomography(points2, points1, cv2.RANSAC)

    # Use homography
    height, width, channels = img1.shape
    img2_reg = cv2.warpPerspective(img2, h, (width, height))

    # Overwrite the layer file with aligned version
    cv2.imwrite(str(layer_path), img2_reg)

@app.post("/align-layer")
async def align_layer(
    base_filename: str = Form(...),
    layer_url: str = Form(...)
):
    base_path = UPLOAD_FOLDER / base_filename
    # Extract filename from URL (/static/generated/...)
    layer_filename = layer_url.split('/')[-1]
    layer_path = GENERATED_FOLDER / layer_filename
    
    if not base_path.exists() or not layer_path.exists():
         return JSONResponse({"error": "File not found"}, status_code=404)

    try:
        # Run alignment in thread
        await asyncio.to_thread(align_images, base_path, layer_path)
        # Return same URL (browser will need to cache-bust)
        return JSONResponse({"url": layer_url, "status": "aligned"})
    except Exception as e:
        print(f"Alignment Error: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)


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
                        
                        fname = f"gen_{{file_index}}_{filename}{{ext}}"
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
    uvicorn.run(app, host="127.0.0.1", port=8000)