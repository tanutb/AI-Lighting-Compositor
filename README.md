# AI Lighting Compositor

**⚠️ VIBE CODING PROJECT ⚠️**
*This project was generated using AI ("Vibe Coding") and may contain experimental features, bugs, or unoptimized code. Use at your own risk.*

## Overview
A web-based tool for compositing AI-generated lighting effects onto base images. It uses Google's Gemini models to generate lighting passes (rim lights, fog, etc.).

<div align="center">
  <img src="asset/output.gif" width="100%" alt="App Preview">
</div>

## Features
- **Upload Base Image**: Start with your render or photo.
- **AI Lighting Generation**: Generate lighting layers using text prompts (e.g., "warm rim light").
- **Layer System**: Stack multiple lighting passes with opacity control.
- **Regenerate**: Quickly re-roll specific lighting layers if the result isn't perfect.
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
    *   **SECURITY WARNING**: **DO NOT LEAK YOUR API KEY.** This key is stored in your browser's Local Storage. Do not commit it to version control or share screenshots of the settings modal.
3.  **Add Layer**: Click "+ Add Layer", enter a prompt (e.g., "blue cinematic fog"), and click Generate.
4.  **Refine**: 
    *   Use the **Regenerate (Refresh Icon)** button on a layer to try a new variation.
    *   Use the **Delete (Trash Icon)** button to remove unwanted layers.
    *   Adjust **Opacity** to blend the effect.
5.  **Export**: Click "Save Image" to download the final composition.

## Tech Stack
- **Backend**: FastAPI, Python, Google GenAI SDK.
- **Frontend**: HTML5 Canvas, Vanilla JS.

---
*Disclaimer: This software is provided "as is", without warranty of any kind.*
