# AI Lighting Compositor

**⚠️ VIBE CODING PROJECT ⚠️**
*This project was generated using AI ("Vibe Coding") and may contain experimental features, bugs, or unoptimized code. Use at your own risk.*

## Overview
A web-based tool for compositing AI-generated lighting effects onto base images. It uses Google's Gemini models to generate lighting passes (rim lights, fog, etc.) and OpenCV for automatic alignment.

## Features
- **Upload Base Image**: Start with your render or photo.
- **AI Lighting Generation**: Generate lighting layers using text prompts (e.g., "warm rim light").
- **Layer System**: Stack multiple lighting passes with opacity control.
- **Auto-Alignment**: Uses computer vision to align generated lighting with the base image.
- **Privacy**: API Keys are stored locally in your browser.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd test_app_image
    ```

2.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run the Server**:
    ```bash
    python main.py
    ```

4.  **Access the App**:
    Open `http://127.0.0.1:8000` in your browser.

## Usage

1.  **Upload**: Drag and drop your image onto the upload page.
2.  **API Key**: Click "API Settings" in the top menu and enter your **Google Gemini API Key**.
3.  **Add Layer**: Click "+ Add Layer", enter a prompt (e.g., "blue cinematic fog"), and click Generate.
4.  **Align**: If the lighting is slightly off, click the **Magic Wand** icon on the layer to auto-align it.
5.  **Export**: (Currently, you can save the canvas by right-clicking it, or implement a save button).

## Tech Stack
- **Backend**: FastAPI, Python, OpenCV, Google GenAI SDK.
- **Frontend**: HTML5 Canvas, Vanilla JS.

---