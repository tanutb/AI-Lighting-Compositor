# Architecture Overview

## Backend (FastAPI)
- `main.py`: Entry point. Handles static file serving, API proxying, and image processing.
- **Endpoints**:
    - `/generate`: Proxies requests to Google Gemini API. Handles the image+prompt payload.
    - `/align-layer`: Uses OpenCV (ORB + Homography) to align two images.
    - `/system-prompt`: Manages the persistent system instruction file.

## Frontend (Vanilla JS)
- `static/js/main.js`: Core logic.
    - **Canvas Rendering**: A central `render()` loop draws the base image and all visible layers with 'screen' blending.
    - **State Management**: Layers are stored in a simple array of objects.
    - **Concurrency**: `fetch` requests are handled asynchronously for batch generation.

## Data Flow
1. User Uploads Image -> Saved to `static/uploads`.
2. User Clicks Generate -> Frontend sends Image + Prompt to Backend.
3. Backend -> Google Gemini API (Image + Prompt).
4. Gemini API -> Returns Generated Image Binary.
5. Backend -> Saves to `static/generated` -> Returns URL.
6. Frontend -> Adds new Layer with URL.
7. (Optional) User Clicks Align -> Backend calculates homography -> Overwrites generated file -> Frontend refreshes.
